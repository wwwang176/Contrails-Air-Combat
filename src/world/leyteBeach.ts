import type { CrateField, ParkedVehicle } from './depot'
import { coastZ } from './leyteCoast'
import { BEACHHEAD, distanceToRoad, ROAD_WIDTH } from './leyteRoads'
import { LEYTE_FLAK_SITES } from './leyteSites'
import { makeLeyteRand as makeRand } from './leyteRandom'

/**
 * 灘頭搶灘的 LST：公路起點兩側各 5 艘，**分叢**擺。它們是**不會動的船**
 * （`world/ships.ts` 的 `lst`）：撞得到、打得沉、防空砲會開火，但不是任務目標。
 *
 * `x, z` 是船的原點（水線 × 艦體中點），`heading` 是艏向（rad，0 = 朝 −Z，與
 * `createShip` 同一套）。放下的跳板末端落在水線上。
 *
 * 【分叢】史實上一個灘段的 LST 並排擠在一起搶灘、灘段之間才隔開。這裡每一側
 * 照 `LST_CLUSTERS` 分成兩叢：叢內每 `LST_IN_CLUSTER` 一艘、艏向相同（叢心那一
 * 點的岸線內法線，整叢再偏 ±`LST_CLUSTER_YAW`），每艘再各自偏
 * ±`LST_SHIP_YAW`；叢與叢之間隔 `LST_CLUSTER_GAP`。偏角繞跳板末端轉，所以偏了
 * 之後跳板仍搭在水線上。
 *
 * 【沿岸線量間距】第一叢離公路起點 `LST_ROAD_GAP`，所有間距都是沿岸線的弧長、
 * 各自乘上 1 ± 一個比例。量 x 的話岸線斜的那一側（斜率到 0.5）會擠在一起。
 *
 * 【亂數有種子】同一張地圖每次都要長一樣（`makeRand`）。
 */
export interface LeyteLst { readonly x: number; readonly z: number; readonly heading: number }
/** 每一側由近到遠各叢的艘數：負 x 那一側、正 x 那一側 */
const LST_CLUSTERS: readonly (readonly number[])[] = [[3, 2], [2, 3]]
const LST_ROAD_GAP = 250
const LST_CLUSTER_GAP = 550
const LST_CLUSTER_GAP_JITTER = 0.3
const LST_IN_CLUSTER = 50
const LST_IN_CLUSTER_JITTER = 0.15
const LST_CLUSTER_YAW = 20 * Math.PI / 180
const LST_SHIP_YAW = 3 * Math.PI / 180
const LST_SEED = 1944_10_20
/** 艦體中點到跳板末端，m（`lst.glb` 的跳板末端在艦體座標 z −53.5） */
export const LST_RAMP_REACH = 53.5

function coastSlope(x: number): number {
  return (coastZ(x + 1) - coastZ(x - 1)) / 2
}

/** 由 x0 沿岸線往 `sign` 那一側走 `arc` 公尺弧長，回傳那一點的 x */
function walkCoast(x0: number, sign: number, arc: number): number {
  const STEP = 1
  let x = x0
  let s = 0
  while (s < arc) {
    s += Math.hypot(STEP, coastSlope(x + sign * STEP / 2) * STEP)
    x += sign * STEP
  }
  return x
}

export const LEYTE_LSTS: readonly LeyteLst[] = /* @__PURE__ */ (() => {
  const out: LeyteLst[] = []
  const rand = makeRand(LST_SEED)
  const jitter = (): number => 2 * rand() - 1
  LST_CLUSTERS.forEach((sizes, side) => {
    const sign = side === 0 ? -1 : 1
    let arc = LST_ROAD_GAP
    sizes.forEach((n, k) => {
      if (k > 0) arc += LST_CLUSTER_GAP * (1 + LST_CLUSTER_GAP_JITTER * jitter())
      // 這一叢每艘沿岸線的位置（弧長）
      const arcs: number[] = [arc]
      for (let i = 1; i < n; i++) arcs.push(arcs[i - 1]! + LST_IN_CLUSTER * (1 + LST_IN_CLUSTER_JITTER * jitter()))
      arc = arcs[n - 1]!
      // 整叢一個艏向：叢心那一點的內法線 (−c′, 1)。艏向 h 的艦艏朝 (−sin h, −cos h)
      const s = coastSlope(walkCoast(BEACHHEAD.x, sign, (arcs[0]! + arc) / 2))
      const len = Math.hypot(s, 1)
      const base = Math.atan2(s / len, -1 / len) + LST_CLUSTER_YAW * jitter()
      for (const a of arcs) {
        const x = walkCoast(BEACHHEAD.x, sign, a)
        const heading = base + LST_SHIP_YAW * jitter()
        const dirX = -Math.sin(heading)
        const dirZ = -Math.cos(heading)
        out.push({ x: x - dirX * LST_RAMP_REACH, z: coastZ(x) - dirZ * LST_RAMP_REACH, heading })
      }
    })
  })
  return out
})()

