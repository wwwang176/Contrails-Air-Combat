import { Color } from 'three'
import { hash1, hash2 } from '../core/hash'
import { FIELD_COLORS, PALETTE_STEPS, type FieldColors, type Season } from './season'
import { BROAD_CROWN_R } from '../specs/flora'

/**
 * 諾曼第式的 Bocage 地景：**每一塊田都被樹籬完整圍起來。**
 *
 * ```
 *   粗的一層（區塊）   這一帶田的走向、尺寸、以及配色的基調
 *                     兩區的交界是一條凹路（sunken lane）
 *   細的一層（田）     區塊座標系裡的抖動矩形格。縱橫界線各自被推移，
 *                     所以田是不規則的四邊形，不是等大的方格
 * ```
 *
 * 【為什麼不是 Voronoi】Voronoi 長出來的是凸多邊形 —— 從空中看是碎石地坪
 * 或迷彩，不是農地。Bocage 的田是**接近矩形**的，而抖動的矩形格直接就是
 * 那個形狀。順帶它便宜得多：不必 3×3 鄰域搜尋，而且格線在區塊座標系裡
 * 軸對齊，所以「離田界多遠」本來就是世界公尺，不必修正方位。
 *
 * 【樹籬是主角，不是點綴】Bocage 的定義就是每塊田被土堤＋灌木＋喬木圍住。
 * 初稿把樹籬砍到只長一半、佔地 6.6%，那是開放田制（open-field）的樣子 ——
 * 帶狀田、樹籬稀疏。Bocage 的樹籬該佔到一成七，讀起來像一張綠色的網。
 *
 * 【為什麼不烘貼圖】要讓 18 m 的樹籬不鋸齒，30 km 見方需要 4096² 的貼圖
 * （7.3 m/texel），RGB 是 50 MB。在著色器裡算是解析的、與解析度無關，
 * **而且延伸到無限遠** —— 遠景環用同一支函式，圖案自動接得上。
 *
 * 【為什麼這不違背「不用 noise 函式庫」】`archipelago.ts` 的檔頭要的是
 * 「決定性天然成立、沒有第三方相依」。整數雜湊的閉式函數兩條都成立。
 *
 * 【GLSL 由這裡的常數產生，不是另抄一份】數字只有一個來源。演算法那幾行
 * 由 `fields.test.ts` 的金本位釘住，語法由 e2e 在真的 WebGL2 裡編譯來守。
 *
 * 【兩份唯一容許分家的地方：犁溝與作物條紋】它只在 GLSL 裡，因為抗鋸齒需要
 * 片段的導數（`fwidth`），CPU 沒有對應物。少了抗鋸齒，1 km 外整片田會出現
 * 摩爾紋 —— 比沒有條紋更糟。這個例外由 `fields.test.ts` 的「犁溝與作物條紋」
 * 那一組守著：條紋確實被呼叫，而 CPU 那一份確實沒有。
 */

/**
 * 田的短邊，m。
 *
 * 【比史實大，這是刻意的】實測 170 那一版的田是 p50 2.36 ha（等效邊長
 * 154 m）、p90 8.07 ha —— 中位數正好落在真實 Bocage 的 0.5～3 ha 中間，
 * 而 p90 已經比真實的大。但玩家是用 200 m/s 在 600 m 高度看它，那個尺度下
 * 150 m 的田是細節不是地貌。
 */
export const FIELD_SPACING = 230

/** 田的長寬比。Bocage 的田是不規則四邊形，不是長條，所以不大 */
export const FIELD_ANISO = 1.55

/**
 * 每一區把田的尺寸乘上這個區間裡的一個數。大小因此成片地變。
 *
 * 【跨距不要拉大】[0.8, 1.6] 那種兩倍的跨距會讓最小的那一撮太碎。
 */
export const FIELD_SPACING_VAR = [0.85, 1.35] as const

/**
 * 格線推移的幅度，格的比例。
 *
 * **必須 < 0.5** —— 大於一半的話相鄰兩條界線會交換次序，田會翻面。
 * 這一條由 `fields.test.ts` 的「格線恆遞增」守著。
 */
export const EDGE_JITTER = 0.26

/** 一塊田再對切一次的機率。田的大小因此有兩倍的變化 */
export const SPLIT_CHANCE = 0.35

/** 區塊的間距，m。一帶田共用走向與色調的範圍 */
export const REGION_SPACING = 3200

/** 樹籬的總寬度，m。土堤加灌木加喬木，由空中看到的那一條帶 */
export const HEDGE_WIDTH = 18

/**
 * 遠處（植被圈外，樹籬的樹不畫了）樹籬那一條帶放寬幾倍、畫成林子從空中看的顏色
 * （`season.ts` 的 `canopyColor`）再壓暗 `HEDGE_FAR_SHADE`。斜著看，一排十幾公尺高的
 * 樹遮住的地比樹冠還寬；照近處那一條細的深色線畫的話，6 km 外的田整片只剩土色。
 *
 * 【對的是點】3～6 km 的樹是點，田界上一串深色的點：烘的那一條淡了，點冒出來的
 * 地方就像突然多了一排樹。同一視角有樹、只剩烘圖兩張，量田界那些最暗的像素與
 * 整體平均對得上的寬度與明暗
 */
export const HEDGE_FAR_GROW = 2.5

export const HEDGE_FAR_SHADE = 0.7

/**
 * 遠圖裡空地的樹畫成點的顏色：林子從空中看的顏色再乘這個（線性值）。對的是
 * 3～6 km 的點：同一視角有樹、只剩烘圖兩張，林緣稀疏那一帶的明暗對得上
 */
export const TREE_DOT_SHADE = 0.55

/**
 * 有多少比例的田界長樹籬。
 *
 * 【為什麼接近 1】**Bocage 的定義就是每塊田被完整圍起來。** 留一點缺口是
 * 給農路的出入口 —— 全滿反而假。
 */
export const HEDGE_CHANCE = 0.92

