import { isGrass } from './island'
import { isLeyteGrass, type CanopyMap } from './leyteGround'
import { BROAD_CROWN_R, BUSH_R, CONE_CROWN_R } from './floraShapes'
import type { HeightFieldData } from '../world/heightfield'
import type { IslandDesc } from '../world/archipelago'
import { baseHeight, farUpland, isInBeachClearing, isInRoadClearing } from '../world/leyte'
import {
  edgeAt, fieldAt, isOpenParcel, isWoodField, openWoodCover, regionAt, regionParams, regionSeed, splitCut, valueNoise,
  villageDistance, FIELD_REACH, HEDGE_CHANCE, HEDGE_WIDTH, REGION_SPACING, TRACK_WIDTH, VILLAGE_CHANCE,
  VILLAGE_NEIGHBOUR,
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
 * 橫線、縱線，**以及對切線**。對切出來的那一刀也是樹籬，實測佔全部樹籬帶
 * 的 11.8%，而它不在任何一條格線上。只走格線的話，那些樹籬
 * 會畫在地上卻沒有樹 —— 貼地飛過去一眼看得出來。
 */

/** 一筆的欄位數：x, y, z, rotY, scale, tint */
export const FLORA_STRIDE = 6

/**
 * 植被的種類。**建築只有一種形狀**（`floraShapes.ts`），四種建築種類差的只是
 * 屋頂的料與牆色 —— 房子、穀倉、倉庫都用它，靠大小、樓高、顏色區分。
 */
export const enum FloraKind {
  BroadTree = 0,
  ConeTree = 1,
  Bush = 2,
  /** 新一點的黏土瓦、灰泥牆 */
  House = 3,
  /** 老黏土瓦（更暗）、磚木牆 */
  Barn = 4,
  Church = 5,
  /** 石板瓦、灰泥牆 */
  SlateHouse = 6,
  /** 油毛氈、磚木牆 */
  TarBarn = 7,
}

/**
 * 面寬與樓高的倍率怎麼存：一個位元組，`值 / SHAPE_ONE` 就是倍率（0～3.98）。
 * 樹一律是 1。
 *
 * 【為什麼是位元組不是浮點】tile 快取是 `MAX_PER_TILE × TILE_CACHE` 格，兩個
 * 浮點要多 6.4 MB，兩個位元組只多 1.6 MB；倍率只要 1/64 的精度。
 */
export const SHAPE_ONE = 64

/**
 * 一格 tile 的產出。**呼叫端預配、呼叫端歸零** —— 放置函數只 append，
 * 所以同一個 buffer 可以餵給好幾個來源。
 */
export interface FloraBuffer {
  readonly data: Float32Array
  readonly kind: Uint8Array
  /** 每一筆兩個位元組：面寬、樓高的倍率（見 `SHAPE_ONE`） */
  readonly shape: Uint8Array
  readonly capacity: number
  count: number
  /** 容量不足丟掉幾筆。**不得靜默截斷** —— 引擎會把它回報出去 */
  dropped: number
}

export function createFloraBuffer(capacity: number): FloraBuffer {
  return {
    data: new Float32Array(capacity * FLORA_STRIDE),
    kind: new Uint8Array(capacity),
    shape: new Uint8Array(capacity * 2),
    capacity,
    count: 0,
    dropped: 0,
  }
}

/** 倍率 → 位元組，夾在 1/64～3.98 */
function shapeByte(v: number): number {
  const q = Math.round(v * SHAPE_ONE)
  return q < 1 ? 1 : q > 255 ? 255 : q
}

/**
 * `wide` 是模型 x 軸（面寬）的額外倍率、`tall` 是 y 軸（樓高）的額外倍率，
 * 乘在 `scale` 之上；z 軸（進深）就是 `scale`。樹不給，兩者都是 1。
 */
export function pushFlora(
  out: FloraBuffer,
  x: number, y: number, z: number,
  rot: number, scale: number, tint: number, kind: FloraKind,
  wide = 1, tall = 1,
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
  out.shape[out.count * 2] = shapeByte(wide)
  out.shape[out.count * 2 + 1] = shapeByte(tall)
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

/**
 * 樹籬上兩棵喬木的間距，m。
 *
 * 【收緊過】15 m 時樹冠之間留六公尺的縫，一排樹讀起來是分開的點。
 */
export const HEDGE_TREE_SPACING = 12

/**
 * 樹籬上兩叢灌木的間距，m。
 *
 * **必須小於灌木的寬度**，相鄰兩叢才交疊成一條連續的帶 —— 而那條帶就是
 * bocage 的本體，喬木只是每隔十幾公尺插上去的一根。6 m 對 3.2 m 寬的灌木
 * 會留下三公尺的縫，整條樹籬因此讀起來是稀疏的一排小樹。
 */
export const HEDGE_BUSH_SPACING = 5

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
/**
 * 逐株的縮放。**上界是 1.0** —— 幾何本身就是最大的那一棵（喬木 30 m、
 * 灌木 8 m），抖動只往下走。
 */
const TREE_SCALE = [0.5, 1.0] as const
const BUSH_SCALE = [0.5, 1.0] as const

export function hash2(i: number, j: number): number {
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
const FLD: FieldSample = { id: 0, edge: 0, hedged: false, cx: 0, cz: 0 }
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
      // 【手寫開根號】V8 的 Math.hypot 每次呼叫都會配置
      const nx = SEED.x - cx
      const nz = SEED.z - cz
      dMin[k] = Math.sqrt(nx * nx + nz * nz)
      const fx = SEED.x - x0 > x1 - SEED.x ? x0 : x1
      const fz = SEED.z - z0 > z1 - SEED.z ? z0 : z1
      const ux = SEED.x - fx
      const uz = SEED.z - fz
      const dMax = Math.sqrt(ux * ux + uz * uz)
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
/** 這一次是「田圍著村」的地圖嗎：空地（`isOpenParcel`）的邊不長樹籬 */
let winOpen = false

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
    if (winOpen && isOpenParcel(FLD)) continue

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
  winOpen = false
  hedges(x0, z0, x1, z1, heightAt, out)
}

/** 「田圍著村」的地圖的樹籬：空地的邊不長（`fields.ts` 的 `FIELD_REACH`） */
export const openHedgeFlora: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
  // 【整格都是空地就整格跳過】空地的邊不長樹籬，而荒野裡的格一大片都是
  if (FLORA_FAST_PATHS.on && tileLandUse(x0, z0, x1, z1) === LAND_OPEN) return
  winOpen = true
  hedges(x0, z0, x1, z1, heightAt, out)
}

const hedges: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
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
  woods(false, x0, z0, x1, z1, heightAt, out)
}

