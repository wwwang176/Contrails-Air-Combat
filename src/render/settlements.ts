import { FloraKind, pushFlora, SHAPE_ONE, type FloraSource } from './flora'
import { BUILDING_DEPTH, BUILDING_WALL, BUILDING_WIDTH } from './floraShapes'
import { TILE_SIZE } from './vegetation'
import { buildDecals, DECAL_LIFT, type DecalGrid, type DecalRegion } from './groundDecal'
import { MEADOW } from './river'
import {
  cellAt, cellRing, cellSize, edgeInward, edgeLine, Footprints, planTown, roadAngles, StreetIndex,
  type Cell, type PlanSpec, type Rect, type Street, type TownPlan,
} from './townPlan'
import {
  insideRing, insideSettlement, nameHash, outlineScale, settlementRadius, type Place,
} from '../world/landFeatures'
import type { HeightSampler } from '../world/river'
import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial } from 'three'

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
 * - **鎮**：幾條放射主路匯到市集廣場，老城是彎曲的窄巷與深的連棟市民屋，城牆的
 *   位置是環路，外圍的街順著放射路一圈圈往外長（`townPlan.ts`）。洛伊納是為煉油
 *   廠工人蓋的**花園城市**：緩彎的街、雙併住宅，每戶帶花園。
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
/**
 * 村有教堂的機率，照人口：小村多半沒有自己的教堂（幾個村共用一個教區教堂），
 * 大村才有。沒有人口資料的村取中間那一檔。鎮一定有、小聚落一定沒有
 */
function villageChurchChance(pop: number | undefined): number {
  if (pop === undefined) return 0.5
  return pop < 250 ? 0.2 : pop < 500 ? 0.5 : 0.8
}
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
 * 鎮上沿街的建築，全部是公尺：面寬、進深、牆高、棟與棟的空隙。換成
 * `pushFlora` 的縮放與倍率見 `sized`。
 *
 * - 老城：深的市民屋，連棟、兩三層半，屋頂陡
 * - 外圍：出租公寓與別墅，有空隙
 * - 花園城市：一層半的雙併住宅，每戶帶花園
 */
interface Frontage {
  readonly front: readonly [number, number]
  readonly depth: readonly [number, number]
  readonly wall: readonly [number, number]
  readonly gap: readonly [number, number]
  /** 正面離街面多遠（人行道、前院），m */
  readonly setback: number
}
const OLD_TOWN: Frontage = { front: [6, 12], depth: [12, 16], wall: [8, 12], gap: [0, 0.4], setback: 0.5 }
const OUTER_TOWN: Frontage = { front: [10, 18], depth: [10, 13], wall: [7, 11], gap: [1, 5], setback: 1.5 }
const GARDEN_CITY: Frontage = { front: [14, 19], depth: [8, 9.5], wall: [5, 6.5], gap: [7, 10], setback: 5 }

/**
 * 老城前屋後面的後屋：與前面那一棟的空隙、進深、牆高（m），面寬佔前面那一棟的
 * 比例，每一排蓋的機率，最多幾排
 */
const REAR = { gap: [2, 4], depth: [6, 9], wall: [5, 8], front: [0.7, 1], chance: 0.85, rows: 2 } as const

/** 小菜園：棚子一格的邊長、棚子的面寬、進深、牆高（m） */
const ALLOTMENT = { cell: 12, front: 3, depth: 2.5, wall: 2 } as const
/** 工廠、學校的大院：兩棟長條建築的長、進深、牆高，兩棟之間的空隙（m） */
const YARD = { length: [36, 50], depth: [12, 16], wall: [7, 10], between: 12 } as const
/**
 * 鎮上房子的佔位半徑，m。房子之間靠精確的外框檢查（`rectOk`），這個圓只擋教堂
 * 與樹。**要小於最窄面寬的一半** —— 老城 6 m 寬的街屋一棟貼一棟，中心只隔
 * 6 m，佔位圓比這大的話每隔一棟被擋掉一棟
 */
const TOWN_HOUSE_ROOM = 2.5
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
/** 街面：石板路與柏油，比鎮的地面暗一截 */
const STREET_COLOR = 0x34322e

