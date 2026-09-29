import {
  AddEquation, CustomBlending, DoubleSide, Group, OneFactor, OneMinusSrcAlphaFactor, SrcAlphaFactor, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, OrthographicCamera,
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
 * 那一圈的畫質與原本逐位元相同。遠圖外面可以再一層更粗的（`horizon`），再外面
 * 是那一層的平均色 —— 遠處不走算式。
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

/**
 * 最外層 → 遠景層、遠景層 → 平均色的兩個圓環（離鏡頭的水平距離，m）。
 *
 * 【以鏡頭為圓心，不照窗緣】窗是方的，照窗緣漸變的話從高空看得到直線與角。
 *
 * 【圓環一定落在窗內】鏡頭離窗中心至多 `span × RECENTRE_FRACTION`（再遠就挪窗），
 * 所以窗緣離鏡頭至少 `span / 2 − span × RECENTRE_FRACTION`。圓環的外緣取它的 95%，
 * 寬度取半窗寬的兩成 —— 漸變帶裡兩張貼圖都讀得到
 */
export function outerFades(horizonSpan: number, backdropSpan: number): {
  horFrom: number, horTo: number, avgFrom: number, avgTo: number
} {
  const ring = (span: number): [number, number] => {
    const to = 0.95 * (span / 2 - span * RECENTRE_FRACTION)
    return [to - 0.2 * (span / 2), to]
  }
  const [horFrom, horTo] = ring(horizonSpan)
  const [avgFrom, avgTo] = ring(backdropSpan)
  return { horFrom, horTo, avgFrom, avgTo }
}

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
  /** 田只圍著村，其餘是空地（`fields.ts` 的 `FIELD_REACH`） */
  readonly open?: boolean
  readonly near: ClipLevelSpec
  readonly far: ClipLevelSpec
  /**
   * 遠圖外面再一層，田色與疊圖都烘，遠處的樣子（與遠圖同一種烘法）。遠圖窗外讀它，
   * 它的窗外讀它的平均色 —— 見地面著色器的 `horizonColourAt`。省略的話遠圖窗外
   * 走算式，`beyondFar` 的粗網格畫在遠圖外
   */
  readonly horizon?: ClipLevelSpec
  /**
   * 最外層外面再一層（要有 `horizon` 才有意義），同一種烘法。有它的話平均色取它的、
   * 兩個交界改成以鏡頭為圓心的圓環漸變 —— 見 `outerFades`
   */
  readonly backdrop?: ClipLevelSpec
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
   * 烘進貼圖的平面，畫在田色上面，依加入的次序。`position` 的 xz 是世界座標
   * （y 不讀）、`color` 是頂點色（線性；四個分量的第四個是不透明度，三個分量的是
   * 1）。`near` 為 false 的不烘近圖（屋頂：近窗裡有真的房子）。加入後每一張整張重烘。
   *
   * 【內圈也看得到】內圈的田色走算式，讀不到貼圖；烘圖時疊圖寫它的不透明度、田色
   * 寫 0，內圈照近圖的透明度把疊圖疊回去。
   *
   * 幾何歸呼叫端，`dispose` 不丟它。
   */
  addOverlay(geometry: BufferGeometry, near: boolean): void
  /**
   * 這顆網格已經整顆烘進兩張貼圖（`addOverlay(…, true)`）：平常不畫，旁路時畫
   */
  replaces(mesh: Mesh): void
  /**
   * 這顆網格只畫在遠圖外面（有最外層時是最外層外面）：窗裡的片段丟掉，旁路時整顆
   * 不畫（那時 `replaces` 的那一份畫滿全圖）
   */
  beyondFar(mesh: Mesh): void
  /** 每幀叫，該挪窗就烘 */
  update(camX: number, camZ: number): void
  /**
   * 這一點的地面由哪一層畫（與地面著色器同一個判斷），給測距工具看。旁路時是算式
   */
  layerAt(x: number, z: number): string
  setInnerRadius(m: number): void
  /**
   * **量測用**：烘遠圖時畫不畫空地的樹點，然後把遠圖整張重烘一次、等 GPU 做完，
   * 回傳毫秒。同頁 A/B 烘圖的成本用
   */
  benchFarBake(trees: boolean): number
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
  const glsl = fieldGlslWithSite(opts.season, opts.site, cand !== undefined, opts.open ?? false)
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
  const horizon = opts.horizon === undefined ? null : level(opts.horizon)
  const backdrop = horizon === null || opts.backdrop === undefined ? null : level(opts.backdrop)
  const stats: FieldClipmapStats = { recentres: 0, pieces: 0, texels: 0 }
  // 【context 還原後整張重烘】three 重建 GPU 資源時貼圖是空的，而鏡頭沒跨挪窗門檻就
  // 不會再烘 —— 遠處讀到一片黑。標成沒烘過，下一次 `update` 整張重來
  const onRestored = (): void => {
    near.primed = false
    far.primed = false
    if (horizon !== null) horizon.primed = false
    if (backdrop !== null) backdrop.primed = false
  }
  renderer.domElement?.addEventListener('webglcontextrestored', onRestored)

  // ── 烘圖 ──
  const bakeMat = new ShaderMaterial({
    uniforms: {
      uCell0: { value: new Vector2() }, uCells: { value: new Vector2() }, uMetres: { value: 1 },
      uBakeFar: { value: 0 },
      uBakeTrees: { value: 1 },
      ...candUniforms(),
    },
    vertexShader: `uniform vec2 uCell0; uniform vec2 uCells; uniform float uMetres; varying vec2 vWorld;
void main() { vWorld = (uCell0 + uv * uCells) * uMetres; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    // 【遠圖烘遠處的樣子】近窗外就是遠圖，樹籬的樹 6 km 外不畫；近窗內的樹籬烘近圖。
    // 空地的樹一棵一棵的點也只烘在遠圖（`fieldTrees`）
    fragmentShader: `varying vec2 vWorld; uniform float uBakeFar; uniform float uBakeTrees;
${glsl}
void main() { fieldFar = uBakeFar; fieldTrees = uBakeFar * uBakeTrees; gl_FragColor = vec4(fieldColorAt(vWorld), 0.0); }`,
  })
  const quadGeo = new PlaneGeometry(2, 2)
  const bakeScene = new Scene()
  const fieldQuad = new Mesh(quadGeo, bakeMat)
  bakeScene.add(fieldQuad)
  const bakeCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  // 【疊在田色上的平面】與田色那一片同一組 uniform，世界 xz 換到這一片的裁切座標。
  // 沒有深度緩衝，先後由 `renderOrder` 決定（田色是 0）
  const overlayMat = new ShaderMaterial({
    uniforms: {
      uCell0: bakeMat.uniforms['uCell0']!, uCells: bakeMat.uniforms['uCells']!, uMetres: bakeMat.uniforms['uMetres']!,
    },
    vertexShader: `uniform vec2 uCell0; uniform vec2 uCells; uniform float uMetres;
attribute vec4 color; varying vec4 vCol;
void main() { vCol = color; gl_Position = vec4((position.xz / uMetres - uCell0) / uCells * 2.0 - 1.0, 0.0, 1.0); }`,
    fragmentShader: `varying vec4 vCol;
void main() { gl_FragColor = vCol; }`,
    // 世界 z 映到裁切 y，繞序跟著翻
    side: DoubleSide,
    // 【顏色照不透明度混、透明度累加】三個分量的頂點色第四個分量讀成 1，整片蓋掉；
    // 淡出的邊顏色與底下混，透明度照樣記下來給內圈用
    transparent: true,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
  })
  const overlays = new Group()
  bakeScene.add(overlays)
  /** 烘掉的網格（`replaces`）與只畫在遠圖外的網格（`beyondFar`）；旁路時對調 */
  const replaced: Mesh[] = []
  const beyond: Mesh[] = []

  const bakePiece = (L: Level, p: TorusPiece, last: boolean): void => {
    for (const o of overlays.children) o.visible = L !== near || o.userData['near'] === true
    // 【viewport／scissor 設在 RT 上】`setRenderTarget` 讀的是 RT 自己那一份，
    // `renderer.setViewport` 設的是畫布的
    L.rt.viewport.set(p.tx, p.tz, p.w, p.h)
    L.rt.scissor.set(p.tx, p.tz, p.w, p.h)
    L.rt.scissorTest = true
    L.rt.texture.generateMipmaps = last
    bakeMat.uniforms['uCell0']!.value.set(p.cx0, p.cz0)
    bakeMat.uniforms['uCells']!.value.set(p.w, p.h)
    bakeMat.uniforms['uMetres']!.value = L.m
    bakeMat.uniforms['uBakeFar']!.value = L === near ? 0 : 1
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
    ...(horizon === null ? {} : {
      uHor: { value: horizon.rt.texture },
      uHorCentre: { value: horizon.centre },
      uHorSpan: { value: horizon.span },
      // 最小一級 mipmap（1×1）的級數：那一格是整張窗的平均色
      uHorTop: { value: Math.log2(horizon.n) },
    }),
    ...(horizon === null || backdrop === null ? {} : ((): Record<string, { value: unknown }> => {
      const f = outerFades(horizon.span, backdrop.span)
      return {
        uBack: { value: backdrop.rt.texture },
        uBackSpan: { value: backdrop.span },
        uBackTop: { value: Math.log2(backdrop.n) },
        uHorFade: { value: new Vector2(f.horFrom, f.horTo) },
        uAvgFade: { value: new Vector2(f.avgFrom, f.avgTo) },
      }
    })()),
  }
  const horizonDecl = (horizon === null ? ''
    : 'uniform sampler2D uHor; uniform vec2 uHorCentre; uniform float uHorSpan; uniform float uHorTop;')
    + (backdrop === null ? ''
      : '\nuniform sampler2D uBack; uniform float uBackSpan; uniform float uBackTop; uniform vec2 uHorFade; uniform vec2 uAvgFade;')
  const horizonGrad = (horizon === null ? '' : `
  vec2 qH = w / uHorSpan;
  vec2 dHx = dFdx(qH); vec2 dHy = dFdy(qH);
  float eH = max(abs(w.x - uHorCentre.x), abs(w.y - uHorCentre.y)) / (0.5 * uHorSpan);`)
    + (backdrop === null ? '' : `
  vec2 qB = w / uBackSpan;
  vec2 dBx = dFdx(qB); vec2 dBy = dFdy(qB);
  float rCam = distance(w, uCam);`)
  /**
   * 遠圖外的顏色。**有最外層時整圈讀貼圖，不走算式**：
   *
   * ```
   *   遠圖窗外、最外層窗內   最外層的貼圖（田色與疊圖都烘在裡面，有 mipmap）
   *   有遠景層時            離鏡頭 horFrom～horTo 由最外層漸變到遠景層，
   *                        avgFrom～avgTo 再漸變到遠景層的平均色
   *   沒有遠景層時           最外層窗外是最外層的平均色，照窗緣漸變
   * ```
   *
   * 【為什麼不走算式】15 km 外一個像素蓋好幾十公尺，逐像素算的田格與樹籬沒有過濾，
   * 畫出來是閃爍的鋸齒；而那一圈在低空平視時佔畫面不少，算式是地面最貴的一段
   * （洛伊納實測整圈換掉省 1.3～2.1 ms）。
   *
   * 【只淡田色，疊圖不淡】最外層的透明度記著疊圖的覆蓋率。最外層窗外接手的是
   * beyondFar 的粗網格（鎮的地面、河漫灘），一出窗就整塊出現 —— 疊圖在窗緣前先淡掉
   * 的話，鎮會先變糊或消失、再跳出來
   */
  const horizonColour = horizon === null ? '' : backdrop === null ? `
vec3 horizonColourAt(vec2 qH, vec2 dHx, vec2 dHy, float eH) {
  vec3 avg = textureLod(uHor, vec2(0.5), uHorTop).rgb;
  if (eH >= 1.0) return avg;
  vec4 h = textureGrad(uHor, fract(qH), dHx, dHy);
  float keep = clamp(h.a * 4.0, 0.0, 1.0);
  return mix(h.rgb, avg, smoothstep(1.0 - uEdgeBlend, 1.0, eH) * (1.0 - keep));
}` : `
vec3 backdropColourAt(vec2 qB, vec2 dBx, vec2 dBy, float rCam) {
  vec3 avg = textureLod(uBack, vec2(0.5), uBackTop).rgb;
  float tA = smoothstep(uAvgFade.x, uAvgFade.y, rCam);
  if (tA >= 1.0) return avg;
  return mix(textureGrad(uBack, fract(qB), dBx, dBy).rgb, avg, tA);
}
vec3 horizonColourAt(vec2 qH, vec2 dHx, vec2 dHy, float eH, vec2 qB, vec2 dBx, vec2 dBy, float rCam) {
  if (eH >= 1.0) return backdropColourAt(qB, dBx, dBy, rCam);
  vec4 h = textureGrad(uHor, fract(qH), dHx, dHy);
  float keep = clamp(h.a * 4.0, 0.0, 1.0);
  float f = smoothstep(uHorFade.x, uHorFade.y, rCam) * (1.0 - keep);
  if (f <= 0.0) return h.rgb;
  return mix(h.rgb, backdropColourAt(qB, dBx, dBy, rCam), f);
}`
  const horizonArgs = backdrop === null ? 'qH, dHx, dHy, eH' : 'qH, dHx, dHy, eH, qB, dBx, dBy, rCam'
  /** 遠圖窗外在不在「算式」那一邊：有最外層時整圈讀貼圖 */
  const farOutProc = horizon === null ? ' || eF >= 1.0' : ''
  const farOutTex = horizon === null ? ' && eF < 1.0' : ''
  const texBlock = horizon === null ? `
    vec3 t = textureGrad(uFar, fract(qF), dFx, dFy).rgb;
    float tN = smoothstep(1.0 - uEdgeBlend, 1.0, eN);
    if (tN < 1.0) t = mix(textureGrad(uNear, fract(qN), dNx, dNy).rgb, t, tN);` : `
    // 【遠圖讀不到的地方不讀】窗外是環面上別處的內容
    float tF = smoothstep(1.0 - uEdgeBlend, 1.0, eF);
    vec3 t = vec3(0.0);
    if (tF < 1.0) {
      t = textureGrad(uFar, fract(qF), dFx, dFy).rgb;
      float tN = smoothstep(1.0 - uEdgeBlend, 1.0, eN);
      if (tN < 1.0) t = mix(textureGrad(uNear, fract(qN), dNx, dNy).rgb, t, tN);
    }
    if (tF > 0.0) t = mix(t, horizonColourAt(${horizonArgs}), tF);`
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
${horizonDecl}
${glsl}
${horizonColour}`)
      .replace('#include <color_fragment>', `
{
  vec2 w = vFarmWorld.xz;
  // 【導數在分支外算】fract 在 0↔1 交界會讓導數爆掉、mip 掉到最小那一級而畫出
  // 一條線，所以用 textureGrad 配 world/span 的導數；導數指令不能放進分支
  vec2 qN = w / uNearSpan;
  vec2 qF = w / uFarSpan;
  vec2 dNx = dFdx(qN); vec2 dNy = dFdy(qN);
  vec2 dFx = dFdx(qF); vec2 dFy = dFdy(qF);${horizonGrad}
  float eN = max(abs(w.x - uNearCentre.x), abs(w.y - uNearCentre.y)) / (0.5 * uNearSpan);
  float eF = max(abs(w.x - uFarCentre.x), abs(w.y - uFarCentre.y)) / (0.5 * uFarSpan);
  float tIn = uInner <= 0.0 ? 1.0 : smoothstep(uInner - uInnerBand, uInner, distance(w, uCam));
  bool proc = uBypass > 0.5 || tIn < 1.0${farOutProc};
  bool tex = uBypass < 0.5 && tIn > 0.0${farOutTex};
  vec3 c = vec3(0.0);
  // 算式：旁路、內圈；沒有最外層時還有遠窗外。近窗外畫遠處的樣子，與遠圖烘的相同
  fieldFar = eN >= 1.0 ? 1.0 : 0.0;
  if (proc) c = fieldColorAt(w);
  // 【內圈疊回烘進貼圖的平面】算式裡沒有街、鎮地面、礦坑；貼圖的透明度記著它們。
  // 近圖外（內圈可以伸出近窗）讀遠圖。
  // 【不是 mix(c, rgb, a)】過濾過的 rgb 本來就是田色與疊圖照覆蓋率混好的，再乘一次
  // 覆蓋率，疊圖的邊會淡掉；有兩成五以上就整個用貼圖的顏色
  if (proc && uBypass < 0.5 && eF < 1.0) {
    vec4 o = eN < 1.0 ? textureGrad(uNear, fract(qN), dNx, dNy) : textureGrad(uFar, fract(qF), dFx, dFy);
    c = mix(c, o.rgb, clamp(o.a * 4.0, 0.0, 1.0));
  }
  if (tex) {${texBlock}
    c = proc ? mix(c, t, tIn) : t;
  }
  diffuseColor.rgb = c;
}`)
  }
  const id = instances++
  material.customProgramCacheKey = () =>
    `field-clipmap:${opts.season}:${opts.site === undefined ? '' : 'site'}:${cand === undefined ? '' : 'cand'}`
    + `:${opts.open === true ? 'open' : ''}:${horizon === null ? '' : 'horizon'}:${id}`

  return {
    material,
    stats,
    addOverlay(geometry, toNear) {
      const mesh = new Mesh(geometry, overlayMat)
      // 包圍球是世界座標，烘圖的鏡頭是 ±1 的正交盒 —— 不關的話整顆被剔掉
      mesh.frustumCulled = false
      mesh.renderOrder = 1 + overlays.children.length
      mesh.userData['near'] = toNear
      overlays.add(mesh)
      far.primed = false
      if (horizon !== null) horizon.primed = false
      if (toNear) near.primed = false
    },
    replaces(mesh) {
      replaced.push(mesh)
      mesh.visible = U.uBypass.value > 0.5
    },
    beyondFar(mesh) {
      beyond.push(mesh)
      mesh.visible = U.uBypass.value < 0.5
      const m = mesh.material as MeshStandardMaterial
      // 有最外層的話它蓋得到的地方地面讀得到疊圖，粗網格只畫在它外面
      const outer = horizon === null
        ? { uFarCentre: U.uFarCentre, uFarSpan: U.uFarSpan }
        : { uFarCentre: { value: horizon.centre }, uFarSpan: { value: horizon.span } }
      m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        Object.assign(shader.uniforms, outer)
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vBeyondXZ;')
          .replace('#include <begin_vertex>',
            '#include <begin_vertex>\nvBeyondXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
varying vec2 vBeyondXZ;
uniform vec2 uFarCentre; uniform float uFarSpan;`)
          // 與地面著色器同一個判斷：窗內（遠圖的 eF < 1，有最外層時是它的 eH < 1）
          // 地面讀得到烘好的那一份
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
{
  vec2 w = vBeyondXZ;
  if (max(abs(w.x - uFarCentre.x), abs(w.y - uFarCentre.y)) < 0.5 * uFarSpan) discard;
}`)
      }
      m.customProgramCacheKey = () => `beyond-far:${id}`
      m.needsUpdate = true
    },
    update(camX, camZ) {
      recentre(near, camX, camZ)
      recentre(far, camX, camZ)
      if (horizon !== null) recentre(horizon, camX, camZ)
      if (backdrop !== null) recentre(backdrop, camX, camZ)
      U.uCam.value.set(camX, camZ)
    },
    layerAt(x, z) {
      if (U.uBypass.value > 0.5) return '旁路：全部逐像素算'
      const edge = (c: Vector2, span: number): number => Math.max(Math.abs(x - c.x), Math.abs(z - c.y)) / (0.5 * span)
      const inner = U.uInner.value > 0 && Math.hypot(x - U.uCam.value.x, z - U.uCam.value.y) < U.uInner.value
      const km = (m: number): string => `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`
      if (inner) return `內圈：逐像素算（${Math.round(U.uInner.value)} m 內）`
      if (edge(near.centre, near.span) < 1) {
        return `近圖：${near.m.toFixed(1)} m／格（±${km(near.span / 2)}），樹籬細線、無屋頂樹冠色塊`
      }
      if (edge(far.centre, far.span) < 1) {
        return `遠圖：${far.m.toFixed(1)} m／格（±${km(far.span / 2)}），寬樹籬、屋頂樹冠色塊`
      }
      if (horizon === null) return '遠圖外：田逐像素算＋粗網格'
      if (backdrop !== null) {
        const f = outerFades(horizon.span, backdrop.span)
        const r = Math.hypot(x - U.uCam.value.x, z - U.uCam.value.y)
        if (r < f.horFrom) return `最外層：${horizon.m.toFixed(0)} m／格，田與疊圖都烘`
        if (r < f.horTo) return `最外層 → 遠景層漸變（${km(f.horFrom)}～${km(f.horTo)}）`
        if (r < f.avgFrom) return `遠景層：${backdrop.m.toFixed(0)} m／格`
        if (r < f.avgTo) return `遠景層 → 平均色漸變（${km(f.avgFrom)}～${km(f.avgTo)}）`
        return '遠景層的平均色'
      }
      if (edge(horizon.centre, horizon.span) < 1) {
        return `最外層：${horizon.m.toFixed(0)} m／格（±${km(horizon.span / 2)}），田與疊圖都烘`
      }
      return '最外層外：最外層的平均色＋粗網格'
    },
    setInnerRadius(m) { U.uInner.value = m },
    benchFarBake(trees) {
      bakeMat.uniforms['uBakeTrees']!.value = trees ? 1 : 0
      // 【讀回一個像素才等得到 GPU】瀏覽器的 finish 不保證等 GPU 做完
      const px = new Uint8Array(4)
      renderer.readRenderTargetPixels(far.rt, 0, 0, 1, 1, px)
      const t0 = performance.now()
      far.primed = false
      recentre(far, U.uCam.value.x, U.uCam.value.y)
      renderer.readRenderTargetPixels(far.rt, 0, 0, 1, 1, px)
      return performance.now() - t0
    },
    setBypass(on) {
      U.uBypass.value = on ? 1 : 0
      for (const m of replaced) m.visible = on
      for (const m of beyond) m.visible = !on
    },
    dispose() {
      renderer.domElement?.removeEventListener('webglcontextrestored', onRestored)
      near.rt.dispose()
      far.rt.dispose()
      horizon?.rt.dispose()
      backdrop?.rt.dispose()
      bakeMat.dispose()
      overlayMat.dispose()
      quadGeo.dispose()
      material.dispose()
    },
  }
}