/**
 * 凹路的寬度：兩區交界的那一條，判準是 `r2 − r1`（`trackGap`）小於它乘上沿路的
 * 起伏（`trackWidthAt`）
 */
export const TRACK_WIDTH = 20

/**
 * 凹路寬度沿路的起伏：三道斜向的正弦疊在 `TRACK_WIDTH` 上，各自的振幅比例，合計
 * ±25%。長波長的讓路忽寬忽窄，最短的那一道（波長一百多公尺）讓路緣參差
 */
export const TRACK_RIPPLE = [
  { amp: 0.12, fx: 0.0047, fz: 0.0029, phase: 0 },
  { amp: 0.08, fx: 0.013, fz: -0.0094, phase: 1.3 },
  { amp: 0.05, fx: 0.041, fz: 0.033, phase: 0.7 },
] as const

/** 凹路最寬與最窄處：`TRACK_WIDTH` 乘上起伏的上下限 */
export const TRACK_WIDTH_MAX = TRACK_WIDTH * 1.25

export const TRACK_WIDTH_MIN = TRACK_WIDTH * 0.75

/**
 * 凹路的歪斜：量凹路之前座標先推移，兩道正弦疊起來，振幅 m。凹路因此在兩區的
 * 交界兩側來回擺（波長約 780 m 與 190 m）。
 *
 * 【擺幅受寬度管】兩區的田格在交界上是一條直的接縫，凹路要一路蓋住它：交界上
 * `trackGap` 最多是 `2 × TRACK_WARP_MAX`，必須小於最窄處 `TRACK_WIDTH_MIN`。
 * 擺得比這個大，接縫就從凹路邊上露出來
 */
export const TRACK_WARP = [
  { amp: 3.8, fx: 0.0069, fz: 0.0041, phase: 0.4 },
  { amp: 1.2, fx: -0.021, fz: 0.026, phase: 2.1 },
] as const

/** 推移量的上限，m（兩個分量各自最多 5） */
export const TRACK_WARP_MAX = 5 * Math.SQRT2

/**
 * 一塊田整片變成樹林（copse）的機率。
 *
 * 【放置與地色共用 `isWoodField`】`render/flora.ts` 用它決定要不要在這塊田裡
 * 填樹，`fieldSurfaceColor` 用它決定地色。兩邊分家的話，會出現「深綠的地上
 * 沒有樹」或「樹長在麥田裡」。
 */
export const WOOD_CHANCE = 0.05

/**
 * 【田圍著村】`open` 的地圖：田只在村的周圍，離村遠的地塊是空地（牧草地、
 * 荒地、休耕），空地上成團的樹林。洛伊納不開 —— 萊比錫低地是開墾到幾乎不剩
 * 空地的黃土平原。
 *
 * 每一塊地用它的**中心**判斷，所以田與空地的交界落在田界上，不切過一塊田。
 * 離村（`villageDistance`）`FIELD_REACH` 以內是田，範圍沿地面用低頻雜訊起伏
 * 0.7～1.3 倍；交界那一段每塊地各抽一個門檻，邊緣是參差的。
 */
export const FIELD_REACH = 1500

/** 田的範圍起伏的雜訊格寬，m */
export const REACH_NOISE_CELL = 2600

/** 空地上的樹林：兩個尺度的雜訊格寬（大的定位置、小的把邊弄毛），m */
export const OPEN_WOOD_CELL = [520, 190] as const

/** 雜訊值落在這一段裡由空地漸變到樹林 */
export const OPEN_WOOD_GATE = [0.5, 0.62] as const

/** 空地兩個色之間漸變的雜訊格寬，m */
export const OPEN_TONE_CELL = 450

/**
 * 樹林裡的網格間距，m。3,906 棵/km²。
 *
 * 【為什麼是網格不是走線】樹林填的是**面**不是線，而 16 m 的網格在 250 m 的
 * tile 上是 244 次 `fieldAt` ≈ 0.09 ms —— 只在生成時付一次。
 *
 * 【在這裡不在 `flora.ts`】遠圖把空地的樹一棵一棵烘成點（GLSL 的 `openTreesOver`），
 * 位置與接受的判準與植被逐位元相同；兩邊讀同一組數字
 */
export const WOOD_GRID = 16

/**
 * 空地上的樹林：接受機率乘這個、縮放取這一段。
 *
 * 【稀一點、大一點】空地的林子佔地大，照田裡樹林的密度長的話，實測整張圖慢
 * 7～9%（多出來的全是樹的實例）。一半多一點的候選點、每棵取大的那一段，從空中
 * 看林冠一樣滿，實例數約少三成五
 */
export const OPEN_WOOD_DENSITY = 0.55

export const OPEN_TREE_SCALE = [0.8, 1.0] as const

/** 空地上的樹林裡針葉樹佔多少 */
export const OPEN_CONIFER_SHARE = 0.3

/** 遠圖的樹點邊緣抗鋸齒的半寬上限，m（遠圖一格 7.3 m，半個像素足跡不到這個） */
export const OPEN_DOT_AA = 8

/** 蓋得到一點的樹點離它最遠多遠，m：最大的樹冠半徑加抗鋸齒 */
export const OPEN_DOT_REACH = BROAD_CROWN_R * OPEN_TREE_SCALE[1] + OPEN_DOT_AA

/**
 * 遠圖畫樹點時的餘量：空地樹林的雜訊（兩層值雜訊，`openWoodCover`）在 `OPEN_DOT_REACH`
 * 裡最多變這麼多。值雜訊一層對座標的斜率不超過 1.5√2 / 格寬（平滑插值的斜率最大 1.5）。
 * 這一點的雜訊 ± 它就夾住了周圍每一棵候選樹的覆蓋率 —— 夾得出答案的候選樹不必
 * 再算雜訊，整圈都長不出樹的點直接跳過
 */
export const OPEN_WOOD_NEAR_MARGIN = 1.5 * Math.SQRT2
  * (0.65 / OPEN_WOOD_CELL[0] + 0.35 / OPEN_WOOD_CELL[1]) * OPEN_DOT_REACH