/** 公園、墓園、小菜園的地面：河灘草甸的枯草色（`river.ts` 的 `MEADOW`） */
const PARK_GROUND = MEADOW

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
  /** 鋪草色地面的街廓（公園、墓園、小菜園），`buildSettlementGround` 讀 */
  readonly greens: GreenPatch[]
  /** 鎮上的街，`buildStreets` 讀 */
  readonly streets: Street[]
  /** 鎮的放射主路方位角（`roadAngles`）。村不用 */
  readonly roads: readonly number[]
}

export type { Street }

/** 鋪草色地面的一塊：中心、多邊形（已經往內縮）、中心到多邊形最遠的距離 */
export interface GreenPatch {
  readonly x: number
  readonly z: number
  readonly ring: readonly (readonly [number, number])[]
  readonly reach: number
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
 * 公尺換成 `pushFlora` 的縮放與倍率：進深 → 縮放、面寬 → 面寬倍率、牆高 → 樓高
 * 倍率。屋頂高跟著牆高走（`BUILDING_ROOF` 乘同一個倍率），高的屋頂陡
 */
function sized(front: number, depth: number, wall: number): { scale: number; wide: number; tall: number } {
  const scale = depth / BUILDING_DEPTH
  return { scale, wide: front / (BUILDING_WIDTH * scale), tall: wall / (BUILDING_WALL * scale) }
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
  if (p.kind === 'village' && ((h >>> 20) & 0xff) / 256 >= villageChurchChance(p.pop)) return null
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

/**
 * 鎮的一區（老城或外圍）怎麼蓋：沿街建築、中心 → 外緣蓋房子的機率、中庭種樹
 * 的機率
 */
interface ZoneStyle {
  readonly frontage: Frontage
  readonly fill: readonly [number, number]
  readonly courtyardTree: number
  /** 每一棟前屋後面隔個小院子蓋後屋（`REAR`） */
  readonly rear: boolean
  /** 房子後面的花園種果樹（花園城市） */
  readonly garden: boolean
  /** 街廓有別的用途：公園、墓園、小菜園、大院（`blockUse`） */
  readonly uses: boolean
}

/** 一種鎮：街網（`townPlan.ts`）、市集廣場在教堂留地外再留多寬（m）、兩區 */
interface TownStyle {
  readonly plan: PlanSpec
  readonly market: number
  readonly old: ZoneStyle
  readonly outer: ZoneStyle
}

/**
 * 一般的鎮：老城是窄巷、深的連棟市民屋加後屋，城牆的位置是環路；外圍是公寓與
 * 別墅，夾著公園、墓園、小菜園、大院。
 *
 * 【市集廣場多留 16 m】教堂墓園的樹種在留地外 5 m，樹冠再 6 m —— 少了的話樹長在
 * 廣場那一圈街上
 */
const TOWN_STYLE: TownStyle = {
  plan: {
    oldTown: 0.4,
    old: { band: [55, 75], cross: [45, 70], half: 2.5 },
    outer: { band: [70, 95], cross: [90, 130], half: 4 },
    mainHalf: 5, ringHalf: 6, marketHalf: 4,
    warp: { old: 10, outer: 7, wave: 130 },
  },
  market: 16,
  old: { frontage: OLD_TOWN, fill: [0.97, 0.92], courtyardTree: 0, rear: true, garden: false, uses: false },
  outer: { frontage: OUTER_TOWN, fill: [0.9, 0.55], courtyardTree: 0.8, rear: false, garden: false, uses: true },
}

/** 洛伊納的花園城市：沒有老城，緩彎的街、雙併住宅、前院、後面是花園 */
const GARDEN_CITY_STYLE: TownStyle = {
  plan: {
    oldTown: 0,
    old: { band: [60, 75], cross: [100, 140], half: 3.5 },
    outer: { band: [60, 75], cross: [100, 140], half: 3.5 },
    mainHalf: 4.5, ringHalf: 4.5, marketHalf: 4,
    warp: { old: 4, outer: 4, wave: 200 },
  },
  market: 16,
  old: { frontage: GARDEN_CITY, fill: [0.95, 0.85], courtyardTree: 0.2, rear: false, garden: true, uses: false },
  outer: { frontage: GARDEN_CITY, fill: [0.95, 0.85], courtyardTree: 0.2, rear: false, garden: true, uses: false },
}

type BlockUse = 'built' | 'park' | 'cemetery' | 'allotment' | 'yard'

/**
 * 這個街廓拿來做什麼。**鎮不是每一塊都蓋滿同一種房子** —— 沒有公園、墓園、
 * 小菜園、工廠大院的話，密度不高，從空中看卻是一整片屋頂海。
 *
 * 墓園一個鎮一個、在外緣；小菜園在外緣；公園在中圈；大院哪裡都可能。
 */
function blockUse(c: Ctx, r: number, state: { cemetery: boolean }): BlockUse {
  const u = c.rand()
  if (!state.cemetery && r >= 0.75 && u < 0.25) {
    state.cemetery = true
    return 'cemetery'
  }
  if (r >= 0.7 && u < 0.12) return 'allotment'
  if (r >= 0.4 && r < 0.9 && u >= 0.12 && u < 0.19) return 'park'
  if (u >= 0.19 && u < 0.25) return 'yard'
  return 'built'
}

/** 牆與牆至少隔多遠，m。負的是容許浮點誤差：連棟街屋的牆本來就貼著 */
const HOUSE_GAP = -0.04
/** 牆外框離街面至少多遠，m：人行道 */
const SIDEWALK = 0.3
/** 沿街的房子放不下時依序試的（進深、面寬）倍率，見 `frontageAlong` */
const SHRINK = [[1, 1], [0.7, 1], [1, 0.8], [0.7, 0.8]] as const

/**
 * 生成一個鎮的房子時共用的：街網、已經放的牆外框、街心點、正在排的那一個街廓的
 * 外框多邊形（`cellRing`）
 */
interface TownCtx {
  readonly plan: TownPlan
  readonly foot: Footprints
  readonly streets: StreetIndex
  ring: readonly (readonly [number, number])[]
}

/**
 * 這個外框能不能蓋：中心在正在排的街廓裡、不在避開的地方、在輪廓內、不與任何
 * 一棟相交、不壓到街、不在別的佔位圓裡（教堂、樹）
 */
function rectOk(c: Ctx, t: TownCtx, r: Rect): boolean {
  return insideRing(t.ring, r.x, r.z) && !c.avoid(r.x, r.z) && radial(c, r.x, r.z) <= 1.02
    && t.foot.free(r, HOUSE_GAP) && t.streets.clear(r, SIDEWALK) && c.occ.free(r.x, r.z, TOWN_HOUSE_ROOM)
}

/**
 * 蓋一棟：外框 `r` 已經檢查過。牆高 `wall` m。
 *
 * 【面寬倍率無條件捨去到 `1 / SHAPE_ONE`】`pushFlora` 把倍率量化成一個位元組；
 * 四捨五入的話畫出來的房子比檢查過的外框寬一點點，連棟街屋因此互相插進去
 */
function build(c: Ctx, t: TownCtx, r: Rect, wall: number, kind: FloraKind): void {
  const b = sized(2 * r.hw, 2 * r.hd, wall)
  const wide = Math.floor(b.wide * SHAPE_ONE) / SHAPE_ONE
  place(c, r.x, r.z, TOWN_HOUSE_ROOM, wideAlong(r.ax, r.az), b.scale, kind, wide, b.tall)
  t.foot.add(r)
}

/** 種一棵樹：在正在排的街廓裡、佔位圓外、不壓到牆與街 */
function treeOk(c: Ctx, t: TownCtx, x: number, z: number, r: number): boolean {
  const box: Rect = { x, z, ax: 1, az: 0, hw: r, hd: r }
  return insideRing(t.ring, x, z) && t.foot.free(box, 0) && t.streets.clear(box, 0) && c.occ.free(x, z, r)
}

/**
 * 不沿街蓋房子的街廓。在街廓的參數矩形裡排：`u` 沿 θ、`v` 沿 r，都是 0～1。
 * 公園、墓園、小菜園的地面鋪草色（`Ctx.greens`）。
 */
function openCell(c: Ctx, t: TownCtx, cell: Cell, use: Exclude<BlockUse, 'built'>): void {
  const q: number[] = [0, 0]
  const q2: number[] = [0, 0]
  const at = (u: number, v: number, out: number[]): void => cellAt(t.plan, cell, u, v, out)
  // 街廓大約的邊長，m：把公尺換成參數
  const { W, H } = cellSize(t.plan, cell)
  const edge = Math.max(...cell.edges) + 3
  const du = Math.min(0.45, edge / W)
  const dv = Math.min(0.45, edge / H)
  if (use !== 'yard') {
    // 草地退到街面外（`du`、`dv` 已經含街半寬）
    const gu = du
    const gv = dv
    if (gu < 0.5 && gv < 0.5) {
      // 【每條邊取好幾點】街是彎的：大街廓只取四個角的話，弦與弧差到十公尺，草色
      // 切進街裡
      const ring: [number, number][] = []
      const K = 6
      const walk: [number, number, number, number][] = [
        [gu, gv, 1 - gu, gv], [1 - gu, gv, 1 - gu, 1 - gv], [1 - gu, 1 - gv, gu, 1 - gv], [gu, 1 - gv, gu, gv],
      ]
      for (const [u0, v0, u1, v1] of walk) {
        for (let k = 0; k < K; k++) {
          at(u0 + ((u1 - u0) * k) / K, v0 + ((v1 - v0) * k) / K, q)
          ring.push([q[0]!, q[1]!])
        }
      }
      at(0.5, 0.5, q)
      const reach = Math.max(...ring.map(([x, z]) => Math.hypot(x - q[0]!, z - q[1]!)))
      c.greens.push({ x: q[0]!, z: q[1]!, ring, reach })
    }
  }
  const grid = (spacing: number, fn: (u: number, v: number) => void): void => {
    const nu = Math.max(1, Math.floor((W * (1 - 2 * du)) / spacing))
    const nv = Math.max(1, Math.floor((H * (1 - 2 * dv)) / spacing))
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) fn(du + ((1 - 2 * du) * (i + 0.5)) / nu, dv + ((1 - 2 * dv) * (j + 0.5)) / nv)
    }
  }
  if (use === 'park') {
    // 椴樹、栗樹、橡樹，散在草地上
    const n = Math.min(16, Math.max(6, Math.round((W * H) / 450)))
    for (let k = 0; k < n; k++) {
      at(du + c.rand() * (1 - 2 * du), dv + c.rand() * (1 - 2 * dv), q)
      if (treeOk(c, t, q[0]!, q[1]!, 5)) {
        place(c, q[0]!, q[1]!, 5, c.rand() * 6.3, pick(c, [0.5, 0.8]), FloraKind.BroadTree)
      }
    }
  } else if (use === 'cemetery') {
    // 四周一圈大樹，裡面成排的小針葉樹（紅豆杉、側柏）
    const ring = (n: number, fn: (s: number) => [number, number]): void => {
      for (let k = 0; k <= n; k++) {
        const [u, v] = fn(k / n)
        at(u, v, q)
        if (treeOk(c, t, q[0]!, q[1]!, 4)) {
          place(c, q[0]!, q[1]!, 4, c.rand() * 6.3, pick(c, [0.5, 0.7]), FloraKind.BroadTree)
        }
      }
    }
    const nu = Math.max(1, Math.round(W / 12))
    const nv = Math.max(1, Math.round(H / 12))
    ring(nu, (s) => [du + (1 - 2 * du) * s, dv])
    ring(nu, (s) => [du + (1 - 2 * du) * s, 1 - dv])
    ring(nv, (s) => [du, dv + (1 - 2 * dv) * s])
    ring(nv, (s) => [1 - du, dv + (1 - 2 * dv) * s])
    grid(7, (u, v) => {
      at(u, v, q)
      if (treeOk(c, t, q[0]!, q[1]!, 2)) {
        place(c, q[0]!, q[1]!, 2, c.rand() * 6.3, pick(c, [0.22, 0.32]), FloraKind.ConeTree)
      }
    })
  } else if (use === 'allotment') {
    // 一格一個小棚子、一叢灌木，棚子順著街廓或轉 90°
    grid(ALLOTMENT.cell, (u, v) => {
      if (c.rand() < 0.2) return
      at(u, v, q)
      at(u + 0.01, v, q2)
      const len = Math.hypot(q2[0]! - q[0]!, q2[1]! - q[1]!) || 1
      let ax = (q2[0]! - q[0]!) / len
      let az = (q2[1]! - q[1]!) / len
      if (c.rand() < 0.5) [ax, az] = [-az, ax]
      const r: Rect = { x: q[0]!, z: q[1]!, ax, az, hw: ALLOTMENT.front / 2, hd: ALLOTMENT.depth / 2 }
      const kind = c.rand() < 0.6 ? FloraKind.TarBarn : FloraKind.Barn
      if (rectOk(c, t, r)) build(c, t, r, ALLOTMENT.wall, kind)
      const bx = q[0]! + ax * 3.5 - az * 3.5
      const bz = q[1]! + az * 3.5 + ax * 3.5
      if (treeOk(c, t, bx, bz, 2)) gardenBush(c, bx, bz)
    })
  } else {
    // 【大院】兩棟平行的長條建築，順著街廓長的那一邊、中間隔 `YARD.between`
    const alongU = W >= H
    const span = alongU ? W : H
    const across = alongU ? H : W
    const length = Math.min(pick(c, YARD.length), span * (1 - 2 * (alongU ? du : dv)))
    for (const side of [-1, 1]) {
      const depth = pick(c, YARD.depth)
      const off = 0.5 + (side * (YARD.between / 2 + depth / 2)) / across
      const a0 = 0.5 - length / 2 / span
      const a1 = 0.5 + length / 2 / span
      if (alongU) {
        at(a0, off, q)
        at(a1, off, q2)
      } else {
        at(off, a0, q)
        at(off, a1, q2)
      }
      const dx = q2[0]! - q[0]!
      const dz = q2[1]! - q[1]!
      const fb = Math.hypot(dx, dz)
      const r: Rect = {
        x: (q[0]! + q2[0]!) / 2, z: (q[1]! + q2[1]!) / 2, ax: dx / fb, az: dz / fb, hw: fb / 2, hd: depth / 2,
      }
      // 長條建築只查中心的話，兩頭可能伸進河道或高速公路
      if (c.avoid(q[0]!, q[1]!) || c.avoid(q2[0]!, q2[1]!) || !rectOk(c, t, r)) continue
      build(c, t, r, pick(c, YARD.wall), c.rand() < 0.6 ? FloraKind.TarBarn : FloraKind.SlateHouse)
    }
  }
}