/**
 * 「田圍著村」的地圖的樹林：田裡照 `farmWoodFlora`；空地（`isOpenParcel`）上照
 * `openWoodCover` 長成團的樹林，與地色同一個覆蓋率。空地的林子一部分是種的
 * 松林，針葉多一點
 */
export const openWoodFlora: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
  woods(true, x0, z0, x1, z1, heightAt, out)
}

/**
 * 整格判斷的開關。**只給測試用**：關掉之後每一格都走逐點的慢路徑，測試拿兩條
 * 路徑的輸出逐株比對
 */
export const FLORA_FAST_PATHS = { on: true }

/**
 * 這一格碰到的田裡**可能**有樹林田嗎（保守）。列出格子在每個候選區塊的座標系裡
 * 蓋到的列與欄（外擴一格），逐一看田的雜湊 —— 比逐點找田便宜兩個數量級，而多數
 * 的格一塊樹林田都沒有
 */
function tileMayHaveWood(x0: number, z0: number, x1: number, z1: number): boolean {
  candidateRegions(x0, z0, x1, z1)
  for (let ci = 0; ci < candCount; ci++) {
    const rid = CAND_ID[ci]! >>> 0
    regionParams(rid, REG)
    const cs = Math.cos(-REG.angle)
    const sn = Math.sin(-REG.angle)
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
    // 【照格線挑，不整片外擴】推移量小於半格，所以候選多看一格，再用真的格線位置
    // 篩掉沒蓋到的列與欄。整片外擴一格的話一格要看八十塊田，幾乎每一格都碰得到
    // 一塊樹林田，這道判斷等於沒有
    const rMin = Math.floor(qzMin / REG.cellH) - 1
    const rMax = Math.floor(qzMax / REG.cellH) + 1
    for (let r = rMin; r <= rMax; r++) {
      if (edgeAt(r + 1, REG.cellH, 1) <= qzMin || edgeAt(r, REG.cellH, 1) >= qzMax) continue
      const colSalt = (r * 2 + 1) | 0
      const cMin = Math.floor(qxMin / REG.cellW) - 1
      const cMax = Math.floor(qxMax / REG.cellW) + 1
      for (let c = cMin; c <= cMax; c++) {
        if (edgeAt(c + 1, REG.cellW, colSalt) <= qxMin || edgeAt(c, REG.cellW, colSalt) >= qxMax) continue
        // 與 `fieldAt` 同一個算法：格的雜湊、對切的兩半
        const cellHash = hash2(c ^ rid, r)
        if (isWoodField(hash1(cellHash)) || isWoodField(hash1(cellHash ^ 0x7f4a))) return true
      }
    }
  }
  return false
}

const LAND_MIXED = 0
const LAND_OPEN = 1
const LAND_FIELD = 2
/** 地塊的半對角線上限，m（最大的地塊約 290） */
const PARCEL_HALF_DIAG = 293

/** 方框的半對角線，m。植被一格（`TILE_SIZE` 250 m）是 177 */
function halfDiagonal(x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0
  const dz = z1 - z0
  return Math.sqrt(dx * dx + dz * dz) / 2
}

