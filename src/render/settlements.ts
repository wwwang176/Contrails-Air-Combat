import { FloraKind, pushFlora, type FloraSource } from './flora'
import { BUILDING_DEPTH, BUILDING_WIDTH } from './floraShapes'
import { TILE_SIZE } from './vegetation'
import { buildDecals, type DecalRegion } from './groundDecal'
import {
  insideSettlement, nameHash, outlineScale, settlementRadius, type Place,
} from '../world/landFeatures'
import type { HeightSampler } from '../world/river'
import type { Mesh } from 'three'

/**
 * # 真實的村鎮：農莊、街屋、教堂、果樹、鎮區的地面
 *
 * 位置與大小照 OSM 的聚落（`world/landFeatures.ts` 的 `settlementRadius`）。
 * 形態照 1944 年的德國中部：
 *
 * - **村的單位是農莊**（Drei-/Vierseithof）：主屋山牆朝街、側屋（畜舍）、後面
 *   橫著一座大穀倉，三棟圍出院子；院子後面是花園與果樹。
 * - **薩勒河西岸**是很早就有人定居的黃土地，村是**團狀村**（Haufendorf）：
 *   兩三條彎巷穿過村心，農莊沿巷擠成一團。
 * - **東岸**是中世紀東向殖民的地區，大村是**綠地村**（Angerdorf）：中間一塊長形
 *   綠地，教堂與椴樹在綠地上，農莊面向綠地排兩列；小村是**街村**。
 * - **鎮**：中心是不規則的老城（小街廓、連棟街屋），外圍是方正的街廓、中庭有樹。
 *   洛伊納是為煉油廠工人蓋的**花園城市**：規整的獨棟排屋，每棟帶花園。
 * - 村外圍一圈**果園**。
 *
 * 樹與灌木用植被的現成模型（闊葉、針葉、灌木）。
 *
 * 【位置只由聚落決定】每個聚落一支固定種子的亂數、固定的生成次序，與「現在
 * 畫到哪一格」無關 —— 否則同一棟房子在相鄰兩格會長在兩個地方。
 */

type Kind = Place['kind']

/** 教堂與建築、樹的外接半徑，m（`floraShapes.ts`：教堂本堂 10 × 19 加塔） */
const CHURCH_REACH = 13
/** 教堂周圍留的空地（加在教堂的外接半徑上），m */
const CHURCH_YARD = 10
/** 村有教堂的機率。鎮一定有 */
const VILLAGE_CHURCH = 0.75
/** 人口超過這個數的鎮，教堂是大教堂（梅澤堡、魏森費爾斯、瑙姆堡） */
const CATHEDRAL_POP = 30000

/** 農莊臨街的寬度與院子的進深，m */
const FARM_WIDTH = [22, 30] as const
const FARM_DEPTH = [24, 34] as const
/** 農莊之間的空隙，m */
const FARM_GAP = [2, 9] as const
/** 農莊前緣離巷子中心線，m */
const FARM_SETBACK = 8
/** 同一座農莊的側屋與主屋、穀倉之間至少留的空隙，m */
const FARM_INNER_GAP = 1

/**
 * 農莊三棟的大小：進深的縮放、面寬倍率、樓高倍率（`pushFlora` 的 `scale`、
 * `wide`、`tall`；尺寸基準見 `floraShapes.ts` 的 `BUILDING_*`）。**建築只有一種
 * 形狀**，主屋、側屋、穀倉只差大小與位置；屋頂的料與牆色另外隨機（`roofKind`）。
 */
const FARM_HOUSE = { scale: [0.9, 1.1], wide: [0.9, 1.25], tall: [1.0, 1.6] } as const
const FARM_SIDE = { scale: [0.7, 0.9], wide: [1.0, 1.6], tall: [0.8, 1.1] } as const
const FARM_BARN = { scale: [1.0, 1.3], wide: [1.4, 2.1], tall: [1.1, 1.6] } as const

/**
 * 鎮上沿街的建築：面寬（m）、進深縮放、樓高倍率、棟與棟的空隙（m）。
 * 老城是連棟的兩三層街屋，外圍矮一點、有空隙，花園城市是獨棟。
 */
interface Frontage {
  readonly front: readonly [number, number]
  readonly scale: readonly [number, number]
  readonly tall: readonly [number, number]
  readonly gap: readonly [number, number]
}
const OLD_TOWN: Frontage = { front: [7, 12], scale: [1.0, 1.4], tall: [1.6, 2.6], gap: [0, 0.6] }
const OUTER_TOWN: Frontage = { front: [9, 16], scale: [1.0, 1.3], tall: [1.3, 2.2], gap: [1, 5] }
const GARDEN_CITY: Frontage = { front: [9, 11], scale: [0.95, 1.1], tall: [1.3, 1.6], gap: [9, 14] }
/**
 * 街廓轉角兩棟之間留的空隙，m。彎街會把轉角擠近，留太少的話轉角那兩棟互相
 * 插進去
 */