/** 沿街的一棟：外框與往街廓裡的法線 */
interface FrontHouse {
  readonly r: Rect
  readonly nx: number
  readonly nz: number
}

/**
 * 老城的後屋：每一棟前屋後面隔個小院子一棟接一棟往裡蓋，最多 `REAR.rows` 排，
 * 放不下就停。**等街廓四條邊的前屋都排完才蓋** —— 先排的那條邊的後屋會一路伸到
 * 街廓中間，把後排那幾條邊的前屋擠掉
 */
function rearRows(c: Ctx, t: TownCtx, fronts: readonly FrontHouse[]): void {
  for (const { r, nx, nz } of fronts) {
    let front: Rect = r
    for (let k = 0; k < REAR.rows && c.rand() < REAR.chance; k++) {
      const rdWant = pick(c, REAR.depth)
      const g = pick(c, REAR.gap)
      const rw = front.hw * pick(c, REAR.front)
      let placed: Rect | null = null
      for (const [kd, kw] of SHRINK) {
        const rd = rdWant * kd
        const back = front.hd + g + rd / 2
        const rr: Rect = { x: front.x + nx * back, z: front.z + nz * back, ax: r.ax, az: r.az, hw: rw * kw, hd: rd / 2 }
        if (rectOk(c, t, rr)) {
          build(c, t, rr, pick(c, REAR.wall), roofKind(c, rr.x, rr.z))
          placed = rr
          break
        }
      }
      if (placed === null) break
      front = placed
    }
  }
}

