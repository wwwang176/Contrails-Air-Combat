import {
  AddEquation, CustomBlending, DoubleSide, Group, OneFactor, OneMinusSrcAlphaFactor, SrcAlphaFactor, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, OrthographicCamera,
  PlaneGeometry, RGFormat, Scene, ShaderMaterial, Vector2, Vector4, WebGLRenderTarget,
  type BufferGeometry, type DataTexture, type WebGLProgramParametersWithUniforms, type WebGLRenderer,
} from 'three'
import { fieldGlslWithSite } from './fieldShaders'
import { type RegionCandidates } from './fields'
import { type SiteLayout } from './siteSurface'
import { SCAR_ATLAS } from './battleScars'
import type { Season } from './season'
import { bakedShadeScale } from './buildingBake'
import { VIEW_SHADE_GLSL, ViewShadeRow, type ViewShade } from './viewShade'
import { matteGround } from './matteGround'

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
 *
 * ## 樹冠與屋頂的亮度份量（第二張貼圖）
 *
 * 每一層同時烘兩張（MRT）：第一張 RGBA 是顏色與疊圖的覆蓋率，第二張 RG8 是這一格的
 * 顏色裡樹冠、屋頂各佔多少亮度（線性，乘 `bakedShadeScale` 再存）。地面照與顏色**相同的
 * 取樣與權重**讀它，把那一份乘上視角係數（`viewShade.ts`）—— 立體的樹與房子迎光暗、
 * 背光亮，烘在地上的要跟著。存亮度份量不存覆蓋率：遠處一格是田與樹籬混在一起，
 * 份量與顏色都是線性平均，mipmap 後兩者仍對得上。見
 * `docs/superpowers/specs/2026-10-17-view-dependent-canopy-design.md`。
 *
 * 【混合狀態兩張共用】疊圖的混合是全域的（`blendFuncSeparate`），第二張也是
 * `src·a + dst·(1−a)`：第二個輸出的 alpha 要與顏色的相同，份量本身不先乘 alpha。
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
  /** 烘進地面的林子與屋頂的視角係數（`viewShade.ts`），與植被的點共用 */
  readonly viewShade: ViewShade
}

export interface FieldClipmapStats {
  recentres: number
  pieces: number
  texels: number
}