/**
 * 「田圍著村」的地圖上，這一格的地塊是不是**全部**是空地（或全部是田）。地塊用
 * 它的中心判斷，中心離格心最遠是格的半對角線加地塊的半對角線：格心離最近的村比
 * 田最遠伸到的地方還遠，整格一定是空地；比田最近的邊還近，整格一定是田
 */
function tileLandUse(x0: number, z0: number, x1: number, z1: number): number {
  const reach = halfDiagonal(x0, z0, x1, z1) + PARCEL_HALF_DIAG
  const d = villageDistance((x0 + x1) / 2, (z0 + z1) / 2)
  if (d - reach > FIELD_REACH * 1.3 * 1.2) return LAND_OPEN
  if (d + reach < FIELD_REACH * 0.7 * 0.8) return LAND_FIELD
  return LAND_MIXED
}

/**
 * 空地上的樹林：接受機率乘這個、縮放取這一段。
 *
 * 【稀一點、大一點】空地的林子佔地大，照田裡樹林的密度長的話，實測整張圖慢
 * 7～9%（多出來的全是樹的實例）。一半多一點的候選點、每棵取大的那一段，從空中
 * 看林冠一樣滿，實例數約少三成五
 */
const OPEN_WOOD_DENSITY = 0.55
const OPEN_TREE_SCALE = [0.8, 1.0] as const
/** 空地上的樹林裡針葉樹佔多少 */
const OPEN_CONIFER_SHARE = 0.3

/** 空地上的一個候選點：照 `openWoodCover` 決定長不長 */
function openTree(
  x: number, z: number, g: number, heightAt: (x: number, z: number) => number, out: FloraBuffer,
): void {
  const g2 = hash1(g)
  // 覆蓋率不超過 1：雜湊已經在密度上限之上的點不必算覆蓋率（兩層雜訊）
  const u = (g2 & 0xffff) / 65536
  if (u >= OPEN_WOOD_DENSITY || u >= openWoodCover(x, z) * OPEN_WOOD_DENSITY) return
  const g3 = hash1(g2)
  pushFlora(
    out, x, heightAt(x, z), z, (g3 / 4294967296) * Math.PI * 2,
    OPEN_TREE_SCALE[0] + ((g3 & 0xffff) / 65536) * (OPEN_TREE_SCALE[1] - OPEN_TREE_SCALE[0]),
    ((g2 >>> 16) & 0xff) / 255,
    ((g3 >>> 24) & 0xff) / 256 < OPEN_CONIFER_SHARE ? FloraKind.ConeTree : FloraKind.BroadTree,
  )
}

