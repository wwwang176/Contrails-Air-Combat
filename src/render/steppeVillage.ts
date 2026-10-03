import { BufferAttribute, BufferGeometry, Color } from 'three'
import { FloraKind, pushFlora, type FloraSource } from './flora'
import { regionAt, steppeRidgeGap, trackGap, trackWidthAt, type RegionSample } from './fields'
import { TILE_SIZE } from './vegetation'
import { DECAL_LIFT } from './groundDecal'
import { churchRoom, Occupancy, placeChurch, type Placement } from './settlements'
import { nameHash, type Place } from '../world/landFeatures'
import type { HeightSampler } from '../world/river'

/**
 * # 草原大村：1943 年俄國南部的村
 *
 * 庫斯克一帶的村（selo）沿著一條主路（或溪谷、沖溝）展開，**主路兩側分出許多不規則、
 * 彎曲的支路，支路再分出更短的岔路**，房子沿每一條路排成兩列；不是中歐那種以村心為中心
 * 的放射狀，也不是單單一條街。每戶一棟小的白牆草頂房子（khata），屋脊順著路；房子後面
 * 是院子與幾棵果樹（別爾哥羅德以果園出名），再後面是**垂直於路、往外伸的長條菜園**（自留
 * 地）。附屬的棚子與主屋分開，不連成德國那種三合院。大村另有集體農場的場部：幾棟長條的
 * 牲口棚與一棟辦公房。戰火下的村有一部分房子燒成焦黑的殼。
 *
 * 【主路就是凹路】程序農地的凹路是兩顆區塊種子的中垂線（`fields.ts` 的 `trackGap`），
 * 村站址在它上面（`flora.ts` 的 `villageSite`）。主路的房子離路心的距離用 `trackGap` 量 ——
 * 與地上畫的路、植被避開的路是同一把尺。凹路在站址以外的地方會轉彎或被第三顆種子截斷，
 * 過了那一點房子就自然停了。**支路與岔路是畫在地面的土路帶**（`buildStreets`，烘進近圖），
 * 它們沒有凹路那把尺，靠 `Occupancy` 與彼此保持距離避免交叉。
 *
 * 【次序】先長出支路的骨架 → 再放主路與支路的房子（房子避開街）→ 最後長菜園（遇到房子、
 * 街、別的菜園、不准建築的地方就截斷）。房子、果樹與菜園出自同一次放置，菜園才對得上房子。
 *
 * 【位置只由聚落決定】每個聚落幾支固定種子的亂數、固定的生成次序，與現在畫到哪一格
 * 無關。
 */

/** 一個村：聚落、站址（凹路上）、凹路的走向（弧度，`atan2(tz, tx)`） */
export interface LaneVillage {
  readonly place: Place
  readonly siteX: number
  readonly siteZ: number
  readonly lane: number
}

/** 屋後的一條菜園：中心、四個角（繞行）、顏色 */
export interface GardenStrip {
  readonly x: number
  readonly z: number
  readonly ring: readonly (readonly [number, number])[]
  readonly color: number
}

/** 一條支路或岔路：中心線的折點與半寬，m */
export interface StreetRibbon {
  readonly points: readonly (readonly [number, number])[]
  readonly half: number
}

/**
 * 燒毀的房子底下的彈坑：中心、貼圖圖集的哪一格（`battleScars.ts`：0～7 是彈坑）、貼片的
 * 半邊長（m）、旋轉
 */
export interface Blast {
  readonly x: number
  readonly z: number
  readonly cell: number
  readonly half: number
  readonly rot: number
}

/** 菜園的色：馬鈴薯與蔬菜的深綠、向日葵的黃綠、乾草的黃、剛翻過的裸土 */
const GARDEN_COLORS = [0x6f7545, 0x7b7c4c, 0x85804f, 0x7a6b4a, 0x8a8a52, 0x65703f, 0x93844f] as const
/** 每條菜園的明暗再抖動的範圍（乘數） */
const GARDEN_SHADE = [0.9, 1.1] as const

