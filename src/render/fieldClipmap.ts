import {
  DoubleSide, Group, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, OrthographicCamera,
  PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector4, WebGLRenderTarget,
  type BufferGeometry, type DataTexture, type WebGLProgramParametersWithUniforms, type WebGLRenderer,
} from 'three'
import { fieldGlslWithSite, type RegionCandidates, type SiteLayout } from './fields'
import type { Season } from './season'

/**
 * # 田色 clipmap
 *
 * 田的顏色由 `fields.ts` 的著色器**每個像素當場算**：區塊種子、田格邊界、樹籬
 * 帶、條紋，廠區再疊距離場。Iris Xe 上那支算式是整層地面成本的七成。這裡把它
 * **烘成兩張跟著鏡頭走的貼圖**，地面改成查貼圖；鏡頭周圍一圈仍走算式，
 * 那一圈的畫質與原本逐位元相同。
 *
 * ## 一層是什麼
 *
 * `n × n` 格、一格 `m` 公尺、蓋 `span = n·m` 的正方形窗。**貼圖是環面的**：
 * 世界格 `c = floor(x / m)` 存在貼圖格 `c mod n`。窗 `[ox, ox + n)` 只決定哪些
 * 格的內容是有效的；取樣是 `fract(world / span)`，不需要原點。
 *
 * ## 挪窗
 *
 * 鏡頭離窗中心超過 `n × RECENTRE_FRACTION` 格就把窗重新置中，只烘**新窗減舊窗**
 * 那至多兩條矩形；每一條映到環面上至多切成四片。位移不小於 `n` 就是整張。
 *
 * 【mipmap 只在一次挪窗的最後一片之後產一次】three 是「畫進 render target
 * 就產一次 mip」，中間幾片先把 `generateMipmaps` 關掉，否則一次挪窗產八次。
 *
 * 【貼圖不配深度緩衝】4096² 的深度是 64 MB，而烘圖是全螢幕四邊形，用不到。
 * 兩張 4096² 帶 mipmap 的貼圖就足以讓 ANGLE D3D11 報記憶體不足並丟掉 context，
 * 尺寸由呼叫端負責，見 `docs/superpowers/specs/2026-09-17-field-clipmap-showcase-design.md`。
 */

/** 鏡頭離窗中心超過窗寬的幾分之幾就挪窗 */
export const RECENTRE_FRACTION = 1 / 8

export interface WindowOrigin { readonly ox: number; readonly oz: number }

/** 世界格的矩形，`[x0, x1) × [z0, z1)` */
export interface CellRect {
  readonly x0: number
  readonly z0: number
  readonly x1: number
  readonly z1: number
}

/** 環面上的一片：貼圖格 `(tx, tz)` 起 `w × h` 格，左下那一格對應世界格 `(cx0, cz0)` */
export interface TorusPiece {
  readonly tx: number
  readonly tz: number
  readonly w: number
  readonly h: number
  readonly cx0: number
  readonly cz0: number
}

/** 讓鏡頭所在的格落在窗中央的窗原點 */
export function windowOriginFor(cell: number, n: number): number {
  return cell - n / 2
}

/** 鏡頭所在的格離窗中心超過 `n × RECENTRE_FRACTION` 就要挪窗 */
export function needsRecentre(origin: number, cell: number, n: number): boolean {
  return Math.abs(cell - (origin + n / 2)) > n * RECENTRE_FRACTION
}

/**
 * 新窗減舊窗，以至多兩塊互不重疊的矩形表示。
 *
 * 第一塊是 x 方向新露出的那一條（配整個新窗的 z），第二塊是 z 方向新露出的
 * 那一條，x 只取兩個窗的交集 —— 角落已經在第一塊裡，不重烘。
 */