function woods(
  open: boolean, x0: number, z0: number, x1: number, z1: number,
  heightAt: (x: number, z: number) => number, out: FloraBuffer,
): void {
  // 【整格先判斷】逐點找區塊、找田是這一支的大宗（一格 244 點），而大多數的格用不到：
  // 田裡的樹林只長在樹林田，整格沒有樹林田就整格跳過；整格都是空地的話不必找田
  let land = LAND_MIXED
  let noTrack = false
  if (FLORA_FAST_PATHS.on) {
    land = open ? tileLandUse(x0, z0, x1, z1) : LAND_FIELD
    if (land === LAND_FIELD && !tileMayHaveWood(x0, z0, x1, z1)) return
    if (land === LAND_OPEN) {
      // `r2 − r1` 每走 1 m 最多變 2：格心離凹路夠遠，整格都碰不到凹路
      regionAt((x0 + x1) / 2, (z0 + z1) / 2, AT)
      noTrack = AT.r2 - AT.r1 - 2 * halfDiagonal(x0, z0, x1, z1) > TRACK_WIDTH
    }
  }
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
      if (land === LAND_OPEN) {
        if (!noTrack) {
          regionAt(x, z, AT)
          if (AT.r2 - AT.r1 < TRACK_WIDTH) continue
        }
        openTree(x, z, g, heightAt, out)
        continue
      }
      regionAt(x, z, AT)
      if (AT.r2 - AT.r1 < TRACK_WIDTH) continue
      fieldAt(x, z, AT, FLD)
      if (open && isOpenParcel(FLD)) {
        openTree(x, z, g, heightAt, out)
        continue
      }
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
 * 【不要放大】140 m 會讓十來棟房子沿路拉開近三百公尺，從空中看是散落的
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
/** 穀倉的面寬與樓高倍率（建築只有一種形狀，見 `floraShapes.ts`） */
const BARN_WIDE = 1.6
const BARN_TALL = 1.3

const SEED_A: Vec2 = { x: 0, z: 0 }
const SEED_B: Vec2 = { x: 0, z: 0 }

/**
 * 配對的鄰格（`VILLAGE_NEIGHBOUR`，與田色共用）。**只往 +x 與 +z，不往回**。
 *
 * 【為什麼不能四個方向都來】(i, j) 選 +x、(i+1, j) 選 −x 的話，兩格算出來
 * 是**同一個中點** —— 同一個村會被生兩次，而且兩份建築完全重疊。只往前配對
 * 之後，一對格子只可能由較小的那一格產生。
 */
const NEIGHBOUR = VILLAGE_NEIGHBOUR

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
          // 【屋脊順著路】
          Math.atan2(tx, tz), 0.85 + ((g2 & 0xff) / 255) * 0.3,
          (hash1(g2) & 0xff) / 255,
          barn ? FloraKind.Barn : FloraKind.House,
          // 【穀倉是拉寬拉高的同一個形狀】面寬約 1.6 倍、高 1.3 倍
          barn ? BARN_WIDE : 1, barn ? BARN_TALL : 1,
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
 * 島上的網格間距，m。**一格最多一棵樹加一叢灌木。**
 *
 * 【這是叢內的密度】`1e6 / grid²` 是上限，13 m 是 5,917 株/km²；叢外由
 * `islandClump` 壓到 5%，所以整座島的總數比均勻鋪法少，叢內卻更密。
 * 要通過高度帶（`isGrass`）、坡度、高度、叢四關才長得出來。
 *
 * 【面積密度是它的平方反比】改它就要回頭看 `ISLAND_MAX_PER_TILE`：一格
 * 250 m 的 tile 放得下幾個網格由它決定。掃描表在
 * `test/tools/island-density.probe.ts`。
 */
export const ISLAND_GRID = 13.0

/** tile 中心離島多遠就整格跳過，m */
const ISLAND_MARGIN = 200

/**
 * 海邊的植被密度相對山頂。山頂是 1.0，密度沿高度線性插到這個值。
 *
 * 【為什麼要有落差】整座島同一個密度看起來像一塊綠地毯。山頂密、山腳疏，
 * 高度差才讀得出來。**山頂是滿密度** —— 這一條只往下壓。
 */
export const ISLAND_SHORE_DENSITY = 0.15

/**
 * 樹叢的尺度，m：值雜訊的格距。叢的直徑大約是它的一到兩倍。
 *
 * 【為什麼要成叢】逐格獨立抽樣鋪出來的是均勻的一層絨毛，整個山頭都是樹；
 * 真的山是一撮一撮的林子夾著空地。叢是一張與 tile 無關的低頻遮罩乘在
 * 接受率上，所以島上「哪裡有林子」是全域決定的，tile 的切法改不了它。
 */
export const ISLAND_CLUMP_CELL = 110
/**
 * 叢的門檻：值雜訊低於下界是空地、高於上界是叢內，中間平滑過渡。
 *
 * 兩個尺度的值雜訊相加後平均 0.5、標準差約 0.2，這一組讓四成上下的地
 * 落在叢內、兩成在邊緣。
 */
const ISLAND_CLUMP_GATE = [0.42, 0.58] as const
/**
 * 叢外殘留的密度。不是 0 —— 空地上零星幾棵樹才像林緣，全空是草皮。
 */
export const ISLAND_CLUMP_FLOOR = 0.05

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export { valueNoise }

/**
 * 這一點在不在樹叢裡，`ISLAND_CLUMP_FLOOR`～1。
 *
 * 兩個尺度：大的定叢的位置，小的把邊緣弄毛 —— 單一尺度的叢是一顆顆圓斑。
 */
export function islandClump(x: number, z: number): number {
  const n = 0.65 * valueNoise(x, z, ISLAND_CLUMP_CELL, 0x6f3a)
    + 0.35 * valueNoise(x, z, ISLAND_CLUMP_CELL * 0.45, 0x1b9c)
  return ISLAND_CLUMP_FLOOR
    + (1 - ISLAND_CLUMP_FLOOR) * smoothstep(ISLAND_CLUMP_GATE[0], ISLAND_CLUMP_GATE[1], n)
}

/**
 * 灌木相對樹的接受機率。
 *
 * 【為什麼要有灌木】樹之間的地是空的，低空掠過時看得到一格一格的間隙。
 * 灌木補在同一格的另一個抽樣點上，吃同一條高度與坡度的門檻。
 */
export const ISLAND_BUSH_RATIO = 0.7

/**
 * 一個候選點的接受機率。**放置與地色共用這一支** —— 見
 * `islandCanopyCover`。
 *
 * 【坡度只壓密度】陡的地方稀疏，但不是砍光 —— 乘 `cos(slope)`。實測群島的
 * 島很陡：草帶 16.24 km² 裡坡度 20° 以內只有 3.7%，用坡度當門檻會砍掉
 * 95% 的地。
 *
 * 【高度只壓密度】山頂 1.0，海邊 `ISLAND_SHORE_DENSITY`，尺是 `h / peak`。
 *
 * 【叢是乘上去的】高度與坡度決定「這一帶能多密」，叢決定「這一點在不在
 * 林子裡」。乘法讓山頂的叢比山腳的叢密，而叢外到處一樣疏。
 *
 * 【坡度要在植株自己的位置上取】格中心離它最遠 7 m，那個距離足以把坡度與
 * 密度的相關性抹平。
 */
export function islandAccept(
  field: HeightFieldData, peak: number, x: number, z: number, h: number,
): number {
  const cell = field.cell
  const dx = (field.sample(x + cell, z) - field.sample(x - cell, z)) / (2 * cell)
  const dz = (field.sample(x, z + cell) - field.sample(x, z - cell)) / (2 * cell)
  return (ISLAND_SHORE_DENSITY + (1 - ISLAND_SHORE_DENSITY)
    * Math.min(1, Math.max(0, h / peak))) * islandClump(x, z)
    / Math.hypot(1, Math.hypot(dx, dz))
}

/**
 * 逐株縮放均勻分佈於 `[0.5, 1]`，所以 `E[s²] = 2∫s²ds = 7/12`。
 * 面積吃的是半徑的平方，所以要的是這個而不是 `E[s]²`。
 */
const E_SCALE2 = 7 / 12
/** 一格裡一株樹的期望樹冠面積，m² */
const CONE_AREA = Math.PI * CONE_CROWN_R * CONE_CROWN_R * E_SCALE2
/** 一格裡一叢灌木的期望樹冠面積，m²。乘上它自己的接受比 */
const BUSH_AREA = Math.PI * BUSH_R * BUSH_R * E_SCALE2 * ISLAND_BUSH_RATIO

/**
 * 這一點的地被樹冠遮住多少，0～1。**島的地色按它上色。**
 *
 * 【為什麼地要先帶上林相】`FLORA_RADIUS` 外一棵都不畫，而地色比樹冠亮很多
 * —— 飛進圈的瞬間整座島同時變暗變花。地先按實際被遮住的面積比調暗，樹進圈
 * 就只是加上質感。
 *
 * 【與放置同源】機率讀的是 `islandAccept`，不是另外湊一條。兩份會漂，而症狀
 * 是「地的顏色說有森林，實際卻是光禿的」。
 *
 * 【要的是聯集，不是面積和】樹冠會互相重疊。名目強度 λ 的實際遮蔽是
 * `1 − e^(−λ)` —— λ = 0.35 時是 0.295，差五個半百分點。直接相加會讓遠處的
 * 地色比實際的林相暗。
 */
export function islandCanopyCover(
  field: HeightFieldData, islands: readonly IslandDesc[],
): (x: number, z: number) => number {
  return (x, z) => {
    const h = field.sample(x, z)
    if (!isGrass(h)) return 0
    let peak = islands[0]!.peak
    let bd = Infinity
    for (const o of islands) {
      const d = Math.hypot(o.cx - x, o.cz - z)
      if (d < bd) { bd = d; peak = o.peak }
    }
    const lambda = (islandAccept(field, peak, x, z, h) * (CONE_AREA + BUSH_AREA))
      / (ISLAND_GRID * ISLAND_GRID)
    return 1 - Math.exp(-lambda)
  }
}

/**
 * 群島的樹與灌木。
 *
 * 【接受機率在 `islandAccept`】坡度與高度都只壓密度，不當門檻。地色那一側
 * 也讀同一支 —— 兩份會漂，而症狀是「地的顏色說有森林，實際卻是光禿的」。
 *
 * 【樹與灌木共用一格】兩者在同一格裡各自抽一個位置、各自抽一次接受 ——
 * 所以灌木不是「沒長樹的地方」，兩者會混在一起。共用高度與坡度的那一趟
 * 取樣是為了成本：一格因此只多兩次 `field.sample`。
 *
 * 【只 import `isGrass`，不 import 任何高度常數】`world/archipelago.ts` 也有
 * 一個 `SHORE_BAND`，值是 200（烘岸距離），而顏色分帶那個是 12。看不到常數
 * 就沒有拿錯的機會 —— 見 `render/island.ts` 的 `GRASS_MIN_HEIGHT`。
 */
export function createIslandFlora(
  field: HeightFieldData, islands: readonly IslandDesc[],
): FloraSource {
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
        // 【最近的島用格中心找】它只提供峰高（密度斜線的尺），而同一格的
        // 兩個候選點最遠只差 7 m —— 找一次，兩者共用
        const cx = (gx + 0.5) * ISLAND_GRID
        const cz = (gz + 0.5) * ISLAND_GRID
        let isl = near
        let bd = Infinity
        for (const o of islands) {
          const d = Math.hypot(o.cx - cx, o.cz - cz)
          if (d < bd) { bd = d; isl = o }
        }

        // ── 樹 ──────────────────────────────────────────
        // 【位置只由全域索引決定】見檔頭的鐵律
        const hh = hash2(gx, gz ^ 0x1d7b)
        const x = (gx + 0.12 + (hh / 4294967296) * 0.76) * ISLAND_GRID
        const g = hash1(hh)
        const z = (gz + 0.12 + (g / 4294967296) * 0.76) * ISLAND_GRID
        const g2 = hash1(g)
        // 【兩個候選各自過邊界】共用一個 `continue` 的話，樹落在格外時會把
        // 灌木一起吃掉 —— 症狀是切法不同結果就不同
        if (x >= x0 && x < x1 && z >= z0 && z < z1) {
          const h = field.sample(x, z)
          if (isGrass(h) && g2 / 4294967296 <= islandAccept(field, isl.peak, x, z, h)) {
            const g3 = hash1(g2)
            pushFlora(
              out, x, heightAt(x, z), z, (g3 / 4294967296) * Math.PI * 2,
              TREE_SCALE[0] + (hash1(g3) / 4294967296) * (TREE_SCALE[1] - TREE_SCALE[0]),
              (hash1(g3 ^ 0x3c1f) & 0xff) / 255, FloraKind.ConeTree,
            )
          }
        }

        // ── 同一格的灌木 ────────────────────────────────
        // 【位置另外抽】與樹同一格但不同點，所以兩者會混在一起
        const bh = hash2(gx ^ 0x5ac3, gz)
        const bx = (gx + 0.12 + (bh / 4294967296) * 0.76) * ISLAND_GRID
        const bg = hash1(bh)
        const bz = (gz + 0.12 + (bg / 4294967296) * 0.76) * ISLAND_GRID
        if (bx < x0 || bx >= x1 || bz < z0 || bz >= z1) continue
        // 【高度要在灌木自己的位置上取】水線是硬分界，借樹的高度會讓灌木
        // 長到沙灘上
        const bhh = field.sample(bx, bz)
        if (!isGrass(bhh)) continue
        const b2 = hash1(bg)
        if (b2 / 4294967296 > islandAccept(field, isl.peak, bx, bz, bhh) * ISLAND_BUSH_RATIO) continue
        const b3 = hash1(b2)
        pushFlora(
          out, bx, heightAt(bx, bz), bz, (b3 / 4294967296) * Math.PI * 2,
          BUSH_SCALE[0] + (hash1(b3) / 4294967296) * (BUSH_SCALE[1] - BUSH_SCALE[0]),
          (hash1(b3 ^ 0x71a5) & 0xff) / 255, FloraKind.Bush,
        )
      }
    }
  }
}