/**
 * 灘頭的防空氣球：**每艘 LST 艉甲板一顆**，灘頭地面在每一側兩叢 LST 之間的
 * 內陸再各一顆。美軍、不是任務目標（`world/balloons.ts`）。
 *
 * 【雷雨天收在低空】灘頭與登陸艦放的是超低空型，平常升到 300 m 上下（上限約
 * 600 m）；但雷雨接近時照規定要絞下來 —— 鋼索是一根通到幾百公尺高的避雷針、
 * 氣囊裡是氫氣，陣風也會扯斷鋼索。日 M2 是雷雨，所以每一顆只放出
 * `BALLOON_TETHER` 之間的鋼索，貼在船與絞車上方，在陣風裡飄晃。
 *
 * 【艇首朝同一個方向】繫留氣球會自己轉向迎風。**風向是起始值，由試飛裁定。**
 */
export interface LeyteBalloon {
  readonly anchor: { readonly ship: number } | { readonly x: number; readonly z: number }
  /** 鋼索放出多長，m */
  readonly tether: number
  /** 艇首朝向，rad（0 = 朝 −Z） */
  readonly heading: number
}
/** LST 艉甲板上的絞車，艦體座標（主甲板 6.67、艉 40 mm 砲座與探照燈塔都在中線上） */
export const LST_BALLOON_DECK = { x: 4.0, y: 6.67, z: 44.0 } as const
const BALLOON_TETHER = [30, 60] as const
/** 艇首朝這個方向（迎風），rad，每顆再偏 ±`BALLOON_HEADING_JITTER` */
const BALLOON_HEADING = -2.4
const BALLOON_HEADING_JITTER = 10 * Math.PI / 180
/** 地面絞車在岸線往內陸多遠，m */
const BALLOON_WINCH_INLAND = 250
const BALLOON_SEED = 1944_10_21

export const LEYTE_BALLOONS: readonly LeyteBalloon[] = /* @__PURE__ */ (() => {
  const rand = makeRand(BALLOON_SEED)
  const pick = (anchor: LeyteBalloon['anchor']): LeyteBalloon => ({
    anchor,
    tether: BALLOON_TETHER[0] + (BALLOON_TETHER[1] - BALLOON_TETHER[0]) * rand(),
    heading: BALLOON_HEADING + BALLOON_HEADING_JITTER * (2 * rand() - 1),
  })
  const out = LEYTE_LSTS.map((_, i) => pick({ ship: i }))
  // 地面絞車：每一側前後兩叢之間，岸線上兩艘跳板末端的中點往內陸走
  const tipX = (l: LeyteLst): number => l.x - Math.sin(l.heading) * LST_RAMP_REACH
  let start = 0
  for (const sizes of LST_CLUSTERS) {
    const lastOfFirst = LEYTE_LSTS[start + sizes[0]! - 1]!
    const firstOfSecond = LEYTE_LSTS[start + sizes[0]!]!
    const x = (tipX(lastOfFirst) + tipX(firstOfSecond)) / 2
    out.push(pick({ x, z: coastZ(x) + BALLOON_WINCH_INLAND }))
    start += sizes.reduce((a, b) => a + b, 0)
  }
  return out
})()

// ── 灘頭的佈景：補給堆與停著的車 ─────────────────────────────

/** 一堆補給（`world/depot.ts`）。卸貨區的 `lane` 是 LST 跳板上來的車道 */
export type BeachDump = CrateField
/** 一台停著不動的車 */
export type BeachVehicle = ParkedVehicle

