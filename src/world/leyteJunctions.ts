import { BROAD_CROWN_R } from '../specs/flora'
import type { CrateField, ParkedVehicle } from './depot'
import { LEYTE_ROADS, ROAD_WIDEN_MAX, type LeyteRoad } from './leyteRoads'

/**
 * # 路邊的補給據點（日 M2）
 *
 * 車隊那一條路上三處：路邊停著等通行的卡車（任務目標，與車隊、灘頭的卡車一起算
 * 摧毀數）、守著的 M16 防空車、卡車後面的木箱堆（純佈景，`render/depot.ts`）。
 *
 * ```
 *   AB  灘頭出口（主路 × 海岸公路）與 B 之間的主路中段
 *   B   主路 × 東路
 *   C   主路 × 西路，離前線約 1 km
 * ```
 *
 * 【擺法】據點往外的每一條路臂量一個方位，路臂之間最寬的那個扇區是停車場：
 * 卡車沿著扇區一側的路臂在路肩上排成一列、車頭朝據點，車側貼著路面最寬處的
 * 外緣；木箱堆緊貼在卡車後面。M16 先放其餘扇區的中分線上，再放卡車列對面的
 * 路肩、卡車列的尾端。每一樣的腳印都不壓任何一條路的路面（取路寬起伏的上限
 * `ROAD_WIDEN_MAX`）—— 車隊開過時不會穿過停著的車。
 *
 * 【M16 不進 `LEYTE_FLAK_SITES`】那張表是灘頭與前線的固定砲位；據點的 M16 跟著
 * 這裡的擺法走，換位置時一起換。
 */
export interface LeyteJunction {
  readonly id: 'AB' | 'B' | 'C'
  /** 據點中心：路上的一個折線點（路口就是兩條路共用的那一點） */
  readonly x: number
  readonly z: number
  readonly trucks: readonly ParkedVehicle[]
  readonly flak: readonly ParkedVehicle[]
  readonly dumps: readonly CrateField[]
}

/** 主路（車隊那一條）上第 `i` 個折線點 */
const mainAt = (i: number): Pt => LEYTE_ROADS[0]!.points[i]!

/** 主路上離 `road` 那條路最近的折線點是第幾個 */
function mainIndexNear(road: LeyteRoad): number {
  const pts = LEYTE_ROADS[0]!.points
  let best = 0
  let bd = Infinity
  pts.forEach((p, i) => {
    for (const q of road.points) {
      const d = Math.hypot(p.x - q.x, p.z - q.z)
      if (d < bd) { bd = d; best = i }
    }
  })
  return best
}

/**
 * 三處據點的位置（`LEYTE_ROADS` 的編號見 `leyteRoads.ts` 的 `SIDE_ROADS`：1 海岸
 * 公路、3 東路、4 西路）。**卡車數是起始值**：三處合計 8 輛，加上車隊 9、灘頭 9
 * 共 26 輛 —— 門檻 20 加放行 7 要大於總數（`campaigns.test.ts`）。
 */
const SITES: readonly { readonly id: LeyteJunction['id']; readonly at: () => Pt; readonly trucks: number }[] = [
  {
    id: 'AB', trucks: 3,
    // 主路從灘頭出口到 B 那一段，取中間那個折線點（折線點大約每 100 m 一個）
    at: () => mainAt(Math.round((mainIndexNear(LEYTE_ROADS[1]!) + mainIndexNear(LEYTE_ROADS[3]!)) / 2)),
  },
  { id: 'B', trucks: 3, at: () => LEYTE_ROADS[3]!.points[0]! },
  { id: 'C', trucks: 2, at: () => LEYTE_ROADS[4]!.points[0]! },
]
/** 每一處的 M16 輛數 */
const FLAK_PER_SITE = 4
/** 扇區中分線上的 M16 離據點最遠多少，m：扇區窄到這裡還離不開路面就不用它 */
const FLAK_REACH = 45
/** M16 與其他車至少隔多遠（中心到中心），m */
const FLAK_SPACING = 10