/**
 * 樹籬與樹林田整條（整塊）種針葉樹的比例（`flora.ts` 的 `speciesOf`；遠圖的樹林田
 * 照它挑林冠色）。
 *
 * 【闊葉為主】Bocage 的樹籬是橡與櫸，針葉只出現在刻意種的防風林裡。
 * 一半一半的話整片地讀起來像雲杉林。
 */
export const CONIFER_SHARE = 0.25

/**
 * 區塊格有村的機率；村在這一格的種子與一個軸向鄰格（`VILLAGE_NEIGHBOUR`，由種子
 * 的雜湊挑）的種子的中點。植被（`flora.ts` 的 `villageSite`）與田色共用
 */
export const VILLAGE_CHANCE = 0.55

export const VILLAGE_NEIGHBOUR = [1, 0, 0, 1] as const

/** 世界座標的一個點。`regionSeed` 就地寫進它 */
export interface Vec2 {
  x: number
  z: number
}

/**
 * 一塊田被對切出來的那一刀。**它也是一條樹籬** —— 實測佔全部樹籬帶的
 * 11.8%，而它不在任何一條格線上。
 */
export interface SplitCut {
  /** 0 = 線上的 qx 固定（沿 qz 走）；1 = qz 固定（沿 qx 走） */
  axis: number
  /** 固定的那個座標 */
  at: number
  /** 線的兩端，在它延伸的那個軸上 */
  lo: number
  hi: number
}

export interface RegionSample {
  /** 到最近與次近的區塊種子的距離，m */
  r1: number
  r2: number
  /** 最近（a）與次近（b）的種子，世界座標。凹路是它們的交界（`trackGap`） */
  ax: number
  az: number
  bx: number
  bz: number
  /** 這一區的雜湊 */
  id: number
  /** 這一帶田的走向，rad */
  angle: number
  /** 這一帶田的短邊與長邊，m */
  cellW: number
  cellH: number
  /** 這一帶的基調在 `PALETTE` 上的位置 */
  tone: number
}

export interface FieldSample {
  /** 這一塊田的雜湊。田的身分 */
  id: number
  /** 到最近的一條田界有多遠，m */
  edge: number
  /** 最近那條田界長不長樹籬 */
  hedged: boolean
  /** 這一塊地的中心（對切過的是那一半的中心），世界座標 */
  cx: number
  cz: number
}

/**
 * 第 `k` 條格線的位置，m。`salt` 分開縱線與橫線。
 *
 * **推移量必須小於半格**，否則相鄰兩條線會交換次序 —— 見 `EDGE_JITTER`。
 *
 * 【`export` 是給測試的】「格線恆遞增」是整個矩形格成立的前提，而由成品
 * 反推很難證明它。直接驗這一支便宜得多。
 */
export function edgeAt(k: number, cell: number, salt: number): number {
  return (k + (hash2(k, salt) / 4294967296 - 0.5) * 2 * EDGE_JITTER) * cell
}

/**
 * 第 `(i, j)` 格區塊的種子座標，寫進 `out`；回傳那一格的雜湊。
 *
 * 【為什麼要匯出】村落的站址是兩顆種子的中點（`render/flora.ts`）。在那邊
 * 重抄一次公式就是兩個真相 —— 一邊改了，村子會離開路面而且不會有人發現。
 */
export function regionSeed(i: number, j: number, out: Vec2): number {
  const h = hash2(i, j)
  out.x = (i + 0.5 + ((h & 0xffff) / 65536 - 0.5) * 0.76) * REGION_SPACING
  out.z = (j + 0.5 + ((h >>> 16) / 65536 - 0.5) * 0.76) * REGION_SPACING
  return h
}

/**
 * 由區塊的雜湊算出這一帶田的走向、格距與色調。**不碰 `r1` / `r2`。**
 *
 * 【為什麼要匯出】一格 tile 可能同時屬於好幾個區塊，走第二個區塊的格線時
 * 手上只有它的 `id`，沒有一個落在它裡面的座標可以拿去問 `regionAt`。
 */
export function regionParams(id: number, out: RegionSample): void {
  const rh = hash1(id)
  out.id = id
  out.angle = ((rh & 0xffff) / 65536) * Math.PI
  const scale = FIELD_SPACING_VAR[0]
    + ((rh >>> 16) / 65536) * (FIELD_SPACING_VAR[1] - FIELD_SPACING_VAR[0])
  out.cellW = FIELD_SPACING * scale
  out.cellH = FIELD_SPACING * scale * FIELD_ANISO
  // 【三角分佈，不是均勻】均勻抽的話四分之一的地是最深的綠、四分之一是
  // 最淡的金 —— 30 km 看下去區塊那一層自己會變成新的迷彩
  const th = hash1(rh)
  out.tone = (((th & 0xffff) % PALETTE_STEPS) + ((th >>> 16) % PALETTE_STEPS)) >> 1
}

/** `regionAt` 找種子用的暫存。熱路徑之外，但仍然不配置 */
const SEED: Vec2 = { x: 0, z: 0 }

/**
 * 世界座標落在哪一區，以及那一區的參數。就地寫進 `out`。
 *
 * 區塊本身是各向同性的 Voronoi —— 走向是它**給出來**的東西，不是它自己吃的。
 */
export function regionAt(x: number, z: number, out: RegionSample): void {
  const gx = Math.floor(x / REGION_SPACING)
  const gz = Math.floor(z / REGION_SPACING)
  let r1 = Infinity
  let r2 = Infinity
  let id = 0
  let ax = 0, az = 0, bx = 0, bz = 0
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const h = regionSeed(gx + di, gz + dj, SEED)
      // 【手寫開根號】V8 的 Math.hypot 每次呼叫都會配置，而生格時每一株
      // 都要問一次這裡
      const dx = x - SEED.x
      const dz = z - SEED.z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < r1) {
        r2 = r1; bx = ax; bz = az
        r1 = d; ax = SEED.x; az = SEED.z; id = h
      } else if (d < r2) { r2 = d; bx = SEED.x; bz = SEED.z }
    }
  }
  regionParams(id, out)
  out.r1 = r1
  out.r2 = r2
  out.ax = ax
  out.az = az
  out.bx = bx
  out.bz = bz
}