/**
 * 灘頭的佈景（**不是目標、沒有碰撞**，`render/leyteBeach.ts` 合併成一顆網格）：
 *
 * - 每艘 LST 跳板上岸處一大片卸貨區，中間留跳板上來的車道，旁邊停幾輛卡車
 * - 沿灘頭散布的補給堆
 * - 公路起點兩側各一個車輛集結場：雪曼、M16、卡車一排排停好
 *
 * 全部避開公路、灘頭砲位、氣球的地面絞車與水線（`beachClear`）。**位置、數量
 * 都是起始值；亂數有種子**，同一張地圖每次都長一樣。
 */
export const LEYTE_BEACH: { readonly dumps: readonly BeachDump[]; readonly vehicles: readonly BeachVehicle[] } =
  /* @__PURE__ */ (() => {
    const rand = makeRand(1944_10_22)
    const jit = (): number => 2 * rand() - 1
    const dumps: BeachDump[] = []
    const vehicles: BeachVehicle[] = []
    const winches = LEYTE_BALLOONS.flatMap((b) => ('ship' in b.anchor ? [] : [b.anchor]))
    /** 半徑 `r` 的一塊地放得下嗎：不壓公路、砲位、絞車，也不下水 */
    const beachClear = (x: number, z: number, r: number): boolean =>
      z > coastZ(x) + 15 + r * 0.3
      && distanceToRoad(x, z) > ROAD_WIDTH / 2 + r + 6
      && LEYTE_FLAK_SITES.every((f) => Math.hypot(f.x - x, f.z - z) > r + 20)
      && winches.every((w) => Math.hypot(w.x - x, w.z - z) > r + 15)
    /** 岸線上 x 那一點的內法線方向的艏向（朝內陸） */
    const inland = (x: number): number => {
      const s = coastSlope(x)
      const len = Math.hypot(s, 1)
      return Math.atan2(s / len, -1 / len)
    }
    const fwd = (h: number): [number, number] => [-Math.sin(h), -Math.cos(h)]
    const right = (h: number): [number, number] => [Math.cos(h), -Math.sin(h)]

    // 1. LST 的卸貨區：跳板末端往內陸 20～60 m，順著船的方向
    for (const l of LEYTE_LSTS) {
      const [fx, fz] = fwd(l.heading)
      const [rx, rz] = right(l.heading)
      const tx = l.x + fx * LST_RAMP_REACH
      const tz = l.z + fz * LST_RAMP_REACH
      const cx = tx + fx * 45
      const cz = tz + fz * 45
      if (beachClear(cx, cz, 23)) {
        dumps.push({ x: cx, z: cz, heading: l.heading, width: 40, depth: 46, lane: 8, seed: dumps.length + 1 })
      }
      // 卸貨區兩旁停著等裝卸的卡車
      for (let k = 0; k < 4; k++) {
        const side = k % 2 === 0 ? -1 : 1
        const along = 22 + 16 * Math.floor(k / 2) + 3 * jit()
        const x = tx + fx * along + rx * side * (26 + 2 * jit())
        const z = tz + fz * along + rz * side * (26 + 2 * jit())
        if (beachClear(x, z, 4)) {
          vehicles.push({ unit: 'usTruck', x, z, heading: l.heading + Math.PI / 2 * side + 0.3 * jit() })
        }
      }
    }

    // 2. 車輛集結場：公路起點兩側各一個、再往外各一個。三排、每排七台，面朝內陸
    const parks: { x: number; z: number }[] = []
    for (const [sign, arc] of [[-1, 110], [1, 110], [-1, 650], [1, 650]] as const) {
      const x0 = walkCoast(BEACHHEAD.x, sign, arc)
      const h = inland(x0)
      const [fx, fz] = fwd(h)
      const [rx, rz] = right(h)
      const bx = x0 + fx * 120
      const bz = coastZ(x0) + fz * 120
      parks.push({ x: bx, z: bz })
      const rows: BeachVehicle['unit'][][] = [
        ['usTank', 'usTank', 'usTank', 'usTank', 'usTank', 'usTank', 'usTank'],
        ['usFlakTrack', 'usTruck', 'usTruck', 'usFlakTrack', 'usTruck', 'usTruck', 'usFlakTrack'],
        ['usTruck', 'usTruck', 'usTruck', 'usTruck', 'usTruck', 'usTruck', 'usTruck'],
      ]
      rows.forEach((row, r) => {
        row.forEach((unit, c) => {
          const lat = (c - (row.length - 1) / 2) * 6
          const dep = (r - 1) * 12
          const x = bx + rx * lat + fx * dep
          const z = bz + rz * lat + fz * dep
          if (beachClear(x, z, 4)) vehicles.push({ unit, x, z, heading: h + 0.03 * jit() })
        })
      })
    }

    // 3. 沿灘頭散布的補給堆，大小不一；不壓集結場、不壓已經停好的車
    let tries = 0
    let placed = 0
    while (placed < 36 && tries < 800) {
      tries++
      const sign = rand() < 0.5 ? -1 : 1
      const x0 = walkCoast(BEACHHEAD.x, sign, 60 + 1640 * rand())
      const h = inland(x0) + 0.25 * jit()
      const [fx, fz] = fwd(h)
      const d = 40 + 280 * rand()
      const x = x0 + fx * d
      const z = coastZ(x0) + fz * d
      const width = 16 + 24 * rand()
      const depth = 12 + 18 * rand()
      const r = Math.hypot(width, depth) / 2
      if (!beachClear(x, z, r)) continue
      if (dumps.some((o) => Math.hypot(o.x - x, o.z - z) < r + Math.hypot(o.width, o.depth) / 2 + 8)) continue
      if (parks.some((p) => Math.hypot(p.x - x, p.z - z) < r + 35)) continue
      if (vehicles.some((v) => Math.hypot(v.x - x, v.z - z) < r + 5)) continue
      dumps.push({ x, z, heading: h, width, depth, lane: 0, seed: dumps.length + 1 })
      placed++
      // 補給堆旁邊停一兩台
      const [rx, rz] = right(h)
      for (const side of rand() < 0.5 ? [1] : [1, -1]) {
        const vx = x + rx * side * (width / 2 + 5)
        const vz = z + rz * side * (width / 2 + 5)
        if (beachClear(vx, vz, 4)) {
          vehicles.push({ unit: rand() < 0.8 ? 'usTruck' : 'usTank', x: vx, z: vz, heading: h + 0.4 * jit() })
        }
      }
    }
    return { dumps, vehicles }
  })()

