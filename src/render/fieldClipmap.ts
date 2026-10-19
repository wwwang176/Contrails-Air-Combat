import {
  AddEquation, CustomBlending, DoubleSide, Group, OneFactor, OneMinusSrcAlphaFactor, SrcAlphaFactor, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, OrthographicCamera,
  PlaneGeometry, RGFormat, Scene, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderTarget,
  type BufferGeometry, type DataTexture, type WebGLProgramParametersWithUniforms, type WebGLRenderer,
} from 'three'
import { fieldGlslWithSite } from './fieldShaders'
import {
  OPEN_CONIFER_SHARE, OPEN_TREE_SCALE, OPEN_WOOD_DENSITY, WOOD_GRID, type RegionCandidates,
} from './fields'
import { type SiteLayout } from './siteSurface'
import { SCAR_ATLAS } from './battleScars'
import type { Season } from './season'
import { matteGround } from './matteGround'
import { DRAWN_TILES_N, type DrawnTiles } from './drawnTiles'
import { TILE_SIZE } from './vegetationPolicy'
import { POINT_SIZE } from './floraShapes'
import { TREE_SCALE } from '../specs/flora'
import { VIEW_SHADE_GLSL, ViewShadeRow, type ViewShade } from './viewShade'

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
 * 樹冠份量（`fieldShaders.ts` 的 `fieldTree`）存進第二張時乘這個。第二張是 RG8（0..1），
 * 而樹籬折成闊葉的份量最多到 `HEDGE_TREE_SHARE`（1.27）
 */
export const TREE_BAKE_SCALE = 0.5

/**
 * 樹林田的樹排在抖動的格點上（一格一株），彼此重疊比隨機撒的少，蓋住地面的比例比隨機的
 * 式子高。展示區（/tools/canopy.html）16 m 一格的闊葉林，點從正上方看蓋住 47%，
 * 隨機的式子是 37%；乘 1.4 之後烘圖與點的亮度差均方根 2.1%。
 *
 * 空地的林子只接受一半多一點的格點（`OPEN_WOOD_DENSITY`），格點的規律被打散，照隨機的式子
 * 算（乘 1）：德 M3 地形 2 km 外、仰角 8°～85° 林子裡點的覆蓋率反推 d 是 0.26～0.39，
 * 式子是 0.35
 */
export const GRID_OVERLAP = { field: 1.4, open: 1 } as const

/** 縮放在 `[a, b]` 之間均勻分布時縮放平方的期望值 `(b³ − a³) / (3(b − a))` */
const meanSquare = ([a, b]: readonly [number, number]): number => (b ** 3 - a ** 3) / (3 * (b - a))

/**
 * 林子裡的點從仰角 e 看過去蓋住地面的比例是 `1 − exp(−d / sin e)`，這是 d：每格點的平均
 * 面積（`POINT_SIZE` × 縮放平方 × 接受率）÷ 一格的面積 × `GRID_OVERLAP`。
 *
 * `broad`、`cone` 是樹林田（整塊一個樹種、`TREE_SCALE`、每格一株）；`open` 是空地的林子
 * （`OPEN_TREE_SCALE`、接受率 `OPEN_WOOD_DENSITY`、樹種照 `OPEN_CONIFER_SHARE` 混）
 */
