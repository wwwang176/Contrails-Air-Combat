import { Color } from 'three'
import { canopyColor, FIELD_COLORS, FLORA_COLORS, PALETTE_STEPS, type FieldColors, type Season } from './season'

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
const TRACK_RIPPLE = [
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
const TRACK_WARP = [
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
 * 區塊格有村的機率；村在這一格的種子與一個軸向鄰格（`VILLAGE_NEIGHBOUR`，由種子
 * 的雜湊挑）的種子的中點。植被（`flora.ts` 的 `villageSite`）與田色共用
 */
export const VILLAGE_CHANCE = 0.55
export const VILLAGE_NEIGHBOUR = [1, 0, 0, 1] as const

/**
 * 色值不在這個檔案。作物色盤、犁田、樹籬、凹路、樹林與犁田比例都由季節
 * 決定（`season.ts`）；這裡只管圖案。**作物色盤是一條漸層**，因為每塊田是
 * 在「區塊的基調 ± 1」裡挑的 —— 索引相鄰就必須顏色相近，不然又變回雜訊。
 */

/** 犁溝與作物行的間距，m */
const STRIPE_PERIOD = 7

/**
 * 條紋的明度幅度。犁田用兩倍 —— 那是溝，不是行。
 *
 * 【為什麼這麼深】離鏡頭遠一點的田是烘在 2 m 一格的 clipmap 上的，條紋在那裡
 * 只剩約三分之二（`stripe` 依取樣密度淡掉），再經 mipmap 平均又更淡；淺了的話
 * 那一圈以外就看不出條紋。7.3 m 一格的遠圖畫不出 7 m 的條紋，多深都一樣。
 */
const STRIPE_AMP = 0.08

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
 * 32 位元的兩維整數雜湊。**不得 `Math.random`** —— 見檔頭。
 *
 * 【與 `scatter.ts` 的 `hash01` 為什麼不共用】那一支吃一個索引，這裡要
 * 兩個座標而且要拿到 32 位元全部。
 */
function hash2(i: number, j: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2545f491)
  return (h ^ (h >>> 13)) >>> 0
}

/** 32 位元的整數再攪一次。要由同一顆雜湊取好幾個不相關的數時用它 */
function hash1(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
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
  x: number, z: number, reg: RegionSample, out: FieldSample,
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
  out.hedged = hash1(edgeKey) / 4294967296 < HEDGE_CHANCE
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

/** 空地上樹林的覆蓋率，0～1。放置與地色共用 */
export function openWoodCover(x: number, z: number): number {
  const n = 0.65 * valueNoise(x, z, OPEN_WOOD_CELL[0], 0x6a11) + 0.35 * valueNoise(x, z, OPEN_WOOD_CELL[1], 0x3b57)
  const t = Math.min(1, Math.max(0, (n - OPEN_WOOD_GATE[0]) / (OPEN_WOOD_GATE[1] - OPEN_WOOD_GATE[0])))
  return t * t * (3 - 2 * t)
}

/** 空地的地色：兩個色低頻漸變，再往樹林色混 */
function openColor(x: number, z: number, out: Color, c: FieldColors): Color {
  const k = valueNoise(x, z, OPEN_TONE_CELL, 0x1f7e)
  out.setHex(c.open).lerp(OPEN_ALT.setHex(c.openAlt), k)
  return out.lerp(OPEN_ALT.setHex(c.wood), openWoodCover(x, z))
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
  regionAt(x, z, REG)
  if (onTrack(x, z, REG)) return out.setHex(c.track)

  fieldAt(x, z, REG, FLD)
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

const rgb = (hex: number): string => vec3Of(new Color().setHex(hex))
const vec3Of = (t: Color): string => `vec3(${t.r.toFixed(4)}, ${t.g.toFixed(4)}, ${t.b.toFixed(4)})`

/** 查候選表時多出來的宣告。uniform 由 `farmGround.ts` 的 `applyFields` 提供 */
const CANDIDATE_DECL_GLSL = `
const float REGION_CANDIDATE_CELL = ${REGION_CANDIDATE_CELL.toFixed(1)};
const int REGION_CANDIDATE_SUB = ${REGION_CANDIDATE_SUB};
uniform highp usampler2D uRegionCand;
// 表左下角的區塊格 (x, z) 與區塊格數 (x, z)
uniform ivec4 uRegionCandRect;`

/**
 * 區塊搜尋的查表版，接在 `r1`、`r2`、`rid` 宣告之後；候選數 15 或在表外時
 * 落進後面原封不動的完整搜尋。與 `regionAtPruned` 同一套索引。
 *
 * 【小格索引由 rgx、rgz 推】不另外由世界座標直接算，否則在區塊格邊上兩個
 * floor 可能各落一邊，查到的是另一格區塊的候選。
 */
const CANDIDATE_LOOKUP_GLSL = `  uint candN = 15u;
  uvec4 cand = uvec4(0u);
  ivec2 candBlock = ivec2(int(rgx), int(rgz)) - uRegionCandRect.xy;
  if (all(greaterThanEqual(candBlock, ivec2(0))) && all(lessThan(candBlock, uRegionCandRect.zw))) {
    vec2 local = world - vec2(rgx, rgz) * REGION_SPACING;
    ivec2 sub = clamp(ivec2(floor(local / REGION_CANDIDATE_CELL)), ivec2(0), ivec2(REGION_CANDIDATE_SUB - 1));
    cand = texelFetch(uRegionCand, candBlock * REGION_CANDIDATE_SUB + sub, 0);
    candN = cand.r & 15u;
  }
  if (candN < 15u) {
    for (uint s = 1u; s <= candN; s++) {
      uint k = (cand[int(s >> 1u)] >> ((s & 1u) * 4u)) & 15u;
      int i = int(rgx) + int(k % 3u) - 1;
      int j = int(rgz) + int(k / 3u) - 1;
      uint h = fieldHash2(i, j);
      float ox = (float(h & 0xffffu) / 65536.0 - 0.5) * 0.76;
      float oz = (float(h >> 16u) / 65536.0 - 0.5) * 0.76;
      vec2 seed = (vec2(float(i), float(j)) + 0.5 + vec2(ox, oz)) * REGION_SPACING;
      float d = distance(world, seed);
      if (d < r1) { r2 = r1; s2 = s1; r1 = d; s1 = seed; rid = h; }
      else if (d < r2) { r2 = d; s2 = seed; }
    }
  } else {
`

/**
 * 上面那一切的 GLSL。提供 `vec3 fieldColorAt(vec2 world)`。
 *
 * 細節地形與遠景環共用它，而且因為吃的是**世界座標**，圖案釘在地上 ——
 * 與網格怎麼擺、切成幾塊完全無關。
 *
 * 【GLSL 版本】three 對內建材質一律加 `#version 300 es`
 * （`WebGLProgram` 的 `versionString`），所以 `uint`、位移、`const vec3[]`
 * 與非常數索引都合法。
 *
 * 【吃季節】色值烘進字串，所以一個季節一份字串；圖案的常數兩份相同。
 * 呼叫端換了字串就要換材質的 `customProgramCacheKey`（`farmGround.ts`）。
 *
 * `candidates` 為真時多一段查候選表（`buildRegionCandidates`）的剪枝，
 * 材質要提供 `uRegionCand` 與 `uRegionCandRect` 兩個 uniform。
 */
export function fieldGlsl(season: Season, candidates = false, open = false): string {
  const base = fieldGlslBase(season, candidates)
  if (!open) return base
  // 【空地疊在條紋之後】空地沒有條紋、沒有樹籬；凹路照舊壓在上面
  const at = base.indexOf('  col = mix(col, mix(HEDGE_COLOR')
  const decl = base.indexOf('vec3 fieldColorAt(')
  return base.slice(0, decl) + openDeclGlsl(season) + base.slice(decl, at) + OPEN_PARCEL_GLSL + base.slice(at)
}

/**
 * `open` 的地圖多出來的常數與函式：值雜訊、到村的距離、地塊是不是空地、空地的
 * 地色。與 CPU 那一份（`valueNoise`、`villageDistance`、`isOpenParcel`、
 * `openColor`）逐項對應
 */
function openDeclGlsl(season: Season): string {
  const c = FIELD_COLORS[season]
  return `const float FIELD_REACH = ${FIELD_REACH.toFixed(1)};
const float REACH_NOISE_CELL = ${REACH_NOISE_CELL.toFixed(1)};
const float VILLAGE_CHANCE = ${VILLAGE_CHANCE.toFixed(3)};
const vec3 OPEN_COLOR = ${rgb(c.open)};
const vec3 OPEN_ALT_COLOR = ${rgb(c.openAlt)};

float fieldNoise(vec2 p, float cell, int salt) {
  vec2 f = p / cell;
  vec2 i = floor(f);
  vec2 t = f - i;
  t = t * t * (3.0 - 2.0 * t);
  int ix = int(i.x);
  int iz = int(i.y);
  float n00 = float(fieldHash2(ix ^ salt, iz)) / 4294967296.0;
  float n10 = float(fieldHash2((ix + 1) ^ salt, iz)) / 4294967296.0;
  float n01 = float(fieldHash2(ix ^ salt, iz + 1)) / 4294967296.0;
  float n11 = float(fieldHash2((ix + 1) ^ salt, iz + 1)) / 4294967296.0;
  return mix(mix(n00, n10, t.x), mix(n01, n11, t.x), t.y);
}

vec2 regionSeedOf(int i, int j, uint h) {
  float ox = (float(h & 0xffffu) / 65536.0 - 0.5) * 0.76;
  float oz = (float(h >> 16u) / 65536.0 - 0.5) * 0.76;
  return (vec2(float(i), float(j)) + 0.5 + vec2(ox, oz)) * REGION_SPACING;
}

float villageDistance(vec2 w) {
  int gx = int(floor(w.x / REGION_SPACING));
  int gz = int(floor(w.y / REGION_SPACING));
  float best = 1e20;
  for (int j = gz - 2; j <= gz + 1; j++) {
    for (int i = gx - 2; i <= gx + 1; i++) {
      uint h = fieldHash2(i, j);
      if (float((h >> 7u) & 0xffu) / 256.0 >= VILLAGE_CHANCE) continue;
      bool alongX = ((h >> 5u) & 1u) == 0u;
      int i2 = alongX ? i + 1 : i;
      int j2 = alongX ? j : j + 1;
      vec2 site = (regionSeedOf(i, j, h) + regionSeedOf(i2, j2, fieldHash2(i2, j2))) * 0.5;
      best = min(best, distance(w, site));
    }
  }
  return best;
}

bool isOpenParcel(vec2 centre, uint fh) {
  float reach = FIELD_REACH * (0.7 + 0.6 * fieldNoise(centre, REACH_NOISE_CELL, 0x4d21));
  float fieldness = 1.0 - smoothstep(0.8 * reach, 1.2 * reach, villageDistance(centre));
  float th = 0.25 + 0.5 * (float(fieldHash1(fh ^ 0x0be5u) & 0xffu) / 255.0);
  return fieldness <= th;
}

float openWoodCover(vec2 w) {
  float n = 0.65 * fieldNoise(w, ${OPEN_WOOD_CELL[0].toFixed(1)}, 0x6a11)
    + 0.35 * fieldNoise(w, ${OPEN_WOOD_CELL[1].toFixed(1)}, 0x3b57);
  return smoothstep(${OPEN_WOOD_GATE[0].toFixed(3)}, ${OPEN_WOOD_GATE[1].toFixed(3)}, n);
}

vec3 openColorAt(vec2 w) {
  vec3 c = mix(OPEN_COLOR, OPEN_ALT_COLOR, fieldNoise(w, ${OPEN_TONE_CELL.toFixed(1)}, 0x1f7e));
  return mix(c, WOOD_COLOR, openWoodCover(w));
}

`
}

/**
 * 插在條紋之後、樹籬之前：這一塊地的中心（對切過的取那一半）轉回世界座標，
 * 是空地就換成空地的地色、不畫樹籬
 */
const OPEN_PARCEL_GLSL = `  vec2 pq = vec2((left + right) * 0.5, (bottom + top) * 0.5);
  if (float(cellHash & 0xffu) / 256.0 < SPLIT_CHANCE) {
    float pf = 0.34 + (float((cellHash >> 8u) & 0xffu) / 255.0) * 0.32;
    if (right - left >= top - bottom) {
      float pcut = left + (right - left) * pf;
      pq.x = part == 0u ? (left + pcut) * 0.5 : (pcut + right) * 0.5;
    } else {
      float pcut = bottom + (top - bottom) * pf;
      pq.y = part == 0u ? (bottom + pcut) * 0.5 : (pcut + top) * 0.5;
    }
  }
  // 【轉差值，不轉座標】q 是上萬公尺，有的 GPU 的 cos、sin 誤差乘上去差將近一公尺，
  // 跨過門檻就與 CPU 判得不一樣（地色是田、樹卻當空地長）；中心離這個像素只有
  // 一兩百公尺
  vec2 dq = pq - q;
  vec2 parcel = world + vec2(dq.x * cos(angle) - dq.y * sin(angle), dq.x * sin(angle) + dq.y * cos(angle));
  if (isOpenParcel(parcel, fh)) {
    col = openColorAt(world);
    isHedge = false;
  }
`

function fieldGlslBase(season: Season, candidates: boolean): string {
  const c = FIELD_COLORS[season]
  const glslPalette = c.palette.map((h) => '  ' + rgb(h)).join(',\n')
  return `
const float FIELD_SPACING = ${FIELD_SPACING.toFixed(1)};
const float FIELD_ANISO = ${FIELD_ANISO.toFixed(3)};
const float EDGE_JITTER = ${EDGE_JITTER.toFixed(3)};
const float SPLIT_CHANCE = ${SPLIT_CHANCE.toFixed(3)};
const float REGION_SPACING = ${REGION_SPACING.toFixed(1)};${candidates ? CANDIDATE_DECL_GLSL : ''}
const float HEDGE_WIDTH = ${HEDGE_WIDTH.toFixed(1)};
const float HEDGE_CHANCE = ${HEDGE_CHANCE.toFixed(3)};
const float TRACK_WIDTH = ${TRACK_WIDTH.toFixed(1)};
const float PLOUGH_CHANCE = ${c.ploughChance.toFixed(3)};
const float WOOD_CHANCE = ${WOOD_CHANCE.toFixed(3)};
const float STRIPE_PERIOD = ${STRIPE_PERIOD.toFixed(1)};
const float STRIPE_AMP = ${STRIPE_AMP.toFixed(3)};
const float SPACING_VAR_LO = ${FIELD_SPACING_VAR[0].toFixed(3)};
const float SPACING_VAR_HI = ${FIELD_SPACING_VAR[1].toFixed(3)};
const vec3 HEDGE_COLOR = ${rgb(c.hedge)};
const vec3 HEDGE_FAR_COLOR = ${vec3Of(canopyColor(FLORA_COLORS[season].broadLeaf).multiplyScalar(HEDGE_FAR_SHADE))};
const float HEDGE_FAR_GROW = ${HEDGE_FAR_GROW.toFixed(3)};
// 【遠處的樣子】1 = 植被圈外（樹籬的樹不畫了），樹籬畫成放寬的林冠色。呼叫端在
// fieldColorAt 之前設；近處與內圈留 0，那裡有真的樹
float fieldFar = 0.0;
const vec3 TRACK_COLOR = ${rgb(c.track)};
const vec3 PLOUGHED_COLOR = ${rgb(c.ploughed)};
const vec3 WOOD_COLOR = ${rgb(c.wood)};
const vec3 FIELD_PALETTE[${PALETTE_STEPS}] = vec3[${PALETTE_STEPS}](
${glslPalette}
);

// 與 fields.ts 的 hash2 逐位元相同。GLSL 沒有 imul，但 uint 乘法本來就是
// 模 2³²，所以直接乘就是同一件事
uint fieldHash2(int i, int j) {
  uint h = uint(i) * 0x27d4eb2du ^ uint(j) * 0x85ebca6bu;
  h = (h ^ (h >> 15u)) * 0x2545f491u;
  return h ^ (h >> 13u);
}

uint fieldHash1(uint h) {
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return h ^ (h >> 16u);
}

bool isWoodField(uint id) {
  return float((id >> 24u) & 0xffu) / 256.0 < WOOD_CHANCE;
}

// 【條紋只在 GPU 上做】見檔頭。取樣不足時自動淡掉 —— 判準是片段的導數
// 而不是相機距離，因為遠景環與細節地形是兩個不同的物件，用距離兩邊會不一致
float stripe(vec2 q, float period, float amp) {
  float u = q.x / period;
  float fade = 1.0 - smoothstep(0.15, 0.5, fwidth(u));
  return 1.0 + amp * fade * (fract(u) < 0.5 ? 1.0 : -1.0);
}

// 【帶的邊緣走解析盒濾波】一個像素蓋到的地一超過帶寬，「在不在帶上」的
// 二選一就隨鏡頭微動翻面 —— 那是遠方線條爬行的原因。MSAA 幫不上忙：
// 它只解析幾何邊緣，而片段著色器一個像素只跑一次。
//
// d 是到帶中心線的距離（非負），halfW 是半寬，w 是像素在地面上的半足跡。
// 回傳的是那條帶在 [d - w, d + w] 這一段裡佔的比例。
//
// 【極限行為】w → 無限大時趨近 halfW / w，也就是那條帶在像素裡的真實面積
// 比：細線變淡，不是變寬。smoothstep 沒有這個
// 性質，它會把影響範圍撐到 halfW + w，遠處是一片過暗的灰霧。
//
// 【參數不能叫 half】那是 GLSL 的保留字。
float bandCoverage(float d, float halfW, float w) {
  return clamp((min(d + w, halfW) - max(d - w, 0.0)) / (2.0 * w), 0.0, 1.0);
}
${trackGlsl()}
float fieldEdgeAt(int k, float cell, int salt) {
  return (float(k) + (float(fieldHash2(k, salt)) / 4294967296.0 - 0.5)
    * 2.0 * EDGE_JITTER) * cell;
}

vec3 fieldColorAt(vec2 world) {
  // 【像素足跡，無條件、吃世界座標】導數指令在 fragment quad 內分歧時結果
  // 不可靠，所以不能放進任何分支；而 world 是內插的 varying，處處平滑。
  // **不得改用 best 自己的導數** —— best 是四條外框加一條切線取 min，在最近
  // 邊換手的角平分線上不可微，田角會長出楔形接縫
  float px = 0.5 * length(vec2(fwidth(world.x), fwidth(world.y)));

  // ── 粗的一層：區塊 ──────────────────────────────
  float rgx = floor(world.x / REGION_SPACING);
  float rgz = floor(world.y / REGION_SPACING);
  float r1 = 1e20;
  float r2 = 1e20;
  uint rid = 0u;
  // 最近與次近的種子：凹路是它們的交界（trackGap）
  vec2 s1 = vec2(0.0);
  vec2 s2 = vec2(0.0);
${candidates ? CANDIDATE_LOOKUP_GLSL : ''}  for (int dj = -1; dj <= 1; dj++) {
    for (int di = -1; di <= 1; di++) {
      int i = int(rgx) + di;
      int j = int(rgz) + dj;
      uint h = fieldHash2(i, j);
      float ox = (float(h & 0xffffu) / 65536.0 - 0.5) * 0.76;
      float oz = (float(h >> 16u) / 65536.0 - 0.5) * 0.76;
      vec2 seed = (vec2(float(i), float(j)) + 0.5 + vec2(ox, oz)) * REGION_SPACING;
      float d = distance(world, seed);
      if (d < r1) { r2 = r1; s2 = s1; r1 = d; s1 = seed; rid = h; }
      else if (d < r2) { r2 = d; s2 = seed; }
    }
  }
${candidates ? '  }\n' : ''}  uint rh = fieldHash1(rid);
  float angle = (float(rh & 0xffffu) / 65536.0) * 3.14159265;
  float scale = SPACING_VAR_LO
    + (float(rh >> 16u) / 65536.0) * (SPACING_VAR_HI - SPACING_VAR_LO);
  float cellW = FIELD_SPACING * scale;
  float cellH = FIELD_SPACING * scale * FIELD_ANISO;
  uint th = fieldHash1(rh);
  int tone = int(((th & 0xffffu) % ${PALETTE_STEPS}u
    + (th >> 16u) % ${PALETTE_STEPS}u) >> 1u);

  // ── 細的一層：抖動的矩形格 ──────────────────────
  float cs = cos(-angle);
  float sn = sin(-angle);
  vec2 q = vec2(world.x * cs - world.y * sn, world.x * sn + world.y * cs);

  int r = int(floor(q.y / cellH));
  if (q.y < fieldEdgeAt(r, cellH, 1)) r -= 1;
  else if (q.y >= fieldEdgeAt(r + 1, cellH, 1)) r += 1;
  int colSalt = r * 2 + 1;

  int c = int(floor(q.x / cellW));
  if (q.x < fieldEdgeAt(c, cellW, colSalt)) c -= 1;
  else if (q.x >= fieldEdgeAt(c + 1, cellW, colSalt)) c += 1;

  float left = fieldEdgeAt(c, cellW, colSalt);
  float right = fieldEdgeAt(c + 1, cellW, colSalt);
  float bottom = fieldEdgeAt(r, cellH, 1);
  float top = fieldEdgeAt(r + 1, cellH, 1);

  float best = q.x - left;
  uint edgeKey = fieldHash2(c ^ colSalt, 0x51ed);
  if (right - q.x < best) { best = right - q.x; edgeKey = fieldHash2((c + 1) ^ colSalt, 0x51ed); }
  if (q.y - bottom < best) { best = q.y - bottom; edgeKey = fieldHash2(r, 0x9e37); }
  if (top - q.y < best) { best = top - q.y; edgeKey = fieldHash2(r + 1, 0x9e37); }

  uint cellHash = fieldHash2(c ^ int(rid), r);
  uint part = 0u;
  if (float(cellHash & 0xffu) / 256.0 < SPLIT_CHANCE) {
    float f = 0.34 + (float((cellHash >> 8u) & 0xffu) / 255.0) * 0.32;
    if (right - left >= top - bottom) {
      float cut = left + (right - left) * f;
      if (abs(q.x - cut) < best) { best = abs(q.x - cut); edgeKey = cellHash ^ 0x1234u; }
      part = q.x < cut ? 0u : 1u;
    } else {
      float cut = bottom + (top - bottom) * f;
      if (abs(q.y - cut) < best) { best = abs(q.y - cut); edgeKey = cellHash ^ 0x1234u; }
      part = q.y < cut ? 0u : 1u;
    }
  }

  bool isHedge = float(fieldHash1(edgeKey)) / 4294967296.0 < HEDGE_CHANCE;

  uint fh = fieldHash1(cellHash ^ (part * 0x7f4au));
  bool wood = isWoodField(fh);

  bool ploughed = float(fh & 0xffu) / 256.0 < PLOUGH_CHANCE;
  vec3 col = wood ? WOOD_COLOR : PLOUGHED_COLOR;
  if (!wood && !ploughed) {
    int t = clamp(tone + int((fh >> 8u) % 3u) - 1, 0, ${PALETTE_STEPS - 1});
    float k = 0.94 + (float((fh >> 16u) & 0xffu) / 255.0) * 0.12;
    col = FIELD_PALETTE[t] * k;
  }
  // 【犁田加倍、樹林沒有】溝比行深；樹林是林冠不是作物。條紋沿田的長軸走，
  // 所以重複發生在 q.x 上
  float amp = wood ? 0.0 : (ploughed ? STRIPE_AMP * 2.0 : STRIPE_AMP);
  col *= stripe(q, STRIPE_PERIOD, amp);
  // 【順序就是優先權】凹路壓過樹籬，樹籬壓過田 —— 與 fieldSurfaceColor 相同。
  // 兩條帶的半寬不一樣：凹路的判準是 trackGap < trackWidthAt，樹籬的是
  // best < HEDGE_WIDTH * 0.5
  col = mix(col, mix(HEDGE_COLOR, HEDGE_FAR_COLOR, fieldFar),
    isHedge ? bandCoverage(best, HEDGE_WIDTH * 0.5 * mix(1.0, HEDGE_FAR_GROW, fieldFar), px) : 0.0);
  col = mix(col, TRACK_COLOR, bandCoverage(trackGap(world, s1, s2), trackWidthAt(world), px));
  return col;
}
`
}

const glslFloat = (v: number): string => v.toFixed(6)

/** `trackWidthAt`、`trackGap` 的 GLSL，由同一組常數產生 */
function trackGlsl(): string {
  const f = glslFloat
  const ripple = TRACK_RIPPLE.map((r) => `${f(r.amp)} * sin(${f(r.fx)} * w.x + ${f(r.fz)} * w.y + ${f(r.phase)})`)
  const wx = TRACK_WARP.map((t) => `${f(t.amp)} * sin(${f(t.fx)} * w.x + ${f(t.fz)} * w.y + ${f(t.phase)})`)
  const wz = TRACK_WARP.map((t) => `${f(t.amp)} * sin(${f(t.fz)} * w.x - ${f(t.fx)} * w.y + ${f(t.phase + 1.7)})`)
  return `
float trackWidthAt(vec2 w) {
  return TRACK_WIDTH * (1.0 + ${ripple.join(' + ')});
}

float trackGap(vec2 w, vec2 a, vec2 b) {
  vec2 p = w;
  p.x += ${wx.join(' + ')};
  p.y += ${wz.join(' + ')};
  return abs(distance(p, b) - distance(p, a));
}
`
}

/** 夏季那一份。農地與群島讀它，測試與 e2e 的著色器編譯也讀它 */
export const FIELD_GLSL = fieldGlsl('summer')

/**
 * 廠區的地面：墊面是混凝土、道路是柏油。**只有洛伊納有**；農地不給，
 * 字串與夏季基準逐位元相同。
 *
 * 【為什麼畫在著色器裡而不是幾何】道路是 20 km 的帶子，幾何要跟著地形的
 * 起伏切；著色器吃世界座標，圖案本來就釘在地上。
 */
export interface SiteLayout {
  /**
   * 廠區局部座標系的原點，世界座標。省略時是 (0, 0)。
   *
   * 【`pad`／`patches`／`outposts` 全部活在局部系裡】它們仍然是軸對齊矩形，
   * 只是先繞 `pivot` 轉了 `heading`。`roads`／`rails` 是例外 —— 那兩組一路
   * 畫到地圖邊緣，寫的是世界座標。
   */
  readonly pivot?: { readonly x: number; readonly z: number }
  /** 局部系相對世界的旋轉，弧度。省略或 0 時局部＝世界 */
  readonly heading?: number
  /** 墊面矩形，廠區局部座標 */
  readonly pad: { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }
  /**
   * 墊面的顏色。**省略 = 混凝土**（廠區）。機場的墊面是草地，只有跑道與
   * 停機坪是鋼板 —— 那兩塊走 `patches`。
   */
  readonly padHex?: number
  /**
   * 附加的墊面矩形，與 `pad` 取**聯集**。機場的草地要貼著跑道與魚骨走，
   * 一個大矩形會多出一大片草 —— 主體是跑道那一條帶子，每一組魚骨各一塊。
   * 每一塊都有自己的咬痕與斜切角，接縫處是兩塊的聯集。
   */
  readonly padLobes?: readonly { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }[]
  /**
   * 墊面之外還要這麼寬的一圈不長樹，m。省略時樹貼著墊面長。
   *
   * 【著色器不看它】只有散佈器用 —— 這一圈仍然是田色，只是沒有樹籬與樹林。
   */
  readonly treeClear?: number
  /** 道路的折線，世界座標 */
  readonly roads: readonly (readonly { readonly x: number; readonly z: number }[])[]
  /** 路寬，m */
  readonly roadWidth: number
  /**
   * 換掉鋪面的矩形：調車場的碴石、留白街廓的裸土。廠區局部座標。
   *
   * 【壓在墊面之上、道路之下】次序在 `siteGlsl` 與 `siteSurfaceColor` 兩邊
   * 要一致，否則畫面上的路被碴石蓋掉，而小地圖取樣說它是柏油。
   */
  readonly patches?: readonly {
    readonly x0: number; readonly z0: number
    readonly x1: number; readonly z1: number
    readonly hex: number
  }[]
  /**
   * 牆外衛星設施的鋪面。廠區局部座標，形狀與 `patches` 相同。
   *
   * 【為什麼不能併進 `patches`】`patches` 在過渡帶之前上色，越靠外越被混回
   * 田色 —— 而衛星設施整塊都在墊面外，併進去會被洗成一片田。這一層畫在
   * 過渡帶之後、道路之前。
   */
  readonly outposts?: readonly {
    readonly x0: number; readonly z0: number
    readonly x1: number; readonly z1: number
    readonly hex: number
  }[]
  /**
   * 鐵路的折線，世界座標。畫成碴石帶，壓在道路之下 —— 平交道上看得到的是
   * 柏油。
   */
  readonly rails?: readonly (readonly { readonly x: number; readonly z: number }[])[]
  /** 碴石帶的寬，m */
  readonly railWidth?: number
}

const CONCRETE = 0x8d8a82
const ASPHALT = 0x3f3d3a
/** 鐵路的碴石。與 `terrain.ts` 調車場街廓那一份同色 */
const BALLAST = 0x5f5a52

/**
 * 髒污碎花的格，m。小格是逐格的亮暗與油漬，大格是整片鋪面的深淺。
 *
 * 【不要再放大】投彈高度一個像素蓋到地面約 4 m，小格已經只有三個像素寬 ——
 * 再細下去會在飛行中閃爍，而那是看得出來的雜訊不是髒。
 */
const GRIME_CELL = 13
const SLAB_CELL = 40

/**
 * 一點的髒污倍率。**墊面與鋪面共用** —— 調車場的碴石與留白的裸土乘上它就
 * 是同色系的碎花，而不是一整塊平色。
 *
 * 【與 `siteGlsl` 逐項對應】兩份不一致的話，小地圖與畫面上的地是兩種顏色。
 */
function grimeFactor(x: number, z: number): number {
  const ph = hash2(Math.floor(x / GRIME_CELL), Math.floor(z / GRIME_CELL))
  const sh = hash2(Math.floor(x / SLAB_CELL) + 7919, Math.floor(z / SLAB_CELL) - 104729)
  const oh = hash1(ph)
  const slab = 0.86 + (0.2 * ((sh >>> 8) & 0x7)) / 7
  const stain = (oh & 0xff) < 46 ? 0.74 : 1
  return slab * stain * (0.96 + (0.08 * (ph & 0xff)) / 255)
}

/**
 * 廠界的三層起伏。**邊界本身是硬的**，不規則靠的是這三個尺度疊起來。
 *
 * - 細（22 m 的格咬 45 m）：鋸齒。這一層決定「這不是畫出來的線」
 * - 中（110 m 咬 90 m）：一段一段的凹凸
 * - 粗（450 m 咬 150 m）：整條邊蜿蜒，把矩形變成不規則的形狀
 *
 * 【三層都要】只有粗的話從投彈高度看是一條平滑的曲線；只有細的話，放在
 * 一條 3 km 的邊上是 1.5% 的相對振幅 —— 仍然是一條直線加毛邊。
 */
const FINE_CELL = 22
const FINE_BITE = 45
const EDGE_CELL = 110
const EDGE_BITE = 90
const COARSE_CELL = 450
const COARSE_BITE = 150

/**
 * 咬痕的基線比墊面往外推這麼多，m。
 *
 * 【沒有它，邊緣的街廓會裸露在田上】三層咬痕加起來最深 285 m，而最外圈的
 * 街廓離墊面邊只有 100 m —— 從墊面邊往內咬的話，整排廠房會站在田色的地上。
 * 往外推之後咬痕在墊面外那一圈裡起伏，平均落在墊面外 40 m 左右。
 */
const PAD_SKIRT = 180

/**
 * 四個角斜切掉的兩條直角邊，m。次序是西北、東北、西南、東南。
 *
 * 【是長度不是比例】寫成墊面尺寸的比例會隨長寬比走樣：3000 × 1500 的墊面
 * 轉成 1500 × 3000 之後，同一組比例把等邊三角形變成 1 : 4.4 的扁三角形 ——
 * 斜邊幾乎平行長軸，畫面上是「工廠的長邊被斜著削掉一條」，比直角還顯眼。
 *
 * 【四個角要不一樣】一樣的話切完仍然是一個對稱的八邊形，那和矩形一樣好認。
 */
const CORNER_CUTS: readonly (readonly [number, number])[] = [
  [300, 300], [180, 195], [255, 260], [135, 300],
]

/** 四個角斜切各自的鹽。共用一個的話四條斜邊會咬出一樣的鋸齒 */
const CORNER_SALT: readonly number[] = [1913, 5273, 8171, 3527]

/**
 * 斜切的早退餘裕，m。**要大於三層咬痕的總和**（285 m）—— 小了的話角落外側
 * 那一段會被跳過，而那正是咬痕該把切線往內拉的地方。
 */
const CORNER_SLACK = 400

/**
 * 早退的外接盒要往外留這麼寬，m。**至少要蓋過 `PAD_SKIRT`** —— 邊界最外
 * 就在墊面外 `PAD_SKIRT` 處，盒子縮進來的話那一圈會露出田色。
 *
 * 【不要放大】盒內每個像素都跑墊面那一整段算式。放到 400 量到 4 km 俯視的
 * frame 由 0.9 ms 變 1.8 ms。
 */
const BAND = 220

/**
 * 起伏的深度。**兩側加起來不得吃掉整塊墊面** —— 咬得比半邊長還深的話，
 * 小一點的墊面會整片消失，而它在畫面上只是「這一關的廠區不見了」。
 */
function edgeBite(pad: SiteLayout['pad']): number {
  return Math.min(EDGE_BITE, (pad.x1 - pad.x0) * 0.08, (pad.z1 - pad.z0) * 0.08)
}

function coarseBite(pad: SiteLayout['pad']): number {
  return Math.min(COARSE_BITE, (pad.x1 - pad.x0) * 0.11, (pad.z1 - pad.z0) * 0.11)
}

function fineBite(pad: SiteLayout['pad']): number {
  return Math.min(FINE_BITE, (pad.x1 - pad.x0) * 0.05, (pad.z1 - pad.z0) * 0.05)
}

/** 一個 0…1 的格值。四條邊各用自己的鹽，否則對邊會鏡射 */
function edgeNoise(t: number, cell: number, salt: number): number {
  return (hash2(Math.floor(t / cell), salt) & 0xff) / 255
}

/**
 * 一點到墊面邊界的有號距離，m —— 負的在裡面、正的在外面。
 *
 * 【為什麼要距離而不是布林】邊緣壓暗與抗鋸齒都要知道「離邊多遠」。取各條
 * 約束的最大違反量：軸對齊矩形的外側距離就是這樣算的，角落會略為低估，
 * 而那正好讓斜切角的邊柔一點。
 *
 * **GLSL 與 CPU 兩份要算出同一個答案** —— 分家的話畫面上的廠界與取樣到的
 * 顏色差一整條邊，而那只有在小地圖與畫面並排時才看得出來。
 */
function padDistance(x: number, z: number, pad: SiteLayout['pad']): number {
  const b = edgeBite(pad)
  const c = coarseBite(pad)
  const f = fineBite(pad)
  const inset = (t: number, s1: number, s2: number): number =>
    edgeNoise(t, FINE_CELL, s1 ^ 0x5bd1) * f
    + edgeNoise(t, EDGE_CELL, s1) * b
    + edgeNoise(t, COARSE_CELL, s2) * c
  const sx0 = pad.x0 - PAD_SKIRT
  const sx1 = pad.x1 + PAD_SKIRT
  const sz0 = pad.z0 - PAD_SKIRT
  const sz1 = pad.z1 + PAD_SKIRT
  const w = sx1 - sx0
  const d = sz1 - sz0
  let out = Math.max(
    sx0 + inset(z, 4517, 3313) - x,
    x - (sx1 - inset(z, 2287, 6151)),
    sz0 + inset(x, 9911, 8543) - z,
    z - (sz1 - inset(x, 7331, 1697)),
  )
  for (let k = 0; k < 4; k++) {
    // 【夾住】兩個角的切在小墊面上會重疊，重疊之後整條邊都不見了
    const a = Math.min(CORNER_CUTS[k]![0], w * 0.3)
    const e = Math.min(CORNER_CUTS[k]![1], d * 0.3)
    // 【四個角量的是外推後的矩形】拿沒外推的邊當基準的話，外推那一圈整個
    // 落在斜切的外側 —— 角落會被削掉四百公尺，而且削出來的是一條直線
    const u = (k & 1) === 0 ? x - sx0 : sx1 - x
    const v = k < 2 ? z - sz0 : sz1 - z
    // 【離角落夠遠就不必算】斜切的違反量在那裡已經比最深的一咬更負，加不加
    // 咬痕都不會勝出。GLSL 那邊靠這一條省掉三次 hash —— 見 `CORNER_SLACK`
    if (u * e + v * a >= a * e + CORNER_SLACK * e) continue
    // 違反量換算成垂直距離：法向量 (1/a, 1/e) 的長度倒數
    // 斜邊也吃同一組三層咬痕，參數是沿斜邊的座標 —— 少了它，四個角是四條
    // 乾淨的斜直線，在投彈高度比矩形還好認
    const t = (u * e - v * a) / Math.hypot(a, e)
    out = Math.max(
      out,
      (1 - u / a - v / e) / Math.hypot(1 / a, 1 / e) + inset(t, CORNER_SALT[k]!, 6473 + k),
    )
  }
  return out
}

/**
 * 廠區這一層的作用範圍：墊面加過渡帶，再併進所有衛星設施。**道路不算** ——
 * 連外那兩條一路畫到地圖邊緣。
 *
 * 【為什麼要這個】墊面那一段的算式每個像素都跑，而投彈高度整片畫面有七成
 * 是田。少了這個外接矩形，4 km 俯視的幀時間從 0.8 ms 變成 2.2 ms。
 */
function siteBounds(site: SiteLayout): { x0: number; z0: number; x1: number; z1: number } {
  const local = {
    x0: site.pad.x0 - BAND, x1: site.pad.x1 + BAND,
    z0: site.pad.z0 - BAND, z1: site.pad.z1 + BAND,
  }
  for (const l of site.padLobes ?? []) {
    local.x0 = Math.min(local.x0, l.x0 - BAND); local.x1 = Math.max(local.x1, l.x1 + BAND)
    local.z0 = Math.min(local.z0, l.z0 - BAND); local.z1 = Math.max(local.z1, l.z1 + BAND)
  }
  for (const q of site.outposts ?? []) {
    local.x0 = Math.min(local.x0, q.x0); local.x1 = Math.max(local.x1, q.x1)
    local.z0 = Math.min(local.z0, q.z0); local.z1 = Math.max(local.z1, q.z1)
  }
  // 【轉過角度就要取四角的外接盒】早退的測試在世界座標做，直接把局部的邊界
  // 當世界用的話，斜角那兩塊墊面會被擋在外面 —— 畫面上是廠區缺了兩個角
  const c = Math.cos(site.heading ?? 0)
  const s = Math.sin(site.heading ?? 0)
  const px = site.pivot?.x ?? 0
  const pz = site.pivot?.z ?? 0
  const out = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
  for (const [dx, dz] of [
    [local.x0, local.z0], [local.x1, local.z0], [local.x1, local.z1], [local.x0, local.z1],
  ] as const) {
    const x = px + dx * c - dz * s
    const z = pz + dx * s + dz * c
    out.x0 = Math.min(out.x0, x); out.x1 = Math.max(out.x1, x)
    out.z0 = Math.min(out.z0, z); out.z1 = Math.max(out.z1, z)
  }
  return out
}

/**
 * 道路與鐵路的外接矩形往外再留多少，m。
 *
 * 【為什麼不能剛好貼著半寬】`bandCoverage(d, halfW, px)` 的抗鋸齒帶一路延到
 * `d = halfW + px`，而 `px` 是那一像素在地面上的足跡 —— 掠角看過去可以到
 * 好幾十公尺。留得不夠的話，路的外緣會沿著矩形邊被削掉一條直線，而且只在
 * 特定視角出現。矩形本身有十幾公里寬，多留這幾百公尺不花錢。
 */
const ROAD_BOUNDS_SLACK = 400

/**
 * 道路與鐵路的世界座標外接矩形。
 *
 * 【為什麼要獨立於 `siteBounds`】連外道路與鐵路一路畫到圖邊，遠在墊面那個
 * 矩形之外 —— 拿墊面的矩形擋它們會把連外那幾條整段砍掉。但完全不擋的話，
 * 那十五段點線距離是**每個像素**都跑，包含畫面上七成的田。
 */
export function roadBounds(site: SiteLayout): {
  x0: number; z0: number; x1: number; z1: number
} {
  const out = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
  for (const lines of [site.roads, site.rails ?? []]) {
    for (const line of lines) {
      for (const p of line) {
        out.x0 = Math.min(out.x0, p.x); out.x1 = Math.max(out.x1, p.x)
        out.z0 = Math.min(out.z0, p.z); out.z1 = Math.max(out.z1, p.z)
      }
    }
  }
  const margin = Math.max(site.roadWidth, site.railWidth ?? 0) / 2 + ROAD_BOUNDS_SLACK
  out.x0 -= margin; out.x1 += margin
  out.z0 -= margin; out.z1 += margin
  return out
}

/** 一條折線攤成線段清單，GLSL 與 CPU 共用 */
function segmentsOf(
  lines: readonly (readonly { readonly x: number; readonly z: number }[])[],
): { ax: number; az: number; bx: number; bz: number }[] {
  const out: { ax: number; az: number; bx: number; bz: number }[] = []
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      out.push({ ax: line[i]!.x, az: line[i]!.z, bx: line[i + 1]!.x, bz: line[i + 1]!.z })
    }
  }
  return out
}

/** 點到線段的距離 */
function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t))
}