const CORNER_GAP = 2
/** 鎮上房子的佔位半徑，m。見 `townBlocks` */
const TOWN_HOUSE_ROOM = 3.5
/** 大一點的東岸村是綠地村；半徑小於這個的是街村 */
const ANGER_MIN_RADIUS = 150
/** 綠地的半寬，m；街村的街是 `STREET_HALF` */
const GREEN_HALF = [22, 34] as const
const STREET_HALF = 6

/**
 * 屋頂的料，**與建築的用途無關**。石板瓦：聚落中心 → 外緣（鎮中心是公家建築與
 * 大戶人家）；剩下的依比例分老瓦（更暗、配磚木牆）、油毛氈，其餘是新一點的瓦。
 * 村裡老瓦與油毛氈多（少翻修、多棚子）
 */
const SLATE: Record<Kind, readonly [number, number]> = {
  town: [0.28, 0.1], village: [0.1, 0.06], hamlet: [0.05, 0.05],
}
const OLD_TILE: Record<Kind, number> = { town: 0.2, village: 0.35, hamlet: 0.4 }
const TAR: Record<Kind, number> = { town: 0.05, village: 0.12, hamlet: 0.15 }

/**
 * 鎮的地面顏色。**取晚秋田色盤裡的色**（`season.ts` 的犁田）—— 自己調一個灰的
 * 話，從空中看是田裡貼了一塊淺色補丁。鎮要靠房子認出來。
 */
const TOWN_GROUND = 0x585046

/** 一株或一棟：建築、果樹、灌木都是 */
export interface Placement {
  readonly x: number
  readonly z: number
  readonly rot: number
  readonly scale: number
  /** 顏色的變化量，0～1 */
  readonly tint: number
  readonly kind: FloraKind
  /** 面寬與樓高的倍率（`pushFlora`）。樹是 1 */
  readonly wide: number
  readonly tall: number
}

/** 種子進、序列出。**不得 `Math.random`** —— 每次進場一樣 */
function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * 模型的 x 軸（面寬）對齊 `(dx, dz)` 的旋轉。實例矩陣只繞 Y 轉，x 軸轉到
 * `(cos θ, −sin θ)`（`vegetation.ts` 就地寫矩陣那一段）；屋脊在 z 軸，所以
 * 屋脊與 `(dx, dz)` 垂直
 */
function wideAlong(dx: number, dz: number): number {
  return Math.atan2(-dz, dx)
}

/** 佔位格網的格寬，m */
const OCC_CELL = 32
/** 佔位圓最大的半徑，m（大教堂 13 × 2 + 10）。查詢的範圍由它決定 */
const OCC_MAX = 36

/**
 * 已經佔掉的圓。**所有聚落共用一份**（`settlementFlora`）—— 相鄰的村可以只隔
 * 三四百公尺。依格分桶：鎮上幾千棟，逐一比對是平方的。
 */
export class Occupancy {
  private readonly xs: number[] = []
  private readonly zs: number[] = []
  private readonly rs: number[] = []
  private readonly cells = new Map<number, number[]>()

  private static key(i: number, j: number): number {
    return (i + 65536) * 131072 + (j + 65536)
  }

  free(x: number, z: number, r: number): boolean {
    const reach = Math.ceil((r + OCC_MAX) / OCC_CELL)
    const ci = Math.floor(x / OCC_CELL)
    const cj = Math.floor(z / OCC_CELL)
    for (let j = cj - reach; j <= cj + reach; j++) {
      for (let i = ci - reach; i <= ci + reach; i++) {
        const list = this.cells.get(Occupancy.key(i, j))
        if (list === undefined) continue
        for (const k of list) {
          if (Math.hypot(this.xs[k]! - x, this.zs[k]! - z) < this.rs[k]! + r) return false
        }
      }
    }
    return true
  }

  add(x: number, z: number, r: number): void {
    const k = this.xs.length
    this.xs.push(x)
    this.zs.push(z)
    this.rs.push(r)
    const key = Occupancy.key(Math.floor(x / OCC_CELL), Math.floor(z / OCC_CELL))
    const list = this.cells.get(key)
    if (list === undefined) this.cells.set(key, [k])
    else list.push(k)
  }
}

/** 生成一個聚落時共用的東西 */
interface Ctx {
  readonly p: Place
  readonly R: number
  readonly rand: () => number
  readonly out: Placement[]
  readonly occ: Occupancy
  readonly avoid: (x: number, z: number) => boolean
  /** 這個聚落的教堂（已經放好、已經佔位）。沒有是 null */
  readonly church: Placement | null
}

const pick = (c: Ctx, r: readonly [number, number]): number => r[0] + c.rand() * (r[1] - r[0])