/** 路臂的方位在路口外這麼遠量，m */
const ARM_REACH = 80
/** 第一輛卡車離路口多遠（沿路），m —— 路口本身留給車隊轉彎 */
const TRUCK_FIRST = 24
/** 卡車沿路的間距（車頭到車頭），m —— 一枚直擊炸得到兩輛，炸不到整列 */
const TRUCK_SPACING = 11
/** 車側離路面最寬處外緣，m */
const SHOULDER = 1.5
/** 木箱堆：沿路的寬、垂直路的深，離卡車車側多遠，m */
const DUMP_WIDTH = 13
const DUMP_DEPTH = 9
const DUMP_GAP = 3
/** 腳印離路面再留這麼寬，m */
const ROAD_MARGIN = 0.5
/** 往外推的步長，m */
const PUSH_STEP = 1
/** 卡車、M16 的腳印：長、寬一半再寬一點，m */
const VEHICLE_HALF_LEN = 3.6
const VEHICLE_HALF_W = 1.2
/** 腳印外接圓的半徑：植被清空帶用 */
const VEHICLE_R = Math.hypot(VEHICLE_HALF_LEN, VEHICLE_HALF_W)
/**
 * 補給堆與車子周圍這麼寬不長樹，m。**要大過最大的樹冠半徑**：清的是樹幹的位置，
 * 只留得比樹冠窄的話，路邊的樹冠會蓋在車頂上，從空中找不到車
 */
const JUNCTION_CLEAR_PAD = BROAD_CROWN_R + 2

interface Pt { readonly x: number; readonly z: number }

/** (x, z) 離每一條路的路面最寬處還有多遠，m；負的就是壓在路面上。載入期用 */
function roadGap(x: number, z: number): number {
  let gap = Infinity
  for (const road of LEYTE_ROADS) {
    const half = road.halfWidth * ROAD_WIDEN_MAX
    const pts = road.points
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      const abx = b.x - a.x
      const abz = b.z - a.z
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)))
      gap = Math.min(gap, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)) - half)
    }
  }
  return gap
}

/** 長方形腳印的四角與中心：中心 (x, z)、`along` 方向半長 `hl`、橫向半寬 `hw` */
function footprint(x: number, z: number, heading: number, hl: number, hw: number): Pt[] {
  const fx = -Math.sin(heading)
  const fz = -Math.cos(heading)
  const out: Pt[] = [{ x, z }]
  for (const u of [-1, 1]) for (const v of [-1, 1]) out.push({ x: x + fx * hl * u + fz * hw * v, z: z + fz * hl * u - fx * hw * v })
  return out
}

/** 腳印的每一點都不壓路面 */
function offRoad(points: readonly Pt[]): boolean {
  return points.every((p) => roadGap(p.x, p.z) > ROAD_MARGIN)
}

/** 一條路臂：方位、走的那條折線、路口在折線上的位置與往外的方向 */
interface Arm {
  readonly bearing: number
  readonly road: LeyteRoad
  readonly i: number
  readonly dir: 1 | -1
}

/** 路口往外每一條路臂，方位（`atan2(dx, dz)`）由小到大 */
function armsAt(x: number, z: number): Arm[] {
  const out: Arm[] = []
  for (const road of LEYTE_ROADS) {
    const pts = road.points
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(pts[i]!.x - x, pts[i]!.z - z) > 1) continue
      for (const dir of [-1, 1] as const) {
        for (let k = i + dir; k >= 0 && k < pts.length; k += dir) {
          const dx = pts[k]!.x - x
          const dz = pts[k]!.z - z
          if (Math.hypot(dx, dz) < ARM_REACH) continue
          out.push({ bearing: Math.atan2(dx, dz), road, i, dir })
          break
        }
      }
    }
  }
  return out.sort((a, b) => a.bearing - b.bearing)
}

/** 路臂之間的扇區：中分線方位、張角與起始那一條路臂，由寬到窄 */
function sectors(arms: readonly Arm[]): { mid: number; span: number; arm: Arm }[] {
  const out: { mid: number; span: number; arm: Arm }[] = []
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i]!.bearing
    const b = i + 1 < arms.length ? arms[i + 1]!.bearing : arms[0]!.bearing + 2 * Math.PI
    out.push({ mid: (a + b) / 2, span: b - a, arm: arms[i]! })
  }
  return out.sort((p, q) => q.span - p.span)
}