export function canopyGapDensity(kind: 'broad' | 'cone' | 'open'): number {
  const area = (pool: 'broadPoint' | 'conePoint'): number => POINT_SIZE[pool] ** 2
  const cell = WOOD_GRID * WOOD_GRID
  if (kind === 'open') {
    const mix = (1 - OPEN_CONIFER_SHARE) * area('broadPoint') + OPEN_CONIFER_SHARE * area('conePoint')
    return (mix * meanSquare(OPEN_TREE_SCALE) * OPEN_WOOD_DENSITY * GRID_OVERLAP.open) / cell
  }
  return (area(kind === 'broad' ? 'broadPoint' : 'conePoint') * meanSquare(TREE_SCALE) * GRID_OVERLAP.field) / cell
}

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
   * 中圖：與近圖同一種烘法（近處的樣子：林地色、細樹籬、不烘屋頂色塊），蓋住整個植被圈。
   * 近窗外、**這一格有畫樹**（`drawnTiles`）的地方讀它，其餘讀遠圖 —— 樹底下是地、不是
   * 烘好的樹冠。要與 `drawnTiles` 一起給
   */
  readonly mid?: ClipLevelSpec
  /** 哪些植被格有畫樹（`drawnTiles.ts`），與植被共用同一份 */
  readonly drawnTiles?: DrawnTiles
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
  /**
   * 植被的點用的那一張表（`viewShade.ts`）。給了的話遠處的樣子（遠圖、最外層、遠景層）
   * 多烘一張樹冠份量，地面把那一份樹冠換成照點的算式畫：
   *
   * ```
   *   底色 = 烘的顏色 − 樹冠色 × 份量 + 林地色 × 份量 × (1 − 覆蓋)
   *   自發光 += 份量 × 覆蓋 × 點的底色 × 表(鏡頭方向)
   *   鏡面反射 ×= 1 − 份量 × 覆蓋
   * ```
   *
   * 覆蓋是點從這個仰角看過去蓋住地面的比例（`canopyGapDensity`）。見
   * `docs/superpowers/specs/2026-10-19-baked-canopy-like-points-design.md`
   */
  readonly viewShade?: ViewShade
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
  /**
   * 烘進地面的林子的表在頂點查（預設）還是在像素查；給了就切換（重編地面的程式），回傳目前
   * 是不是在像素查。沒有樹冠份量（沒給 `viewShade`）時沒有作用
   */
  canopyLookup(perPixel?: boolean): boolean
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

/** 烘圖材質的第二個輸出（樹冠份量）的宣告 */
const TREE_OUT = (tree: boolean): string => tree ? '\nlayout(location = 1) out highp vec4 treeBake;' : ''

let instances = 0