/** 這一點離聚落中心的比例（0 = 中心、1 = 輪廓） */
function radial(c: Ctx, x: number, z: number): number {
  const dx = x - c.p.x
  const dz = z - c.p.z
  return Math.hypot(dx, dz) / (c.R * outlineScale(c.p, Math.atan2(dz, dx)))
}

/**
 * 放一株或一棟：不在避開的地方、不與已經放的重疊。成功回 true。
 * `r` 是它的外接半徑（佔位用）
 */
function place(
  c: Ctx, x: number, z: number, r: number, rot: number, scale: number, kind: FloraKind, wide = 1, tall = 1,
): boolean {
  if (c.avoid(x, z) || !c.occ.free(x, z, r)) return false
  c.occ.add(x, z, r)
  c.out.push({ x, z, rot, scale, tint: c.rand(), kind, wide, tall })
  return true
}

/** 這一棟的屋頂料（與牆色）：石板瓦、老瓦、油毛氈、新瓦，見 `SLATE` 等 */
function roofKind(c: Ctx, x: number, z: number): FloraKind {
  const [s0, s1] = SLATE[c.p.kind]
  const slate = s0 + (s1 - s0) * Math.min(1, radial(c, x, z))
  const u = c.rand()
  if (u < slate) return FloraKind.SlateHouse
  const v = (u - slate) / (1 - slate)
  if (v < OLD_TILE[c.p.kind]) return FloraKind.Barn
  if (v < OLD_TILE[c.p.kind] + TAR[c.p.kind]) return FloraKind.TarBarn
  return FloraKind.House
}

/** 牆的外框對角線的一半，m：佔位圓的半徑 */
function footprintReach(scale: number, wide: number): number {
  return Math.hypot(BUILDING_WIDTH * scale * wide, BUILDING_DEPTH * scale) / 2
}

/**
 * 果樹：闊葉樹縮成 10～14 m。真的果樹還再矮一點，但縮到那麼小的話從幾百公尺
 * 高看只剩一個個黑點
 */
function fruitTree(c: Ctx, x: number, z: number): boolean {
  return place(c, x, z, 4, c.rand() * Math.PI * 2, pick(c, [0.34, 0.48]), FloraKind.BroadTree)
}

/** 花園的灌木 */
function gardenBush(c: Ctx, x: number, z: number): boolean {
  return place(c, x, z, 2.5, c.rand() * Math.PI * 2, pick(c, [0.35, 0.55]), FloraKind.Bush)
}

/**
 * 一座農莊。`(px, pz)` 是臨街的中點，`(tx, tz)` 沿街、`(nx, nz)` 從街往院子裡。
 *
 * ```
 *        花園：果樹、灌木
 *   ┌──────────────────────┐
 *   │       大穀倉（橫）      │
 *   ├────┐            ┌────┤
 *   │主屋│    院子     │側屋│
 *   │    │            │    │
 *   └────┘            └────┘
 *  ─────────── 巷 ───────────
 * ```
 *
 * 佔位先看整座：放不下就整座不放，不會剩半座。放了回 true。
 *
 * 【佔位圓只蓋臨街的寬度】半徑 `W / 2`、圓心在院子中央。蓋住整個院子加花園的
 * 話，沿街一座挨一座的農莊會互相擋掉；兩條巷在村心交叉時，這個圓仍然擋得住。
 */