/**
 * 廠區那一層的 GLSL。接在 `fieldColorAt` 的 `return col;` 之前：先鋪墊面，
 * 再鋪道路 —— 道路壓過墊面，墊面壓過田。
 */
function siteGlsl(site: SiteLayout): string {
  const segs = segmentsOf(site.roads)
  const rail = segmentsOf(site.rails ?? [])
  const railGlsl = rail.length === 0 ? '' : `
  // 鐵路：碴石帶。與道路同一套距離場，只是另一組線段與另一個顏色
  const vec4 RAILS[${rail.length}] = vec4[${rail.length}](
${rail.map((s) => `  vec4(${s.ax.toFixed(1)}, ${s.az.toFixed(1)}, `
    + `${s.bx.toFixed(1)}, ${s.bz.toFixed(1)})`).join(',\n')}
  );
  float railD = 1.0e9;
  for (int i = 0; i < ${rail.length}; i++) {
    vec2 a = RAILS[i].xy;
    vec2 b = RAILS[i].zw;
    vec2 ab = b - a;
    float t = clamp(dot(world - a, ab) / max(dot(ab, ab), 1.0e-6), 0.0, 1.0);
    railD = min(railD, length(world - (a + ab * t)));
  }
  col = mix(col, ${rgb(BALLAST)},
    bandCoverage(railD, ${((site.railWidth ?? 24) / 2).toFixed(1)}, px));`
  const list = segs.map((s) =>
    `  vec4(${s.ax.toFixed(1)}, ${s.az.toFixed(1)}, ${s.bx.toFixed(1)}, ${s.bz.toFixed(1)})`).join(',\n')
  /**
   * 一個墊面矩形到邊界的有號距離，寫進名為 `name` 的變數。**與 `padDistance`
   * 逐項對應**：三層咬痕、四個斜切角、外推的裙邊。主墊面與每一塊附加的
   * 墊面（`padLobes`）各叫一次。
   */
  const padBlock = (rect: SiteLayout['pad'], name: string): string => {
    const B = edgeBite(rect).toFixed(1)
    const C = coarseBite(rect).toFixed(1)
    const F = fineBite(rect).toFixed(1)
    const sx0 = rect.x0 - PAD_SKIRT
    const sx1 = rect.x1 + PAD_SKIRT
    const sz0 = rect.z0 - PAD_SKIRT
    const sz1 = rect.z1 + PAD_SKIRT
    const W = sx1 - sx0
    const D = sz1 - sz0
    /** 與 `padDistance` 的 `inset()` 逐項對應 —— 三層都要，鹽也要一樣 */
    const inset = (axis: string, s1: number, s2: number): string =>
      `float(fieldHash2(int(floor(${axis} / ${FINE_CELL}.0)), ${s1 ^ 0x5bd1}) & 0xffu) / 255.0 * ${F}`
      + ` + float(fieldHash2(int(floor(${axis} / ${EDGE_CELL}.0)), ${s1}) & 0xffu) / 255.0 * ${B}`
      + ` + float(fieldHash2(int(floor(${axis} / ${COARSE_CELL}.0)), ${s2}) & 0xffu) / 255.0 * ${C}`
    const corners = CORNER_CUTS.map(([ca, ce], k) => {
      // 【與 padDistance 的夾住逐項對應】
      const a = Math.min(ca, W * 0.3)
      const e = Math.min(ce, D * 0.3)
      const u = (k & 1) === 0 ? `local.x - ${sx0.toFixed(1)}` : `${sx1.toFixed(1)} - local.x`
      const v = k < 2 ? `local.y - ${sz0.toFixed(1)}` : `${sz1.toFixed(1)} - local.y`
      const norm = Math.hypot(1 / a, 1 / e)
      const len = Math.hypot(a, e)
      return `  {\n    float cu = ${u};\n    float cv = ${v};\n`
        + `    if (cu * ${e.toFixed(4)} + cv * ${a.toFixed(4)}`
        + ` < ${(a * e + CORNER_SLACK * e).toFixed(1)}) {\n`
        + `      float ct = (cu * ${e.toFixed(4)} - cv * ${a.toFixed(4)}) / ${len.toFixed(6)};\n`
        + `      ${name} = max(${name}, (1.0 - cu / ${a.toFixed(1)} - cv / ${e.toFixed(1)})`
        + ` / ${norm.toFixed(8)}\n        + ${inset('ct', CORNER_SALT[k]!, 6473 + k)});\n    }\n  }`
    }).join('\n')
    return `  float ${name} = max(
    max(${sx0.toFixed(1)} + ${inset('local.y', 4517, 3313)} - local.x,
        local.x - (${sx1.toFixed(1)} - (${inset('local.y', 2287, 6151)}))),
    max(${sz0.toFixed(1)} + ${inset('local.x', 9911, 8543)} - local.y,
        local.y - (${sz1.toFixed(1)} - (${inset('local.x', 7331, 1697)}))));
${corners}`
  }
  // 【附加的墊面是聯集】每一塊自己算一個距離，取最小的 —— 負的在任何一塊裡面
  const lobes = (site.padLobes ?? []).map((l) =>
    `  {\n${padBlock(l, 'lobeD')}\n    padD = min(padD, lobeD);\n  }`).join('\n')
  /** 一組矩形＋色相攤成 GLSL 的兩張表加一個迴圈 */
  const rectsGlsl = (
    name: string, rs: NonNullable<SiteLayout['patches']>, assign: string,
  ): string => rs.length === 0 ? '' : `
  const vec4 ${name}[${rs.length}] = vec4[${rs.length}](
${rs.map((p) => `  vec4(${p.x0.toFixed(1)}, ${p.z0.toFixed(1)}, `
    + `${p.x1.toFixed(1)}, ${p.z1.toFixed(1)})`).join(',\n')}
  );
  const vec3 ${name}_HUE[${rs.length}] = vec3[${rs.length}](
${rs.map((p) => `  ${rgb(p.hex)}`).join(',\n')}
  );
  for (int i = 0; i < ${rs.length}; i++) {
    if (local.x >= ${name}[i].x && local.x < ${name}[i].z
        && local.y >= ${name}[i].y && local.y < ${name}[i].w) {
      ${assign.replace('$', `${name}_HUE[i]`)}
    }
  }`
  const patchGlsl = rectsGlsl('PATCHES', site.patches ?? [],
    'siteCol = $ * siteGrime * padDark;')
  const outpostGlsl = rectsGlsl('OUTPOSTS', site.outposts ?? [],
    'col = $ * siteGrime;')
  const near = siteBounds(site)
  const rb = roadBounds(site)
  return `
  // 【先用外接矩形擋掉】底下這一段是每個像素都跑的，而投彈高度整片畫面有
  // 七成是田 —— 少了這個測試，4 km 俯視的幀時間從 0.8 ms 變成 2.2 ms。
  // 道路留在外面：連外那兩條一路畫到地圖邊緣
  if (world.x > ${near.x0.toFixed(1)} && world.x < ${near.x1.toFixed(1)}
      && world.y > ${near.z0.toFixed(1)} && world.y < ${near.z1.toFixed(1)}) {
  // 【底下這一段全部在廠區局部座標】墊面轉了 ${((site.heading ?? 0) * 180 / Math.PI).toFixed(1)} 度，
  // 而墊面／鋪面／衛星設施都是軸對齊矩形 —— 轉一次座標比把四個不等式改成
  // 一般多邊形便宜得多。髒污也吃局部座標，碎花才跟著廠區的方向走
  vec2 rel = world - vec2(${(site.pivot?.x ?? 0).toFixed(1)}, ${(site.pivot?.z ?? 0).toFixed(1)});
  vec2 local = vec2(rel.x * ${Math.cos(site.heading ?? 0).toFixed(8)}
                    + rel.y * ${Math.sin(site.heading ?? 0).toFixed(8)},
                    -rel.x * ${Math.sin(site.heading ?? 0).toFixed(8)}
                    + rel.y * ${Math.cos(site.heading ?? 0).toFixed(8)});
  // 髒污：${SLAB_CELL.toFixed(0)} m 的鋪面塊疊 ${GRIME_CELL.toFixed(0)} m 的油漬與微亮暗。
  // 墊面與鋪面共用，所以碴石與裸土也是同色系的碎花而不是一整塊平色
  //
  // 【油漬要是塊狀的】邊界不平滑是刻意的：低多邊形的髒就是一塊一塊的
  uint sgP = fieldHash2(int(floor(local.x / ${GRIME_CELL}.0)), int(floor(local.y / ${GRIME_CELL}.0)));
  uint sgS = fieldHash2(int(floor(local.x / ${SLAB_CELL}.0)) + 7919,
                        int(floor(local.y / ${SLAB_CELL}.0)) - 104729);
  uint sgO = fieldHash1(sgP);
  float siteGrime = (0.86 + 0.2 * float((sgS >> 8) & 0x7u) / 7.0)
    * ((sgO & 0xffu) < 46u ? 0.74 : 1.0)
    * (0.96 + 0.08 * float(sgP & 0xffu) / 255.0);

  // 【廠界不是直角矩形】兩層起伏：${EDGE_CELL.toFixed(0)} m 的格咬出鋸齒、
  // ${COARSE_CELL.toFixed(0)} m 的格讓整條邊蜿蜒，四個角再各斜切一塊。一條直的邊在投彈
  // 高度看下去就是一把尺，而廠區是幾十年間一塊一塊擴出來的
  //
  // 【與 padDistance() 逐項對應】負的在墊面內、正的在外面
${padBlock(site.pad, 'padD')}
${lobes}

  // 【靠邊處壓暗】高空最刺眼的是水泥與田的亮度階梯。越靠外越髒越舊，順便
  // 把那一階削掉一截
  float padDark = mix(0.90, 1.0, clamp(-padD / ${(PAD_SKIRT * 2).toFixed(1)}, 0.0, 1.0));
  vec3 siteCol = ${rgb(site.padHex ?? CONCRETE)} * siteGrime * padDark;
${patchGlsl}
  // 【邊界是硬的】墊面外沒有過渡帶：一圈把混凝土混回田色的帶子，從投彈高度
  // 看是「一半工廠一半田」的暈。不規則靠的是 padD 裡疊的三層咬痕，不是混色。
  //
  // 【這一像素的柔化只為了抗鋸齒】寬度就是像素在地面上的足跡 —— 拉寬就變回
  // 過渡帶了
  col = mix(siteCol, col, clamp(padD / max(px, 0.25) * 0.5 + 0.5, 0.0, 1.0));
${outpostGlsl}
  }
  // 【道路與鐵路自己一個外接矩形】底下這 ${rail.length + segs.length} 段點線距離是每個像素都跑的，
  // 而連外道路一路畫到圖邊 —— 墊面那個矩形擋不住它們，得自己算一個。
  // 見 roadBounds()：留的邊界要蓋得住抗鋸齒帶，否則路的外緣會沿著矩形邊
  // 被削掉一條直線，而且只在掠角出現
  if (world.x > ${rb.x0.toFixed(1)} && world.x < ${rb.x1.toFixed(1)}
      && world.y > ${rb.z0.toFixed(1)} && world.y < ${rb.z1.toFixed(1)}) {
${railGlsl}
  // 道路：離任一條線段小於半寬。**畫在鐵路之後** —— 平交道上看得到的是柏油
  const vec4 ROADS[${segs.length}] = vec4[${segs.length}](
${list}
  );
  float roadD = 1.0e9;
  for (int i = 0; i < ${segs.length}; i++) {
    vec2 a = ROADS[i].xy;
    vec2 b = ROADS[i].zw;
    vec2 ab = b - a;
    float t = clamp(dot(world - a, ab) / max(dot(ab, ab), 1.0e-6), 0.0, 1.0);
    roadD = min(roadD, length(world - (a + ab * t)));
  }
  col = mix(col, ${rgb(ASPHALT)}, bandCoverage(roadD, ${(site.roadWidth / 2).toFixed(1)}, px));
  }`
}