/**
 * 雷伊泰平地上的密度相對丘陵頂。**平地的樹少** —— 平地取代了水田，看起來
 * 該是開闊地夾著零星的林子。**起始值，由試飛裁定。**
 */
export const LEYTE_PLAIN_DENSITY = 0.08
/**
 * 丘陵上的密度上限。**不是 1**：丘陵又大又多，滿密度的話植被池要配到六十萬個
 * 實例（約 90 MB）。六成之下山坡仍然是林子 —— 地色讀同一個接受率，遠看一樣暗。
 */
export const LEYTE_HILL_DENSITY = 0.6
/** 高出基準面這麼多就到丘陵的密度，m。丘陵的山腰往上是林子 */
const LEYTE_HILL_FULL = 40

/**
 * 雷伊泰一個候選點的接受機率。**不超過 `LEYTE_HILL_DENSITY`** —— 叢遮罩 ≤ 1、
 * 坡度只除不乘；`createLeyteFlora` 靠這個上限先擋掉大部分候選，改式子時要守住。
 *
 * 沙灘與公路清空帶是 0；平地是 `LEYTE_PLAIN_DENSITY`；高出基準面
 * `LEYTE_HILL_FULL` 就是 `LEYTE_HILL_DENSITY`。再乘上成叢遮罩、除以坡度（同群島）。
 *
 * 【清空帶讀 `isInRoadClearing`】路的座標只有 `LEYTE_ROADS` 一份 —— 路面
 * 與這裡讀的是同一組折線，車隊走的是其中第 0 條。
 */