function farm(
  c: Ctx, W: number, px: number, pz: number, tx: number, tz: number, nx: number, nz: number,
): boolean {
  const D = pick(c, FARM_DEPTH)
  // 【院子稍微歪】整座農莊繞臨街中點轉一點點，一排排下來不是尺畫的
  const skew = (c.rand() - 0.5) * 0.2
  const cs = Math.cos(skew)
  const sn = Math.sin(skew)
  const Tx = tx * cs - nx * sn
  const Tz = tz * cs - nz * sn
  const Nx = nx * cs + tx * sn
  const Nz = nz * cs + tz * sn
  const at = (u: number, v: number): [number, number] => [px + Tx * u + Nx * v, pz + Tz * u + Nz * v]
  const [cx, cz] = at(0, FARM_SETBACK + D / 2)
  // 大穀倉：橫在院子最後面，長邊（面寬）沿著街，不超過農莊的寬度
  const bs = pick(c, FARM_BARN.scale)
  const bw = Math.min(pick(c, FARM_BARN.wide), W / (BUILDING_WIDTH * bs))
  const [bx, bz] = at(0, FARM_SETBACK + D - (BUILDING_DEPTH / 2) * bs)
  // 側屋：長邊沿著院子的進深，靠右。**長度夾在院子前緣到穀倉前緣之間** ——
  // 不夾的話長一點的側屋加上深一點的穀倉會超過院子，兩棟的牆穿插
  const ss = pick(c, FARM_SIDE.scale)
  const sideLen = Math.min(pick(c, FARM_SIDE.wide) * BUILDING_WIDTH * ss, D - BUILDING_DEPTH * bs - FARM_INNER_GAP)
  const sw = sideLen / (BUILDING_WIDTH * ss)
  const [sx, sz] = at(W / 2 - (BUILDING_DEPTH / 2) * ss, FARM_SETBACK + sideLen / 2)
  // 主屋：屋脊垂直於街（山牆朝街）、靠左。**面寬夾在側屋左邊** —— 窄的農莊裡
  // 寬的主屋會撞到側屋
  const hs = pick(c, FARM_HOUSE.scale)
  const hw = Math.min(pick(c, FARM_HOUSE.wide), (W - BUILDING_DEPTH * ss - FARM_INNER_GAP) / (BUILDING_WIDTH * hs))
  const [hx, hz] = at(-W / 2 + (BUILDING_WIDTH / 2) * hs * hw, FARM_SETBACK + (BUILDING_DEPTH / 2) * hs)
  // 【三棟各自也要看佔位】臨街寬度的那個圓蓋不到後面的穀倉（進深最遠 17 m），
  // 只看圓的話穀倉會擠進教堂的空地
  if (radial(c, cx, cz) > 1 || c.avoid(cx, cz) || !c.occ.free(cx, cz, W / 2)
    || !c.occ.free(hx, hz, footprintReach(hs, hw)) || !c.occ.free(sx, sz, footprintReach(ss, sw))
    || !c.occ.free(bx, bz, footprintReach(bs, bw))) return false
  c.occ.add(cx, cz, W / 2)
  c.occ.add(hx, hz, footprintReach(hs, hw))
  c.occ.add(sx, sz, footprintReach(ss, sw))
  c.occ.add(bx, bz, footprintReach(bs, bw))
  // 三棟各自再看一次避開的地方 —— 圓心在岸上不代表後面那座穀倉也在岸上
  const building = (x: number, z: number, rot: number, scale: number, wide: number, tall: number): void => {
    if (!c.avoid(x, z)) c.out.push({ x, z, rot, scale, tint: c.rand(), kind: roofKind(c, x, z), wide, tall })
  }
  building(hx, hz, wideAlong(Tx, Tz), hs, hw, pick(c, FARM_HOUSE.tall))
  building(sx, sz, wideAlong(Nx, Nz), ss, sw, pick(c, FARM_SIDE.tall))
  building(bx, bz, wideAlong(Tx, Tz), bs, bw, pick(c, FARM_BARN.tall))
  // 花園：院子後面兩到四棵果樹、零到兩叢灌木
  const trees = 2 + Math.floor(c.rand() * 3)
  for (let k = 0; k < trees; k++) {
    const [x, z] = at((c.rand() - 0.5) * W, FARM_SETBACK + D + pick(c, [5, 20]))
    fruitTree(c, x, z)
  }
  const bushes = Math.floor(c.rand() * 3)
  for (let k = 0; k < bushes; k++) {
    const [x, z] = at((c.rand() - 0.5) * W, FARM_SETBACK + D + pick(c, [2, 24]))
    gardenBush(c, x, z)
  }
  return true
}

/**
 * 沿一條路的一側一路排農莊。`pathAt(s)` 回路上弧長 `s` 那一點與切線；`side`
 * 決定排在左還是右。`s` 從 `s0` 排到 `s1`（可以倒著排）
 */
function farmsAlong(
  c: Ctx, pathAt: (s: number, out: number[]) => void, s0: number, s1: number, side: number, skip: number,
): void {
  const dir = s1 >= s0 ? 1 : -1
  const pt: number[] = [0, 0, 0, 0]
  let s = s0
  while ((s1 - s) * dir > 0) {
    // 【寬度先定、再走半個寬度放下去】下一座從這一座的邊緣加空隙開始 ——
    // 用上一座的寬度去推的話，下一座比較寬時會與上一座重疊
    const W = pick(c, FARM_WIDTH)
    const mid = s + (dir * W) / 2
    pathAt(mid, pt)
    const [x, z, tx, tz] = pt as [number, number, number, number]
    // 左手邊的法線是 (−tz, tx)
    const nx = -tz * side
    const nz = tx * side
    // 【有些空著】團狀村不是每一格都有人；空的那一格照樣佔一個寬度
    if (c.rand() >= skip) farm(c, W, x, z, tx, tz, nx, nz)
    s = mid + dir * (W / 2 + pick(c, FARM_GAP))
  }
}

/**
 * 聚落的教堂：在聚落中心，周圍留空地。有沒有、朝哪、多大只由聚落本身決定（名字
 * 的雜湊與人口），不吃生成的亂數序列。
 *
 * 【所有聚落的教堂都要最先放】相鄰的村可以只隔三四百公尺（外圍的果園伸得到
 * 隔壁村心），教堂先佔好位，之後每一座農莊、每一棵樹都避開它。放不下（被避開
 * 的地方或另一座教堂擋住）就沒有教堂。
 */
