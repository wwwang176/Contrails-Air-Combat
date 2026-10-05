import {
  edgeAt, fieldAt, isOpenParcel, isWoodField, onTrack, openWoodCover, regionAt, regionParams,
  regionSeed, splitCut, BELT_CHANCE, steppeEdgeAt, steppeRegionParams, trackGap, trackWidthAt,
  villageDistance, FIELD_REACH, HEDGE_CHANCE, HEDGE_WIDTH, REGION_SPACING, TRACK_WARP_MAX,
  TRACK_WIDTH, TRACK_WIDTH_MAX, VILLAGE_CHANCE, VILLAGE_NEIGHBOUR, CONIFER_SHARE,
  OPEN_CONIFER_SHARE, OPEN_TREE_SCALE, OPEN_WOOD_DENSITY, OPEN_WOOD_GATE, WOOD_GRID,
  type FieldSample, type RegionSample, type SplitCut, type Vec2,
} from './fields'
import {
  FloraKind, type FloraBuffer, createFloraBuffer, pushFlora, type FloraSource,
} from '../core/floraBuffer'
import { TREE_SCALE, BUSH_SCALE } from '../specs/flora'
import { hash2, hash1 } from '../core/hash'

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

/** 沿線抖動的幅度，佔間距的比例。必須 < 0.5，否則相鄰兩株會交換次序 */
const ALONG_JITTER = 0.3

/** 側向抖動的半幅，m。樹籬帶是 ±9 m，所以這個要小得多 */
const SIDE_JITTER = 3

const REG: RegionSample = {
  r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}

const AT: RegionSample = {
  r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
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

/** 這一次一條田界長樹籬的機率（季節的 `hedgeChance`）。見 `hedged` */
let winHedge: number = HEDGE_CHANCE

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
    fieldAt(x, z, AT, FLD, winHedge)
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
  return hash1(lineKey) / 4294967296 < winHedge
}

/**
 * 這條樹籬（或這一塊樹林田）種什麼樹。**逐線決定，不是逐棵** —— 整排同種才讀得出
 * 防風林。比例見 `fields.ts` 的 `CONIFER_SHARE`
 */
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
  winHedge = HEDGE_CHANCE
  hedges(x0, z0, x1, z1, heightAt, out)
}

/** 「田圍著村」的地圖的樹籬：空地的邊不長（`fields.ts` 的 `FIELD_REACH`） */
export const openHedgeFlora: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
  // 【整格都是空地就整格跳過】空地的邊不長樹籬，而荒野裡的格一大片都是
  if (FLORA_FAST_PATHS.on && tileLandUse(x0, z0, x1, z1) === LAND_OPEN) return
  winOpen = true
  winHedge = HEDGE_CHANCE
  hedges(x0, z0, x1, z1, heightAt, out)
}

/**
 * 同 `openHedgeFlora`，一條田界長樹籬的機率由季節給（`FieldColors.hedgeChance`）。
 * **與地色傳同一份**。預設值就回原本那一支
 */
export function openHedgeFloraFor(chance: number): FloraSource {
  if (chance === HEDGE_CHANCE) return openHedgeFlora
  return (x0, z0, x1, z1, heightAt, out) => {
    if (FLORA_FAST_PATHS.on && tileLandUse(x0, z0, x1, z1) === LAND_OPEN) return
    winOpen = true
    winHedge = chance
    hedges(x0, z0, x1, z1, heightAt, out)
  }
}

/** 林帶分段的長度，m：缺口與濃度都以段為單位 */
export const BELT_SEGMENT = 90

/** 一段有樹的機率；其餘是缺口 */
export const BELT_SEGMENT_KEEP = 0.85

/** 三排交錯的沿線間距，m：同一排每隔兩棵，所以一排的間距是這個的三倍 */
export const BELT_TREE_SPACING = 3.5

/** 相鄰兩排之間的距離，m */
export const BELT_ROW_GAP = 5

/** 林帶的樹縮放：人工林帶的樹不老，比野生的矮（1.0 是 30 m） */
export const BELT_TREE_SCALE = [0.45, 0.7] as const

/** 樹離村的站址至少多遠，m：村的房子與菜園自己種樹，林帶不蓋上去 */
export const BELT_VILLAGE_CLEAR = 500