export function createFieldClipmap(renderer: WebGLRenderer, opts: FieldClipmapOptions): FieldClipmap {
  const cand = opts.candidates
  const shade = opts.viewShade
  /** 遠處的樣子要不要多烘一張樹冠份量 —— 見 `viewShade` 選項 */
  const tree = shade !== undefined
  const glsl = fieldGlslWithSite(opts.season, opts.site, cand !== undefined, opts.open ?? false, tree)
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
   * @param share 要不要第二張（樹冠份量）。**近處的樣子（近圖、中圖）不要**：份量恆為 0。
   *   烘圖的材質照樣寫第二個輸出，沒有那張附件時 GL 丟掉它
   */
  const level = (spec: ClipLevelSpec, share = false): Level => {
    const rt = new WebGLRenderTarget(spec.size, spec.size, {
      minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, generateMipmaps: true,
      depthBuffer: false, stencilBuffer: false, anisotropy, count: share ? 2 : 1,
    })
    // 【第二張只要兩個通道、不開各向異性】建構選項套到每一張；第一張的 alpha 是疊圖的覆蓋率，
    // 要留 RGBA。份量只是換算顏色的比例，不必銳利
    if (share) {
      rt.textures[1]!.format = RGFormat
      rt.textures[1]!.anisotropy = 1
    }
    return {
      n: spec.size, m: spec.metersPerTexel, span: spec.size * spec.metersPerTexel,
      rt, centre: new Vector2(), ox: 0, oz: 0, primed: false,
    }
  }
  const near = level(opts.near)
  const drawn = opts.drawnTiles
  const mid = opts.mid === undefined || drawn === undefined ? null : level(opts.mid)
  const far = level(opts.far, tree)
  const horizon = opts.horizon === undefined ? null : level(opts.horizon, tree)
  const backdrop = horizon === null || opts.backdrop === undefined ? null : level(opts.backdrop, tree)
  const stats: FieldClipmapStats = { recentres: 0, pieces: 0, texels: 0 }
  /** 近處的樣子（近圖、中圖）：林地色、細樹籬，`near = false` 的疊圖不烘 */
  const nearLook = (L: Level): boolean => L === near || L === mid
  // 【context 還原後整張重烘】three 重建 GPU 資源時貼圖是空的，而鏡頭沒跨挪窗門檻就
  // 不會再烘 —— 遠處讀到一片黑。標成沒烘過，下一次 `update` 整張重來
  const onRestored = (): void => {
    near.primed = false
    if (mid !== null) mid.primed = false
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
    // 【第二個輸出】three 把這支編成 GLSL 300 es，gl_FragColor 是它宣告的 location 0；
    // 樹冠份量寫 location 1
    fragmentShader: `varying vec2 vWorld; uniform float uBakeFar; uniform float uBakeTrees;${TREE_OUT(tree)}
${glsl}
void main() { fieldFar = uBakeFar; fieldTrees = uBakeFar * uBakeTrees; gl_FragColor = vec4(fieldColorAt(vWorld), 0.0);${
  tree ? ` treeBake = vec4(fieldTree * ${TREE_BAKE_SCALE.toFixed(3)}, 0.0, 0.0);` : ''} }`,
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
    // 疊圖不是樹冠：份量寫 0，透明度與顏色相同，混合時照覆蓋率把底下的份量衰減掉
    fragmentShader: `varying vec4 vCol;${TREE_OUT(tree)}
void main() { gl_FragColor = vCol;${tree ? ' treeBake = vec4(0.0, 0.0, 0.0, vCol.a);' : ''} }`,
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
    fragmentShader: `varying vec2 vUv; uniform sampler2D uScarAtlas;${TREE_OUT(tree)}
void main() { gl_FragColor = texture2D(uScarAtlas, vUv);${
  tree ? ' treeBake = vec4(0.0, 0.0, 0.0, gl_FragColor.a);' : ''} }`,
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
    for (const o of overlays.children) o.visible = !nearLook(L) || o.userData['near'] === true
    // 【viewport／scissor 設在 RT 上】`setRenderTarget` 讀的是 RT 自己那一份，
    // `renderer.setViewport` 設的是畫布的
    L.rt.viewport.set(p.tx, p.tz, p.w, p.h)
    L.rt.scissor.set(p.tx, p.tz, p.w, p.h)
    L.rt.scissorTest = true
    for (const t of L.rt.textures) t.generateMipmaps = last
    bakeMat.uniforms['uCell0']!.value.set(p.cx0, p.cz0)
    bakeMat.uniforms['uCells']!.value.set(p.w, p.h)
    bakeMat.uniforms['uMetres']!.value = L.m
    bakeMat.uniforms['uBakeFar']!.value = nearLook(L) ? 0 : 1
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
    ...(mid === null || drawn === undefined ? {} : {
      uMid: { value: mid.rt.texture },
      uMidCentre: { value: mid.centre },
      uMidSpan: { value: mid.span },
      ...drawn.uniforms,
    }),
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
    ...(shade === undefined ? {} : {
      uFarS: { value: far.rt.textures[1]! },
      ...(horizon === null ? {} : { uHorS: { value: horizon.rt.textures[1]! } }),
      ...(backdrop === null ? {} : { uBackS: { value: backdrop.rt.textures[1]! } }),
      ...shade.uniforms,
      uCanopyGap: { value: new Vector3(canopyGapDensity('broad'), canopyGapDensity('cone'), canopyGapDensity('open')) },
    }),
  }
  const horizonDecl = (horizon === null ? ''
    : 'uniform sampler2D uHor; uniform vec2 uHorCentre; uniform float uHorSpan; uniform float uHorTop;')
    + (backdrop === null ? ''
      : '\nuniform sampler2D uBack; uniform float uBackSpan; uniform float uBackTop; uniform vec2 uHorFade; uniform vec2 uAvgFade;')
    + (!tree ? '' : (horizon === null ? '' : '\nuniform sampler2D uHorS;') + (backdrop === null ? '' : '\nuniform sampler2D uBackS;'))
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
  /**
   * 有樹冠份量時同一套取樣與權重多讀第二張，由 `hs` 帶出（存的是乘過 `TREE_BAKE_SCALE` 的值）
   */
  const horizonColourTree = horizon === null ? '' : backdrop === null ? `
vec3 horizonColourAt(vec2 qH, vec2 dHx, vec2 dHy, float eH, out vec2 hs) {
  vec3 avg = textureLod(uHor, vec2(0.5), uHorTop).rgb;
  vec2 avgS = textureLod(uHorS, vec2(0.5), uHorTop).rg;
  if (eH >= 1.0) { hs = avgS; return avg; }
  vec4 h = textureGrad(uHor, fract(qH), dHx, dHy);
  vec2 hS = textureGrad(uHorS, fract(qH), dHx, dHy).rg;
  float keep = clamp(h.a * 4.0, 0.0, 1.0);
  float f = smoothstep(1.0 - uEdgeBlend, 1.0, eH) * (1.0 - keep);
  hs = mix(hS, avgS, f);
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
  vec2 hS = textureGrad(uHorS, fract(qH), dHx, dHy).rg;
  float keep = clamp(h.a * 4.0, 0.0, 1.0);
  float f = smoothstep(uHorFade.x, uHorFade.y, rCam) * (1.0 - keep);
  if (f <= 0.0) { hs = hS; return h.rgb; }
  vec2 bs;
  vec3 b = backdropColourAt(qB, dBx, dBy, rCam, bs);
  hs = mix(hS, bs, f);
  return mix(h.rgb, b, f);
}`
  const horizonColour = tree ? horizonColourTree : horizon === null ? '' : backdrop === null ? `
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
  const midDecl = mid === null ? ''
    : 'uniform sampler2D uMid; uniform vec2 uMidCentre; uniform float uMidSpan;\n'
      + 'uniform sampler2D uTreesDrawn; uniform vec2 uTreesOrigin;'
  /**
   * 【這一點有沒有畫樹】查植被發布的那一張（`drawnTiles.ts`）：貼圖第 k 格是植被格
   * `uTreesOrigin + k`，格心對格心，線性過濾讓格與格之間 250 m 漸變。中窗邊緣淡出 ——
   * 中窗外讀不到中圖，那裡照讀遠圖（見 `2026-10-19-ground-under-drawn-trees-design.md`）
   */
  const midGrad = mid === null ? '\n  float drawn = 0.0;' : `
  vec2 qM = w / uMidSpan;
  vec2 dMx = dFdx(qM); vec2 dMy = dFdy(qM);
  float eM = max(abs(w.x - uMidCentre.x), abs(w.y - uMidCentre.y)) / (0.5 * uMidSpan);
  float drawn = texture2D(uTreesDrawn, (w / ${TILE_SIZE.toFixed(1)} - uTreesOrigin) / ${DRAWN_TILES_N.toFixed(1)}).r
    * (1.0 - smoothstep(1.0 - uEdgeBlend, 1.0, eM));`
  /** 有畫樹的地方由遠圖換成中圖（近處的樣子） */
  const midMix = mid === null ? ''
    : '\n    if (drawn > 0.0) t = mix(t, textureGrad(uMid, fract(qM), dMx, dMy).rgb, drawn);'
  const texBlockPlain = horizon === null ? `
    vec3 t = textureGrad(uFar, fract(qF), dFx, dFy).rgb;${midMix}
    float tN = smoothstep(1.0 - uEdgeBlend, 1.0, eN);
    if (tN < 1.0) t = mix(textureGrad(uNear, fract(qN), dNx, dNy).rgb, t, tN);` : `
    // 【遠圖讀不到的地方不讀】窗外是環面上別處的內容
    float tF = smoothstep(1.0 - uEdgeBlend, 1.0, eF);
    vec3 t = vec3(0.0);
    if (tF < 1.0) {
      t = textureGrad(uFar, fract(qF), dFx, dFy).rgb;${midMix}
      float tN = smoothstep(1.0 - uEdgeBlend, 1.0, eN);
      if (tN < 1.0) t = mix(textureGrad(uNear, fract(qN), dNx, dNy).rgb, t, tN);
    }
    if (tF > 0.0) t = mix(t, horizonColourAt(${horizonArgs}), tF);`
  // 【樹冠份量照顏色的權重混】近圖、中圖的份量是 0（近處的樣子），所以換成它們時份量照
  // 權重衰減；每一處少跟一步，遠圖與最外層的交界就會出現接縫
  const midMixTree = mid === null ? ''
    : '\n    if (drawn > 0.0) { t = mix(t, textureGrad(uMid, fract(qM), dMx, dMy).rgb, drawn); ts *= 1.0 - drawn; }'
  const texBlockTree = horizon === null ? `
    vec3 t = textureGrad(uFar, fract(qF), dFx, dFy).rgb;
    vec2 ts = textureGrad(uFarS, fract(qF), dFx, dFy).rg;${midMixTree}
    float tN = smoothstep(1.0 - uEdgeBlend, 1.0, eN);
    if (tN < 1.0) { t = mix(textureGrad(uNear, fract(qN), dNx, dNy).rgb, t, tN); ts *= tN; }` : `
    // 【遠圖讀不到的地方不讀】窗外是環面上別處的內容
    float tF = smoothstep(1.0 - uEdgeBlend, 1.0, eF);
    vec3 t = vec3(0.0);
    vec2 ts = vec2(0.0);
    if (tF < 1.0) {
      t = textureGrad(uFar, fract(qF), dFx, dFy).rgb;
      ts = textureGrad(uFarS, fract(qF), dFx, dFy).rg;${midMixTree}
      float tN = smoothstep(1.0 - uEdgeBlend, 1.0, eN);
      if (tN < 1.0) { t = mix(textureGrad(uNear, fract(qN), dNx, dNy).rgb, t, tN); ts *= tN; }
    }
    if (tF > 0.0) {
      vec2 hs;
      vec3 h = horizonColourAt(${horizonArgs}, hs);
      t = mix(t, h, tF);
      ts = mix(ts, hs, tF);
    }`
  const texBlock = tree ? texBlockTree : texBlockPlain
  // 【樹冠換成點的算式】三段：宣告、`color_fragment` 裡換底色與算樹冠的光、光照算完之後
  // 加上樹冠的光並把那一份的鏡面反射拿掉。`canopyLight`、`canopyMatte` 是全域變數，兩段
  // 之間靠它們傳
  //
  // 【表在頂點查或在像素查】兩次查表放在像素裡，德 M3 地形 3000 m 往下看多 0.45 ms（Iris Xe）；
  // 放在頂點、像素之間內插只多 0.06 ms。地面網格密，頂點查的與像素查的看不出差別。
  // `canopyLookup` 可以同頁切換
  let perPixel = false
  const treeDecl = (): string => !tree ? '' : `
uniform sampler2D uFarS;
uniform vec3 uCanopyBroad; uniform vec3 uCanopyCone; uniform vec3 uCanopyGap;
${perPixel ? VIEW_SHADE_GLSL : 'varying vec3 vCanopyKB; varying vec3 vCanopyKC;'}
vec3 canopyLight = vec3(0.0);
float canopyMatte = 0.0;`
  const canopyK = (row: ViewShadeRow, varying: string): string =>
    perPixel ? `viewShade(${row.toFixed(1)}, toCam)` : varying
  // 份量 s（乘過 TREE_BAKE_SCALE）→ 闊葉、針葉各自的面積份量；樹籬折成闊葉，最多到 1.27。
  // 覆蓋：點從這個仰角看過去蓋住地面的比例；沒蓋到的是林地。
  // 【哪一種林子】樹林田整塊一個樹種，空地的林子闊葉、針葉固定照 OPEN_CONIFER_SHARE 記
  // （fieldShaders.ts）：兩個分量照那個比例同時有的那一份是空地的林子，點比較稀
  const treeShade = (): string => !tree ? '' : `
  vec2 share = s / ${TREE_BAKE_SCALE.toFixed(3)};
  float shareSum = share.x + share.y;
  if (shareSum > 1.0e-3) {
    vec3 toCam = normalize(cameraPosition - vFarmWorld);
    float sinE = max(toCam.y, 0.02);
    float openWood = clamp(min(share.x / ${(1 - OPEN_CONIFER_SHARE).toFixed(3)}, share.y / ${OPEN_CONIFER_SHARE.toFixed(3)}) / shareSum, 0.0, 1.0);
    float coverB = 1.0 - exp(-mix(uCanopyGap.x, uCanopyGap.z, openWood) / sinE);
    float coverC = 1.0 - exp(-mix(uCanopyGap.y, uCanopyGap.z, openWood) / sinE);
    c = max(c - share.x * BROAD_FAR_COLOR - share.y * CONE_FAR_COLOR, vec3(0.0))
      + (share.x * (1.0 - coverB) + share.y * (1.0 - coverC)) * WOOD_COLOR;
    canopyLight = share.x * coverB * uCanopyBroad * ${canopyK(ViewShadeRow.Broad, 'vCanopyKB')}
      + share.y * coverC * uCanopyCone * ${canopyK(ViewShadeRow.Cone, 'vCanopyKC')};
    canopyMatte = clamp(share.x * coverB + share.y * coverC, 0.0, 1.0);
  }`
  const material = new MeshStandardMaterial({ flatShading: true, roughness: ROUGHNESS })
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, U, candUniforms())
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFarmWorld;${tree && !perPixel ? `
varying vec3 vCanopyKB; varying vec3 vCanopyKC;
${VIEW_SHADE_GLSL}` : ''}`)
      .replace('#include <begin_vertex>',
        `#include <begin_vertex>\nvFarmWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;${tree && !perPixel ? `
{
  vec3 toCam = normalize(cameraPosition - vFarmWorld);
  vCanopyKB = viewShade(${ViewShadeRow.Broad.toFixed(1)}, toCam);
  vCanopyKC = viewShade(${ViewShadeRow.Cone.toFixed(1)}, toCam);
}` : ''}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFarmWorld;
uniform sampler2D uNear; uniform vec2 uNearCentre; uniform float uNearSpan;
uniform sampler2D uFar; uniform vec2 uFarCentre; uniform float uFarSpan;
uniform vec2 uCam; uniform float uInner; uniform float uInnerBand; uniform float uEdgeBlend;
uniform float uBypass;
${midDecl}
${horizonDecl}${treeDecl()}
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
  vec2 dFx = dFdx(qF); vec2 dFy = dFdy(qF);${horizonGrad}${midGrad}
  float eN = max(abs(w.x - uNearCentre.x), abs(w.y - uNearCentre.y)) / (0.5 * uNearSpan);
  float eF = max(abs(w.x - uFarCentre.x), abs(w.y - uFarCentre.y)) / (0.5 * uFarSpan);
  float tIn = uInner <= 0.0 ? 1.0 : smoothstep(uInner - uInnerBand, uInner, distance(w, uCam));
  bool proc = uBypass > 0.5 || tIn < 1.0${farOutProc};
  bool tex = uBypass < 0.5 && tIn > 0.0${farOutTex};
  vec3 c = vec3(0.0);
  // 算式：旁路、內圈；沒有最外層時還有遠窗外。近窗外、沒有畫樹的地方畫遠處的樣子，
  // 與遠圖烘的相同；有畫樹的地方與中圖相同
  fieldFar = eN >= 1.0 && drawn < 0.5 ? 1.0 : 0.0;${tree ? `
  vec2 s = vec2(0.0);
  if (proc) { c = fieldColorAt(w); s = fieldTree * ${TREE_BAKE_SCALE.toFixed(3)}; }` : `
  if (proc) c = fieldColorAt(w);`}
  // 【內圈疊回烘進貼圖的平面】算式裡沒有街、鎮地面、礦坑；貼圖的透明度記著它們。
  // 近圖外（內圈可以伸出近窗）讀遠圖。
  // 【不是 mix(c, rgb, a)】過濾過的 rgb 本來就是田色與疊圖照覆蓋率混好的，再乘一次
  // 覆蓋率，疊圖的邊會淡掉；有兩成五以上就整個用貼圖的顏色
  if (proc && uBypass < 0.5 && eF < 1.0) {
    vec4 o = eN < 1.0 ? textureGrad(uNear, fract(qN), dNx, dNy) : textureGrad(uFar, fract(qF), dFx, dFy);${tree ? `
    float k = clamp(o.a * 4.0, 0.0, 1.0);
    c = mix(c, o.rgb, k);
    s = mix(s, eN < 1.0 ? vec2(0.0) : textureGrad(uFarS, fract(qF), dFx, dFy).rg, k);` : `
    c = mix(c, o.rgb, clamp(o.a * 4.0, 0.0, 1.0));`}
  }
  if (tex) {${texBlock}
    c = proc ? mix(c, t, tIn) : t;${tree ? `
    s = proc ? mix(s, ts, tIn) : ts;` : ''}
  }${treeShade()}
  diffuseColor.rgb = c;
}`)
    if (tree) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