export function placeChurch(p: Place, avoid: (x: number, z: number) => boolean, occ: Occupancy): Placement | null {
  const h = nameHash(p.name)
  if (p.kind === 'hamlet') return null
  if (p.kind === 'village' && ((h >>> 20) & 0xff) / 256 >= VILLAGE_CHURCH) return null
  const scale = p.kind === 'town' ? ((p.pop ?? 0) >= CATHEDRAL_POP ? 2 : 1.5) : 1
  const room = CHURCH_REACH * scale + CHURCH_YARD
  if (avoid(p.x, p.z) || !occ.free(p.x, p.z, room)) return null
  occ.add(p.x, p.z, room)
  return {
    x: p.x, z: p.z, rot: ((h >>> 3) & 0xffff) / 65536 * Math.PI * 2, scale, tint: 0.5, kind: FloraKind.Church,
    wide: 1, tall: 1,
  }
}

/** 教堂墓園四周的大樹（椴樹）與一兩棵針葉樹 */
function churchyardTrees(c: Ctx, x: number, z: number, scale: number): void {
  const ring = CHURCH_REACH * scale + CHURCH_YARD + 5
  const n = 3 + Math.floor(c.rand() * 4)
  for (let k = 0; k < n; k++) {
    const a = c.rand() * Math.PI * 2
    const d = ring + c.rand() * 8
    const conifer = c.rand() < 0.25
    place(c, x + Math.cos(a) * d, z + Math.sin(a) * d, conifer ? 3 : 6, c.rand() * 6.3,
      conifer ? pick(c, [0.3, 0.4]) : pick(c, [0.5, 0.75]), conifer ? FloraKind.ConeTree : FloraKind.BroadTree)
  }
}

/** 一條從村心穿過的彎路：`angle` 方向、左右擺幅 `amp`、波長 `wave` */
function curvedPath(c: Ctx, angle: number, amp: number, wave: number, phase: number) {
  const ux = Math.cos(angle)
  const uz = Math.sin(angle)
  return (s: number, out: number[]): void => {
    const off = amp * Math.sin(s / wave + phase)
    const slope = (amp / wave) * Math.cos(s / wave + phase)
    out[0] = c.p.x + ux * s - uz * off
    out[1] = c.p.z + uz * s + ux * off
    const tx = ux - uz * slope
    const tz = uz + ux * slope
    const l = Math.hypot(tx, tz)
    out[2] = tx / l
    out[3] = tz / l
  }
}

/** 薩勒河西岸的團狀村：兩三條彎巷穿過村心，農莊沿巷擠成一團 */
function haufendorf(c: Ctx): void {
  const a0 = c.rand() * Math.PI
  const lanes = c.p.kind === 'hamlet' ? 1 : 2 + (c.rand() < 0.5 ? 1 : 0)
  for (let k = 0; k < lanes; k++) {
    const angle = a0 + (k * Math.PI) / lanes + (c.rand() - 0.5) * 0.5
    const path = curvedPath(c, angle, c.R * pick(c, [0.08, 0.16]), c.R * pick(c, [0.35, 0.6]), c.rand() * 6.3)
    const L = c.R * 1.1
    for (const side of [1, -1]) {
      // 從村心往外排，兩個方向各一次 —— 村心先擠滿
      farmsAlong(c, path, 12, L, side, 0.12)
      farmsAlong(c, path, -12, -L, side, 0.12)
    }
  }
  if (c.church !== null) churchyardTrees(c, c.church.x, c.church.z, c.church.scale)
}

/**
 * 東岸的綠地村／街村：一條軸線，綠地（或街）在中間，農莊面向它排兩列。
 * 綠地上是教堂與一排椴樹。
 */
function angerdorf(c: Ctx): void {
  const angle = c.rand() * Math.PI
  const green = c.R >= ANGER_MIN_RADIUS ? pick(c, GREEN_HALF) : STREET_HALF
  const ux = Math.cos(angle)
  const uz = Math.sin(angle)
  const bow = c.R * pick(c, [0.03, 0.08])
  const L = c.R * 1.15
  // 綠地兩側的路：軸線左右各偏 `green`，軸線本身略彎
  for (const side of [1, -1]) {
    const path = (s: number, out: number[]): void => {
      const off = side * green + bow * Math.sin((s / L) * Math.PI)
      out[0] = c.p.x + ux * s - uz * off
      out[1] = c.p.z + uz * s + ux * off
      out[2] = ux
      out[3] = uz
    }
    // 農莊背對綠地往外長：這條路偏在 side 那一側，往外就是 side 那一側的法線
    farmsAlong(c, path, -L, L, side, 0.08)
  }
  if (c.church === null) return
  if (green === STREET_HALF) {
    churchyardTrees(c, c.church.x, c.church.z, c.church.scale)
    return
  }
  // 綠地上的椴樹：沿軸線一排，間隔不一
  for (let s = -L * 0.8; s < L * 0.8; s += pick(c, [22, 40])) {
    if (c.rand() < 0.3) continue
    const off = (c.rand() - 0.5) * green
    place(c, c.p.x + ux * s - uz * off, c.p.z + uz * s + ux * off, 6, c.rand() * 6.3,
      pick(c, [0.5, 0.75]), FloraKind.BroadTree)
  }
}