/** 樹離凹路的路緣至少多遠，m：縱隊走路，樹冠（半徑 4～6 m）不蓋到路面 */
export const BELT_ROAD_CLEAR = 10

/** 側向抖動的半幅，m */
const BELT_SIDE_JITTER = 1.2

/**
 * 有林帶的段裡有多少比例長成小樹林：這一段不種三排的帶，改成一團橢圓形的林子（兩端窄、
 * 中間寬），隨機散佈、枝葉交疊，從空中讀起來是一塊林地而不是一條線
 */
export const BELT_GROVE_CHANCE = 0.14

/** 小樹林裡沿線的候選間距，m（側向隨機，所以 90 m 長的一段約 60 棵） */
export const BELT_GROVE_SPACING = 1.5

/** 小樹林最寬處的半寬，m */
export const BELT_GROVE_HALF = 14

/** 小樹林的樹縮放：自然長大的，比人工林帶高 */
export const BELT_GROVE_SCALE = [0.5, 0.85] as const

/** 小樹林裡針葉樹的比例，逐段決定 */
const BELT_GROVE_CONE = 0.25

let beltFade: (x: number, z: number) => number = () => 1

/**
 * 林帶某一段的狀態：0 缺口、1 三排的林帶、2 小樹林。**只由這一段的身分與段中心的濃度
 * 決定**，與 tile 切在哪裡無關
 */
function beltSegment(axis: number, at: number, seg: number, lineKey: number): number {
  const tc = (seg + 0.5) * BELT_SEGMENT
  const cx = axis === 0 ? at : tc
  const cz = axis === 0 ? tc : at
  const fade = beltFade(cx * winCos - cz * winSin, cx * winSin + cz * winCos)
  if (fade <= 0 || hash2(seg, lineKey ^ 0x5e61) / 4294967296 >= BELT_SEGMENT_KEEP * fade) return 0
  return hash2(seg, lineKey ^ 0x9a07) / 4294967296 < BELT_GROVE_CHANCE ? 2 : 1
}

/**
 * 這一點能不能種樹：在這一格 tile 裡、屬於我正在走的那一區、不壓在凹路上、離村夠遠
 *
 * 【驗證比的是「我正在走的那一區」】同 `walkLine`
 */
function beltSpotOk(x: number, z: number): boolean {
  if (x < winX0 || x >= winX1 || z < winZ0 || z >= winZ1) return false
  regionAt(x, z, AT)
  if (AT.id !== winRid) return false
  if (trackGap(x, z, AT) < trackWidthAt(x, z) + BELT_ROAD_CLEAR) return false
  return villageDistance(x, z) >= BELT_VILLAGE_CLEAR
}

/**
 * 沿一條田界種一條林帶，其中幾段長成小樹林。`axis`、`at`、`lo`、`hi` 同 `walkLine`；
 * `lineKey` 是這條線的身分
 */