export function leyteAccept(field: HeightFieldData, x: number, z: number, h: number): number {
  if (!isLeyteGrass(h)) return 0
  if (isInRoadClearing(x, z) || isInBeachClearing(x, z)) return 0
  const cell = field.cell
  const dx = (field.sample(x + cell, z) - field.sample(x - cell, z)) / (2 * cell)
  const dz = (field.sample(x, z + cell) - field.sample(x, z - cell)) / (2 * cell)
  // 【高出的是丘陵，不是平地的緩坡】量的是比這一點的基準面高多少
  const up = Math.min(1, Math.max(0, (h - baseHeight(x, z)) / LEYTE_HILL_FULL))
  return (LEYTE_PLAIN_DENSITY + (LEYTE_HILL_DENSITY - LEYTE_PLAIN_DENSITY) * up) * islandClump(x, z)
    / Math.hypot(1, Math.hypot(dx, dz))
}

/** 一格裡一株闊葉樹的期望樹冠面積，m² */
const BROAD_AREA = Math.PI * BROAD_CROWN_R * BROAD_CROWN_R * E_SCALE2

/**
 * 粗的樹冠圖：一格一個高度場格子，值是那裡的**期望**覆蓋率（與
 * `islandCanopyCover` 同一個算法）。開場先用它，`bakeLeyteCanopy` 在背景烘好
 * 之後換掉 —— 換之前林子是一片平均的暗綠，換之後是一株一株的。
 */
