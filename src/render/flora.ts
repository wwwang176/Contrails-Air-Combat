import { isGrass } from './island'
import type { HeightFieldData } from '../world/heightfield'
import type { IslandDesc } from '../world/archipelago'
import {
  edgeAt, fieldAt, isWoodField, regionAt, regionParams, regionSeed, splitCut,
  HEDGE_CHANCE, HEDGE_WIDTH, REGION_SPACING, TRACK_WIDTH,
  type FieldSample, type RegionSample, type SplitCut, type Vec2,
} from './fields'

/**
 * 植被的**放置**。這個檔案只算「哪裡該有一株什麼」，不碰 three 的場景 ——
 * 那是 `render/vegetation.ts` 的事。
 *
 * ── 鐵律：一株植被的座標只由它自己的全域索引決定 ──────────
 *
 * tile 的邊界**只能用來過濾**，不得進入座標的計算。違反的話相鄰兩格的接縫上
 * 會重複或缺漏，而且鏡頭一動植被就換位置。
 *
 * 「不重複」加「密度差不多」證明不了這件事 —— 每格各自生一套不同但仍落在
 * 格內、密度也相近的點，那兩條照樣綠。承重的是 `flora-hedge.test.ts` 的
 * **分割等價**：一個大矩形的結果，必須與把它切成 n × n 之後的聯集逐位元相同。
 *
 * ── 為什麼是走線，不是密集取樣 ────────────────────────────
 *
 * 4 m 網格在 250 m 的 tile 上是 3,906 次 `fieldAt`（實測 0.371 µs／次）
 * = 1.45 ms，光補一欄就 23 ms。走線的候選數約等於實際株數。
 *
 * ── 三種線，不是兩種 ──────────────────────────────────────
 *
 * 橫線、縱線，**以及對切線**。對切出來的那一刀也是樹籬，佔全部樹籬帶的
 * 11.8%（2026-08-29 實測），而它不在任何一條格線上。只走格線的話，那些樹籬
 * 會畫在地上卻沒有樹 —— 貼地飛過去一眼看得出來。
 */

/** 一筆的欄位數：x, y, z, rotY, scale, tint */
export const FLORA_STRIDE = 6

export const enum FloraKind {
  BroadTree = 0,
  ConeTree = 1,
  Bush = 2,
  House = 3,
  Barn = 4,
  Church = 5,
}

/**
 * 一格 tile 的產出。**呼叫端預配、呼叫端歸零** —— 放置函數只 append，
 * 所以同一個 buffer 可以餵給好幾個來源。
 */
export interface FloraBuffer {
  readonly data: Float32Array
  readonly kind: Uint8Array
  readonly capacity: number
  count: number
  /** 容量不足丟掉幾筆。**不得靜默截斷** —— 引擎會把它回報出去 */
  dropped: number
}

export function createFloraBuffer(capacity: number): FloraBuffer {
  return {
    data: new Float32Array(capacity * FLORA_STRIDE),
    kind: new Uint8Array(capacity),
    capacity,
    count: 0,
    dropped: 0,
  }
}

export function pushFlora(
  out: FloraBuffer,
  x: number, y: number, z: number,
  rot: number, scale: number, tint: number, kind: FloraKind,
): void {
  if (out.count >= out.capacity) { out.dropped++; return }
  const o = out.count * FLORA_STRIDE
  out.data[o] = x
  out.data[o + 1] = y
  out.data[o + 2] = z
  out.data[o + 3] = rot
  out.data[o + 4] = scale
  out.data[o + 5] = tint
  out.kind[out.count] = kind
  out.count++
}

/**
 * 一個放置來源。把 `[x0, x1) × [z0, z1)` 這一格裡的植被 append 進 `out`。
 *
 * `heightAt` 是地面高度 —— 每一株的 `y` 直接放它，樹才不會浮空或陷地。
 */