/** 見 `townBlocks` 的 `core` */
interface TownCore {
  readonly occ: Occupancy
  readonly role: 'mark' | 'clear'
}

/** 小聚落：兩到四座農莊，各朝各的 */
function hamlet(c: Ctx): void {
  const n = 2 + Math.floor(c.rand() * 3)
  for (let k = 0; k < n; k++) {
    const a = c.rand() * Math.PI * 2
    const d = c.rand() * c.R * 0.5
    const t = c.rand() * Math.PI * 2
    farm(c, pick(c, FARM_WIDTH), c.p.x + Math.cos(a) * d, c.p.z + Math.sin(a) * d,
      Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t))
  }
}

/**
 * 鎮的街廓。`S` 街廓邊長（街心到街心）、`street` 街的半寬（房子的正面貼在
 * 這裡）、`frontage` 沿街建築的面寬、進深、樓高、空隙。`warp` 讓格線緩緩扭曲成
 * 彎街（振幅、波長），`inner` 只鋪離中心這個比例以內（`outer` 以外）的街廓。
 *
 * 每一邊從一頭沿街一棟一棟往下排，面寬隨機、山牆朝街。**±u 那兩邊排滿整條、
 * 佔住轉角；±v 那兩邊兩頭各讓出一棟的進深** —— 四邊都排滿的話轉角那兩棟會
 * 互相插進去。
 *
 * `core`：兩套格線疊在同一個鎮上時，先鋪的那一套把每一棟的外框圓記進去
 * （`mark`），後鋪的避開它（`clear`）。兩套格線夾一個角度，不避的話交界那一圈
 * 的房子斜插進彼此，最深 6 m 多。
 */
function townBlocks(
  c: Ctx, angle: number, S: number, street: number, frontage: Frontage, warp: readonly [number, number],
  inner: number, outer: number, fill: readonly [number, number], courtyardTree: number, garden: boolean,
  core: TownCore | null,
): void {
  const ux = Math.cos(angle)
  const uz = Math.sin(angle)
  const vx = -uz
  const vz = ux
  const [amp, wave] = warp
  const ph1 = c.rand() * 6.3
  const ph2 = c.rand() * 6.3
  // 平滑的扭曲：位置與方向一起彎
  const bend = (x: number, z: number, out: number[]): void => {
    out[0] = x + amp * Math.sin(z / wave + ph1)
    out[1] = z + amp * Math.sin(x / wave + ph2)
  }
  const q: number[] = [0, 0]
  const q2: number[] = [0, 0]
  const n = Math.ceil((1.3 * c.R) / S)
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const cx = c.p.x + ux * i * S + vx * j * S
      const cz = c.p.z + uz * i * S + vz * j * S
      const r = radial(c, cx, cz)
      if (r > 1 || r < outer || r >= inner) continue
      const fillHere = fill[0] + (fill[1] - fill[0]) * Math.min(1, r * r)
      const deepest = BUILDING_DEPTH * frontage.scale[1]
      for (let side = 0; side < 4; side++) {
        const nu = side === 0 ? 1 : side === 1 ? -1 : 0
        const nv = side === 2 ? 1 : side === 3 ? -1 : 0
        // 沿街的方向與往外（朝街）的方向
        const tx = nu !== 0 ? vx : ux
        const tz = nu !== 0 ? vz : uz
        const ox = ux * nu + vx * nv
        const oz = uz * nu + vz * nv
        const run = S - 2 * street - (nu !== 0 ? 0 : 2 * (deepest + CORNER_GAP))
        let pos = -run / 2
        while (pos < run / 2) {
          let f = pick(c, frontage.front)
          const left = run / 2 - pos
          if (f > left) {
            if (left < frontage.front[0]) break
            f = left
          }
          const mid = pos + f / 2
          pos += f + pick(c, frontage.gap)
          // 【空地】不是每一塊都蓋了
          if (c.rand() >= fillHere) continue
          const s = pick(c, frontage.scale)
          // 【正面落在彎過的街線上】這一棟正面的兩頭各彎一次、取弦當正面 —— 相鄰兩棟
          // 共用端點，一棟接一棟。只彎中心、面寬照彎之前的話，彎街內側的中心距被
          // 擠短，同一排互相插進去
          const fx = cx + ox * (S / 2 - street)
          const fz = cz + oz * (S / 2 - street)
          bend(fx + tx * (mid - f / 2), fz + tz * (mid - f / 2), q)
          bend(fx + tx * (mid + f / 2), fz + tz * (mid + f / 2), q2)
          const dx = q2[0]! - q[0]!
          const dz = q2[1]! - q[1]!
          const fb = Math.hypot(dx, dz)
          // 弦的法線，朝街廓裡（與 −o 同側）
          const sign = -dz * ox + dx * oz > 0 ? -1 : 1
          const nx = (-dz / fb) * sign
          const nz = (dx / fb) * sign
          const depth = BUILDING_DEPTH * s
          const bx = (q[0]! + q2[0]!) / 2 + nx * (depth / 2)
          const bz = (q[1]! + q2[1]!) / 2 + nz * (depth / 2)
          if (radial(c, bx, bz) > 1) continue
          // 【山牆朝街】面寬（x）沿著弦、屋脊往街廓裡
          const rot = wideAlong(dx, dz)
          const wide = fb / (BUILDING_WIDTH * s)
          const reach = footprintReach(s, wide)
          if (core?.role === 'clear' && !core.occ.free(bx, bz, reach)) continue
          // 【佔位圓比房子小】連棟街屋一棟貼一棟，照外框佔位的話一排會被擋掉一半。
          // 這個圓只擋教堂與中庭的樹；同一邊不會重疊是排法保證的
          if (!place(c, bx, bz, TOWN_HOUSE_ROOM, rot, s, roofKind(c, bx, bz),
            wide, pick(c, frontage.tall))) continue
          if (core?.role === 'mark') core.occ.add(bx, bz, reach)
          if (garden) {
            // 花園城市：房子後面的花園一到兩棵果樹
            const back = depth / 2 + pick(c, [5, 11])
            const gx = bx + nx * back
            const gz = bz + nz * back
            fruitTree(c, gx, gz)
            if (c.rand() < 0.5) gardenBush(c, gx + (dx / fb) * 5, gz + (dz / fb) * 5)
          }
        }
      }
      // 中庭的樹：椴樹、栗樹，比果樹高大；大一點的中庭有兩棵
      for (let k = 0; k < 2; k++) {
        if (c.rand() >= courtyardTree * (k === 0 ? 1 : 0.5)) continue
        bend(cx + (c.rand() - 0.5) * S * 0.3, cz + (c.rand() - 0.5) * S * 0.3, q)
        place(c, q[0]!, q[1]!, 5, c.rand() * 6.3, pick(c, [0.45, 0.7]), FloraKind.BroadTree)
      }
    }
  }
}