/**
 * 沿街廓的一條邊排房子。走街心線的弧長，每一棟取一段面寬，兩頭往街廓裡退
 * 「街半寬 + 退縮」，弦當正面、弦的法線往裡量進深。**每一棟都做精確的外框檢查**
 * （`rectOk`）：轉角、彎街、後屋都交給它，放不下就跳過（試一次淺一點的）。
 */
function frontageAlong(
  c: Ctx, t: TownCtx, cell: Cell, e: number, zs: ZoneStyle, fill: number, fronts: FrontHouse[],
): void {
  const fr = zs.frontage
  const line = edgeLine(t.plan, cell, e, 2)
  const n = line.xs.length
  const L = line.len[n - 1]!
  const off = cell.edges[e]! + fr.setback
  const inward: number[] = [0, 0]
  /** 弧長 `s` 在這條邊上的參數（0～1）：邊是照參數等分取樣的 */
  const paramAt = (s: number): number => {
    let i = 0
    while (i + 2 < n && line.len[i + 1]! < s) i++
    const seg = line.len[i + 1]! - line.len[i]! || 1
    return (i + Math.min(1, Math.max(0, (s - line.len[i]!) / seg))) / (n - 1)
  }
  /** 弧長 `s` 處的街心點往街廓裡退 `off` */
  const inset = (s: number, out: number[]): void => {
    let i = 0
    while (i + 2 < n && line.len[i + 1]! < s) i++
    const seg = line.len[i + 1]! - line.len[i]! || 1
    const k = Math.min(1, Math.max(0, (s - line.len[i]!) / seg))
    const tx = (line.xs[i + 1]! - line.xs[i]!) / seg
    const tz = (line.zs[i + 1]! - line.zs[i]!) / seg
    const px = line.xs[i]! + (line.xs[i + 1]! - line.xs[i]!) * k
    const pz = line.zs[i]! + (line.zs[i + 1]! - line.zs[i]!) * k
    edgeInward(t.plan, cell, e, paramAt(s), inward)
    const sign = -tz * inward[0]! + tx * inward[1]! >= 0 ? 1 : -1
    out[0] = px - tz * sign * off
    out[1] = pz + tx * sign * off
  }
  const a: number[] = [0, 0]
  const b: number[] = [0, 0]
  let pos = 0
  while (pos < L) {
    let f = pick(c, fr.front)
    if (pos + f > L) {
      if (L - pos < fr.front[0]) break
      f = L - pos
    }
    const s0 = pos
    pos += f + pick(c, fr.gap)
    // 【空地】不是每一塊都蓋了
    if (c.rand() >= fill) continue
    inset(s0, a)
    inset(s0 + f, b)
    const dx = b[0]! - a[0]!
    const dz = b[1]! - a[1]!
    const fb = Math.hypot(dx, dz)
    if (fb < fr.front[0] * 0.6) continue
    const ax = dx / fb
    const az = dz / fb
    // 弦的法線，朝街廓裡（照這一段中點的參數方向，見 `edgeInward`）
    edgeInward(t.plan, cell, e, paramAt(s0 + f / 2), inward)
    const sign = -az * inward[0]! + ax * inward[1]! >= 0 ? 1 : -1
    const nx = -az * sign
    const nz = ax * sign
    const mx = (a[0]! + b[0]!) / 2
    const mz = (a[1]! + b[1]!) / 2
    const want = pick(c, fr.depth)
    // 【放不下就縮】凹的那一側（街廓外緣的弧）一排房子的背面往裡收攏，深的街屋
    // 一棟咬一棟將近一公尺；依序試淺一點、窄一點
    let r: Rect | null = null
    let depth = want
    for (const [kd, kw] of SHRINK) {
      depth = want * kd
      const cand: Rect = { x: mx + nx * (depth / 2), z: mz + nz * (depth / 2), ax, az, hw: (fb * kw) / 2, hd: depth / 2 }
      if (rectOk(c, t, cand)) {
        r = cand
        break
      }
    }
    if (r === null) continue
    build(c, t, r, pick(c, fr.wall), roofKind(c, r.x, r.z))
    // 後屋等四條邊的前屋都排完再蓋（`rearRows`）
    if (zs.rear) fronts.push({ r, nx, nz })
    if (zs.garden) {
      // 花園城市：房子後面的花園一到兩棵果樹
      const back = depth / 2 + pick(c, [5, 11])
      const gx = r.x + nx * back
      const gz = r.z + nz * back
      if (treeOk(c, t, gx, gz, 4)) fruitTree(c, gx, gz)
      if (c.rand() < 0.5 && treeOk(c, t, gx + ax * 5, gz + az * 5, 2.5)) gardenBush(c, gx + ax * 5, gz + az * 5)
    }
  }
}