export type FloraSource = (
  x0: number, z0: number, x1: number, z1: number,
  heightAt: (x: number, z: number) => number,
  out: FloraBuffer,
) => void

/** 樹籬上兩棵喬木的間距，m */
export const HEDGE_TREE_SPACING = 15

/** 樹籬上兩叢灌木的間距，m。連成一條帶，喬木才有底 */
export const HEDGE_BUSH_SPACING = 6

/**
 * 樹林裡的網格間距，m。3,906 棵/km²。
 *
 * 【為什麼是網格不是走線】樹林填的是**面**不是線，而 16 m 的網格在 250 m 的
 * tile 上是 244 次 `fieldAt` ≈ 0.09 ms —— 只在生成時付一次。
 */
export const WOOD_GRID = 16

/** 沿線抖動的幅度，佔間距的比例。必須 < 0.5，否則相鄰兩株會交換次序 */
const ALONG_JITTER = 0.3

/** 側向抖動的半幅，m。樹籬帶是 ±9 m，所以這個要小得多 */
const SIDE_JITTER = 3

/** 喬木的縮放區間。幾何在 1.0 是 15 m 高 */
const TREE_SCALE = [0.8, 1.2] as const
const BUSH_SCALE = [0.8, 1.3] as const

function hash2(i: number, j: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2545f491)
  return (h ^ (h >>> 13)) >>> 0
}

function hash1(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
}

const REG: RegionSample = {
  r1: 0, r2: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}
const AT: RegionSample = {
  r1: 0, r2: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}
const FLD: FieldSample = { id: 0, edge: 0, hedged: false }
const CUT: SplitCut = { axis: 0, at: 0, lo: 0, hi: 0 }
const SEED: Vec2 = { x: 0, z: 0 }

/** 這一格 tile 可能屬於哪些區塊。最多 9 顆，實際通常一到三顆 */
const CAND_ID = new Int32Array(9)
let candCount = 0

/**
 * 列舉「可能擁有這格裡任何一點」的區塊。
 *
 * 【為什麼不是四角加中心取樣】那是猜的 —— 細長的楔形可以穿過 tile 而不含
 * 那五點，於是那一區的樹整片消失。
 *
 * 【剔除是精確的，不會漏】若 `dMin(tile, s_i) > dMax(tile, s_k)`，則對格內
 * 任何一點 p 都有 `d(p, s_i) ≥ dMin_i > dMax_k ≥ d(p, s_k)` —— s_i 永遠贏
 * 不了 s_k，可以安全剔除。留下來的可能多幾顆，但不會少。
 *
 * 【3 × 3 就夠】與 `regionAt` 自己的搜尋範圍相同。tile 是 250 m，區塊間距
 * 3,200 m，所以格內任何一點的最近種子都在它自己那一格的 3 × 3 之內。
 */
function candidateRegions(x0: number, z0: number, x1: number, z1: number): void {
  const gx = Math.floor((x0 + x1) / 2 / REGION_SPACING)
  const gz = Math.floor((z0 + z1) / 2 / REGION_SPACING)
  candCount = 0
  let minOfMax = Infinity
  // 先求每一顆的 dMin / dMax，順便求 min(dMax)
  const dMin = FAR_MIN
  const ids = FAR_ID
  let k = 0
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const h = regionSeed(gx + di, gz + dj, SEED)
      const cx = Math.max(x0, Math.min(x1, SEED.x))
      const cz = Math.max(z0, Math.min(z1, SEED.z))
      dMin[k] = Math.hypot(SEED.x - cx, SEED.z - cz)
      const fx = SEED.x - x0 > x1 - SEED.x ? x0 : x1
      const fz = SEED.z - z0 > z1 - SEED.z ? z0 : z1
      const dMax = Math.hypot(SEED.x - fx, SEED.z - fz)
      if (dMax < minOfMax) minOfMax = dMax
      ids[k] = h | 0
      k++
    }
  }
  for (let i = 0; i < 9; i++) {
    if (dMin[i]! <= minOfMax) CAND_ID[candCount++] = ids[i]!
  }
}

