import {
  edgeAt, fieldAt, regionAt, regionParams, regionSeed, splitCut,
  HEDGE_CHANCE, HEDGE_WIDTH, REGION_SPACING,
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

/** 這條樹籬種什麼樹。**逐線決定，不是逐棵** —— 整排同種才讀得出防風林 */
function speciesOf(lineKey: number): FloraKind {
  return (hash1(lineKey ^ 0x5bd1) & 1) === 0 ? FloraKind.BroadTree : FloraKind.ConeTree
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