/** 鎮：中心不規則的老城、外圍方正的街廓。洛伊納是花園城市 */
function town(c: Ctx): void {
  const angle = c.rand() * Math.PI
  if (c.church !== null) churchyardTrees(c, c.church.x, c.church.z, c.church.scale)
  if (c.p.name === 'Leuna') {
    // 花園城市：整個鎮都是規整的獨棟排屋，前院 8 m、後面是花園
    townBlocks(c, angle, 66, 8, GARDEN_CITY, [4, 400], 1.01, 0, [0.9, 0.7], 0.2, true, null)
    return
  }
  const occ = new Occupancy()
  // 老城：小街廓、連棟的兩三層街屋、街道彎得厲害，格線另外轉一個角度
  townBlocks(c, angle + 0.35, 56, 4, OLD_TOWN, [9, 90], 0.4, 0, [0.95, 0.9], 0.15, false, { occ, role: 'mark' })
  // 外圍：方正的街廓、矮一點、有空隙，中庭有樹
  townBlocks(c, angle, 64, 5, OUTER_TOWN, [6, 260], 1.01, 0.4, [0.9, 0.55], 0.8, false, { occ, role: 'clear' })
}

/**
 * 村外圍一圈果園：輪廓外 0～30% 的一圈，成排的果樹、稍微錯開。
 * 鎮外也有，但稀。
 */
function orchards(c: Ctx): void {
  const density = c.p.kind === 'town' ? 0.12 : 0.35
  const G = 22
  const n = Math.ceil((1.35 * c.R) / G)
  const a = c.rand() * Math.PI
  const ux = Math.cos(a)
  const uz = Math.sin(a)
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const x = c.p.x + (ux * i - uz * j) * G + (c.rand() - 0.5) * 6
      const z = c.p.z + (uz * i + ux * j) * G + (c.rand() - 0.5) * 6
      const r = radial(c, x, z)
      if (r < 0.95 || r > 1.3) continue
      if (c.rand() >= density) continue
      fruitTree(c, x, z)
    }
  }
}

/**
 * 一個聚落的全部建築與樹。`avoid(x, z)` 為真的位置不放（河道、高速公路、
 * 砲位……）；`eastOfSaale` 決定村形（見檔頭）。
 *
 * `occ` 與 `church` 由 `settlementFlora` 給：所有聚落共用一份佔位、教堂先全部
 * 放好。單獨呼叫時自己建一份、自己放教堂。
 */