const FAR_MIN = new Float64Array(9)
const FAR_ID = new Int32Array(9)

/** 走線時共用的狀態。全部是模組層的，熱路徑不配置 */
let winX0 = 0
let winZ0 = 0
let winX1 = 0
let winZ1 = 0
let winRid = 0
let winCos = 0
let winSin = 0
let winHeight: (x: number, z: number) => number = () => 0
let winOut: FloraBuffer = createFloraBuffer(1)

/**
 * 沿一條線種東西。
 *
 * `axis` 0 = 線上的 qx 固定在 `at`，沿 qz 由 `lo` 走到 `hi`；1 則相反。
 * `lineKey` 是**這條線的身分** —— 它就是 `fieldAt` 用來決定「這條邊長不長
 * 樹籬」的那把鑰匙，所以樹種、抖動與樹籬的有無天生一致。
 *
 * 沿線的位置由**全域索引 m** 決定，與這一格 tile 切在哪裡無關 —— 見檔頭的鐵律。
 */
function walkLine(
  axis: number, at: number, lo: number, hi: number,
  spacing: number, lineKey: number, kind: FloraKind,
): void {
  if (hi <= lo) return
  const m0 = Math.floor(lo / spacing) - 1
  const m1 = Math.floor(hi / spacing) + 1
  for (let m = m0; m <= m1; m++) {
    const h = hash2(m, lineKey)
    const t = (m + 0.5 + ((h / 4294967296) - 0.5) * 2 * ALONG_JITTER) * spacing
    if (t < lo || t >= hi) continue
    const g = hash1(h)
    const side = ((g / 4294967296) - 0.5) * 2 * SIDE_JITTER
    const qx = axis === 0 ? at + side : t
    const qz = axis === 0 ? t : at + side
    const x = qx * winCos - qz * winSin
    const z = qx * winSin + qz * winCos
    if (x < winX0 || x >= winX1 || z < winZ0 || z >= winZ1) continue
    // 【驗證比的是「我正在走的那一區」】比 tile 中心那一區的話，跨界的
    // 另一側會整片被丟掉
    regionAt(x, z, AT)
    if (AT.id !== winRid) continue
    fieldAt(x, z, AT, FLD)
    if (!FLD.hedged || FLD.edge >= HEDGE_WIDTH / 2) continue

    const g2 = hash1(g)
    const rot = (g2 / 4294967296) * Math.PI * 2
    const g3 = hash1(g2)
    const u = g3 / 4294967296
    const lo2 = kind === FloraKind.Bush ? BUSH_SCALE[0] : TREE_SCALE[0]
    const hi2 = kind === FloraKind.Bush ? BUSH_SCALE[1] : TREE_SCALE[1]
    pushFlora(
      winOut, x, winHeight(x, z), z, rot,
      lo2 + u * (hi2 - lo2), (hash1(g3) & 0xff) / 255, kind,
    )
  }
}

/** 這條邊長不長樹籬。與 `fieldAt` 的判準相同 —— 不長的線整條跳過 */
function hedged(lineKey: number): boolean {
  return hash1(lineKey) / 4294967296 < HEDGE_CHANCE
}

/**
 * 這條樹籬種什麼樹。**逐線決定，不是逐棵** —— 整排同種才讀得出防風林。
 *
 * 【闊葉為主】Bocage 的樹籬是橡與櫸，針葉只出現在刻意種的防風林裡。
 * 一半一半的話整片地讀起來像雲杉林。
 */
const CONIFER_SHARE = 0.25

function speciesOf(lineKey: number): FloraKind {
  return hash1(lineKey ^ 0x5bd1) / 4294967296 < CONIFER_SHARE
    ? FloraKind.ConeTree : FloraKind.BroadTree
}