export function newCellRects(prev: WindowOrigin, next: WindowOrigin, n: number): CellRect[] {
  const dx = next.ox - prev.ox
  const dz = next.oz - prev.oz
  if (dx === 0 && dz === 0) return []
  if (Math.abs(dx) >= n || Math.abs(dz) >= n) {
    return [{ x0: next.ox, z0: next.oz, x1: next.ox + n, z1: next.oz + n }]
  }
  const rects: CellRect[] = []
  if (dx !== 0) {
    rects.push(dx > 0
      ? { x0: prev.ox + n, z0: next.oz, x1: next.ox + n, z1: next.oz + n }
      : { x0: next.ox, z0: next.oz, x1: prev.ox, z1: next.oz + n })
  }
  if (dz !== 0) {
    const x0 = Math.max(prev.ox, next.ox)
    const x1 = Math.min(prev.ox, next.ox) + n
    rects.push(dz > 0
      ? { x0, z0: prev.oz + n, x1, z1: next.oz + n }
      : { x0, z0: next.oz, x1, z1: prev.oz })
  }
  return rects
}

const mod = (v: number, n: number): number => ((v % n) + n) % n

/** 一軸切成不跨環面邊界的段 */
function axisPieces(a0: number, a1: number, n: number): { c0: number; t: number; len: number }[] {
  const out: { c0: number; t: number; len: number }[] = []
  let start = a0
  while (start < a1) {
    const t = mod(start, n)
    const len = Math.min(a1 - start, n - t)
    out.push({ c0: start, t, len })
    start += len
  }
  return out
}

/** 把世界格的矩形映到環面上；每一軸至多切成兩段，所以至多四片 */
export function torusPieces(rect: CellRect, n: number): TorusPiece[] {
  const out: TorusPiece[] = []
  for (const z of axisPieces(rect.z0, rect.z1, n)) {
    for (const x of axisPieces(rect.x0, rect.x1, n)) {
      out.push({ tx: x.t, tz: z.t, w: x.len, h: z.len, cx0: x.c0, cz0: z.c0 })
    }
  }
  return out
}

export interface ClipLevelSpec {
  /** 每邊幾格 */
  readonly size: number
  /** 一格幾公尺 */
  readonly metersPerTexel: number
}

export interface FieldClipmapOptions {
  readonly season: Season
  readonly site?: SiteLayout
  readonly near: ClipLevelSpec
  readonly far: ClipLevelSpec
  /**
   * 區塊候選表（`farmGround.ts` 建的那一份）。給了的話烘圖與內圈的算式都查表，
   * 每個片段少比五六顆種子；沒給就走完整的 3×3，答案相同
   */
  readonly candidates?: { texture: DataTexture; table: RegionCandidates }
  /** 鏡頭周圍走算式的半徑，m。0 = 純貼圖 */
  readonly innerRadius?: number
  /** 內圈往外漸變到貼圖的寬度，m */
  readonly innerBand?: number
  /** 近圖邊緣漸變到遠圖的寬度，佔近窗半寬的比例 */
  readonly edgeBlend?: number
}

export interface FieldClipmapStats {
  recentres: number
  pieces: number
  texels: number
}

export interface FieldClipmap {
  /** 掛到地面與遠景環的材質 */
  readonly material: MeshStandardMaterial
  readonly stats: FieldClipmapStats
  /**
   * 烘進**遠圖**的平面，畫在田色上面，依加入的次序。`position` 的 xz 是世界
   * 座標（y 不讀）、`color` 是頂點色（線性）。加入後遠圖整張重烘。
   *
   * 幾何歸呼叫端，`dispose` 不丟它。
   */
  addFarOverlay(geometry: BufferGeometry): void
  /**
   * 替貼在地上的材質補一段：**地面改讀遠圖的地方**（近窗外、遠窗內）丟掉片段。
   * 那裡的顏色由 `addFarOverlay` 烘進遠圖的那一份畫；旁路時照畫。
   */
  nearOnly(material: MeshStandardMaterial): void
  /** 每幀叫，該挪窗就烘 */
  update(camX: number, camZ: number): void
  setInnerRadius(m: number): void
  /** 整支改走算式。A/B 用 —— 兩邊是同一個 program，差的只有一個 uniform */
  setBypass(on: boolean): void
  dispose(): void
}