export function settlementPlacements(
  p: Place, avoid: (x: number, z: number) => boolean, eastOfSaale: boolean,
  occ: Occupancy = new Occupancy(), church: Placement | null = placeChurch(p, avoid, occ),
): Placement[] {
  const c: Ctx = {
    p, R: settlementRadius(p), rand: makeRand(nameHash(p.name)), out: [], occ, avoid, church,
  }
  if (church !== null) c.out.push(church)
  if (p.kind === 'town') town(c)
  else if (p.kind === 'hamlet') hamlet(c)
  else if (eastOfSaale) angerdorf(c)
  else haufendorf(c)
  orchards(c)
  return c.out
}

/**
 * 空桶。**查詢不得每次 `?? []`** —— 那會在植被補格時每一株配一個陣列（keepOut
 * 每一株都問）
 */
const NO_PLACEMENTS: readonly Placement[] = []
const NO_PLACES: readonly Place[] = []

/** 依 tile 分桶的鍵。tile 的索引夾在 ±4096 內（±1,000 km） */
function bucketKey(i: number, j: number): number {
  return (i + 4096) * 8192 + (j + 4096)
}

/**
 * 全部聚落的建築與樹，當成一個散佈器。**預先算好、依 tile 分桶** —— 十幾萬筆
 * 每一格都全掃的話，補格時一幀要比對幾十萬次。
 */
export function settlementFlora(
  places: readonly Place[], avoid: (x: number, z: number) => boolean,
  eastOfSaale: (x: number, z: number) => boolean,
): FloraSource {
  const buckets = new Map<number, Placement[]>()
  // 【共用一份佔位、教堂先放】相鄰的村可以只隔三四百公尺，外圍的果園伸得到
  // 隔壁的村心 —— 各自佔位的話，隔壁的果樹會長進教堂的空地
  const occ = new Occupancy()
  const churches = places.map((p) => placeChurch(p, avoid, occ))
  for (let i = 0; i < places.length; i++) {
    const p = places[i]!
    for (const b of settlementPlacements(p, avoid, eastOfSaale(p.x, p.z), occ, churches[i]!)) {
      const k = bucketKey(Math.floor(b.x / TILE_SIZE), Math.floor(b.z / TILE_SIZE))
      const list = buckets.get(k)
      if (list === undefined) buckets.set(k, [b])
      else list.push(b)
    }
  }
  return (x0, z0, x1, z1, heightAt, out) => {
    const i0 = Math.floor(x0 / TILE_SIZE)
    const i1 = Math.floor((x1 - 1e-6) / TILE_SIZE)
    const j0 = Math.floor(z0 / TILE_SIZE)
    const j1 = Math.floor((z1 - 1e-6) / TILE_SIZE)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (const b of buckets.get(bucketKey(i, j)) ?? NO_PLACEMENTS) {
          if (b.x < x0 || b.x >= x1 || b.z < z0 || b.z >= z1) continue
          pushFlora(out, b.x, heightAt(b.x, b.z), b.z, b.rot, b.scale, b.tint, b.kind, b.wide, b.tall)
        }
      }
    }
  }
}

/**
 * 「在某個聚落的輪廓內」的查詢。**依 1 km 分桶** —— 四百多個聚落，植被每一株
 * 都要問一次。
 */
export function settlementTest(places: readonly Place[]): (x: number, z: number) => boolean {
  const CELL = 1000
  const buckets = new Map<number, Place[]>()
  for (const p of places) {
    const r = settlementRadius(p) * 1.25
    for (let j = Math.floor((p.z - r) / CELL); j <= Math.floor((p.z + r) / CELL); j++) {
      for (let i = Math.floor((p.x - r) / CELL); i <= Math.floor((p.x + r) / CELL); i++) {
        const k = bucketKey(i, j)
        const list = buckets.get(k)
        if (list === undefined) buckets.set(k, [p])
        else list.push(p)
      }
    }
  }
  return (x, z) => {
    for (const p of buckets.get(bucketKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? NO_PLACES) {
      if (insideSettlement(p, x, z)) return true
    }
    return false
  }
}

/**
 * 鎮的地面。**村不鋪** —— 農莊只沿著巷子與綠地排，輪廓裡大半是院子後面的田與
 * 花園；鋪滿的話是一大片沒有田紋的平地。
 */
export function buildSettlementGround(sample: HeightSampler, places: readonly Place[]): Mesh {
  const regions: DecalRegion[] = places
    .filter((p) => p.kind === 'town')
    .map((p) => {
      // 輪廓的起伏最多 +22%（`outlineScale`），外接盒放 1.25 倍
      const r = settlementRadius(p) * 1.25
      const color = TOWN_GROUND
      return {
        x0: p.x - r, z0: p.z - r, x1: p.x + r, z1: p.z + r,
        inside: (x, z) => insideSettlement(p, x, z),
        colorAt: () => color,
      }
    })
  return buildDecals(sample, regions, 'settlementGround')
}