/** 一條線上種喬木與灌木 */
function plantLine(
  axis: number, at: number, lo: number, hi: number, lineKey: number,
): void {
  if (!hedged(lineKey)) return
  walkLine(axis, at, lo, hi, HEDGE_TREE_SPACING, lineKey, speciesOf(lineKey))
  walkLine(axis, at, lo, hi, HEDGE_BUSH_SPACING, lineKey ^ 0xb115, FloraKind.Bush)
}

/**
 * 農地的樹籬 —— 喬木與灌木。
 *
 * 走法見檔頭。橫線用 salt 1、縱線的 salt 帶著列號（所以縱線在每一條橫線上
 * 斷掉），對切線由 `splitCut` 給。
 */
export const farmHedgeFlora: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
  winX0 = x0
  winZ0 = z0
  winX1 = x1
  winZ1 = z1
  winHeight = heightAt
  winOut = out

  candidateRegions(x0, z0, x1, z1)
  for (let ci = 0; ci < candCount; ci++) {
    // 【一定要 >>> 0】CAND_ID 是 Int32Array，最高位是 1 的雜湊存進去會變成
    // 負數，而 `regionAt` 回的 `id` 是無號的 —— 兩者一比永遠不相等，
    // 那些區塊會一株都不長
    const rid = CAND_ID[ci]! >>> 0
    regionParams(rid, REG)
    winRid = rid
    const cs = Math.cos(-REG.angle)
    const sn = Math.sin(-REG.angle)
    winCos = Math.cos(REG.angle)
    winSin = Math.sin(REG.angle)

    // tile 的四角轉進區塊座標系，取 AABB
    let qxMin = Infinity
    let qxMax = -Infinity
    let qzMin = Infinity
    let qzMax = -Infinity
    for (let i = 0; i < 4; i++) {
      const x = (i & 1) === 0 ? x0 : x1
      const z = (i & 2) === 0 ? z0 : z1
      const qx = x * cs - z * sn
      const qz = x * sn + z * cs
      if (qx < qxMin) qxMin = qx
      if (qx > qxMax) qxMax = qx
      if (qz < qzMin) qzMin = qz
      if (qz > qzMax) qzMax = qz
    }

    const rMin = Math.floor(qzMin / REG.cellH) - 1
    const rMax = Math.floor(qzMax / REG.cellH) + 1
    const cMin = Math.floor(qxMin / REG.cellW) - 1
    const cMax = Math.floor(qxMax / REG.cellW) + 1

    // ── 橫線 ──────────────────────────────────────────
    for (let r = rMin; r <= rMax + 1; r++) {
      const at = edgeAt(r, REG.cellH, 1)
      // 【垂直方向要放 SIDE_JITTER 的餘裕】株的側向抖動最多 3 m，所以線本身
      // 落在窗外一點點時仍然可能有株落進窗裡。少了這道餘裕，把一個窗切成
      // 四個小窗時邊界上會漏掉幾株 —— 分割等價那一條就是這樣紅的
      if (at < qzMin - SIDE_JITTER || at > qzMax + SIDE_JITTER) continue
      plantLine(1, at, qxMin, qxMax, hash2(r, 0x9e37))
    }

    // ── 縱線與對切線 ──────────────────────────────────
    for (let r = rMin; r <= rMax; r++) {
      const bottom = edgeAt(r, REG.cellH, 1)
      const top = edgeAt(r + 1, REG.cellH, 1)
      if (top < qzMin || bottom > qzMax) continue
      const lo = Math.max(bottom, qzMin)
      const hi = Math.min(top, qzMax)
      const colSalt = (r * 2 + 1) | 0
      for (let c = cMin; c <= cMax + 1; c++) {
        const at = edgeAt(c, REG.cellW, colSalt)
        if (at >= qxMin - SIDE_JITTER && at <= qxMax + SIDE_JITTER) {
          plantLine(0, at, lo, hi, hash2(c ^ colSalt, 0x51ed))
        }
        // 【對切線】fieldAt 認定它是樹籬，佔全部樹籬帶的 11.8%
        if (c > cMax) continue
        if (!splitCut(c, r, REG, CUT)) continue
        if (CUT.axis === 0) {
          if (CUT.at < qxMin - SIDE_JITTER || CUT.at > qxMax + SIDE_JITTER) continue
          plantLine(0, CUT.at, Math.max(CUT.lo, qzMin), Math.min(CUT.hi, qzMax),
            hash2(c ^ rid, r) ^ 0x1234)
        } else {
          if (CUT.at < qzMin - SIDE_JITTER || CUT.at > qzMax + SIDE_JITTER) continue
          plantLine(1, CUT.at, Math.max(CUT.lo, qxMin), Math.min(CUT.hi, qxMax),
            hash2(c ^ rid, r) ^ 0x1234)
        }
      }
    }
  }
}