/** 補給堆與車子周圍這麼寬不長樹，m */
const BEACH_TREE_CLEAR = 6
/** 整片灘頭佈景的外接矩形（含清空帶）：植被每個候選點都問，先比它 */
const BEACH_BOX = /* @__PURE__ */ (() => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  const grow = (x: number, z: number, r: number): void => {
    x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r)
    z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r)
  }
  for (const d of LEYTE_BEACH.dumps) grow(d.x, d.z, Math.hypot(d.width, d.depth) / 2 + BEACH_TREE_CLEAR)
  for (const v of LEYTE_BEACH.vehicles) grow(v.x, v.z, 4 + BEACH_TREE_CLEAR)
  return { x0, x1, z0, z1 }
})()

/**
 * 這一點落在灘頭佈景（補給堆、停著的車）的清空帶裡嗎。**植被每個候選點都問**
 * —— 沙灘分界以上是草地，不擋的話樹會長在木箱堆與車子上。
 */
export function isInBeachClearing(x: number, z: number): boolean {
  const b = BEACH_BOX
  if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return false
  for (const d of LEYTE_BEACH.dumps) {
    const dx = x - d.x
    const dz = z - d.z
    // 轉到補給堆自己的座標：沿 heading 是深、垂直的是寬
    const c = Math.cos(d.heading)
    const s = Math.sin(d.heading)
    const lat = dx * c - dz * s
    const dep = -(dx * s + dz * c)
    if (Math.abs(lat) < d.width / 2 + BEACH_TREE_CLEAR && Math.abs(dep) < d.depth / 2 + BEACH_TREE_CLEAR) return true
  }
  for (const v of LEYTE_BEACH.vehicles) {
    if (Math.hypot(x - v.x, z - v.z) < 4 + BEACH_TREE_CLEAR) return true
  }
  return false
}