export interface FieldClipmap {
  /** 掛到地面的材質 */
  readonly material: MeshStandardMaterial
  /**
   * 掛到遠景環的材質：與 `material` 同一支著色器，視角係數逐像素查（遠景環一格將近
   * 100 km，頂點內插不準）
   */
  readonly horizonMaterial: MeshStandardMaterial
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
   *
   * 【樹冠與屋頂】頂點可以帶 `viewShade`（兩個分量：這一點的顏色有幾成是樹冠、幾成是
   * 屋頂），烘進第二張貼圖給地面乘視角係數（見檔頭）。沒帶的是 0：照不透明度把底下的
   * 份量蓋掉。
   *
   * 【貼圖版】`textured` 為真時改讀頂點的 `uv`，顏色與不透明度取自戰場痕跡的圖集
   * （`battleScars.ts` 的 `SCAR_ATLAS`），不讀 `color`。燒毀房屋底下的彈坑用它。
   */
  addOverlay(geometry: BufferGeometry, near: boolean, textured?: boolean): void
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
  const scale = bakedShadeScale(opts.season)
  /** 第二張貼圖的比例尺（樹冠、屋頂）。**烘的與讀的用同一份**，不同的話林子整片偏亮或偏暗 */
  const scaleGlsl = `const vec2 VIEW_BAKE_SCALE = vec2(${scale.tree.toFixed(5)}, ${scale.roof.toFixed(5)});
const vec3 VIEW_BAKE_LUM = vec3(0.2126, 0.7152, 0.0722);`
  /**
   * 候選表的兩個 uniform，加上戰場痕跡的圖集（有的話）；烘圖材質與地面材質各掛一份
   * 同樣的。圖集是共用的物件（`SCAR_ATLAS`）—— 進場前已經載好
   */
  const candUniforms = (): Record<string, { value: unknown }> => ({
    ...(cand === undefined ? {} : {
      uRegionCand: { value: cand.texture },
      uRegionCandRect: { value: new Vector4(cand.table.gx0, cand.table.gz0, cand.table.blocksX, cand.table.blocksZ) },
    }),
    ...(opts.site?.scars === undefined ? {} : { uScarAtlas: SCAR_ATLAS }),
  })
  const anisotropy = renderer.capabilities.getMaxAnisotropy()
  /**
   * @param shade 要不要第二張（樹冠與屋頂的份量）。**近圖不要**：近圖烘的是近處的樣子，
   *   份量恆為 0（真的樹與房子底下的地）。烘圖的材質照樣寫第二個輸出，沒有那張附件時
   *   GL 丟掉它
   */
  const level = (spec: ClipLevelSpec, shade = true): Level => {
    const rt = new WebGLRenderTarget(spec.size, spec.size, {
      minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, generateMipmaps: true,
      depthBuffer: false, stencilBuffer: false, anisotropy, count: shade ? 2 : 1,
    })
    // 【第二張只要兩個通道】建構選項套到每一張；第一張的 alpha 是疊圖的覆蓋率，要留 RGBA
    // 【第二張不開各向異性】份量只是乘在顏色上的比例，不必銳利；開到顯示卡上限的話，
    // Iris Xe 上這一次取樣多花 0.1 ms（農地 700 m 平視）
    if (shade) {
      rt.textures[1]!.format = RGFormat
      rt.textures[1]!.anisotropy = 1
    }
    return {
      n: spec.size, m: spec.metersPerTexel, span: spec.size * spec.metersPerTexel,
      rt, centre: new Vector2(), ox: 0, oz: 0, primed: false,
    }
  }
  const near = level(opts.near, false)
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
    //
    // 【第二個輸出】three 把這支編成 GLSL 300 es，第一個輸出是它宣告的 location 0；
    // 第二張貼圖寫 location 1（見檔頭）
    fragmentShader: `varying vec2 vWorld; uniform float uBakeFar; uniform float uBakeTrees;
layout(location = 1) out highp vec4 viewBake;
${scaleGlsl}
${glsl}
void main() {
  fieldFar = uBakeFar; fieldTrees = uBakeFar * uBakeTrees;
  gl_FragColor = vec4(fieldColorAt(vWorld), 0.0);
  viewBake = vec4(fieldTree * VIEW_BAKE_SCALE.x, 0.0, 0.0, 0.0);
}`,
  })
  const quadGeo = new PlaneGeometry(2, 2)
  const bakeScene = new Scene()
  const fieldQuad = new Mesh(quadGeo, bakeMat)
  bakeScene.add(fieldQuad)
  const bakeCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  // 【疊在田色上的平面】與田色那一片同一組 uniform，世界 xz 換到這一片的裁切座標。
  // 沒有深度緩衝，先後由 `renderOrder` 決定（田色是 0）
  // 【樹冠與屋頂的份量只烘遠處】近圖的地在真的樹與房子底下（河漫灘的林地也烘近圖）
  const overlayMat = new ShaderMaterial({
    uniforms: {
      uCell0: bakeMat.uniforms['uCell0']!, uCells: bakeMat.uniforms['uCells']!, uMetres: bakeMat.uniforms['uMetres']!,
      uBakeFar: bakeMat.uniforms['uBakeFar']!,
    },
    vertexShader: `uniform vec2 uCell0; uniform vec2 uCells; uniform float uMetres;
attribute vec4 color; attribute vec2 viewShade; varying vec4 vCol; varying vec2 vShare;
void main() { vCol = color; vShare = viewShade; gl_Position = vec4((position.xz / uMetres - uCell0) / uCells * 2.0 - 1.0, 0.0, 1.0); }`,
    fragmentShader: `varying vec4 vCol; varying vec2 vShare; uniform float uBakeFar;
layout(location = 1) out highp vec4 viewBake;
${scaleGlsl}
void main() {
  gl_FragColor = vCol;
  viewBake = vec4(vShare * dot(vCol.rgb, VIEW_BAKE_LUM) * VIEW_BAKE_SCALE * uBakeFar, 0.0, vCol.a);
}`,
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
  // 【沒帶 viewShade 的疊圖讀 0】街、鎮的地面、沖溝不是樹也不是屋頂。不給預設值的話
  // 那條屬性讀到的是上一個程式在同一個位置留下的值
  ;(overlayMat.defaultAttributeValues as Record<string, number[]>)['viewShade'] = [0, 0]
  // 【貼圖版】同一組 uniform 與同一套混合，顏色改取圖集（`SCAR_ATLAS`）。圖集是直的
  // alpha，sRGB 貼圖取樣時 GPU 轉成線性，與頂點色同一個空間。取樣點的偏移由呼叫端的
  // uv 留（`steppeVillage.ts`）
  const texturedOverlayMat = new ShaderMaterial({
    uniforms: {
      uCell0: bakeMat.uniforms['uCell0']!, uCells: bakeMat.uniforms['uCells']!, uMetres: bakeMat.uniforms['uMetres']!,
      uScarAtlas: SCAR_ATLAS,
    },
    vertexShader: `uniform vec2 uCell0; uniform vec2 uCells; uniform float uMetres;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4((position.xz / uMetres - uCell0) / uCells * 2.0 - 1.0, 0.0, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform sampler2D uScarAtlas;
layout(location = 1) out highp vec4 viewBake;
void main() { gl_FragColor = texture2D(uScarAtlas, vUv); viewBake = vec4(0.0, 0.0, 0.0, gl_FragColor.a); }`,
    side: DoubleSide,
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
    // 兩張都要：只設第一張的話第二張每一片都重產整張 mipmap
    for (const t of L.rt.textures) t.generateMipmaps = last
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
    uFarS: { value: far.rt.textures[1]! },
    uFarCentre: { value: far.centre },
    uFarSpan: { value: far.span },
    uCam: { value: new Vector2() },
    uInner: { value: opts.innerRadius ?? 500 },
    uInnerBand: { value: opts.innerBand ?? 100 },
    uEdgeBlend: { value: opts.edgeBlend ?? 0.05 },
    uBypass: { value: 0 },
    ...(horizon === null ? {} : {
      uHor: { value: horizon.rt.texture },
      uHorS: { value: horizon.rt.textures[1]! },
      uHorCentre: { value: horizon.centre },
      uHorSpan: { value: horizon.span },
      // 最小一級 mipmap（1×1）的級數：那一格是整張窗的平均色
      uHorTop: { value: Math.log2(horizon.n) },
    }),
    ...(horizon === null || backdrop === null ? {} : ((): Record<string, { value: unknown }> => {
      const f = outerFades(horizon.span, backdrop.span)
      return {
        uBack: { value: backdrop.rt.texture },
        uBackS: { value: backdrop.rt.textures[1]! },
        uBackSpan: { value: backdrop.span },
        uBackTop: { value: Math.log2(backdrop.n) },
        uHorFade: { value: new Vector2(f.horFrom, f.horTo) },
        uAvgFade: { value: new Vector2(f.avgFrom, f.avgTo) },
      }
    })()),
  }
  const horizonDecl = (horizon === null ? ''
    : 'uniform sampler2D uHor; uniform sampler2D uHorS; uniform vec2 uHorCentre; uniform float uHorSpan; uniform float uHorTop;')
    + (backdrop === null ? ''
      : '\nuniform sampler2D uBack; uniform sampler2D uBackS; uniform float uBackSpan; uniform float uBackTop; uniform vec2 uHorFade; uniform vec2 uAvgFade;')
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
   *
   * 【樹冠與屋頂的份量走同一條路】第二張貼圖照相同的座標、導數與權重取樣，經最後一個
   * 參數帶出去（見檔頭）
   */
  const horizonColour = horizon === null ? '' : backdrop === null ? `
vec3 horizonColourAt(vec2 qH, vec2 dHx, vec2 dHy, float eH, out vec2 hs) {
  vec3 avg = textureLod(uHor, vec2(0.5), uHorTop).rgb;
  vec2 avgS = textureLod(uHorS, vec2(0.5), uHorTop).rg;
  if (eH >= 1.0) { hs = avgS; return avg; }
  vec4 h = textureGrad(uHor, fract(qH), dHx, dHy);
  vec2 sh = textureGrad(uHorS, fract(qH), dHx, dHy).rg;
  float keep = clamp(h.a * 4.0, 0.0, 1.0);
  float f = smoothstep(1.0 - uEdgeBlend, 1.0, eH) * (1.0 - keep);
  hs = mix(sh, avgS, f);
  return mix(h.rgb, avg, f);
}` : `
vec3 backdropColourAt(vec2 qB, vec2 dBx, vec2 dBy, float rCam, out vec2 bs) {
  vec3 avg = textureLod(uBack, vec2(0.5), uBackTop).rgb;
  vec2 avgS = textureLod(uBackS, vec2(0.5), uBackTop).rg;
  float tA = smoothstep(uAvgFade.x, uAvgFade.y, rCam);
  if (tA >= 1.0) { bs = avgS; return avg; }
  bs = mix(textureGrad(uBackS, fract(qB), dBx, dBy).rg, avgS, tA);
  return mix(textureGrad(uBack, fract(qB), dBx, dBy).rgb, avg, tA);
}
vec3 horizonColourAt(vec2 qH, vec2 dHx, vec2 dHy, float eH, vec2 qB, vec2 dBx, vec2 dBy, float rCam, out vec2 hs) {
  if (eH >= 1.0) return backdropColourAt(qB, dBx, dBy, rCam, hs);
  vec4 h = textureGrad(uHor, fract(qH), dHx, dHy);
  vec2 sh = textureGrad(uHorS, fract(qH), dHx, dHy).rg;
  float keep = clamp(h.a * 4.0, 0.0, 1.0);
  float f = smoothstep(uHorFade.x, uHorFade.y, rCam) * (1.0 - keep);
  if (f <= 0.0) { hs = sh; return h.rgb; }
  vec2 bs;
  vec3 b = backdropColourAt(qB, dBx, dBy, rCam, bs);
  hs = mix(sh, bs, f);
  return mix(h.rgb, b, f);
}`
  const horizonArgs = backdrop === null ? 'qH, dHx, dHy, eH, hs' : 'qH, dHx, dHy, eH, qB, dBx, dBy, rCam, hs'
  /** 遠圖窗外在不在「算式」那一邊：有最外層時整圈讀貼圖 */
  const farOutProc = horizon === null ? ' || eF >= 1.0' : ''
  const farOutTex = horizon === null ? ' && eF < 1.0' : ''
  // 【近圖沒有份量】近圖的那一份恆為 0（見 `level`），漸變到近圖時份量照權重淡掉
  const texBlock = horizon === null ? `
    vec3 t = textureGrad(uFar, fract(qF), dFx, dFy).rgb;
    float tN = smoothstep(1.0 - uEdgeBlend, 1.0, eN);
    vec2 ts = textureGrad(uFarS, fract(qF), dFx, dFy).rg * tN;
    if (tN < 1.0) t = mix(textureGrad(uNear, fract(qN), dNx, dNy).rgb, t, tN);` : `
    // 【遠圖讀不到的地方不讀】窗外是環面上別處的內容
    float tF = smoothstep(1.0 - uEdgeBlend, 1.0, eF);
    vec3 t = vec3(0.0);
    vec2 ts = vec2(0.0);
    if (tF < 1.0) {
      t = textureGrad(uFar, fract(qF), dFx, dFy).rgb;
      float tN = smoothstep(1.0 - uEdgeBlend, 1.0, eN);
      ts = textureGrad(uFarS, fract(qF), dFx, dFy).rg * tN;
      if (tN < 1.0) t = mix(textureGrad(uNear, fract(qN), dNx, dNy).rgb, t, tN);
    }
    if (tF > 0.0) {
      vec2 hs;
      vec3 hc = horizonColourAt(${horizonArgs});
      t = mix(t, hc, tF);
      ts = mix(ts, hs, tF);
    }`
  /**
   * 地面與遠景環的材質。兩者同一支著色器，差在視角係數在哪裡查：
   *
   * - 地面（`perPixel = false`）**逐頂點**：三角形一格 80 m，份量只出現在近窗外（2 km
   *   以遠），那裡一個三角形裡視線方向幾乎不變；逐像素查兩次表是整段裡最貴的一步
   * - 遠景環（`perPixel = true`）**逐像素**：一格將近 100 km，頂點內插的係數在交界與地面
   *   差兩成以上。它只畫在 15 km 外，像素不多
   */
  const groundMaterial = (perPixel: boolean): MeshStandardMaterial => {
    const material = new MeshStandardMaterial({ flatShading: true, roughness: ROUGHNESS })
    const kVaryings = perPixel ? '' : '\nvarying vec3 vViewKTree;\nvarying vec3 vViewKRoof;'
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, U, candUniforms(), opts.viewShade.uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
  varying vec3 vFarmWorld;${kVaryings}
  ${perPixel ? '' : VIEW_SHADE_GLSL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vFarmWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;${perPixel ? '' : `
  {
    vec3 toCam = normalize(cameraPosition - vFarmWorld);
    vViewKTree = viewShade(${ViewShadeRow.Ground.toFixed(1)}, toCam);
    vViewKRoof = viewShade(${ViewShadeRow.House.toFixed(1)}, toCam);
  }`}`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
  varying vec3 vFarmWorld;${kVaryings}
  ${perPixel ? VIEW_SHADE_GLSL : ''}
  uniform sampler2D uNear; uniform vec2 uNearCentre; uniform float uNearSpan;
  uniform sampler2D uFar; uniform sampler2D uFarS; uniform vec2 uFarCentre; uniform float uFarSpan;
  uniform vec2 uCam; uniform float uInner; uniform float uInnerBand; uniform float uEdgeBlend;
  uniform float uBypass;
  ${horizonDecl}
  ${scaleGlsl}
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
    // 樹冠、屋頂的亮度份量（乘過 VIEW_BAKE_SCALE，與第二張貼圖同一個單位）。每一步與 c 同樣混
    vec2 vs = vec2(0.0);
    // 算式：旁路、內圈；沒有最外層時還有遠窗外。近窗外畫遠處的樣子，與遠圖烘的相同
    fieldFar = eN >= 1.0 ? 1.0 : 0.0;
    if (proc) {
      c = fieldColorAt(w);
      vs = vec2(fieldTree * VIEW_BAKE_SCALE.x, 0.0);
    }
    // 【內圈疊回烘進貼圖的平面】算式裡沒有街、鎮地面、礦坑；貼圖的透明度記著它們。
    // 近圖外（內圈可以伸出近窗）讀遠圖。
    // 【不是 mix(c, rgb, a)】過濾過的 rgb 本來就是田色與疊圖照覆蓋率混好的，再乘一次
    // 覆蓋率，疊圖的邊會淡掉；有兩成五以上就整個用貼圖的顏色
    if (proc && uBypass < 0.5 && eF < 1.0) {
      vec4 o = eN < 1.0 ? textureGrad(uNear, fract(qN), dNx, dNy) : textureGrad(uFar, fract(qF), dFx, dFy);
      vec2 os = eN < 1.0 ? vec2(0.0) : textureGrad(uFarS, fract(qF), dFx, dFy).rg;
      float k = clamp(o.a * 4.0, 0.0, 1.0);
      c = mix(c, o.rgb, k);
      vs = mix(vs, os, k);
    }
    if (tex) {${texBlock}
      c = proc ? mix(c, t, tIn) : t;
      vs = proc ? mix(vs, ts, tIn) : ts;
    }
    // 【樹冠與屋頂隨視角變亮暗】份量除以這一格的亮度就是那一份佔的比例，那一份乘上
    // 視角係數。比例是亮度的，變化照整格的色相分配（見檔頭）
    // 【不分支】份量為 0 的像素算出來乘 1。Iris Xe 上包一層 if 反而多花 0.2 ms
    //（農地 700 m 平視，地面佔滿畫面）
    {${perPixel ? `
      vec3 toCam = normalize(cameraPosition - vFarmWorld);
      vec3 kTree = viewShade(${ViewShadeRow.Ground.toFixed(1)}, toCam);
      vec3 kRoof = viewShade(${ViewShadeRow.House.toFixed(1)}, toCam);` : `
      vec3 kTree = vViewKTree;
      vec3 kRoof = vViewKRoof;`}
      vec2 share = vs / VIEW_BAKE_SCALE / max(dot(c, VIEW_BAKE_LUM), 1.0e-5);
      float sTree = clamp(share.x, 0.0, 1.0);
      float sRoof = clamp(share.y, 0.0, 1.0 - sTree);
      c *= 1.0 + (kTree - 1.0) * sTree + (kRoof - 1.0) * sRoof;
    }
    diffuseColor.rgb = c;
  }`)
    }
    material.customProgramCacheKey = () =>
      `field-clipmap:${opts.season}:${opts.site === undefined ? '' : 'site'}:${cand === undefined ? '' : 'cand'}`
      + `:${opts.open === true ? 'open' : ''}:${horizon === null ? '' : 'horizon'}:${id}:${perPixel ? 'pixel' : 'vertex'}`
    matteGround(material)
    return material
  }
  const id = instances++
  const material = groundMaterial(false)
  const horizonMaterial = groundMaterial(true)

  return {
    material,
    horizonMaterial,
    stats,
    addOverlay(geometry, toNear, textured = false) {
      const mesh = new Mesh(geometry, textured ? texturedOverlayMat : overlayMat)
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
      // 【林地那一份乘視角係數】粗網格是貼片（`groundDecal.ts`），頂點的 `viewShade.x` 是
      // 顏色裡林地佔的比例 —— 與烘進貼圖的那一份同一個規則
      m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        Object.assign(shader.uniforms, outer, opts.viewShade.uniforms)
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>',
            '#include <common>\nvarying vec2 vBeyondXZ;\nattribute vec2 viewShade;\nvarying float vBeyondTree;\nvarying vec3 vBeyondWorld;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
vBeyondWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vBeyondXZ = vBeyondWorld.xz;
vBeyondTree = viewShade.x;`)
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
varying vec2 vBeyondXZ;
varying float vBeyondTree;
varying vec3 vBeyondWorld;
uniform vec2 uFarCentre; uniform float uFarSpan;
${VIEW_SHADE_GLSL}`)
          // 與地面著色器同一個判斷：窗內（遠圖的 eF < 1，有最外層時是它的 eH < 1）
          // 地面讀得到烘好的那一份
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
{
  vec2 w = vBeyondXZ;
  if (max(abs(w.x - uFarCentre.x), abs(w.y - uFarCentre.y)) < 0.5 * uFarSpan) discard;
}`)
          .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= mix(vec3(1.0), viewShade(${ViewShadeRow.Ground.toFixed(1)}, normalize(cameraPosition - vBeyondWorld)), vBeyondTree);`)
      }
      m.customProgramCacheKey = () => `beyond-far:${id}`
      // 上面整個換掉了貼片原本的掛鉤，地面不算鏡面那一層要重掛
      matteGround(m)
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
      texturedOverlayMat.dispose()
      quadGeo.dispose()
      material.dispose()
      horizonMaterial.dispose()
    },
  }
}