/**
 * 樹林（copse）—— **一整塊田變成樹林**，由田的雜湊決定（`isWoodField`）。
 *
 * 【放置與地色共用同一個判準】`fieldSurfaceColor` 對同一塊田回最深的那一階，
 * 所以不會出現「深綠的地上沒有樹」或「樹長在麥田裡」。
 *
 * 【不疊在樹籬帶上】樹林田的邊界仍然是樹籬，那一圈由 `farmHedgeFlora` 種。
 *
 * 【樹種逐田決定】混種的樹林從空中看是雜訊。
 */
export const farmWoodFlora: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
  const g0 = Math.floor(x0 / WOOD_GRID)
  const g1 = Math.floor(x1 / WOOD_GRID)
  const h0 = Math.floor(z0 / WOOD_GRID)
  const h1 = Math.floor(z1 / WOOD_GRID)
  for (let gz = h0; gz <= h1; gz++) {
    for (let gx = g0; gx <= g1; gx++) {
      // 【位置只由全域索引決定】見檔頭的鐵律
      const h = hash2(gx, gz)
      const x = (gx + 0.15 + (h / 4294967296) * 0.7) * WOOD_GRID
      const g = hash1(h)
      const z = (gz + 0.15 + (g / 4294967296) * 0.7) * WOOD_GRID
      if (x < x0 || x >= x1 || z < z0 || z >= z1) continue
      regionAt(x, z, AT)
      if (AT.r2 - AT.r1 < TRACK_WIDTH) continue
      fieldAt(x, z, AT, FLD)
      if (!isWoodField(FLD.id)) continue
      // 【樹籬那一圈留給 farmHedgeFlora】不疊兩層樹
      if (FLD.edge < HEDGE_WIDTH / 2) continue
      const g2 = hash1(g)
      const u = hash1(g2) / 4294967296
      pushFlora(
        out, x, heightAt(x, z), z, (g2 / 4294967296) * Math.PI * 2,
        TREE_SCALE[0] + u * (TREE_SCALE[1] - TREE_SCALE[0]),
        (hash1(FLD.id ^ 0x2ea3) & 0xff) / 255,
        speciesOf(FLD.id ^ 0x77aa),
      )
    }
  }
}

/**
 * 村落的建築離站址最遠多少，m。
 *
 * 【收緊過】原本 140 m 讓十來棟房子沿路拉開近三百公尺，從空中看是散落的
 * 點而不是一個聚落。
 */
export const VILLAGE_REACH = 95

/** 建築沿路排開的最近距離，m */
const VILLAGE_INNER = 14

/** 建築離路心的垂距，m */
const LANE_OFFSET = [11, 34] as const

/**
 * 一棟建築離站址最遠可能多遠，m。沿路 `VILLAGE_REACH`、垂向 `LANE_OFFSET[1]`。
 * **由那兩個推導，不寫死** —— 兩者改了這個要跟著改，而漏掉的症狀是村的
 * 邊緣幾棟房子在切窗時忽有忽無。
 */
