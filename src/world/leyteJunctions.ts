import { BROAD_CROWN_R } from '../specs/flora'
import type { CrateField, ParkedVehicle } from './depot'
import { LEYTE_ROADS, roadTreeClear } from './leyteRoads'

/**
 * # 路口的補給據點（日 M2）
 *
 * 三個路口各一處：路邊停著等通行的卡車（任務目標，與車隊、灘頭的卡車一起算
 * 摧毀數）、守路口的 M16 防空車、卡車後面的木箱堆（純佈景，`render/depot.ts`）。
 *
 * ```
 *   B  主路 × 東路    車隊路線中段
 *   C  主路 × 西路    離前線約 1 km
 *   F  西路 × 土路    主路以西，要離開車隊路線才打得到
 * ```
 *
 * 【擺法】路口往外的每一條路臂量一個方位，路臂之間最寬的那個扇區放卡車與
 * 木箱堆，其次的兩個扇區各放一輛 M16。每一樣都沿扇區的中分線往外推，直到
 * 整個腳印離開所有路的清空帶（`roadTreeClear`）——車隊開過 B、C 時不會穿過
 * 停著的車，樹也不會長在路面上。
 *
 * 【不進 `LEYTE_FLAK_SITES`】那張表會讓山脈讓位（`world/leyte.ts` 的
 * `fitLobe`），加進去整片高度場就變了。
 */
export interface LeyteJunction {
  readonly id: 'B' | 'C' | 'F'
  /** 路口的世界座標：兩條路共用的折線點 */
  readonly x: number
  readonly z: number
  readonly trucks: readonly ParkedVehicle[]
  readonly flak: readonly ParkedVehicle[]
  readonly dumps: readonly CrateField[]
}

/**
 * 三個路口：`road` 與 `at` 指出路口是哪一條路的哪一端（`LEYTE_ROADS` 的編號，
 * 見 `leyteRoads.ts` 的 `SIDE_ROADS`）。**卡車數是起始值**：三處合計 8 輛，
 * 加上車隊 9、灘頭 9 共 26 輛 —— 門檻 20 加放行 7 要大於總數
 * （`campaigns.test.ts`）。
 */
const SITES: readonly { readonly id: LeyteJunction['id']; readonly road: number; readonly at: 'first' | 'last'; readonly trucks: number }[] = [
  { id: 'B', road: 3, at: 'first', trucks: 3 },
  { id: 'C', road: 4, at: 'first', trucks: 2 },
  { id: 'F', road: 9, at: 'last', trucks: 3 },
]
/** 每一處的 M16 輛數 */
const FLAK_PER_SITE = 2
/** M16 離路口最遠多少，m：扇區窄到這裡還離不開路就不用它 */
const FLAK_REACH = 60
/** 停在卡車排側邊的 M16 與最外側卡車隔幾個車位 */
const FLAK_ROW_SLOTS = 1.5

/** 路臂的方位在路口外這麼遠量，m */
const ARM_REACH = 80
/** 卡車並排的間距（車側到車側約 7 m），m —— 一枚直擊炸得到兩輛，炸不到整排 */
const TRUCK_GAP = 9.5
/** 木箱堆在卡車排後方多遠、左右各偏多少，m */
const DUMP_BEHIND = 34
const DUMP_SIDE = 15
const DUMP_WIDTH = 22
const DUMP_DEPTH = 14
/** 腳印離路的清空帶再留這麼寬，m */
const ROAD_MARGIN = 6
/** 往外推的起點與步長，m */
const PUSH_START = 25
const PUSH_STEP = 2
/** 卡車、M16 腳印的半徑（車長一半再寬一點），m */
const VEHICLE_R = 4.5
/**
 * 補給堆與車子周圍這麼寬不長樹，m。**要大過最大的樹冠半徑**：清的是樹幹的位置，
 * 只留得比樹冠窄的話，路邊的樹冠會蓋在車頂上，從空中找不到車
 */
const JUNCTION_CLEAR_PAD = BROAD_CROWN_R + 2