function plantBelt(axis: number, at: number, lo: number, hi: number, lineKey: number): void {
  if (hi <= lo) return
  if (hash1(lineKey ^ 0x2be1) / 4294967296 >= BELT_CHANCE) return
  const kind = speciesOf(lineKey)
  const m0 = Math.floor(lo / BELT_TREE_SPACING) - 1
  const m1 = Math.floor(hi / BELT_TREE_SPACING) + 1
  for (let m = m0; m <= m1; m++) {
    const h = hash2(m, lineKey)
    const t = (m + 0.5 + ((h / 4294967296) - 0.5) * 2 * ALONG_JITTER) * BELT_TREE_SPACING
    if (t < lo || t >= hi) continue
    if (beltSegment(axis, at, Math.floor(t / BELT_SEGMENT), lineKey) !== 1) continue

    const g = hash1(h)
    const row = (((m % 3) + 3) % 3) - 1
    const side = row * BELT_ROW_GAP + ((g / 4294967296) - 0.5) * 2 * BELT_SIDE_JITTER
    const x = (axis === 0 ? at + side : t) * winCos - (axis === 0 ? t : at + side) * winSin
    const z = (axis === 0 ? at + side : t) * winSin + (axis === 0 ? t : at + side) * winCos
    if (!beltSpotOk(x, z)) continue

    const g2 = hash1(g)
    const g3 = hash1(g2)
    pushFlora(
      winOut, x, winHeight(x, z), z, (g2 / 4294967296) * Math.PI * 2,
      BELT_TREE_SCALE[0] + (g3 / 4294967296) * (BELT_TREE_SCALE[1] - BELT_TREE_SCALE[0]),
      (hash1(g3) & 0xff) / 255, kind,
    )
  }

  // 小樹林：候選點沿線密排，側向在橢圓形的範圍裡隨機取
  const n0 = Math.floor(lo / BELT_GROVE_SPACING) - 1
  const n1 = Math.floor(hi / BELT_GROVE_SPACING) + 1
  for (let n = n0; n <= n1; n++) {
    const h = hash2(n, lineKey ^ 0x6e07)
    const t = (n + 0.5 + ((h / 4294967296) - 0.5) * 2 * ALONG_JITTER) * BELT_GROVE_SPACING
    if (t < lo || t >= hi) continue
    const seg = Math.floor(t / BELT_SEGMENT)
    if (beltSegment(axis, at, seg, lineKey) !== 2) continue

    const g = hash1(h)
    // 橢圓：沿段的位置 0..1，兩端 0、中間 1；側向在 ±半寬 裡均勻取，超出就不種
    const along = t / BELT_SEGMENT - seg
    const lens = 1 - (2 * along - 1) * (2 * along - 1)
    const half = BELT_GROVE_HALF * (0.35 + 0.65 * lens)
    const side = ((g / 4294967296) * 2 - 1) * BELT_GROVE_HALF
    if (Math.abs(side) > half) continue
    const x = (axis === 0 ? at + side : t) * winCos - (axis === 0 ? t : at + side) * winSin
    const z = (axis === 0 ? at + side : t) * winSin + (axis === 0 ? t : at + side) * winCos
    if (!beltSpotOk(x, z)) continue

    const g2 = hash1(g)
    const g3 = hash1(g2)
    pushFlora(
      winOut, x, winHeight(x, z), z, (g2 / 4294967296) * Math.PI * 2,
      BELT_GROVE_SCALE[0] + (g3 / 4294967296) * (BELT_GROVE_SCALE[1] - BELT_GROVE_SCALE[0]),
      (hash1(g3) & 0xff) / 255,
      hash2(seg, lineKey ^ 0x3c11) / 4294967296 < BELT_GROVE_CONE ? FloraKind.ConeTree : FloraKind.BroadTree,
    )
  }
}

const steppeBelts: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
  winX0 = x0
  winZ0 = z0
  winX1 = x1
  winZ1 = z1
  winHeight = heightAt
  winOut = out
  const margin = Math.max(BELT_ROW_GAP + BELT_SIDE_JITTER, BELT_GROVE_HALF)

  candidateRegions(x0, z0, x1, z1)
  for (let ci = 0; ci < candCount; ci++) {
    // 【一定要 >>> 0】理由同 `hedges`
    const rid = CAND_ID[ci]! >>> 0
    steppeRegionParams(rid, REG)
    winRid = rid
    const cs = Math.cos(-REG.angle)
    const sn = Math.sin(-REG.angle)
    winCos = Math.cos(REG.angle)
    winSin = Math.sin(REG.angle)

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

    // 橫的田界：一整條，沿 qx 走
    for (let r = rMin; r <= rMax + 1; r++) {
      const at = steppeEdgeAt(r, REG.cellH, 1)
      if (at < qzMin - margin || at > qzMax + margin) continue
      plantBelt(1, at, qxMin, qxMax, hash2(r, 0x9e37))
    }
    // 縱的田界：每一列各自抖動，所以在每條橫線上斷開
    for (let r = rMin; r <= rMax; r++) {
      const bottom = steppeEdgeAt(r, REG.cellH, 1)
      const top = steppeEdgeAt(r + 1, REG.cellH, 1)
      if (top < qzMin || bottom > qzMax) continue
      const lo = Math.max(bottom, qzMin)
      const hi = Math.min(top, qzMax)
      const colSalt = (r * 2 + 1) | 0
      for (let c = cMin; c <= cMax + 1; c++) {
        const at = steppeEdgeAt(c, REG.cellW, colSalt)
        if (at < qxMin - margin || at > qxMax + margin) continue
        plantBelt(0, at, lo, hi, hash2(c ^ colSalt, 0x51ed))
      }
    }
  }
}