export const VILLAGE_SPAN = Math.hypot(VILLAGE_REACH, LANE_OFFSET[1])

/** 有村的區塊格佔多少 */
const VILLAGE_CHANCE = 0.55

/**
 * 建築容許的「離凹路多遠」，用 `r2 − r1` 表示。
 *
 * 【為什麼是 r2 − r1 而不是公尺】兩顆種子的 Voronoi 邊界上 `r2 − r1 = 0`，
 * 離開邊界 t 公尺時 `r2 − r1 ≈ 2t`。用它就不必自己算點到邊界的距離，而且
 * 與 `fieldSurfaceColor` 判斷凹路用的是同一個量。
 *
 * 下界是 `TRACK_WIDTH`（房子不蓋在路面上），上界 90 ≈ 離路心 45 m。
 */
export const LANE_BAND = 90

/** 一個村有教堂的機率 */
const CHURCH_CHANCE = 0.45

/** 有多少比例的建築是穀倉 */
const BARN_CHANCE = 0.33

const SEED_A: Vec2 = { x: 0, z: 0 }
const SEED_B: Vec2 = { x: 0, z: 0 }

/**
 * 配對的鄰格。**只往 +x 與 +z，不往回**。
 *
 * 【為什麼不能四個方向都來】(i, j) 選 +x、(i+1, j) 選 −x 的話，兩格算出來
 * 是**同一個中點** —— 同一個村會被生兩次，而且兩份建築完全重疊。只往前配對
 * 之後，一對格子只可能由較小的那一格產生。
 */
const NEIGHBOUR = [1, 0, 0, 1] as const

/**
 * 站址那條凹路的走向（單位向量）。**只在 `villageSite` 回 true 之後有效，
 * 而且會被下一次呼叫蓋掉。**
 *
 * 【為什麼要它】房子要沿路排。凹路是兩顆種子的垂直平分線，所以走向就是
 * 「兩顆種子連線」轉九十度。
 */
const LANE_TAN: Vec2 = { x: 1, z: 0 }

/**
 * 第 `(i, j)` 格區塊有沒有村；有的話把站址寫進 `out`。
 *
 * ```
 *   1. 取這一格的種子 A，由它的雜湊挑一個軸向鄰格
 *   2. 取那一格的種子 B
 *   3. 站址 = A 與 B 的中點 —— 到兩顆等距，所以落在它們的邊界上，也就是凹路上
 *   4. 驗證：第三顆種子不得更近（`r2 − r1 < TRACK_WIDTH`）
 * ```
 *
 * 【為什麼站址是「算出來」而不是「擺好再檢查」】村子在路口是 bocage 的常態，
 * 而中點這個構造直接保證它 —— 驗證只用來擋掉第三顆種子更近的情形。
 */
export function villageSite(i: number, j: number, out: Vec2): boolean {
  const h = regionSeed(i, j, SEED_A)
  if (((h >>> 7) & 0xff) / 256 >= VILLAGE_CHANCE) return false
  const d = ((h >>> 5) & 1) * 2
  regionSeed(i + NEIGHBOUR[d]!, j + NEIGHBOUR[d + 1]!, SEED_B)
  const x = (SEED_A.x + SEED_B.x) / 2
  const z = (SEED_A.z + SEED_B.z) / 2
  regionAt(x, z, AT)
  if (AT.r2 - AT.r1 >= TRACK_WIDTH) return false
  // 凹路的走向 = 兩顆種子連線轉九十度
  const dx = SEED_B.x - SEED_A.x
  const dz = SEED_B.z - SEED_A.z
  const len = Math.hypot(dx, dz)
  LANE_TAN.x = -dz / len
  LANE_TAN.z = dx / len
  out.x = x
  out.z = z
  return true
}

const SITE: Vec2 = { x: 0, z: 0 }

/** 這個點可以蓋房子嗎 —— 在路邊，但不在路上 */
function besideLane(x: number, z: number): boolean {
  regionAt(x, z, AT)
  const d = AT.r2 - AT.r1
  return d >= TRACK_WIDTH && d <= LANE_BAND
}