/** (x, z) 離每一條路的清空帶還有多遠，m；負的就是壓在上面。載入期用 */
function roadGap(x: number, z: number): number {
  let gap = Infinity
  for (const road of LEYTE_ROADS) {
    const clear = roadTreeClear(road)
    const pts = road.points
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      const abx = b.x - a.x
      const abz = b.z - a.z
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)))
      gap = Math.min(gap, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)) - clear)
    }
  }
  return gap
}

/** 路口往外每一條路臂的方位，rad（`atan2(dx, dz)`），由小到大 */
function armBearings(x: number, z: number): number[] {
  const out: number[] = []
  for (const road of LEYTE_ROADS) {
    const pts = road.points
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(pts[i]!.x - x, pts[i]!.z - z) > 1) continue
      for (const dir of [-1, 1]) {
        for (let k = i + dir; k >= 0 && k < pts.length; k += dir) {
          const dx = pts[k]!.x - x
          const dz = pts[k]!.z - z
          if (Math.hypot(dx, dz) < ARM_REACH) continue
          out.push(Math.atan2(dx, dz))
          break
        }
      }
    }
  }
  return out.sort((a, b) => a - b)
}

/** 路臂之間的扇區：中分線方位與張角，由寬到窄 */
function sectors(bearings: readonly number[]): { mid: number; span: number }[] {
  const out: { mid: number; span: number }[] = []
  for (let i = 0; i < bearings.length; i++) {
    const a = bearings[i]!
    const b = i + 1 < bearings.length ? bearings[i + 1]! : bearings[0]! + 2 * Math.PI
    out.push({ mid: (a + b) / 2, span: b - a })
  }
  return out.sort((p, q) => q.span - p.span)
}

/** 方位 `bearing` 上離路口 `d` 公尺、再往側面 `side` 公尺的那一點 */
function along(x: number, z: number, bearing: number, d: number, side: number): { x: number; z: number } {
  const fx = Math.sin(bearing)
  const fz = Math.cos(bearing)
  return { x: x + fx * d + fz * side, z: z + fz * d - fx * side }
}

/** 車頭朝方位 `bearing` 的艏向（0 = 朝 −Z） */
function headingToward(bearing: number): number {
  return Math.atan2(-Math.sin(bearing), -Math.cos(bearing))
}

/** 沿方位往外推到 `fits(d)` 成立的最小距離 */
function pushOut(fits: (d: number) => boolean): number {
  let d = PUSH_START
  while (!fits(d)) d += PUSH_STEP
  return d
}