interface Level {
  readonly n: number
  readonly m: number
  readonly span: number
  readonly rt: WebGLRenderTarget
  readonly centre: Vector2
  ox: number
  oz: number
  primed: boolean
}

/** 與 `farmGround.ts` 同一組材質參數；換了的話同一片田在兩條路徑下明暗不同 */
const ROUGHNESS = 0.95

let instances = 0

export function createFieldClipmap(renderer: WebGLRenderer, opts: FieldClipmapOptions): FieldClipmap {
  const cand = opts.candidates
  const glsl = fieldGlslWithSite(opts.season, opts.site, cand !== undefined)
  /** 候選表的兩個 uniform；烘圖材質與地面材質各掛一份同樣的 */
  const candUniforms = (): Record<string, { value: unknown }> => (cand === undefined ? {} : {
    uRegionCand: { value: cand.texture },
    uRegionCandRect: { value: new Vector4(cand.table.gx0, cand.table.gz0, cand.table.blocksX, cand.table.blocksZ) },
  })
  const anisotropy = renderer.capabilities.getMaxAnisotropy()
  const level = (spec: ClipLevelSpec): Level => {
    const rt = new WebGLRenderTarget(spec.size, spec.size, {
      minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, generateMipmaps: true,
      depthBuffer: false, stencilBuffer: false, anisotropy,
    })
    return {
      n: spec.size, m: spec.metersPerTexel, span: spec.size * spec.metersPerTexel,
      rt, centre: new Vector2(), ox: 0, oz: 0, primed: false,
    }
  }
  const near = level(opts.near)
  const far = level(opts.far)
  const stats: FieldClipmapStats = { recentres: 0, pieces: 0, texels: 0 }

  // ── 烘圖 ──
  const bakeMat = new ShaderMaterial({
    uniforms: {
      uCell0: { value: new Vector2() }, uCells: { value: new Vector2() }, uMetres: { value: 1 },
      ...candUniforms(),
    },
    vertexShader: `uniform vec2 uCell0; uniform vec2 uCells; uniform float uMetres; varying vec2 vWorld;
void main() { vWorld = (uCell0 + uv * uCells) * uMetres; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `varying vec2 vWorld;
${glsl}
void main() { gl_FragColor = vec4(fieldColorAt(vWorld), 1.0); }`,
  })
  const quadGeo = new PlaneGeometry(2, 2)
  const bakeScene = new Scene()
  bakeScene.add(new Mesh(quadGeo, bakeMat))
  const bakeCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  // 【疊在田色上的平面】與田色那一片同一組 uniform，世界 xz 換到這一片的裁切座標。
  // 沒有深度緩衝，先後由 `renderOrder` 決定（田色是 0）
  const overlayMat = new ShaderMaterial({
    uniforms: {
      uCell0: bakeMat.uniforms['uCell0']!, uCells: bakeMat.uniforms['uCells']!, uMetres: bakeMat.uniforms['uMetres']!,
    },
    vertexShader: `uniform vec2 uCell0; uniform vec2 uCells; uniform float uMetres;
attribute vec3 color; varying vec3 vCol;
void main() { vCol = color; gl_Position = vec4((position.xz / uMetres - uCell0) / uCells * 2.0 - 1.0, 0.0, 1.0); }`,
    fragmentShader: `varying vec3 vCol;
void main() { gl_FragColor = vec4(vCol, 1.0); }`,
    // 世界 z 映到裁切 y，繞序跟著翻
    side: DoubleSide,
  })
  const overlays = new Group()
  bakeScene.add(overlays)

  const bakePiece = (L: Level, p: TorusPiece, last: boolean): void => {
    overlays.visible = L === far
    // 【viewport／scissor 設在 RT 上】`setRenderTarget` 讀的是 RT 自己那一份，
    // `renderer.setViewport` 設的是畫布的
    L.rt.viewport.set(p.tx, p.tz, p.w, p.h)
    L.rt.scissor.set(p.tx, p.tz, p.w, p.h)
    L.rt.scissorTest = true
    L.rt.texture.generateMipmaps = last
    bakeMat.uniforms['uCell0']!.value.set(p.cx0, p.cz0)
    bakeMat.uniforms['uCells']!.value.set(p.w, p.h)
    bakeMat.uniforms['uMetres']!.value = L.m
    renderer.setRenderTarget(L.rt)
    renderer.render(bakeScene, bakeCam)
    stats.pieces++
    stats.texels += p.w * p.h
  }

  const recentre = (L: Level, camX: number, camZ: number): void => {
    const cx = Math.floor(camX / L.m)
    const cz = Math.floor(camZ / L.m)
    const moveX = !L.primed || needsRecentre(L.ox, cx, L.n)
    const moveZ = !L.primed || needsRecentre(L.oz, cz, L.n)
    if (!moveX && !moveZ) return
    const next: WindowOrigin = {
      ox: moveX ? windowOriginFor(cx, L.n) : L.ox,
      oz: moveZ ? windowOriginFor(cz, L.n) : L.oz,
    }
    const rects = L.primed
      ? newCellRects({ ox: L.ox, oz: L.oz }, next, L.n)
      : [{ x0: next.ox, z0: next.oz, x1: next.ox + L.n, z1: next.oz + L.n }]
    const pieces = rects.flatMap((r) => torusPieces(r, L.n))
    const prev = renderer.getRenderTarget()
    for (let i = 0; i < pieces.length; i++) bakePiece(L, pieces[i]!, i === pieces.length - 1)
    renderer.setRenderTarget(prev)
    L.rt.scissorTest = false
    L.rt.viewport.set(0, 0, L.n, L.n)
    L.ox = next.ox
    L.oz = next.oz
    L.primed = true
    L.centre.set((next.ox + L.n / 2) * L.m, (next.oz + L.n / 2) * L.m)
    stats.recentres++
  }

  // ── 地面的材質 ──
  const U = {
    uNear: { value: near.rt.texture },
    uNearCentre: { value: near.centre },
    uNearSpan: { value: near.span },
    uFar: { value: far.rt.texture },
    uFarCentre: { value: far.centre },
    uFarSpan: { value: far.span },
    uCam: { value: new Vector2() },
    uInner: { value: opts.innerRadius ?? 500 },
    uInnerBand: { value: opts.innerBand ?? 100 },
    uEdgeBlend: { value: opts.edgeBlend ?? 0.05 },
    uBypass: { value: 0 },
  }
  const material = new MeshStandardMaterial({ flatShading: true, roughness: ROUGHNESS })
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, U, candUniforms())
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFarmWorld;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvFarmWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFarmWorld;
uniform sampler2D uNear; uniform vec2 uNearCentre; uniform float uNearSpan;
uniform sampler2D uFar; uniform vec2 uFarCentre; uniform float uFarSpan;
uniform vec2 uCam; uniform float uInner; uniform float uInnerBand; uniform float uEdgeBlend;
uniform float uBypass;
${glsl}`)
      .replace('#include <color_fragment>', `
{
  vec2 w = vFarmWorld.xz;
  // 【導數在分支外算】fract 在 0↔1 交界會讓導數爆掉、mip 掉到最小那一級而畫出
  // 一條線，所以用 textureGrad 配 world/span 的導數；導數指令不能放進分支
  vec2 qN = w / uNearSpan;
  vec2 qF = w / uFarSpan;
  vec2 dNx = dFdx(qN); vec2 dNy = dFdy(qN);
  vec2 dFx = dFdx(qF); vec2 dFy = dFdy(qF);
  float eN = max(abs(w.x - uNearCentre.x), abs(w.y - uNearCentre.y)) / (0.5 * uNearSpan);
  float eF = max(abs(w.x - uFarCentre.x), abs(w.y - uFarCentre.y)) / (0.5 * uFarSpan);
  float tIn = uInner <= 0.0 ? 1.0 : smoothstep(uInner - uInnerBand, uInner, distance(w, uCam));
  bool proc = uBypass > 0.5 || eF >= 1.0 || tIn < 1.0;
  bool tex = uBypass < 0.5 && eF < 1.0 && tIn > 0.0;
  vec3 c = vec3(0.0);
  // 算式：旁路、內圈、遠窗外（遠景環 15 km 外）
  if (proc) c = fieldColorAt(w);
  if (tex) {
    vec3 t = textureGrad(uFar, fract(qF), dFx, dFy).rgb;
    float tN = smoothstep(1.0 - uEdgeBlend, 1.0, eN);
    if (tN < 1.0) t = mix(textureGrad(uNear, fract(qN), dNx, dNy).rgb, t, tN);
    c = proc ? mix(c, t, tIn) : t;
  }
  diffuseColor.rgb = c;
}`)
  }
  const id = instances++
  material.customProgramCacheKey = () =>
    `field-clipmap:${opts.season}:${opts.site === undefined ? '' : 'site'}:${cand === undefined ? '' : 'cand'}:${id}`

  return {
    material,
    stats,
    addFarOverlay(geometry) {
      const mesh = new Mesh(geometry, overlayMat)
      // 包圍球是世界座標，烘圖的鏡頭是 ±1 的正交盒 —— 不關的話整顆被剔掉
      mesh.frustumCulled = false
      mesh.renderOrder = 1 + overlays.children.length
      overlays.add(mesh)
      far.primed = false
    },
    nearOnly(m) {
      m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        Object.assign(shader.uniforms, {
          uNearCentre: U.uNearCentre, uNearSpan: U.uNearSpan,
          uFarCentre: U.uFarCentre, uFarSpan: U.uFarSpan, uBypass: U.uBypass,
          uCam: U.uCam, uInner: U.uInner,
        })
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vNearOnlyXZ;')
          .replace('#include <begin_vertex>',
            '#include <begin_vertex>\nvNearOnlyXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
varying vec2 vNearOnlyXZ;
uniform vec2 uNearCentre; uniform float uNearSpan; uniform vec2 uFarCentre; uniform float uFarSpan;
uniform float uBypass; uniform vec2 uCam; uniform float uInner;`)
          // 【與地面著色器同一個判斷】地面只讀遠圖的地方才讓開：近窗外（eN）、遠窗內
          // （eF）、內圈外（內圈走算式，可以伸出近窗）。任何一條漏了，那裡的鎮地面
          // 變成田
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
{
  vec2 w = vNearOnlyXZ;
  float eN = max(abs(w.x - uNearCentre.x), abs(w.y - uNearCentre.y)) / (0.5 * uNearSpan);
  float eF = max(abs(w.x - uFarCentre.x), abs(w.y - uFarCentre.y)) / (0.5 * uFarSpan);
  bool outsideInner = uInner <= 0.0 || distance(w, uCam) >= uInner;
  if (uBypass < 0.5 && eN >= 1.0 && eF < 1.0 && outsideInner) discard;
}`)
      }
      m.customProgramCacheKey = () => `near-only:${id}`
      m.needsUpdate = true
    },
    update(camX, camZ) {
      recentre(near, camX, camZ)
      recentre(far, camX, camZ)
      U.uCam.value.set(camX, camZ)
    },
    setInnerRadius(m) { U.uInner.value = m },
    setBypass(on) { U.uBypass.value = on ? 1 : 0 },
    dispose() {
      near.rt.dispose()
      far.rt.dispose()
      bakeMat.dispose()
      overlayMat.dispose()
      quadGeo.dispose()
      material.dispose()
    },
  }
}