export function leyteCanopyCoarse(field: HeightFieldData): CanopyMap {
  const size = field.size - 1
  const half = (size * field.cell) / 2
  const data = new Uint8Array(size * size)
  for (let row = 0; row < size; row++) {
    const z = -half + (row + 0.5) * field.cell
    for (let col = 0; col < size; col++) {
      const x = -half + (col + 0.5) * field.cell
      const lambda = (leyteAccept(field, x, z, field.sample(x, z)) * (BROAD_AREA + BUSH_AREA))
        / (ISLAND_GRID * ISLAND_GRID)
      data[row * size + col] = Math.round((1 - Math.exp(-lambda)) * 255)
    }
  }
  return { data, size, half, texel: field.cell }
}

/** 成叢遮罩的平均值。第一次用到才量：64 × 64 點、37 m 一格，蓋二十幾個叢 */
let clumpMean = -1
function meanClump(): number {
  if (clumpMean >= 0) return clumpMean
  let s = 0
  for (let i = 0; i < 64; i++) for (let j = 0; j < 64; j++) s += islandClump(i * 37 + 5, j * 37 + 11)
  clumpMean = s / 4096
  return clumpMean
}

/**
 * 場外遠景陸地的期望樹冠覆蓋率，0～1。與場內同一套密度（平地疏、山上是山林
 * 的密度）與同一個樹冠面積，所以兩邊平均起來一樣暗。「在不在山上」讀
 * `farUpland`。
 *
 * 【叢取平均值】遠景的頂點 500 m 一個，叢才 110 m —— 逐點取的話只是雜訊。
 * 一株一株的質感由地面的 shader 補（`render/leyteGround.ts`）。
 *
 * @param h 這一點的遠景高度（`farHeight`）
 */
export function leyteFarCover(x: number, z: number, h: number): number {
  if (!isLeyteGrass(h)) return 0
  const up = farUpland(x, z)
  const accept = (LEYTE_PLAIN_DENSITY + (LEYTE_HILL_DENSITY - LEYTE_PLAIN_DENSITY) * up) * meanClump()
  return 1 - Math.exp(-(accept * (BROAD_AREA + BUSH_AREA)) / (ISLAND_GRID * ISLAND_GRID))
}

/** 樹冠圖一格幾公尺。樹冠半徑 5～10 m，一株落在一到幾格 */
const CANOPY_TEXEL = 8
/** 烘焙時一次跑多大一塊，m。只影響暫存緩衝的大小 */
const CANOPY_CHUNK = 400

/**
 * 把場地裡**每一株**闊葉樹與灌木的樹冠印成一張俯視圖，給地面的 shader 畫
 * （`render/leyteGround.ts`）。**載入期跑一次。**
 *
 * 【為什麼】立體的樹只生成到 `FLORA_RADIUS`，更遠的林子原本只有頂點色的
 * 平均暗綠（80 m 一格），樹跑進範圍時是憑空冒出來的。這張圖的每一個暗點
 * 就是那一株真的樹：**走的是同一支 `createLeyteFlora`**，位置、接受率、
 * 大小完全相同 —— 樹進入範圍時是長在自己的暗點上。
 *
 * 【一株的份量守恆】樹冠面積照「離圓心多近」分給周圍幾格，再縮放到總和
 * 等於樹冠面積 —— 比一格還小的灌木也只加它自己那麼多，不會整格塗滿。
 * 同一格疊到滿就停在 255。
 *
 * 【整張場地要跑兩秒多】**在背景執行緒跑**（`render/canopyBake.ts`），主執行緒
 * 不得直接呼叫 —— 會卡住畫面。
 */
export function bakeLeyteCanopy(field: HeightFieldData): CanopyMap {
  const half = ((field.size - 1) * field.cell) / 2
  const size = Math.round((2 * half) / CANOPY_TEXEL)
  const texel = (2 * half) / size
  const data = new Uint8Array(size * size)
  const source = createLeyteFlora(field)
  const buf = createFloraBuffer(8192)
  const heightAt = (): number => 0
  const w = new Float32Array(64)
  for (let z0 = -half; z0 < half; z0 += CANOPY_CHUNK) {
    for (let x0 = -half; x0 < half; x0 += CANOPY_CHUNK) {
      buf.count = 0
      buf.dropped = 0
      source(x0, z0, Math.min(half, x0 + CANOPY_CHUNK), Math.min(half, z0 + CANOPY_CHUNK), heightAt, buf)
      for (let k = 0; k < buf.count; k++) {
        const o = k * FLORA_STRIDE
        const x = buf.data[o]!
        const z = buf.data[o + 2]!
        const r = (buf.kind[k] === FloraKind.Bush ? BUSH_R : BROAD_CROWN_R) * buf.data[o + 4]!
        // 樹冠圓涵蓋的格子，每格依「格心離圓心多近」給一個權重
        const u = (x + half) / texel - 0.5
        const v = (z + half) / texel - 0.5
        const rt = r / texel
        const c0 = Math.max(0, Math.floor(u - rt))
        const c1 = Math.min(size - 1, Math.ceil(u + rt))
        const r0 = Math.max(0, Math.floor(v - rt))
        const r1 = Math.min(size - 1, Math.ceil(v + rt))
        let sum = 0
        let n = 0
        for (let row = r0; row <= r1; row++) {
          for (let col = c0; col <= c1; col++) {
            const wt = Math.min(1, Math.max(0, rt + 0.5 - Math.hypot(col - u, row - v)))
            if (n < w.length) w[n] = wt
            sum += wt
            n++
          }
        }
        if (sum <= 0 || n > w.length) continue
        const scale = (Math.PI * rt * rt) / sum
        n = 0
        for (let row = r0; row <= r1; row++) {
          for (let col = c0; col <= c1; col++) {
            const add = Math.round(w[n++]! * scale * 255)
            const i = row * size + col
            data[i] = Math.min(255, data[i]! + add)
          }
        }
      }
    }
  }
  return { data, size, half, texel }
}