function buildJunction(site: (typeof SITES)[number]): LeyteJunction {
  const pts = LEYTE_ROADS[site.road]!.points
  const j = site.at === 'first' ? pts[0]! : pts[pts.length - 1]!
  const [yard, ...rest] = sectors(armBearings(j.x, j.z))

  // 卡車排：橫在中分線上，車頭朝路口
  const offsets = Array.from({ length: site.trucks }, (_, i) => (i - (site.trucks - 1) / 2) * TRUCK_GAP)
  const rowAt = pushOut((d) => offsets.every((s) => {
    const p = along(j.x, j.z, yard!.mid, d, s)
    return roadGap(p.x, p.z) > VEHICLE_R + ROAD_MARGIN
  }))
  const trucks: ParkedVehicle[] = offsets.map((s) => ({
    unit: 'usTruck', ...along(j.x, j.z, yard!.mid, rowAt, s), heading: headingToward(yard!.mid + Math.PI),
  }))

  // 木箱堆：卡車排後方左右各一堆，長邊橫著擺
  const dumpR = Math.hypot(DUMP_WIDTH, DUMP_DEPTH) / 2
  const dumps: CrateField[] = [-1, 1].map((side, i) => {
    const d = pushOut((dd) => {
      const p = along(j.x, j.z, yard!.mid, Math.max(dd, rowAt + DUMP_BEHIND), side * DUMP_SIDE)
      return roadGap(p.x, p.z) > dumpR + ROAD_MARGIN
    })
    const p = along(j.x, j.z, yard!.mid, Math.max(d, rowAt + DUMP_BEHIND), side * DUMP_SIDE)
    return {
      ...p, heading: headingToward(yard!.mid), width: DUMP_WIDTH, depth: DUMP_DEPTH, lane: 0,
      seed: 7000 + SITES.indexOf(site) * 10 + i,
    }
  })

  // M16：其次的扇區各一輛；窄到 `FLAK_REACH` 內離不開路的扇區不用，那一輛改停在
  // 卡車排的側邊（兩側輪流）
  const flak: ParkedVehicle[] = []
  const vehicleFits = (p: { x: number; z: number }): boolean => roadGap(p.x, p.z) > VEHICLE_R + ROAD_MARGIN
  for (const sec of rest) {
    if (flak.length === FLAK_PER_SITE) break
    const d = pushOut((dd) => dd > FLAK_REACH || vehicleFits(along(j.x, j.z, sec.mid, dd, 0)))
    if (d > FLAK_REACH) continue
    flak.push({ unit: 'usFlakTrack', ...along(j.x, j.z, sec.mid, d, 0), heading: headingToward(sec.mid) })
  }
  for (let k = 0; flak.length < FLAK_PER_SITE; k++) {
    const side = (k % 2 === 0 ? 1 : -1) * ((site.trucks - 1) / 2 + FLAK_ROW_SLOTS + Math.floor(k / 2)) * TRUCK_GAP
    const d = pushOut((dd) => dd >= rowAt && vehicleFits(along(j.x, j.z, yard!.mid, dd, side)))
    flak.push({ unit: 'usFlakTrack', ...along(j.x, j.z, yard!.mid, d, side), heading: headingToward(yard!.mid) })
  }

  return { id: site.id, x: j.x, z: j.z, trucks, flak, dumps }
}

/** 三個路口據點。載入期建一次 */
export const LEYTE_JUNCTIONS: readonly LeyteJunction[] = /* @__PURE__ */ SITES.map(buildJunction)

/**
 * 每一處據點（含清空帶）的外接矩形與停著的車：植被每個候選點都問，先比矩形；
 * 車子先併成一份，問的時候不配置
 */
const JUNCTION_BOXES = /* @__PURE__ */ LEYTE_JUNCTIONS.map((j) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  const grow = (x: number, z: number, r: number): void => {
    x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r)
    z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r)
  }
  const vehicles = [...j.trucks, ...j.flak]
  for (const d of j.dumps) grow(d.x, d.z, Math.hypot(d.width, d.depth) / 2 + JUNCTION_CLEAR_PAD)
  for (const v of vehicles) grow(v.x, v.z, VEHICLE_R + JUNCTION_CLEAR_PAD)
  return { x0, x1, z0, z1, vehicles }
})

/**
 * 這一點落在路口據點（木箱堆、停著的車）的清空帶裡嗎。**植被每個候選點都問**
 * —— 不擋的話樹會長在木箱堆與車子上。
 */
export function isInJunctionClearing(x: number, z: number): boolean {
  for (let k = 0; k < LEYTE_JUNCTIONS.length; k++) {
    const b = JUNCTION_BOXES[k]!
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue
    const j = LEYTE_JUNCTIONS[k]!
    for (const d of j.dumps) {
      const dx = x - d.x
      const dz = z - d.z
      // 轉到補給堆自己的座標：沿 heading 是深、垂直的是寬
      const c = Math.cos(d.heading)
      const s = Math.sin(d.heading)
      const lat = dx * c - dz * s
      const dep = -(dx * s + dz * c)
      if (Math.abs(lat) < d.width / 2 + JUNCTION_CLEAR_PAD && Math.abs(dep) < d.depth / 2 + JUNCTION_CLEAR_PAD) return true
    }
    for (const v of b.vehicles) {
      if (Math.hypot(x - v.x, z - v.z) < VEHICLE_R + JUNCTION_CLEAR_PAD) return true
    }
  }
  return false
}