function shade(hex: number, k: number): number {
  const ch = (s: number): number => Math.min(255, Math.max(0, Math.round(((hex >> s) & 255) * k)))
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
/** 支路的顏色：乾的黃土，與凹路同色（`season.ts` 的 `track`） */
const STREET_COLOR = 0xa39a80

/**
 * 主路的總長，m：`BASE + pop × PER_POP`，人口沒給時取中間。**實際長度受凹路限制**。
 *
 * 【大】庫斯克一帶的村常是一兩百戶以上，街拉長到一兩公里甚至更長。程序村的人口 150～900
 * 人，換算成主路約 1.2～2.7 km
 */
const STREET_LENGTH = { base: 900, perPop: 2.0 } as const
/**
 * 【小村】戰場的那一個村以外的村：主路 240～420 m、人口小到不長場部也少有教堂，支路最多六條、
 * 各 60～130 m、不再分岔。遠處的村不該都長成一條一兩公里的長街，從高空看一個模子
 */
const SMALL_STREET = [240, 420] as const
const SMALL_POP = 100
const SMALL_BRANCH_LENGTH = [60, 130] as const
const SMALL_BRANCH_GAP = [120, 200] as const
const SMALL_BRANCH_MAX = 6
/** 一戶沿路的寬，m */
const LOT = [17, 25] as const
/** 支路上的一戶寬，m（比主路略寬一點） */
const LOT_BRANCH = [18, 26] as const
/** 一戶空著的機率：搬走的、留作空地的。街不是排得滿滿的，但俄國的村房子挨得近 */
const LOT_EMPTY = 0.05
/**
 * 房子的大小：`scale` 是屋脊長（模型 z 軸進深 8 m 乘上它）、`wide` 是面寬倍率（模型 x 軸
 * 11 m）、`tall` 是樓高倍率（模型 y 軸 5 m）。分三檔：小屋、一般、大屋，三個數各自再抽。
 * 每棟都一樣的話，一排房子看起來像複製貼上。**要放的間距跟著 `scale` 走**（`HOUSE_ROOM`）
 */
const HOUSE_SIZE = {
  small: [1.0, 1.15], mid: [1.15, 1.4], large: [1.4, 1.65], smallShare: 0.25, largeShare: 0.15,
  wide: [0.42, 0.62], tall: [0.44, 0.58],
} as const
/** 一棟房子佔的半徑 = `HOUSE_ROOM` × `scale`，m（`scale` 1.2 時約 6 m，與相鄰兩棟的最小間距 12 m 相當） */
const HOUSE_ROOM = 5

function houseSize(r: () => number): { scale: number; wide: number; tall: number } {
  const u = r()
  const scale = u < HOUSE_SIZE.smallShare ? span(r, HOUSE_SIZE.small)
    : u > 1 - HOUSE_SIZE.largeShare ? span(r, HOUSE_SIZE.large) : span(r, HOUSE_SIZE.mid)
  return { scale, wide: span(r, HOUSE_SIZE.wide), tall: span(r, HOUSE_SIZE.tall) }
}
/**
 * 房子的中心離路心多遠，m。凹路半寬約 10 m（`TRACK_WIDTH` 20），房子前緣再留幾公尺；
 * 支路窄，離中心近一點
 */
const HOUSE_OFFSET = [16, 20] as const
const HOUSE_OFFSET_BRANCH = [12, 15] as const
/** 凹路的帶寬：`trackGap` 是離路心的兩倍。小於下限在路上、大於上限路已經轉走了 */
const GAP_NEAR = 8
const GAP_FAR = 80
/**
 * 菜園：離路心多遠起算、寬佔一戶的比例（每戶各抽）、沒有菜園的戶的比例、整條相對於街的垂直
 * 方向偏幾弧度（總幅）、有兩種作物的比例。長度分三檔：短、中、長，比例 `LENGTH_SHARE`。
 * 每戶都一樣的話，從空中看是一排整齊的條紋
 */
const GARDEN = {
  from: [32, 52], share: [0.62, 0.95], none: 0.12, skew: 0.28, twoCrops: 0.3,
} as const
const GARDEN_LENGTH = { short: [50, 85], mid: [90, 170], long: [170, 260] } as const
/** 短與長各佔多少，其餘是中 */
const LENGTH_SHARE = { short: 0.15, long: 0.15 } as const

/** 支路：骨架每一步多長，m；半寬 m；兩條路的中心線至少隔多遠，m */
const BRANCH = { step: 20, half: 3.5, apart: 40 } as const
/** 支路的長度：`BASE + rand × (SPAN + pop × PER_POP)`，m */
const BRANCH_LENGTH = { base: 150, span: 150, perPop: 0.5 } as const
/** 主路上相鄰兩條支路起點的間距，m */
const BRANCH_GAP = [60, 120] as const
/**
 * 路心離田埂線多近算「疊在一起」，m：支路半寬 3.5 加田埂半寬 4，再留一點。沿著田埂走的支路
 * 與田埂重疊成一條線，看起來像田埂延伸成路。垂直穿過田埂時一步（20 m）的五個取樣點最多
 * 三個落在這個距離內，所以只擋沿著走與斜著擦過去的（約 50° 以內）
 */
export const RIDGE_CLEAR = 6.5
/** 一個村最多幾條路（支路與岔路合計）。村的大小有上限，載入時間也有 */
const BRANCH_MAX = 150
/** 一條支路上每一步長出岔路的機率，與岔路的長度，m */
const SUB_CHANCE = 0.16
const SUB_LENGTH = [70, 190] as const

const REG: RegionSample = { r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0 }

/** 種子進、序列出。**不得 `Math.random`** */
function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const span = (r: () => number, v: readonly [number, number]): number => v[0] + r() * (v[1] - v[0])

/** 不在凹路上，也離路邊留了一段 */
function offTrack(x: number, z: number): boolean {
  regionAt(x, z, REG)
  return trackGap(x, z, REG) >= trackWidthAt(x, z) + GAP_NEAR
}

/** 這一點在凹路上嗎 */
function onRoad(x: number, z: number): boolean {
  regionAt(x, z, REG)
  return trackGap(x, z, REG) < trackWidthAt(x, z)
}

/** 這一步（a → b）是不是沿著田埂走：五個取樣點有四個離田埂線不到 `RIDGE_CLEAR` */
function alongRidge(ax: number, az: number, bx: number, bz: number): boolean {
  // 取樣點離中點最多半步，距離田埂線超過 `RIDGE_CLEAR + 半步` 的話五點都不會中，省下四次查詢
  if (steppeRidgeGap((ax + bx) / 2, (az + bz) / 2) > RIDGE_CLEAR + BRANCH.step / 2) return false
  let n = 0
  for (let k = 0; k < 5; k++) {
    const t = 0.1 + k * 0.2
    if (steppeRidgeGap(ax + (bx - ax) * t, az + (bz - az) * t) < RIDGE_CLEAR) n++
  }
  return n >= 4
}

/** 這一點離凹路的距離合不合房子的位置：不在路上、也不在路已經轉走的地方 */
function besideStreet(x: number, z: number): boolean {
  regionAt(x, z, REG)
  const g = trackGap(x, z, REG)
  return g >= trackWidthAt(x, z) + GAP_NEAR && g <= GAP_FAR
}

/** 屋脊順著路的旋轉（模型的屋脊在 z 軸，`flora.ts` 的 `farmVillageFlora` 同一個算法） */
function ridgeAlong(tx: number, tz: number): number {
  return Math.atan2(tx, tz)
}

/** 一戶：路上的一點、往這一側的單位法線、路的單位切線、這一戶的寬、離路心的距離 */
interface Lot {
  readonly px: number
  readonly pz: number
  readonly nx: number
  readonly nz: number
  readonly tx: number
  readonly tz: number
  readonly width: number
  readonly burned: boolean
}

interface Out {
  readonly placements: Placement[]
  readonly gardens: GardenStrip[]
  readonly streets: StreetRibbon[]
  readonly blasts: Blast[]
}

/** 一條支路的骨架 */
interface Branch {
  readonly id: number
  readonly pts: [number, number][]
}

/** 骨架的取樣點，依 50 m 格分桶，量「離別條路多遠」用 */
class Skeleton {
  private readonly cells = new Map<number, {
    x: number; z: number; branch: number; idx: number; ox: number; oz: number
  }[]>()
  private static key(i: number, j: number): number { return (i + 8192) * 16384 + (j + 8192) }

  /** `ox, oz` 是這一條路的起點（路口） */
  add(x: number, z: number, branch: number, idx: number, ox: number, oz: number): void {
    const k = Skeleton.key(Math.floor(x / 50), Math.floor(z / 50))
    const list = this.cells.get(k)
    if (list === undefined) this.cells.set(k, [{ x, z, branch, idx, ox, oz }])
    else list.push({ x, z, branch, idx, ox, oz })
  }

  /**
   * 離這一點 `r` 以內有沒有別條路的取樣點。`self` 自己那一條與（開頭幾步裡）`parent` 不算；
   * 從同一個路口（`ox, oz`）長出來的兄弟路，頭兩步也不算
   */
  near(
    x: number, z: number, r: number, self: number, parent: number, step: number, ox: number, oz: number,
  ): boolean {
    const ci = Math.floor(x / 50)
    const cj = Math.floor(z / 50)
    for (let j = cj - 1; j <= cj + 1; j++) {
      for (let i = ci - 1; i <= ci + 1; i++) {
        for (const s of this.cells.get(Skeleton.key(i, j)) ?? []) {
          if (s.branch === self) continue
          if (s.branch === parent && step < 4) continue
          // 【同一個路口左右各一條支路】頭兩步彼此只隔 40 m；擋了的話後長的那一側幾乎都長不
          // 出來。**只放行同一個路口的**：別處不相干的支路貼過來要擋
          if (step <= 2 && s.idx <= 2 && s.ox === ox && s.oz === oz) continue
          if (Math.hypot(s.x - x, s.z - z) < r) return true
        }
      }
    }
    return false
  }
}

/** 一個村 */
function village(
  v: LaneVillage, avoid: (x: number, z: number) => boolean, keepOut: (x: number, z: number) => boolean,
  burnRate: number, large: boolean, occ: Occupancy, hardOcc: Occupancy, out: Out,
): void {
  const p = v.place
  const rand = makeRand(nameHash(p.name))
  const rb = makeRand(nameHash(p.name) ^ 0x5bd1e995)
  const rburn = makeRand(nameHash(p.name) ^ 0xb0b0b0b0)
  const rg = makeRand(nameHash(p.name) ^ 0x2545f491)
  // 【彈坑自己一條亂數流】與菜園共用的話，燒毀的比例一動，所有菜園跟著重排
  const rbl = makeRand(nameHash(p.name) ^ 0x68e31da4)
  // 房子的大小也自己一條：改大小的範圍不會讓街與菜園的亂數位移
  const rsz = makeRand(nameHash(p.name) ^ 0x3c6ef372)
  const pop = large ? (p.pop ?? 400) : SMALL_POP
  const church = placeChurch(large ? p : { ...p, pop }, (x, z) => avoid(x, z) || keepOut(x, z), occ)
  if (church !== null) {
    out.placements.push(church)
    hardOcc.add(church.x, church.z, churchRoom(church.scale))
  }
  const tx = Math.cos(v.lane)
  const tz = Math.sin(v.lane)
  // 往左的單位法線
  const nx = -tz
  const nz = tx
  const length = large ? STREET_LENGTH.base + pop * STREET_LENGTH.perPop : span(rb, SMALL_STREET)
  const rot = ridgeAlong(tx, tz)

  // ── 一、支路的骨架 ───────────────────────────────
  // 【房子與菜園要避開街】街的取樣點也進佔位（半徑 5 m）：房子離街心 12 m 以上，所以
  // 不會被擋；站在街上的會被擋
  const skeleton = new Skeleton()
  const branches: Branch[] = []
  const grow = (sx: number, sz: number, ang0: number, maxLen: number, parent: number, depth: number): void => {
    if (branches.length >= (large ? BRANCH_MAX : SMALL_BRANCH_MAX)) return
    const b: Branch = { id: branches.length, pts: [[sx, sz]] }
    branches.push(b)
    let ang = ang0
    let x = sx
    let z = sz
    for (let step = 1; step * BRANCH.step <= maxLen; step++) {
      ang += (rb() - 0.5) * 0.3
      ang = Math.min(ang0 + 0.5, Math.max(ang0 - 0.5, ang))
      const lastX = x
      const lastZ = z
      x += Math.cos(ang) * BRANCH.step
      z += Math.sin(ang) * BRANCH.step
      // 【路停在佔了的地方】教堂（與別的村先蓋好的東西）佔的位置路不穿過；也不沿著田埂走
      if (keepOut(x, z) || !occ.free(x, z, BRANCH.half) || alongRidge(lastX, lastZ, x, z)
        || skeleton.near(x, z, BRANCH.apart, b.id, parent, step, sx, sz)) break
      b.pts.push([x, z])
      skeleton.add(x, z, b.id, step, sx, sz)
      occ.add(x, z, 5)
      hardOcc.add(x, z, 6)
      if (large && depth < 2 && step >= 3 && rb() < SUB_CHANCE && maxLen - step * BRANCH.step >= SUB_LENGTH[0]) {
        const side = rb() < 0.5 ? 1 : -1
        grow(x, z, ang + side * (0.9 + rb() * 0.6), span(rb, SUB_LENGTH), b.id, depth + 1)
      }
    }
  }
  const halfLen = length / 2
  const gap = large ? BRANCH_GAP : SMALL_BRANCH_GAP
  for (let s = -halfLen + span(rb, gap) * 0.5; s < halfLen; s += span(rb, gap)) {
    const sx = v.siteX + tx * s
    const sz = v.siteZ + tz * s
    if (!onRoad(sx, sz) || keepOut(sx, sz)) continue
    for (const side of [1, -1]) {
      if (rb() < 0.12) continue
      const a = Math.atan2(nz * side, nx * side) + (rb() - 0.5) * 0.4
      const len = large
        ? BRANCH_LENGTH.base + rb() * (BRANCH_LENGTH.span + pop * BRANCH_LENGTH.perPop)
        : span(rb, SMALL_BRANCH_LENGTH)
      grow(sx, sz, a, len, -1, 0)
    }
  }
  for (const b of branches) {
    if (b.pts.length >= 2) out.streets.push({ points: b.pts, half: BRANCH.half })
  }

  // ── 二、房子 ───────────────────────────────────
  const lots: Lot[] = []
  /** 一棟房子與它的院子（棚子與果樹）。成功放下回 true */
  const house = (
    hx: number, hz: number, ntx: number, ntz: number, nnx: number, nnz: number,
    back: number, width: number, px: number, pz: number,
  ): boolean => {
    // 半徑 4：只擋先蓋的村留下的菜園（同一個村的菜園最後才長，街與房子的間距已由 `occ` 管）
    if (keepOut(hx, hz) || !offTrack(hx, hz) || !hardOcc.free(hx, hz, 4)) return false
    const burned = rburn() < burnRate
    // 大小見 `HOUSE_SIZE`：屋脊長 8～13 m、面寬 4.6～11 m、牆高 2.2～4.8 m，一般的約
    // 10 × 7 m、牆高 3.3 m（模型 z 軸是進深、x 軸是面寬，所以 `scale` 定長、`wide` 壓成窄的）。
    // 燒毀的是焦黑的殼
    const sz = houseSize(rsz)
    const room = HOUSE_ROOM * sz.scale
    if (!place(out, occ, hx, hz, room, ridgeAlong(ntx, ntz) + (rand() - 0.5) * 0.12, sz.scale, rand(),
      burned ? FloraKind.SlateHouse : FloraKind.House, sz.wide, sz.tall)) return false
    hardOcc.add(hx, hz, room + 1)
    lots.push({ px, pz, nx: nnx, nz: nnz, tx: ntx, tz: ntz, width, burned })
    // 【被炸到的房子底下有一個彈坑】圖集一格裡坑佔四到八成，貼片 28～40 m 見方的話
    // 坑約 11～32 m，比 11 × 8 m 的房子大，坑緣與濺痕露在屋外。貼片小於房子的話
    // 整個坑被屋身蓋住，從空中看不出來
    if (burned) {
      out.blasts.push({
        x: hx + (rbl() - 0.5) * 5, z: hz + (rbl() - 0.5) * 5,
        cell: Math.floor(rbl() * 8), half: 14 + rbl() * 6, rot: rbl() * Math.PI * 2,
      })
    }
    // 院子：屋後的棚子（與主屋分開），0～2 棟
    const sheds = rand() < 0.55 ? (rand() < 0.3 ? 2 : 1) : 0
    for (let k = 0; k < sheds; k++) {
      const bk = back + 14 + rand() * 8
      const along = (rand() - 0.5) * width * 0.6
      const sx = px + nnx * bk + ntx * along
      const sz = pz + nnz * bk + ntz * along
      if (!keepOut(sx, sz) && offTrack(sx, sz)) {
        place(out, occ, sx, sz, 3.5, ridgeAlong(ntx, ntz) + (rand() - 0.5) * 0.3, 0.7 + rand() * 0.2, rand(),
          FloraKind.Barn, 0.7, 0.6)
      }
    }
    // 果樹：屋兩側與屋後各幾棵
    const trees = 1 + Math.floor(rand() * 3)
    for (let k = 0; k < trees; k++) {
      const bk = back + 6 + rand() * 24
      const along = (rand() - 0.5) * width * 0.9
      const qx = px + nnx * bk + ntx * along
      const qz = pz + nnz * bk + ntz * along
      if (!keepOut(qx, qz) && offTrack(qx, qz)) {
        place(out, occ, qx, qz, 3, rand() * 6.3, 0.3 + rand() * 0.12, rand(), FloraKind.BroadTree)
      }
    }
    return true
  }

  // 主路：沿凹路兩側
  for (const side of [1, -1]) {
    let s = -halfLen + rand() * 10
    while (s < halfLen) {
      const lot = span(rand, LOT)
      const mid = s + lot / 2
      s += lot
      const off = span(rand, HOUSE_OFFSET) * side
      const px = v.siteX + tx * mid
      const pz = v.siteZ + tz * mid
      const hx = px + nx * off
      const hz = pz + nz * off
      if (rand() < LOT_EMPTY) continue
      if (!besideStreet(hx, hz)) continue
      house(hx, hz, tx, tz, nx * side, nz * side, Math.abs(off) - HOUSE_OFFSET[0], lot, px, pz)
    }
  }
  // 支路：沿骨架的弧長兩側
  for (const b of branches) {
    if (b.pts.length < 2) continue
    let seg = 0
    let segStart = 0
    const segLen = (i: number): number => Math.hypot(b.pts[i + 1]![0] - b.pts[i]![0], b.pts[i + 1]![1] - b.pts[i]![1])
    let total = 0
    for (let i = 0; i + 1 < b.pts.length; i++) total += segLen(i)
    for (const side of [1, -1]) {
      seg = 0
      segStart = 0
      let s = 12 + rand() * 10
      while (s < total) {
        const lot = span(rand, LOT_BRANCH)
        const mid = s + lot / 2
        s += lot
        if (mid >= total) break
        while (seg + 1 < b.pts.length - 1 && segStart + segLen(seg) < mid) {
          segStart += segLen(seg)
          seg++
        }
        const a = b.pts[seg]!
        const c = b.pts[seg + 1]!
        const sl = segLen(seg) || 1
        const stx = (c[0] - a[0]) / sl
        const stz = (c[1] - a[1]) / sl
        const f = Math.min(1, Math.max(0, (mid - segStart) / sl))
        const px = a[0] + (c[0] - a[0]) * f
        const pz = a[1] + (c[1] - a[1]) * f
        const snx = -stz * side
        const snz = stx * side
        if (rand() < LOT_EMPTY) continue
        const off = span(rand, HOUSE_OFFSET_BRANCH)
        house(px + snx * off, pz + snz * off, stx, stz, snx, snz, off - HOUSE_OFFSET_BRANCH[0], lot, px, pz)
      }
    }
  }

  // ── 三、集體農場的場部 ─────────────────────────
  // 大村才有。主路的一端外面：兩三棟長條牲口棚加一棟辦公房。**在菜園之前放**，菜園才
  // 讓得開它
  if (pop >= 350 && rand() < 0.7) {
    const end = rand() < 0.5 ? 1 : -1
    const s0 = end * (halfLen + 40)
    const side = rand() < 0.5 ? 1 : -1
    const cx = v.siteX + tx * s0 + nx * side * 34
    const cz = v.siteZ + tz * s0 + nz * side * 34
    const sheds = 2 + Math.floor(rand() * 2)
    for (let k = 0; k < sheds; k++) {
      const ax = cx + nx * side * (k * 24 - 12)
      const az = cz + nz * side * (k * 24 - 12)
      if (!keepOut(ax, az) && offTrack(ax, az) && hardOcc.free(ax, az, 12)
        && place(out, occ, ax, az, 12, rot, 1.0, rand(), FloraKind.TarBarn, 0.45, 0.7)) {
        hardOcc.add(ax, az, 14)
      }
    }
    const ox = cx - tx * 40
    const oz = cz - tz * 40
    if (!keepOut(ox, oz) && offTrack(ox, oz) && hardOcc.free(ox, oz, 7)
      && place(out, occ, ox, oz, 7, rot, 1.1, rand(), FloraKind.House, 0.6, 0.75)) {
      hardOcc.add(ox, oz, 9)
    }
  }

  // ── 四、菜園：所有房子、街與場部都放好之後 ──────────
  for (const lot of lots) {
    // 【每一條都不一樣】有的戶沒有菜園；整條相對於街的垂直方向偏一點，寬窄、起點、長短、
    // 作物與明暗各自抽。軸與橫向一起轉，所以仍是矩形
    if (rg() < GARDEN.none) continue
    const sk = (rg() - 0.5) * GARDEN.skew
    const cs = Math.cos(sk)
    const sn = Math.sin(sk)
    const dx = lot.nx * cs - lot.nz * sn
    const dz = lot.nx * sn + lot.nz * cs
    const ex = lot.tx * cs - lot.tz * sn
    const ez = lot.tx * sn + lot.tz * cs
    const u = rg()
    let gl = u < LENGTH_SHARE.short ? span(rg, GARDEN_LENGTH.short)
      : u > 1 - LENGTH_SHARE.long ? span(rg, GARDEN_LENGTH.long) : span(rg, GARDEN_LENGTH.mid)
    const hw = lot.width * span(rg, GARDEN.share) / 2
    const from = span(rg, GARDEN.from)
    const x0 = lot.px + lot.nx * from
    const z0 = lot.pz + lot.nz * from
    const crop = (): number => shade(GARDEN_COLORS[Math.floor(rg() * GARDEN_COLORS.length)]!, span(rg, GARDEN_SHADE))
    const colour = crop()
    const colour2 = crop()
    const split = rg() < GARDEN.twoCrops
    const splitAt = 0.4 + rg() * 0.2
    // 【遇到東西就截斷】凹路、不准建築的地方、房子與街（佔位）、別的菜園
    const blocked = (d: number): boolean => {
      const cx = x0 + dx * d
      const cz = z0 + dz * d
      if (!offTrack(cx, cz) || !offTrack(cx + ex * hw, cz + ez * hw) || !offTrack(cx - ex * hw, cz - ez * hw)) return true
      if (keepOut(cx, cz) || keepOut(cx + ex * hw, cz + ez * hw) || keepOut(cx - ex * hw, cz - ez * hw)) return true
      return !hardOcc.free(cx, cz, hw * 0.85)
    }
    // 每 8 m 查一次，**最後一點也要查**（`gl` 不一定是 8 的倍數）。園子停在最後一個查過
    // 沒事的點上，終點因此一定是查過的。禁區要比 8 m 寬，查點之間才漏不掉
    let ok = -8
    for (let d = 0; ; d += 8) {
      const at = Math.min(d, gl)
      if (blocked(at)) {
        gl = ok
        break
      }
      ok = at
      if (at >= gl) break
    }
    if (gl < 45) continue
    for (let d = 0; d <= gl; d += 12) hardOcc.add(x0 + dx * d, z0 + dz * d, hw * 0.85)
    const corner = (d: number, a: number): readonly [number, number] => [x0 + dx * d + ex * a, z0 + dz * d + ez * a]
    /** 從離起點 `d0` 到 `d1` 的一條：四個角繞行 */
    const strip = (d0: number, d1: number, color: number): void => {
      out.gardens.push({
        x: x0 + dx * (d0 + d1) / 2, z: z0 + dz * (d0 + d1) / 2,
        ring: [corner(d0, -hw), corner(d0, hw), corner(d1, hw), corner(d1, -hw)],
        color,
      })
    }
    // 兩種作物：前半與後半各一條，接縫在中間偏一點的地方。太短就不分
    if (split && gl >= 100) {
      strip(0, gl * splitAt, colour)
      strip(gl * splitAt, gl, colour2)
    } else {
      strip(0, gl, colour)
    }
  }
}

const place = (
  o: Out, occ: Occupancy, x: number, z: number, room: number, rot: number, scale: number, tint: number,
  kind: FloraKind, wide = 1, tall = 1,
): boolean => {
  if (!occ.free(x, z, room)) return false
  occ.add(x, z, room)
  o.placements.push({ x, z, rot, scale, tint, kind, wide, tall })
  return true
}

/** 小聚落（khutor）：三五戶擠在一起，沒有街 */
function hamlet(
  v: LaneVillage, keepOut: (x: number, z: number) => boolean, occ: Occupancy, hardOcc: Occupancy, out: Out,
): void {
  const rand = makeRand(nameHash(v.place.name))
  const n = 3 + Math.floor(rand() * 3)
  const heading = rand() * Math.PI * 2
  for (let k = 0; k < n; k++) {
    const a = heading + (rand() - 0.5) * 1.2
    const d = 10 + k * (18 + rand() * 10)
    const hx = v.place.x + Math.cos(a) * d
    const hz = v.place.z + Math.sin(a) * d
    const rot = heading + Math.PI / 2 + (rand() - 0.5) * 0.4
    // 菜園與街在 `hardOcc` 裡：小聚落蓋在後面，不能蓋進村的菜園
    if (keepOut(hx, hz) || !offTrack(hx, hz) || !hardOcc.free(hx, hz, 7)) continue
    const sz = houseSize(rand)
    const room = HOUSE_ROOM * sz.scale
    if (!place(out, occ, hx, hz, room, rot, sz.scale, rand(), FloraKind.House, sz.wide, sz.tall)) continue
    hardOcc.add(hx, hz, room + 1)
    for (let t = 0; t < 2 + Math.floor(rand() * 3); t++) {
      const ta = rand() * Math.PI * 2
      const td = 8 + rand() * 20
      const tx = hx + Math.cos(ta) * td
      const tz = hz + Math.sin(ta) * td
      if (!keepOut(tx, tz) && offTrack(tx, tz)) {
        place(out, occ, tx, tz, 3, rand() * 6.3, 0.3 + rand() * 0.12, rand(), FloraKind.BroadTree)
      }
    }
  }
}

/** 依 tile 分桶的鍵（tile 索引夾在 ±4096 內） */
function bucketKey(i: number, j: number): number {
  return (i + 4096) * 8192 + (j + 4096)
}

const NONE: readonly Placement[] = []
const NO_KEEP_OUT = (): boolean => false
const ALL_LARGE = (): boolean => true
/** 沒有戰場時，每個村零星燒毀的房子比例 */
const SPORADIC_BURN = (): number => 0.04

/**
 * 全部草原村的建築與樹（`flora`，散佈器）、屋後的菜園（`gardens`）與支路（`streets`）。
 * **建築預先算好、依 tile 分桶**，與 `settlementLayout` 同一個做法。
 *
 * @param avoid 教堂不蓋的地方（凹路）
 * @param keepOut 房子、樹、支路與菜園都不准的地方（戰場的單位與壕溝，`world/rzhev.ts`）
 * @param burnRate 這個村的房子燒毀的比例，依村名
 * @param large 這個村是不是大村（依村名）。不是的話畫成小村（`SMALL_STREET`）；預設全部是大村
 */
export function steppeLayout(
  villages: readonly LaneVillage[], avoid: (x: number, z: number) => boolean,
  keepOut: (x: number, z: number) => boolean = NO_KEEP_OUT,
  burnRate: (name: string) => number = SPORADIC_BURN,
  large: (name: string) => boolean = ALL_LARGE,
): {
  flora: FloraSource; gardens: readonly GardenStrip[]; streets: readonly StreetRibbon[]; blasts: readonly Blast[]
} {
  const out: Out = { placements: [], gardens: [], streets: [], blasts: [] }
  const occ = new Occupancy()
  /** 街、菜園、房子、教堂、場部的佔位：菜園與後蓋的小聚落都要讓開。`occ` 管的是建築與樹的間距 */
  const hardOcc = new Occupancy()
  for (const v of villages) {
    if (v.place.kind === 'hamlet') hamlet(v, keepOut, occ, hardOcc, out)
    else village(v, avoid, keepOut, burnRate(v.place.name), large(v.place.name), occ, hardOcc, out)
  }
  const buckets = new Map<number, Placement[]>()
  for (const b of out.placements) {
    const k = bucketKey(Math.floor(b.x / TILE_SIZE), Math.floor(b.z / TILE_SIZE))
    const list = buckets.get(k)
    if (list === undefined) buckets.set(k, [b])
    else list.push(b)
  }
  const flora: FloraSource = (x0, z0, x1, z1, heightAt, o) => {
    const i0 = Math.floor(x0 / TILE_SIZE)
    const i1 = Math.floor((x1 - 1e-6) / TILE_SIZE)
    const j0 = Math.floor(z0 / TILE_SIZE)
    const j1 = Math.floor((z1 - 1e-6) / TILE_SIZE)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (const b of buckets.get(bucketKey(i, j)) ?? NONE) {
          if (b.x < x0 || b.x >= x1 || b.z < z0 || b.z >= z1) continue
          pushFlora(o, b.x, heightAt(b.x, b.z), b.z, b.rot, b.scale, b.tint, b.kind, b.wide, b.tall)
        }
      }
    }
  }
  return { flora, gardens: out.gardens, streets: out.streets, blasts: out.blasts }
}