/**
 * 鎮：照 `townPlan.ts` 的街網，沿每個街廓每一條有街的邊排房子；公園、墓園、
 * 小菜園、大院另外排。洛伊納是花園城市
 */
function town(c: Ctx): void {
  if (c.church !== null) churchyardTrees(c, c.church.x, c.church.z, c.church.scale)
  const style = c.p.name === 'Leuna' ? GARDEN_CITY_STYLE : TOWN_STYLE
  const room = CHURCH_REACH * (c.church?.scale ?? 1) + CHURCH_YARD
  const plan = planTown({
    x: c.p.x, z: c.p.z, R: c.R, outline: (th) => outlineScale(c.p, th), roads: c.roads,
    market: room + style.market, rand: c.rand, avoid: c.avoid, spec: style.plan,
  })
  for (const s of plan.streets) c.streets.push(s)
  const t: TownCtx = { plan, foot: new Footprints(), streets: new StreetIndex(plan.streets), ring: [] }
  const uses = { cemetery: false }
  const q: number[] = [0, 0]
  for (const cell of plan.cells) {
    t.ring = cellRing(plan, cell, 4)
    const zs = cell.zone === 'old' ? style.old : style.outer
    const r = (cell.r0 + cell.r1) / 2
    const use = zs.uses ? blockUse(c, r, uses) : 'built'
    if (use !== 'built') {
      openCell(c, t, cell, use)
      continue
    }
    const fill = zs.fill[0] + (zs.fill[1] - zs.fill[0]) * Math.min(1, r * r)
    const fronts: FrontHouse[] = []
    for (let e = 0; e < 4; e++) if (cell.edges[e]! > 0) frontageAlong(c, t, cell, e, zs, fill, fronts)
    rearRows(c, t, fronts)
    // 中庭的樹：椴樹、栗樹，比果樹高大；大一點的中庭有兩棵
    for (let k = 0; k < 2; k++) {
      if (c.rand() >= zs.courtyardTree * (k === 0 ? 1 : 0.5)) continue
      cellAt(plan, cell, pick(c, [0.35, 0.65]), pick(c, [0.35, 0.65]), q)
      if (treeOk(c, t, q[0]!, q[1]!, 5)) place(c, q[0]!, q[1]!, 5, c.rand() * 6.3, pick(c, [0.45, 0.7]), FloraKind.BroadTree)
    }
  }
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
 * `occ` 與 `church` 由 `settlementLayout` 給：所有聚落共用一份佔位、教堂先全部
 * 放好。單獨呼叫時自己建一份、自己放教堂。鋪草色的街廓加進 `greens`、鎮上的
 * 街加進 `streets`。
 */
export function settlementPlacements(
  p: Place, avoid: (x: number, z: number) => boolean, eastOfSaale: boolean,
  occ: Occupancy = new Occupancy(), church: Placement | null = placeChurch(p, avoid, occ),
  greens: GreenPatch[] = [], streets: Street[] = [], roads: readonly number[] = [],
): Placement[] {
  const c: Ctx = {
    p, R: settlementRadius(p), rand: makeRand(nameHash(p.name)), out: [], occ, avoid, church, greens, streets, roads,
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

/** 全部聚落的建築與樹，當成一個散佈器 */
export function settlementFlora(
  places: readonly Place[], avoid: (x: number, z: number) => boolean,
  eastOfSaale: (x: number, z: number) => boolean,
): FloraSource {
  return settlementLayout(places, avoid, eastOfSaale).flora
}

/**
 * 全部聚落的建築與樹（`flora`，散佈器）、鋪草色的街廓（`greens`，給
 * `buildSettlementGround`）與鎮上的街（`streets`，給 `buildStreets`）。**建築預先
 * 算好、依 tile 分桶** —— 十幾萬筆每一格都全掃的話，補格時一幀要比對幾十萬次。
 */
export function settlementLayout(
  places: readonly Place[], avoid: (x: number, z: number) => boolean,
  eastOfSaale: (x: number, z: number) => boolean,
): { flora: FloraSource; greens: readonly GreenPatch[]; streets: readonly Street[] } {
  const buckets = new Map<number, Placement[]>()
  const greens: GreenPatch[] = []
  const streets: Street[] = []
  // 【共用一份佔位、教堂先放】相鄰的村可以只隔三四百公尺，外圍的果園伸得到
  // 隔壁的村心 —— 各自佔位的話，隔壁的果樹會長進教堂的空地
  const occ = new Occupancy()
  const churches = places.map((p) => placeChurch(p, avoid, occ))
  // 放射主路往鄰近的村鎮（小聚落不算）
  const hubs = places.filter((p) => p.kind !== 'hamlet')
  for (let i = 0; i < places.length; i++) {
    const p = places[i]!
    const roads = p.kind === 'town' ? roadAngles(p.x, p.z, hubs) : []
    for (const b of settlementPlacements(p, avoid, eastOfSaale(p.x, p.z), occ, churches[i]!, greens, streets, roads)) {
      const k = bucketKey(Math.floor(b.x / TILE_SIZE), Math.floor(b.z / TILE_SIZE))
      const list = buckets.get(k)
      if (list === undefined) buckets.set(k, [b])
      else list.push(b)
    }
  }
  const flora: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
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
  return { flora, greens, streets }
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
export function buildSettlementGround(
  sample: HeightSampler, places: readonly Place[], grid?: DecalGrid, name = 'settlementGround',
): Mesh {
  const regions: DecalRegion[] = places
    .filter((p) => p.kind === 'town')
    .map((p) => {
      // 輪廓的起伏最多 +22%（`outlineScale`），外接盒放 1.25 倍
      const r = settlementRadius(p) * 1.25
      return {
        x0: p.x - r, z0: p.z - r, x1: p.x + r, z1: p.z + r,
        inside: (x, z) => insideSettlement(p, x, z),
        colorAt: () => TOWN_GROUND,
      }
    })
  return buildDecals(sample, regions, name, grid)
}

/**
 * 公園、墓園、小菜園的草地：每一塊一個多邊形（從中心扇形切三角形），頂點取
 * 地形高度再抬 `DECAL_LIFT`。
 *
 * 【不用鎮地面的頂點色】那是 20 m 一格、三角形裡內插的 —— 草色會漸變到框外一格，
 * 跨過窄街染到隔壁的街廓。多邊形跟著街廓的邊走，烘進貼圖時邊是準的。
 *
 * 【不與地形共平面】多邊形的邊不在地形的格線上，坡地上中間會沉一點。平常整顆
 * 烘進田色貼圖（`terrain.ts`），只在旁路時畫
 */
export function buildGreens(sample: HeightSampler, greens: readonly GreenPatch[]): Mesh {
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const c = new Color(PARK_GROUND)
  for (const g of greens) {
    const base = pos.length / 3
    pos.push(g.x, sample(g.x, g.z) + DECAL_LIFT, g.z)
    col.push(c.r, c.g, c.b)
    for (const [x, z] of g.ring) {
      pos.push(x, sample(x, z) + DECAL_LIFT, z)
      col.push(c.r, c.g, c.b)
    }
    const n = g.ring.length
    for (let i = 0; i < n; i++) {
      const a = base + 1 + i
      const b = base + 1 + ((i + 1) % n)
      // 【捲繞朝上】多邊形繞的方向隨街廓而定，逐片對
      const ux = pos[a * 3]! - g.x
      const uz = pos[a * 3 + 2]! - g.z
      const vx = pos[b * 3]! - g.x
      const vz = pos[b * 3 + 2]! - g.z
      if (uz * vx - ux * vz > 0) idx.push(base, a, b)
      else idx.push(base, b, a)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  const mesh = new Mesh(geo, new MeshStandardMaterial({
    vertexColors: true, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }))
  mesh.name = 'greens'
  return mesh
}

/**
 * 鎮上的街：每一段一條貼著地面的帶子，頂點取地形高度再抬 `DECAL_LIFT`。
 *
 * 【偏移與高速公路同級】要蓋過鎮的地面（−1／−2）與河灘草甸（−2／−4）—— 沿河的
 * 鎮一半在草甸上。水面（−4／−8）仍蓋過它；高速公路上的那一段已經斷開
 * （`streetEdge`）。
 */
export function buildStreets(sample: HeightSampler, streets: readonly Street[]): Mesh {
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
    // 【捲繞方向】與高速公路同一個排法：左在 2i、右在 2i+1，「左、下一個左、右」朝上
    for (let i = 0; i + 1 < n; i++) {
      const k = base + i * 2
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  const mesh = new Mesh(geo, new MeshStandardMaterial({
    vertexColors: true, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  }))
  mesh.name = 'streets'
  return mesh
}