/** 凹路這一點的寬度：`TRACK_WIDTH` × (1 ± 0.25)。**與 shader 同一條式子**，只吃世界座標 */
export function trackWidthAt(x: number, z: number): number {
  let k = 1
  for (let i = 0; i < TRACK_RIPPLE.length; i++) {
    const r = TRACK_RIPPLE[i]!
    k += r.amp * Math.sin(r.fx * x + r.fz * z + r.phase)
  }
  return TRACK_WIDTH * k
}

/**
 * 量凹路用的 `r2 − r1`：最近與次近兩顆種子（`regionAt` 寫進 `reg` 的那兩顆）
 * 到**推移過的座標**（`TRACK_WARP`）的距離差。凹路是 `trackGap < trackWidthAt`。
 * **與 shader 同一條式子**。
 *
 * 推移量不超過 `TRACK_WARP_MAX`，所以它與沒推移的 `reg.r2 − reg.r1` 差不到
 * `2 × TRACK_WARP_MAX` —— 整格判斷拿這個當餘量
 */
export function trackGap(x: number, z: number, reg: RegionSample): number {
  let wx = x
  let wz = z
  for (let i = 0; i < TRACK_WARP.length; i++) {
    const w = TRACK_WARP[i]!
    wx += w.amp * Math.sin(w.fx * x + w.fz * z + w.phase)
    wz += w.amp * Math.sin(w.fz * x - w.fx * z + w.phase + 1.7)
  }
  const ex = wx - reg.ax
  const ez = wz - reg.az
  const fx = wx - reg.bx
  const fz = wz - reg.bz
  return Math.abs(Math.sqrt(fx * fx + fz * fz) - Math.sqrt(ex * ex + ez * ez))
}

/** 這一點在凹路上嗎。`reg` 是這一點的 `regionAt` */
export function onTrack(x: number, z: number, reg: RegionSample): boolean {
  // 離交界遠的點不必算正弦：`trackGap` 與 `r2 − r1` 差不到兩倍推移量
  if (reg.r2 - reg.r1 >= TRACK_WIDTH_MAX + 2 * TRACK_WARP_MAX) return false
  return trackGap(x, z, reg) < trackWidthAt(x, z)
}

/** 候選表一小格的邊長，m。一格區塊切成 16 × 16 小格 */
export const REGION_CANDIDATE_CELL = 200

/** 一格區塊每一邊有幾個小格 */
export const REGION_CANDIDATE_SUB = REGION_SPACING / REGION_CANDIDATE_CELL

/**
 * 每個小格可能成為最近或次近種子的那幾顆（3×3 裡的索引 `(dj+1)*3+(di+1)`）。
 *
 * `data` 每個小格 4 位元組、8 個 nibble：第 0 個是候選數，1…7 是索引，
 * 由小到大 —— 也就是完整搜尋的走訪順序，平手時取到的是同一顆。候選數
 * 15 表示這一格不剪枝、走完整搜尋。貼圖座標 `(x, y)` 對應 `(小格欄, 小格列)`。
 */
export interface RegionCandidates {
  /** 表左下角那一格區塊的索引 */
  gx0: number
  gz0: number
  blocksX: number
  blocksZ: number
  cols: number
  rows: number
  data: Uint8Array
}

/**
 * 剪枝的安全邊界，m。
 *
 * 【為什麼要留】GPU 用 float32 算距離、算小格索引，誤差在公分以下。
 * 不留的話兩顆種子距離幾乎相同的小格可能剪掉真正的次近種子 —— 樹籬的位置
 * 就在那裡跳一格，而且只在 GPU 上發生。
 */
const CANDIDATE_MARGIN = 1

/**
 * 建候選表。`x0`、`z0` 必須是 `REGION_SPACING` 的整數倍，`cols`、`rows`
 * 必須是 `REGION_CANDIDATE_SUB` 的整數倍 —— 小格不得跨區塊格，否則同一個
 * 小格會對應兩組不同的 3×3。進關卡時建一次。
 */
export function buildRegionCandidates(
  x0: number, z0: number, cols: number, rows: number,
): RegionCandidates {
  const gx0 = Math.round(x0 / REGION_SPACING)
  const gz0 = Math.round(z0 / REGION_SPACING)
  const blocksX = cols / REGION_CANDIDATE_SUB
  const blocksZ = rows / REGION_CANDIDATE_SUB
  if (gx0 * REGION_SPACING !== x0 || gz0 * REGION_SPACING !== z0
    || !Number.isInteger(blocksX) || !Number.isInteger(blocksZ)) {
    throw new Error('候選表必須對齊區塊格')
  }
  const data = new Uint8Array(cols * rows * 4)
  const sx = new Float64Array(9)
  const sz = new Float64Array(9)
  const dMin = new Float64Array(9)
  const seed: Vec2 = { x: 0, z: 0 }
  for (let bz = 0; bz < blocksZ; bz++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const gx = gx0 + bx
      const gz = gz0 + bz
      for (let k = 0; k < 9; k++) {
        regionSeed(gx + (k % 3) - 1, gz + ((k / 3) | 0) - 1, seed)
        sx[k] = seed.x
        sz[k] = seed.z
      }
      for (let sj = 0; sj < REGION_CANDIDATE_SUB; sj++) {
        for (let si = 0; si < REGION_CANDIDATE_SUB; si++) {
          const ax = gx * REGION_SPACING + si * REGION_CANDIDATE_CELL - CANDIDATE_MARGIN
          const bxw = ax + REGION_CANDIDATE_CELL + 2 * CANDIDATE_MARGIN
          const az = gz * REGION_SPACING + sj * REGION_CANDIDATE_CELL - CANDIDATE_MARGIN
          const bzw = az + REGION_CANDIDATE_CELL + 2 * CANDIDATE_MARGIN
          let max1 = Infinity
          let max2 = Infinity
          for (let k = 0; k < 9; k++) {
            const nx = Math.max(ax - sx[k]!, 0, sx[k]! - bxw)
            const nz = Math.max(az - sz[k]!, 0, sz[k]! - bzw)
            dMin[k] = Math.sqrt(nx * nx + nz * nz)
            const fx = Math.max(Math.abs(sx[k]! - ax), Math.abs(sx[k]! - bxw))
            const fz = Math.max(Math.abs(sz[k]! - az), Math.abs(sz[k]! - bzw))
            const dMax = Math.sqrt(fx * fx + fz * fz)
            if (dMax < max1) { max2 = max1; max1 = dMax } else if (dMax < max2) max2 = dMax
          }
          const o = ((bz * REGION_CANDIDATE_SUB + sj) * cols + bx * REGION_CANDIDATE_SUB + si) * 4
          let n = 0
          for (let k = 0; k < 9; k++) {
            // 比兩顆種子的最遠距離還遠，這一格裡不可能是最近或次近
            if (dMin[k]! > max2 + CANDIDATE_MARGIN) continue
            n++
            if (n <= 7) data[o + (n >> 1)] = data[o + (n >> 1)]! | (k << ((n & 1) * 4))
          }
          if (n > 7) { data[o] = 15; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0 } else data[o] = data[o]! | n
        }
      }
    }
  }
  return { gx0, gz0, blocksX, blocksZ, cols, rows, data }
}