/** 沿路臂離路口 `s` 公尺那一點與那裡往外的單位切線 */
function alongArm(arm: Arm, s: number): { p: Pt; tx: number; tz: number } {
  const pts = arm.road.points
  let left = s
  for (let k = arm.i; k + arm.dir >= 0 && k + arm.dir < pts.length; k += arm.dir) {
    const a = pts[k]!
    const b = pts[k + arm.dir]!
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    const tx = (b.x - a.x) / len
    const tz = (b.z - a.z) / len
    if (left <= len) return { p: { x: a.x + tx * left, z: a.z + tz * left }, tx, tz }
    left -= len
  }
  throw new Error('路臂不夠長')
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

function buildJunction(site: (typeof SITES)[number]): LeyteJunction {
  const j = site.at()
  const [yard, ...rest] = sectors(armsAt(j.x, j.z))
  const arm = yard!.arm
  // 停車場那一側：路臂的法線裡指向扇區中分線的那一個
  const yx = Math.sin(yard!.mid)
  const yz = Math.cos(yard!.mid)

  /** 沿路臂 `s` 公尺、往停車場那一側離中線 `off` 公尺的一點，與朝路口的艏向 */
  const roadside = (s: number, off: number): { p: Pt; heading: number; nx: number; nz: number } => {
    const { p, tx, tz } = alongArm(arm, s)
    const side = tz * yx - tx * yz >= 0 ? 1 : -1
    const nx = tz * side
    const nz = -tx * side
    return {
      p: { x: p.x + nx * off, z: p.z + nz * off },
      heading: headingToward(Math.atan2(-tx, -tz)), nx, nz,
    }
  }

  // 卡車：路肩上一列。離中線 = 路面最寬處 + 路肩 + 半個車寬；壓到別條路就沿路往外挪
  const truckOff = arm.road.halfWidth * ROAD_WIDEN_MAX + SHOULDER + VEHICLE_HALF_W
  const trucks: ParkedVehicle[] = []
  const truckAt: number[] = []
  for (let s = TRUCK_FIRST; trucks.length < site.trucks; s += PUSH_STEP) {
    const r = roadside(s, truckOff)
    if (!offRoad(footprint(r.p.x, r.p.z, r.heading, VEHICLE_HALF_LEN, VEHICLE_HALF_W))) continue
    trucks.push({ unit: 'usTruck', ...r.p, heading: r.heading })
    truckAt.push(s)
    s += TRUCK_SPACING - PUSH_STEP
  }

  // 木箱堆：緊貼在頭尾兩輛卡車後面，長邊順著路
  const dumpOff = truckOff + VEHICLE_HALF_W + DUMP_GAP + DUMP_DEPTH / 2
  const dumps: CrateField[] = [truckAt[0]!, truckAt[truckAt.length - 1]! + TRUCK_SPACING / 2].map((s, i) => {
    let off = dumpOff
    for (;;) {
      const r = roadside(s, off)
      const heading = headingToward(Math.atan2(r.nx, r.nz))
      if (offRoad(footprint(r.p.x, r.p.z, heading, DUMP_DEPTH / 2, DUMP_WIDTH / 2))) {
        return { ...r.p, heading, width: DUMP_WIDTH, depth: DUMP_DEPTH, lane: 0, seed: 7000 + SITES.indexOf(site) * 10 + i }
      }
      off += PUSH_STEP
    }
  })

  // M16：依序試 (1) 其餘扇區的中分線，沿線推到不壓路面，推到 `FLAK_REACH` 還壓著的
  // 扇區不用；(2) 卡車列對面的路肩，正對頭尾兩輛；(3) 卡車列的尾端往外。跟已經停好的
  // 車隔不到 `FLAK_SPACING` 的位置跳過
  const flak: ParkedVehicle[] = []
  const free = (p: Pt): boolean =>
    [...trucks, ...flak].every((v) => Math.hypot(v.x - p.x, v.z - p.z) >= FLAK_SPACING)
  const tryPlace = (p: Pt, heading: number): boolean => {
    if (flak.length === FLAK_PER_SITE || !free(p)) return false
    if (!offRoad(footprint(p.x, p.z, heading, VEHICLE_HALF_LEN, VEHICLE_HALF_W))) return false
    flak.push({ unit: 'usFlakTrack', ...p, heading })
    return true
  }
  for (const sec of rest) {
    for (let d = TRUCK_FIRST / 2; d <= FLAK_REACH; d += PUSH_STEP) {
      if (tryPlace(along(j.x, j.z, sec.mid, d, 0), headingToward(sec.mid))) break
    }
  }
  for (const s0 of [truckAt[0]!, truckAt[truckAt.length - 1]!]) {
    for (let s = s0; s < s0 + TRUCK_SPACING; s += PUSH_STEP) {
      const r = roadside(s, -truckOff)
      if (tryPlace(r.p, r.heading)) break
    }
  }
  for (let s = truckAt[truckAt.length - 1]! + TRUCK_SPACING; flak.length < FLAK_PER_SITE; s += PUSH_STEP) {
    const r = roadside(s, truckOff)
    if (tryPlace(r.p, r.heading)) s += TRUCK_SPACING - PUSH_STEP
  }

  return { id: site.id, x: j.x, z: j.z, trucks, flak, dumps }
}

/** 三處路邊據點。載入期建一次 */
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
 * 這一點落在路邊據點（木箱堆、停著的車）的清空帶裡嗎。**植被每個候選點都問**
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