/**
 * 村落與教堂。
 *
 * 【tile 只負責過濾】站址與每一棟的座標都由區塊格的索引決定，所以一棟房子
 * 由「包含它的那一格」產生，與別格生不生無關。區塊間距 3,200 m 遠大於
 * tile 的 250 m，所以只要檢查涵蓋 `VILLAGE_REACH` 的那幾格。
 */
export const farmVillageFlora: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
  // 【格範圍要多放一格】站址是兩顆種子的**中點**，所以格 (i, j) 生出來的村
  // 可能落在格 (i+1, j) 或 (i, j+1) 裡。只掃站址所在的那一格的話，窄長條的
  // 窗會把整個村漏掉 —— 而全窗看起來完全正常
  const i0 = Math.floor((x0 - VILLAGE_SPAN) / REGION_SPACING) - 1
  const i1 = Math.floor((x1 + VILLAGE_SPAN) / REGION_SPACING) + 1
  const j0 = Math.floor((z0 - VILLAGE_SPAN) / REGION_SPACING) - 1
  const j1 = Math.floor((z1 + VILLAGE_SPAN) / REGION_SPACING) + 1

  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (!villageSite(i, j, SITE)) continue
      const sx = SITE.x
      const sz = SITE.z
      const tx = LANE_TAN.x
      const tz = LANE_TAN.z
      const hs = hash1(hash2(i, j) ^ 0x5eed)
      const count = 6 + (hs % 9)

      for (let k = 0; k < count; k++) {
        const kh = hash2(k, hs)
        const g = hash1(kh)
        // 【沿路排，不是圍著站址一圈】圓上的點絕大多數離路心 60 m 以上，
        // 而房子的容許帶只有 45 m —— 那樣九成的候選會被 besideLane 擋掉
        const along = (VILLAGE_INNER
          + (kh / 4294967296) * (VILLAGE_REACH - VILLAGE_INNER))
          * ((g & 1) === 0 ? 1 : -1)
        const off = (LANE_OFFSET[0]
          + ((g >>> 1) / 2147483648) * (LANE_OFFSET[1] - LANE_OFFSET[0]))
          * ((g & 2) === 0 ? 1 : -1)
        const x = sx + tx * along - tz * off
        const z = sz + tz * along + tx * off
        if (x < x0 || x >= x1 || z < z0 || z >= z1) continue
        if (!besideLane(x, z)) continue
        const g2 = hash1(g)
        const barn = ((g2 >>> 8) & 0xff) / 256 < BARN_CHANCE
        pushFlora(
          out, x, heightAt(x, z), z,
          // 【山牆對著路】房子的長軸順著路
          Math.atan2(tx, tz), 0.85 + ((g2 & 0xff) / 255) * 0.3,
          (hash1(g2) & 0xff) / 255,
          barn ? FloraKind.Barn : FloraKind.House,
        )
      }

      // ── 教堂 ────────────────────────────────────────
      if ((hs >>> 16) / 65536 >= CHURCH_CHANCE) continue
      for (let k = 0; k < 4; k++) {
        const kh = hash2(k, hs ^ 0xc47c)
        const along = ((kh / 4294967296) - 0.5) * 2 * 24
        const off = (LANE_OFFSET[0] + 6) * (((kh >>> 20) & 1) === 0 ? 1 : -1)
        const x = sx + tx * along - tz * off
        const z = sz + tz * along + tx * off
        if (!besideLane(x, z)) continue
        // 【這裡是 break 不是 continue】教堂就蓋在第一個合格的候選位上。
        // 改成 continue 的話，位置會取決於這一格 tile 切在哪裡
        if (x < x0 || x >= x1 || z < z0 || z >= z1) break
        pushFlora(out, x, heightAt(x, z), z, Math.atan2(tx, tz), 1, 0.5, FloraKind.Church)
        break
      }
    }
  }
}