/**
 * `regionAt` 的查表版，結果與它相同。**它是 GLSL 查表那一段的 CPU 對照**
 * —— 小格索引由區塊格推出來，走訪次序與完整搜尋相同。
 */
export function regionAtPruned(
  x: number, z: number, table: RegionCandidates, out: RegionSample,
): void {
  const gx = Math.floor(x / REGION_SPACING)
  const gz = Math.floor(z / REGION_SPACING)
  const bx = gx - table.gx0
  const bz = gz - table.gz0
  if (bx < 0 || bz < 0 || bx >= table.blocksX || bz >= table.blocksZ) {
    regionAt(x, z, out)
    return
  }
  const last = REGION_CANDIDATE_SUB - 1
  const si = Math.min(Math.max(Math.floor((x - gx * REGION_SPACING) / REGION_CANDIDATE_CELL), 0), last)
  const sj = Math.min(Math.max(Math.floor((z - gz * REGION_SPACING) / REGION_CANDIDATE_CELL), 0), last)
  const o = ((bz * REGION_CANDIDATE_SUB + sj) * table.cols + bx * REGION_CANDIDATE_SUB + si) * 4
  const d0 = table.data
  const n = d0[o]! & 15
  if (n === 15) {
    regionAt(x, z, out)
    return
  }
  let r1 = Infinity
  let r2 = Infinity
  let id = 0
  let sax = 0, saz = 0, sbx = 0, sbz = 0
  for (let s = 1; s <= n; s++) {
    const k = (d0[o + (s >> 1)]! >> ((s & 1) * 4)) & 15
    const h = regionSeed(gx + (k % 3) - 1, gz + ((k / 3) | 0) - 1, SEED)
    const dx = x - SEED.x
    const dz = z - SEED.z
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d < r1) {
      r2 = r1; sbx = sax; sbz = saz
      r1 = d; sax = SEED.x; saz = SEED.z; id = h
    } else if (d < r2) { r2 = d; sbx = SEED.x; sbz = SEED.z }
  }
  regionParams(id, out)
  out.r1 = r1
  out.r2 = r2
  out.ax = sax
  out.az = saz
  out.bx = sbx
  out.bz = sbz
}

/**
 * 第 `(c, r)` 格有沒有被對切；有的話把那條線寫進 `out`。
 *
 * **`fieldAt` 自己也呼叫它** —— 對切的公式只有這一份。走線的那一側
 * （`render/flora.ts`）要沿著這條線種樹，兩份公式一漂，樹就會離開樹籬。
 */
export function splitCut(
  c: number, r: number, reg: RegionSample, out: SplitCut,
): boolean {
  const cellHash = hash2(c ^ reg.id, r)
  if ((cellHash & 0xff) / 256 >= SPLIT_CHANCE) return false
  const colSalt = (r * 2 + 1) | 0
  const left = edgeAt(c, reg.cellW, colSalt)
  const right = edgeAt(c + 1, reg.cellW, colSalt)
  const bottom = edgeAt(r, reg.cellH, 1)
  const top = edgeAt(r + 1, reg.cellH, 1)
  const f = 0.34 + (((cellHash >>> 8) & 0xff) / 255) * 0.32
  // 【沿長邊切】切出來的兩半仍然接近方形，不是兩條長帶
  if (right - left >= top - bottom) {
    out.axis = 0
    out.at = left + (right - left) * f
    out.lo = bottom
    out.hi = top
  } else {
    out.axis = 1
    out.at = bottom + (top - bottom) * f
    out.lo = left
    out.hi = right
  }
  return true
}

/**
 * 這塊田是不是樹林。**放置與地色共用這一支** —— 見 `WOOD_CHANCE`。
 *
 * 【位元的挑選】`id` 的低 8 位被犁田用掉、8–15 位被色調用掉、16–23 位被
 * 明度抖動用掉。樹林用 24–31 位，四者互不相關。
 */
export function isWoodField(id: number): boolean {
  return ((id >>> 24) & 0xff) / 256 < WOOD_CHANCE
}