/** 有廠區的那一份 GLSL。`site` 省略時與 `fieldGlsl(season)` 逐字相同 */
export function fieldGlslWithSite(season: Season, site?: SiteLayout, candidates = false, open = false): string {
  const base = fieldGlsl(season, candidates, open)
  if (site === undefined) return base
  const at = base.lastIndexOf('  return col;')
  return base.slice(0, at) + siteGlsl(site) + '\n' + base.slice(at)
}

/**
 * `fieldSurfaceColor` 的廠區版：道路壓過墊面，墊面壓過田。`site` 省略時與
 * `fieldSurfaceColor` 相同。
 */
export function siteSurfaceColor(
  x: number, z: number, out: Color, season: Season, site?: SiteLayout, open = false,
): Color {
  if (site !== undefined) {
    for (const s of segmentsOf(site.roads)) {
      if (segmentDistance(x, z, s.ax, s.az, s.bx, s.bz) < site.roadWidth / 2) return out.setHex(ASPHALT)
    }
    for (const s of segmentsOf(site.rails ?? [])) {
      if (segmentDistance(x, z, s.ax, s.az, s.bx, s.bz) < (site.railWidth ?? 24) / 2) {
        return out.setHex(BALLAST)
      }
    }
    // 【與 `siteGlsl` 一樣先擋外接矩形】次序與早退的條件都要一致
    const near = siteBounds(site)
    if (x <= near.x0 || x >= near.x1 || z <= near.z0 || z >= near.z1) {
      return fieldSurfaceColor(x, z, out, season, open)
    }
    // 【與 `siteGlsl` 一樣，底下全部在廠區局部座標】髒污也是
    const c = Math.cos(site.heading ?? 0)
    const sn = Math.sin(site.heading ?? 0)
    const rx = x - (site.pivot?.x ?? 0)
    const rz = z - (site.pivot?.z ?? 0)
    const lx = rx * c + rz * sn
    const lz = -rx * sn + rz * c
    for (const q of site.outposts ?? []) {
      if (lx >= q.x0 && lx < q.x1 && lz >= q.z0 && lz < q.z1) {
        return out.setHex(q.hex).multiplyScalar(grimeFactor(lx, lz))
      }
    }
    // 【邊界是硬的】著色器那邊只有一像素的柔化，而它是為了抗鋸齒；取樣沒有
    // 像素，直接切
    let d = padDistance(lx, lz, site.pad)
    for (const l of site.padLobes ?? []) d = Math.min(d, padDistance(lx, lz, l))
    if (d < 0) {
      // 【與 `siteGlsl` 逐項對應】墊面 → 鋪面 → 壓暗，次序一致
      let hex = site.padHex ?? CONCRETE
      for (const q of site.patches ?? []) {
        if (lx >= q.x0 && lx < q.x1 && lz >= q.z0 && lz < q.z1) hex = q.hex
      }
      const dark = 0.9 + 0.1 * Math.min(1, Math.max(0, -d / (PAD_SKIRT * 2)))
      return out.setHex(hex).multiplyScalar(grimeFactor(lx, lz) * dark)
    }
  }
  return fieldSurfaceColor(x, z, out, season, open)
}