/**
 * 島上的網格間距，m。400 棵/km² 的上限 —— 坡度會再往下壓。
 */
export const ISLAND_GRID = 50

/** tile 中心離島多遠就整格跳過，m */
const ISLAND_MARGIN = 200

/**
 * 群島的樹。
 *
 * 【判準是高度帶，不是坡度】實測群島的島很陡：草帶 16.24 km² 裡坡度 20°
 * 以內只有 0.60（3.7%），最大兩座島的平均坡是 29.5° 與 32.7°。用坡度篩會
 * 砍掉 95% 的地。坡度改成只壓密度 —— 接受機率乘 `cos(slope)`。
 *
 * 【只 import `isGrass`，不 import 任何高度常數】`world/archipelago.ts` 也有
 * 一個 `SHORE_BAND`，值是 200（烘岸距離），而顏色分帶那個是 12。看不到常數
 * 就沒有拿錯的機會 —— 見 `render/island.ts` 的 `GRASS_MIN_HEIGHT`。
 */
export function createIslandFlora(
  field: HeightFieldData, islands: readonly IslandDesc[],
): FloraSource {
  const cell = field.cell
  return (x0, z0, x1, z1, heightAt, out) => {
    // 【先整格早退】離任何一座島都遠的話，下面的網格一格都不必走
    const mx = (x0 + x1) / 2
    const mz = (z0 + z1) / 2
    const reach = Math.hypot(x1 - x0, z1 - z0) / 2 + ISLAND_MARGIN
    let near: IslandDesc | null = null
    let nearD = Infinity
    for (const isl of islands) {
      const d = Math.hypot(isl.cx - mx, isl.cz - mz)
      if (d - isl.outerRadius > reach) continue
      if (d < nearD) { nearD = d; near = isl }
    }
    if (near === null) return

    const g0 = Math.floor(x0 / ISLAND_GRID)
    const g1 = Math.floor(x1 / ISLAND_GRID)
    const h0 = Math.floor(z0 / ISLAND_GRID)
    const h1 = Math.floor(z1 / ISLAND_GRID)
    for (let gz = h0; gz <= h1; gz++) {
      for (let gx = g0; gx <= g1; gx++) {
        // 【位置只由全域索引決定】見檔頭的鐵律
        const hh = hash2(gx, gz ^ 0x1d7b)
        const x = (gx + 0.12 + (hh / 4294967296) * 0.76) * ISLAND_GRID
        const g = hash1(hh)
        const z = (gz + 0.12 + (g / 4294967296) * 0.76) * ISLAND_GRID
        if (x < x0 || x >= x1 || z < z0 || z >= z1) continue

        // 這一點最近的島 —— 峰高要拿它的
        let isl = near
        let bd = Infinity
        for (const o of islands) {
          const d = Math.hypot(o.cx - x, o.cz - z)
          if (d < bd) { bd = d; isl = o }
        }
        const h = field.sample(x, z)
        if (!isGrass(h, isl.peak)) continue

        // 【坡度只壓密度】陡的地方稀疏，但不是砍光
        const dx = (field.sample(x + cell, z) - field.sample(x - cell, z)) / (2 * cell)
        const dz = (field.sample(x, z + cell) - field.sample(x, z - cell)) / (2 * cell)
        const g2 = hash1(g)
        if (g2 / 4294967296 > 1 / Math.hypot(1, Math.hypot(dx, dz))) continue

        const g3 = hash1(g2)
        pushFlora(
          out, x, heightAt(x, z), z, (g3 / 4294967296) * Math.PI * 2,
          TREE_SCALE[0] + (hash1(g3) / 4294967296) * (TREE_SCALE[1] - TREE_SCALE[0]),
          (hash1(g3 ^ 0x3c1f) & 0xff) / 255, FloraKind.ConeTree,
        )
      }
    }
  }
}