/**
 * 世界座標落在哪一塊田、離田界多遠、那條界有沒有樹籬。就地寫進 `out`。
 *
 * 【抖動的矩形格】區塊座標系裡，第 k 條縱線在
 * `(k ± EDGE_JITTER) × cellW`，橫線同理。推移量小於半格，所以由
 * `floor(q / cell)` 起算、左右各看一格就一定找得到自己那一格。
 *
 * 【再對切一次】`SPLIT_CHANCE` 的格子沿長邊再切一刀，田的大小因此有兩倍
 * 的變化。切線也是一條田界，一樣長樹籬。
 *
 * 熱路徑之外（測試與工具用；畫面上跑的是 GLSL 那一份），但仍然不配置。
 */
export function fieldAt(
  x: number, z: number, reg: RegionSample, out: FieldSample, hedgeChance: number = HEDGE_CHANCE,
): void {
  const cos = Math.cos(-reg.angle)
  const sin = Math.sin(-reg.angle)
  // 【旋轉不改變距離】所以在這個座標系裡量到的就是世界的公尺
  const qx = x * cos - z * sin
  const qz = x * sin + z * cos

  // 【先定列】縱界的推移量帶著列號 —— 每一列各自錯開，縱線因此在每一條
  // 橫線上斷掉。不錯開的話縱橫線都貫穿整片，讀起來是方格土地測量，
  // 不是諾曼第的 bocage
  let r = Math.floor(qz / reg.cellH)
  if (qz < edgeAt(r, reg.cellH, 1)) r--
  else if (qz >= edgeAt(r + 1, reg.cellH, 1)) r++
  const colSalt = (r * 2 + 1) | 0

  // 自己那一欄。推移量 < 0.5 格，所以最多差一格
  let c = Math.floor(qx / reg.cellW)
  if (qx < edgeAt(c, reg.cellW, colSalt)) c--
  else if (qx >= edgeAt(c + 1, reg.cellW, colSalt)) c++

  const left = edgeAt(c, reg.cellW, colSalt)
  const right = edgeAt(c + 1, reg.cellW, colSalt)
  const bottom = edgeAt(r, reg.cellH, 1)
  const top = edgeAt(r + 1, reg.cellH, 1)

  // 四條邊各自的距離。`edgeKey` 記住最近的是哪一條 —— 樹籬長不長是
  // **那條邊**的性質，不是這塊田的
  let best = qx - left
  let edgeKey = hash2(c ^ colSalt, 0x51ed)
  const dr = right - qx
  if (dr < best) { best = dr; edgeKey = hash2((c + 1) ^ colSalt, 0x51ed) }
  const db = qz - bottom
  if (db < best) { best = db; edgeKey = hash2(r, 0x9e37) }
  const dt = top - qz
  if (dt < best) { best = dt; edgeKey = hash2(r + 1, 0x9e37) }

  // 【對切】沿長邊切一刀，切出來的兩半是兩塊田。公式在 `splitCut`
  const cellHash = hash2(c ^ reg.id, r)
  // 【不能叫 half】`half` 是 GLSL 的保留字，GLSL 那一份編不過。兩邊維持
  // 同一個名字，金本位測試才比得下去
  let part = 0
  let pqx = (left + right) / 2
  let pqz = (bottom + top) / 2
  if (splitCut(c, r, reg, CUT)) {
    const along = CUT.axis === 0 ? qx : qz
    const d = Math.abs(along - CUT.at)
    if (d < best) { best = d; edgeKey = cellHash ^ 0x1234 }
    part = along < CUT.at ? 0 : 1
    if (CUT.axis === 0) pqx = part === 0 ? (left + CUT.at) / 2 : (CUT.at + right) / 2
    else pqz = part === 0 ? (bottom + CUT.at) / 2 : (CUT.at + top) / 2
  }

  out.id = hash1(cellHash ^ (part * 0x7f4a))
  out.edge = best
  out.hedged = hash1(edgeKey) / 4294967296 < hedgeChance
  // 地塊中心轉回世界座標（q 是世界轉了 −angle）。與 GLSL 同一個算法：轉差值再加回
  // 這一點，不轉上萬公尺的座標
  const ca = Math.cos(reg.angle)
  const sa = Math.sin(reg.angle)
  const dx = pqx - qx
  const dz = pqz - qz
  out.cx = x + dx * ca - dz * sa
  out.cz = z + dx * sa + dz * ca
}

/**
 * 值雜訊：格點上的雜湊值做平滑雙線性內插，0～1。**只吃全域座標**。GLSL 有
 * 逐位元相同的一份（`fieldNoise`）
 */
export function valueNoise(x: number, z: number, cell: number, salt: number): number {
  const fx = x / cell
  const fz = z / cell
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const sx = fx - ix
  const sz = fz - iz
  const tx = sx * sx * (3 - 2 * sx)
  const tz = sz * sz * (3 - 2 * sz)
  const n00 = hash2(ix ^ salt, iz) / 4294967296
  const n10 = hash2((ix + 1) ^ salt, iz) / 4294967296
  const n01 = hash2(ix ^ salt, iz + 1) / 4294967296
  const n11 = hash2((ix + 1) ^ salt, iz + 1) / 4294967296
  const a = n00 + (n10 - n00) * tx
  const b = n01 + (n11 - n01) * tx
  return a + (b - a) * tz
}

const VA: Vec2 = { x: 0, z: 0 }

const VB: Vec2 = { x: 0, z: 0 }

/**
 * 到最近一個村的站址多遠，m。站址是種子與鄰格種子的中點（`VILLAGE_CHANCE`）。
 *
 * 【不驗第三顆種子】植被的 `villageSite` 另外擋掉「第三顆種子更近」的站址；
 * 這裡不擋 —— 那樣的站址周圍一樣是田，只是沒有村，GLSL 那一份因此少算九顆
 * 種子。站址落在 `[i, i + 2)` 格裡、田最遠伸到 2.4 km，所以往左下看兩格、往右上
 * 看一格就夠
 */