/**
 * 雷伊泰的闊葉樹與灌木。**網格走法與 `createIslandFlora` 相同**：一格一棵樹
 * 加一叢灌木的候選，座標只由全域索引決定（檔頭的鐵律）。
 *
 * 【整格早退】tile 的四角與中心全部是沙灘或海就跳過。一片陸地伸進 tile 中間
 * 而五個取樣點都落在水裡的情形只丟掉幾棵岸邊的樹。
 */
export function createLeyteFlora(field: HeightFieldData): FloraSource {
  return (x0, z0, x1, z1, heightAt, out) => {
    const mx = (x0 + x1) / 2
    const mz = (z0 + z1) / 2
    if (
      !isLeyteGrass(field.sample(x0, z0)) && !isLeyteGrass(field.sample(x1, z0))
      && !isLeyteGrass(field.sample(x0, z1)) && !isLeyteGrass(field.sample(x1, z1))
      && !isLeyteGrass(field.sample(mx, mz))
    ) return

    const g0 = Math.floor(x0 / ISLAND_GRID)
    const g1 = Math.floor(x1 / ISLAND_GRID)
    const h0 = Math.floor(z0 / ISLAND_GRID)
    const h1 = Math.floor(z1 / ISLAND_GRID)
    for (let gz = h0; gz <= h1; gz++) {
      for (let gx = g0; gx <= g1; gx++) {
        // ── 樹 ──────────────────────────────────────────
        const hh = hash2(gx, gz ^ 0x1d7b)
        const x = (gx + 0.12 + (hh / 4294967296) * 0.76) * ISLAND_GRID
        const g = hash1(hh)
        const z = (gz + 0.12 + (g / 4294967296) * 0.76) * ISLAND_GRID
        const g2 = hash1(g)
        // 【兩個候選各自過邊界】理由同 `createIslandFlora`
        // 【雜湊先比上限】接受率不會超過 `LEYTE_HILL_DENSITY`，雜湊超過它的候選
        // 一定不長 —— 先擋掉就不用算接受率。結果逐位元相同，只是省時間
        if (x >= x0 && x < x1 && z >= z0 && z < z1 && g2 / 4294967296 < LEYTE_HILL_DENSITY) {
          const h = field.sample(x, z)
          // 【嚴格小於】接受率 0（清空帶、沙灘）時雜湊剛好是 0 也不長
          if (g2 / 4294967296 < leyteAccept(field, x, z, h)) {
            const g3 = hash1(g2)
            pushFlora(
              out, x, heightAt(x, z), z, (g3 / 4294967296) * Math.PI * 2,
              TREE_SCALE[0] + (hash1(g3) / 4294967296) * (TREE_SCALE[1] - TREE_SCALE[0]),
              (hash1(g3 ^ 0x3c1f) & 0xff) / 255, FloraKind.BroadTree,
            )
          }
        }

        // ── 同一格的灌木 ────────────────────────────────
        const bh = hash2(gx ^ 0x5ac3, gz)
        const bx = (gx + 0.12 + (bh / 4294967296) * 0.76) * ISLAND_GRID
        const bg = hash1(bh)
        const bz = (gz + 0.12 + (bg / 4294967296) * 0.76) * ISLAND_GRID
        if (bx < x0 || bx >= x1 || bz < z0 || bz >= z1) continue
        const b2 = hash1(bg)
        if (b2 / 4294967296 >= LEYTE_HILL_DENSITY * ISLAND_BUSH_RATIO) continue
        const bhh = field.sample(bx, bz)
        if (b2 / 4294967296 >= leyteAccept(field, bx, bz, bhh) * ISLAND_BUSH_RATIO) continue
        const b3 = hash1(b2)
        pushFlora(
          out, bx, heightAt(bx, bz), bz, (b3 / 4294967296) * Math.PI * 2,
          BUSH_SCALE[0] + (hash1(b3) / 4294967296) * (BUSH_SCALE[1] - BUSH_SCALE[0]),
          (hash1(b3 ^ 0x71a5) & 0xff) / 255, FloraKind.Bush,
        )
      }
    }
  }
}