/**
 * 菜園的網格：每一條一個四邊形，頂點取地形高度再抬 `DECAL_LIFT`，帶自己的顏色。
 * 平常整顆烘進田色貼圖（`terrain.ts` 的 `addOverlay`）。
 */
export function buildGardens(sample: HeightSampler, gardens: readonly GardenStrip[]): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const c = new Color()
  for (const g of gardens) {
    const base = pos.length / 3
    c.setHex(g.color)
    for (const [x, z] of g.ring) {
      pos.push(x, sample(x, z) + DECAL_LIFT, z)
      col.push(c.r, c.g, c.b)
    }
    // 【捲繞朝上】四個角的繞行方向隨菜園的朝向而定，逐片對
    const a = g.ring[0]!
    const b = g.ring[1]!
    const d = g.ring[2]!
    const cross = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])
    if (cross > 0) idx.push(base, base + 2, base + 1, base, base + 3, base + 2)
    else idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return finish(pos, col, idx)
}

/**
 * 支路的網格：每一條折線一條帶子（左右各取地形高度再抬 `DECAL_LIFT`）。畫在菜園之後。
 */
export function buildStreets(sample: HeightSampler, streets: readonly StreetRibbon[]): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const c = new Color(STREET_COLOR)
  for (const s of streets) {
    const pts = s.points
    const n = pts.length
    const base = pos.length / 3
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)]!
      const b = pts[Math.min(n - 1, i + 1)]!
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      // 往左的單位法線
      const nx = -(b[1] - a[1]) / len
      const nz = (b[0] - a[0]) / len
      const [x, z] = pts[i]!
      for (const side of [1, -1]) {
        const vx = x + nx * s.half * side
        const vz = z + nz * s.half * side
        pos.push(vx, sample(vx, vz) + DECAL_LIFT, vz)
        col.push(c.r, c.g, c.b)
      }
    }
    // 【捲繞方向】左在 2i、右在 2i+1，「左、下一個左、右」朝上
    for (let i = 0; i + 1 < n; i++) {
      const k = base + i * 2
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3)
    }
  }
  return finish(pos, col, idx)
}