export function villageDistance(x: number, z: number): number {
  const gx = Math.floor(x / REGION_SPACING)
  const gz = Math.floor(z / REGION_SPACING)
  let best = Infinity
  for (let j = gz - 2; j <= gz + 1; j++) {
    for (let i = gx - 2; i <= gx + 1; i++) {
      const h = regionSeed(i, j, VA)
      if (((h >>> 7) & 0xff) / 256 >= VILLAGE_CHANCE) continue
      const d = ((h >>> 5) & 1) * 2
      regionSeed(i + VILLAGE_NEIGHBOUR[d]!, j + VILLAGE_NEIGHBOUR[d + 1]!, VB)
      // 手寫開根號：見 `regionAt`
      const ex = x - (VA.x + VB.x) / 2
      const ez = z - (VA.z + VB.z) / 2
      best = Math.min(best, Math.sqrt(ex * ex + ez * ez))
    }
  }
  return best
}

/**
 * 地塊是不是空地的快取：直接映射，槽位由地塊的雜湊決定，另外存中心座標比對 ——
 * 雜湊撞了就重算，答案只由地塊決定，與查過哪些地塊無關。
 *
 * 【為什麼要快取】植被補格時每一個候選點都要問（樹林 16 m 一點、樹籬 5 m 一點），
 * 而同一塊地上幾百個點的答案一樣；每次都找附近 16 個村站址的話，補格的時間翻倍
 */
const OPEN_CACHE = 1 << 14

const openId = new Uint32Array(OPEN_CACHE)

const openCx = new Float64Array(OPEN_CACHE).fill(NaN)

const openCz = new Float64Array(OPEN_CACHE)

const openBit = new Uint8Array(OPEN_CACHE)

/** 這一塊地是空地嗎（`open` 的地圖）。用地塊的中心與地塊的雜湊 */
export function isOpenParcel(f: FieldSample): boolean {
  const slot = (f.id ^ (f.id >>> 14)) & (OPEN_CACHE - 1)
  // 中心由每一點自己算（`fieldAt`），同一塊地不同點差在小數第十幾位
  if (openId[slot] === f.id >>> 0 && Math.abs(openCx[slot]! - f.cx) < 0.01 && Math.abs(openCz[slot]! - f.cz) < 0.01) {
    return openBit[slot] === 1
  }
  const reach = FIELD_REACH * (0.7 + 0.6 * valueNoise(f.cx, f.cz, REACH_NOISE_CELL, 0x4d21))
  const d = villageDistance(f.cx, f.cz)
  const t = Math.min(1, Math.max(0, (d - 0.8 * reach) / (0.4 * reach)))
  const fieldness = 1 - t * t * (3 - 2 * t)
  // 交界那一段每塊地各抽一個門檻
  const th = 0.25 + 0.5 * ((hash1(f.id ^ 0x0be5) & 0xff) / 255)
  const open = fieldness <= th
  openId[slot] = f.id >>> 0
  openCx[slot] = f.cx
  openCz[slot] = f.cz
  openBit[slot] = open ? 1 : 0
  return open
}

/**
 * 空地上樹林的覆蓋率，0～1。放置與地色共用
 *
 * @param gate 雜訊門檻，季節的 `woodGate`。兩邊要傳同一份
 */
export function openWoodCover(
  x: number, z: number, gate: readonly [number, number] = OPEN_WOOD_GATE,
): number {
  const n = 0.65 * valueNoise(x, z, OPEN_WOOD_CELL[0], 0x6a11) + 0.35 * valueNoise(x, z, OPEN_WOOD_CELL[1], 0x3b57)
  const t = Math.min(1, Math.max(0, (n - gate[0]) / (gate[1] - gate[0])))
  return t * t * (3 - 2 * t)
}

/** 空地的地色：兩個色低頻漸變，再往樹林色混 */
function openColor(x: number, z: number, out: Color, c: FieldColors): Color {
  const k = valueNoise(x, z, OPEN_TONE_CELL, 0x1f7e)
  out.setHex(c.open).lerp(OPEN_ALT.setHex(c.openAlt), k)
  return out.lerp(OPEN_ALT.setHex(c.wood), openWoodCover(x, z, c.woodGate))
}

const OPEN_ALT = new Color()

/** `fieldAt` 問對切線用的暫存。呼叫端自己帶 `out`，所以不會互相踩 */
const CUT: SplitCut = { axis: 0, at: 0, lo: 0, hi: 0 }

const REG: RegionSample = {
  r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}

const FLD: FieldSample = { id: 0, edge: 0, hedged: false, cx: 0, cz: 0 }

/**
 * 地面在世界座標 (x, z) 的顏色。**這是 GLSL 那支 `fieldColorAt` 的 CPU 版**，近處的
 * 樣子（`fieldFar = 0`）。
 *
 * 順序就是優先權：凹路壓過樹籬，樹籬壓過作物。`open` 的地圖上，空地沒有樹籬
 * 也沒有作物（`FIELD_REACH`）。
 */
export function fieldSurfaceColor(
  x: number, z: number, out: Color, season: Season = 'summer', open = false,
): Color {
  const c = FIELD_COLORS[season]
  // 【草原田沒有 CPU 版】格寬與抖動是它自己的常數，而 `fieldAt` 讀的是中歐那一組。
  // 執行期沒有任何呼叫者（植被不讀草原田的田界），所以明講不支援，不回一個靜靜地錯的色
  if (c.layout === 'steppe') throw new Error('草原田（steppe）沒有 CPU 版的取色')
  regionAt(x, z, REG)
  if (onTrack(x, z, REG)) return out.setHex(c.track)

  fieldAt(x, z, REG, FLD, c.hedgeChance)
  if (open && isOpenParcel(FLD)) return openColor(x, z, out, c)
  if (FLD.hedged && FLD.edge < HEDGE_WIDTH / 2) return out.setHex(c.hedge)

  const fh = FLD.id
  if (isWoodField(fh)) return out.setHex(c.wood)
  if ((fh & 0xff) / 256 < c.ploughChance) return out.setHex(c.ploughed)

  // 【在區塊的基調 ±1 裡挑】色盤是一條漸層，所以相鄰的索引顏色相近
  let t = REG.tone + ((fh >>> 8) % 3) - 1
  if (t < 0) t = 0
  if (t >= PALETTE_STEPS) t = PALETTE_STEPS - 1
  out.setHex(c.palette[t]!)
  // 【每塊田再抖一點亮度】同色調的兩塊田仍然分得出來，而且不會跳色
  const k = 0.94 + (((fh >>> 16) & 0xff) / 255) * 0.12
  return out.multiplyScalar(k)
}