/**
 * 草原的防風林帶。`fade(x, z)` 是各處的濃度，0（沒有）～1（照 `BELT_SEGMENT_KEEP`）：
 * 戰場本身不種，往外漸增。
 */
export function steppeBeltFloraFor(fade: (x: number, z: number) => number): FloraSource {
  return (x0, z0, x1, z1, heightAt, out) => {
    beltFade = fade
    steppeBelts(x0, z0, x1, z1, heightAt, out)
  }
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
  woods(true, x0, z0, x1, z1, heightAt, out, OPEN_WOOD_GATE)
}

/**
 * 同 `openWoodFlora`，空地長樹林的門檻由季節給（`FieldColors.woodGate`）。**與地色
 * 傳同一份**，地上畫的林子才對得上長出來的樹
 */
export function openWoodFloraFor(gate: readonly [number, number]): FloraSource {
  if (gate[0] === OPEN_WOOD_GATE[0] && gate[1] === OPEN_WOOD_GATE[1]) return openWoodFlora
  return (x0, z0, x1, z1, heightAt, out) => {
    woods(true, x0, z0, x1, z1, heightAt, out, gate)
  }
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

/** 空地上的一個候選點：照 `openWoodCover` 決定長不長 */
function openTree(
  x: number, z: number, g: number, heightAt: (x: number, z: number) => number, out: FloraBuffer,
  gate: readonly [number, number],
): void {
  const g2 = hash1(g)
  // 覆蓋率不超過 1：雜湊已經在密度上限之上的點不必算覆蓋率（兩層雜訊）
  const u = (g2 & 0xffff) / 65536
  if (u >= OPEN_WOOD_DENSITY || u >= openWoodCover(x, z, gate) * OPEN_WOOD_DENSITY) return
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
  gate: readonly [number, number] = OPEN_WOOD_GATE,
): void {
  // 【整格先判斷】逐點找區塊、找田是這一支的大宗（一格 244 點），而大多數的格用不到：
  // 田裡的樹林只長在樹林田，整格沒有樹林田就整格跳過；整格都是空地的話不必找田
  let land = LAND_MIXED
  let noTrack = false
  if (FLORA_FAST_PATHS.on) {
    land = open ? tileLandUse(x0, z0, x1, z1) : LAND_FIELD
    if (land === LAND_FIELD && !tileMayHaveWood(x0, z0, x1, z1)) return
    if (land === LAND_OPEN) {
      // `r2 − r1` 每走 1 m 最多變 2，量凹路的 `trackGap` 與它差不到兩倍推移量：
      // 格心離凹路夠遠，整格都碰不到凹路
      regionAt((x0 + x1) / 2, (z0 + z1) / 2, AT)
      noTrack = AT.r2 - AT.r1 - 2 * halfDiagonal(x0, z0, x1, z1) > TRACK_WIDTH_MAX + 2 * TRACK_WARP_MAX
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
          if (onTrack(x, z, AT)) continue
        }
        openTree(x, z, g, heightAt, out, gate)
        continue
      }
      regionAt(x, z, AT)
      if (onTrack(x, z, AT)) continue
      fieldAt(x, z, AT, FLD)
      if (open && isOpenParcel(FLD)) {
        openTree(x, z, g, heightAt, out, gate)
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
 * 建築容許的「離凹路多遠」，用 `trackGap` 表示。
 *
 * 【為什麼是 trackGap 而不是公尺】它是兩顆種子距離差，凹路中心線上是 0，
 * 離開 t 公尺時約 2t。用它就不必自己算點到凹路的距離，而且與
 * `fieldSurfaceColor` 判斷凹路用的是同一個量。
 *
 * 下界是 `trackWidthAt`（房子不蓋在路面上），上界 90 ≈ 離路心 45 m。
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
  const d = trackGap(x, z, AT)
  return d >= trackWidthAt(x, z) && d <= LANE_BAND
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