/**
 * 燒毀房子底下的彈坑貼片：每一個一個四邊形，帶 `uv`，取圖集的一格（4 × 4，列優先、左上為
 * 0）。四邊形的 uv 往格子裡縮一點，避免雙線性取樣混進隔壁格。烘圖時走貼圖版的 overlay
 * （`fieldClipmap.ts` 的 `addOverlay(…, true, true)`）。
 */
export function buildBlasts(sample: HeightSampler, blasts: readonly Blast[]): BufferGeometry {
  const pos: number[] = []
  const uvs: number[] = []
  const idx: number[] = []
  const IN = 0.004
  for (const b of blasts) {
    const base = pos.length / 3
    const c = Math.cos(b.rot)
    const s = Math.sin(b.rot)
    const u0 = (b.cell % 4) / 4
    const v0 = Math.floor(b.cell / 4) / 4
    // 四個角：(−,−) (+,−) (+,+) (−,+)；圖集的 y 朝上（`uv` 的 v 與列相反）
    const corners: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    for (const [a, d] of corners) {
      const x = b.x + (a * c - d * s) * b.half
      const z = b.z + (a * s + d * c) * b.half
      pos.push(x, sample(x, z) + DECAL_LIFT, z)
      uvs.push(u0 + (a < 0 ? IN : 0.25 - IN), 1 - (v0 + (d < 0 ? IN : 0.25 - IN)))
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geo.setIndex(idx)
  geo.computeBoundingSphere()
  return geo
}

function finish(pos: number[], col: number[], idx: number[]): BufferGeometry {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}