/**
 * 草原田的格局：俄國南部集體農場的大田。與 `european` 共用「區塊 → 抖動的矩形格」的框架
 * （凹路、村站址、菜園都掛在區塊上），差在：
 *
 * - 格寬 544～896 m、格長再乘 `aniso`（653～1,075 m），**不對切**
 * - 每一條田界都是田埂（`HEDGE_CHANCE = 1`），寬 `ridge`，沒有樹籬；遠處仍然是田埂色
 *   （不是樹冠色）
 * - 「樹林田」換成牧草地（沒耕的草），比例 `pasture`；沒有條播紋
 *
 * 【著色器常數沿用 `european` 的名字】`fieldColorAt` 只有一份算式，兩種格局換的是這幾個
 * 常數與牧草地那一行（`pastureGlsl`）。`european` 輸出的字串逐字不變。
 */
export const STEPPE_LAYOUT = {
  spacing: 640, aniso: 1.2, spacingVar: [0.85, 1.4], edgeJitter: 0.14,
  ridge: 8, pasture: 0.26,
} as const

const STEPPE_REG: RegionSample = {
  r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}

/** 草原田第 `k` 條格線的位置，m：`edgeAt` 換成草原的抖動量 */
export function steppeEdgeAt(k: number, cell: number, salt: number): number {
  return (k + (hash2(k, salt) / 4294967296 - 0.5) * 2 * STEPPE_LAYOUT.edgeJitter) * cell
}

/**
 * 草原田一個區塊的格局：走向 `angle`、格寬 `cellW`、格長 `cellH`，就地寫進 `out`
 * （只動 `id`、`angle`、`cellW`、`cellH`）。
 *
 * 【與 `european` 的 `regionParams` 不同】走向與格寬的範圍都不一樣。`steppeRidgeGap` 與草原的
 * 防風林（`flora.ts`）讀這一份，林帶才會落在畫出來的田埂上。
 */
export function steppeRegionParams(id: number, out: RegionSample): void {
  const rh = hash1(id)
  out.id = id
  out.angle = 0.35 + ((rh & 0xffff) / 65536 - 0.5) * 0.5
  const scale = STEPPE_LAYOUT.spacingVar[0]
    + ((rh >>> 16) / 65536) * (STEPPE_LAYOUT.spacingVar[1] - STEPPE_LAYOUT.spacingVar[0])
  out.cellW = STEPPE_LAYOUT.spacing * scale
  out.cellH = out.cellW * STEPPE_LAYOUT.aniso
}

/**
 * 草原的防風林帶：一條田界有林帶的機率。`flora.ts` 種樹（`steppeBeltFloraFor`）與地面著色器畫
 * 遠處的帶子（`SiteLayout.belts`）讀同一個數；判準是田界的身分（`edgeKey`）再雜湊一次小於它。
 */
export const BELT_CHANCE = 0.4

/** 草原田最近的一條田界：距離與身分 */
export interface SteppeEdge {
  /** 到最近一條田界的距離，m */
  gap: number
  /** 那條田界的身分，**與 GLSL `fieldColorAt` 裡的 `edgeKey` 同一個值**（`fieldAt` 的 `edgeKey` 也是） */
  key: number
}

const STEPPE_EDGE: SteppeEdge = { gap: 0, key: 0 }

/**
 * 草原田：世界座標 (x, z) 最近的一條田界，就地寫進 `out`。**是 GLSL `fieldColorAt` 裡 `best` 與
 * `edgeKey` 的 CPU 版**（草原田不對切，所以只有四條外框）。
 *
 * 熱路徑之外（載入時與測試），不配置。
 */
export function steppeNearestEdge(x: number, z: number, out: SteppeEdge): void {
  regionAt(x, z, STEPPE_REG)
  steppeRegionParams(STEPPE_REG.id, STEPPE_REG)
  const { angle, cellW, cellH } = STEPPE_REG
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  const qx = x * cos - z * sin
  const qz = x * sin + z * cos

  let r = Math.floor(qz / cellH)
  if (qz < steppeEdgeAt(r, cellH, 1)) r--
  else if (qz >= steppeEdgeAt(r + 1, cellH, 1)) r++
  const colSalt = (r * 2 + 1) | 0
  let c = Math.floor(qx / cellW)
  if (qx < steppeEdgeAt(c, cellW, colSalt)) c--
  else if (qx >= steppeEdgeAt(c + 1, cellW, colSalt)) c++

  let best = qx - steppeEdgeAt(c, cellW, colSalt)
  let key = hash2(c ^ colSalt, 0x51ed)
  const dr = steppeEdgeAt(c + 1, cellW, colSalt) - qx
  if (dr < best) { best = dr; key = hash2((c + 1) ^ colSalt, 0x51ed) }
  const db = qz - steppeEdgeAt(r, cellH, 1)
  if (db < best) { best = db; key = hash2(r, 0x9e37) }
  const dt = steppeEdgeAt(r + 1, cellH, 1) - qz
  if (dt < best) { best = dt; key = hash2(r + 1, 0x9e37) }
  out.gap = best
  out.key = key
}

/**
 * 草原田：世界座標 (x, z) 到最近一條田埂（田界）的距離，m。畫在地上的東西要避開田埂線時問它：
 * 沿著田埂走的支路會與田埂重疊成一條線，看起來像田埂延伸成路。
 *
 * 熱路徑之外（載入時與測試），不配置。
 */
export function steppeRidgeGap(x: number, z: number): number {
  steppeNearestEdge(x, z, STEPPE_EDGE)
  return STEPPE_EDGE.gap
}