totalEmissiveRadiance += canopyLight;
reflectedLight.directSpecular *= 1.0 - canopyMatte;
reflectedLight.indirectSpecular *= 1.0 - canopyMatte;`)
    }
  }
  const id = instances++
  material.customProgramCacheKey = () =>
    `field-clipmap:${opts.season}:${opts.site === undefined ? '' : 'site'}:${cand === undefined ? '' : 'cand'}`
    + `:${opts.open === true ? 'open' : ''}:${horizon === null ? '' : 'horizon'}:${mid === null ? '' : 'mid'}`
    + `:${tree ? (perPixel ? 'tree-px' : 'tree-vx') : ''}:${id}`
  matteGround(material)

  return {
    material,
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
      if (toNear) {
        near.primed = false
        if (mid !== null) mid.primed = false
      }
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
      // 上面整個換掉了貼片原本的掛鉤，地面的光照要重掛
      matteGround(m)
    },
    update(camX, camZ) {
      recentre(near, camX, camZ)
      if (mid !== null) recentre(mid, camX, camZ)
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
      if (mid !== null && drawn !== undefined && edge(mid.centre, mid.span) < 1
        && drawn.drawnAt(Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE))) {
        return `中圖：${mid.m.toFixed(1)} m／格，這一格有畫樹，近處的樣子`
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
    canopyLookup(on) {
      if (on !== undefined && on !== perPixel) {
        perPixel = on
        material.needsUpdate = true
      }
      return perPixel
    },
    dispose() {
      renderer.domElement?.removeEventListener('webglcontextrestored', onRestored)
      near.rt.dispose()
      mid?.rt.dispose()
      far.rt.dispose()
      horizon?.rt.dispose()
      backdrop?.rt.dispose()
      bakeMat.dispose()
      overlayMat.dispose()
      texturedOverlayMat.dispose()
      quadGeo.dispose()
      material.dispose()
    },
  }
}
