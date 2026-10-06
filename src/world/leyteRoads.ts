import { coastZ, FIELD_HALF, smoothstep } from './leyteCoast'

/**
 * 公路的走向：水線 → 灘頭 → 前線。**公路本身由它生成**（`buildRoad`），這一份只
 * 決定大方向。第一點在水線外 20 m —— 路是從海灘上來的。
 */
const ROAD_WAYPOINTS: readonly { readonly x: number; readonly z: number }[] = [
  { x: 2950, z: coastZ(2950) - 20 },
  { x: 2800, z: -3250 },
  { x: 2200, z: -2500 },
  { x: 2000, z: -1700 },
  { x: 1300, z: -1000 },
  { x: 1100, z: -200 },
  { x: 300, z: 300 },
  { x: -600, z: 500 },
  { x: -1400, z: 1200 },
]
/** 生成的折線每一段大約多長，m。短一點轉角才小（每個轉角 ≤ 45°） */
const ROAD_STEP = 100
/**
 * 路的蜿蜒：沿路線的法向，兩道不同波長的正弦疊加，m。頭尾各 `ROAD_MEANDER_TAPER`
 * 公尺內漸漸收回 0 —— 起點要落在水線、終點要落在前線。
 */
const ROAD_MEANDER = [
  { amp: 90, len: 1000, phase: 0.4 },
  { amp: 12, len: 500, phase: 2.2 },
] as const
const ROAD_MEANDER_TAPER = 400

/** 均勻 Catmull-Rom：過 p1、p2 的曲線在參數 t 的點 */
function catmullRom(
  p0: { x: number; z: number }, p1: { x: number; z: number },
  p2: { x: number; z: number }, p3: { x: number; z: number }, t: number,
): { x: number; z: number } {
  const t2 = t * t
  const t3 = t2 * t
  const f = (a: number, b: number, c: number, d: number): number => 0.5 * (
    2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  return { x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) }
}

/** 一道蜿蜒：沿路線法向的正弦，振幅 m、波長 m、相位 rad */
interface Meander { readonly amp: number; readonly len: number; readonly phase: number }

/**
 * 由路點生成一條路的折線：先過每一個路點畫一條平滑曲線，每 `ROAD_STEP`
 * 公尺取一點，再沿法向加上蜿蜒。載入期跑一次。
 *
 * 【曲線而不是折線】折線的路點之間是一條長長的直線，從空中看是尺畫的。
 *
 * 【頭尾不蜿蜒】頭尾各 `ROAD_MEANDER_TAPER` 公尺內蜿蜒收回 0，第一點與最後一點
 * 就是路點本身 —— 支線靠這個接在別條路上。
 */
function buildRoad(
  P: readonly { readonly x: number; readonly z: number }[], meander: readonly Meander[],
): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = []
  for (let i = 0; i + 1 < P.length; i++) {
    const p0 = P[Math.max(0, i - 1)]!
    const p1 = P[i]!
    const p2 = P[i + 1]!
    const p3 = P[Math.min(P.length - 1, i + 2)]!
    const n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / ROAD_STEP))
    for (let k = 0; k < n; k++) pts.push(catmullRom(p0, p1, p2, p3, k / n))
  }
  pts.push({ x: P[P.length - 1]!.x, z: P[P.length - 1]!.z })

  const s: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    s.push(s[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z))
  }
  const total = s[s.length - 1]!
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!
    const b = pts[Math.min(pts.length - 1, i + 1)]!
    const tx = b.x - a.x
    const tz = b.z - a.z
    const l = Math.hypot(tx, tz)
    const taper = smoothstep(0, ROAD_MEANDER_TAPER, s[i]!) * smoothstep(0, ROAD_MEANDER_TAPER, total - s[i]!)
    let off = 0
    for (const m of meander) off += m.amp * Math.sin((2 * Math.PI * s[i]!) / m.len + m.phase)
    off *= taper
    return { x: p.x + (tz / l) * off, z: p.z - (tx / l) * off }
  })
}

/**
 * 公路：水線 → 灘頭 → 前線的折線，世界座標。**車隊的路線、地上畫的路、植被的
 * 清空帶全部讀這一份** —— 各寫一份的話車會開在路旁的樹林裡，而且不報錯。
 *
 * 【轉角不超過 45°】車在轉角走 25 m 半徑的圓弧（`world/groundMotion.ts`），
 * 離折線最遠 `25 × (1/cos 22.5° − 1)` ≈ 2.1 m，落在路最窄處的半寬之內
 * （`leyte.test.ts`、`leyte-render.test.ts`）。
 *
 * 【全長要夠長】開場時整條車隊已經沿路排開在走，最前面那一批離終點還要有一段
 * —— `campaigns.test.ts` 對著卡片上的車隊檢查。
 */
export const LEYTE_ROAD: readonly { readonly x: number; readonly z: number }[] =
  buildRoad(ROAD_WAYPOINTS, ROAD_MEANDER)
/** 路面的標稱寬，m。實際寬度沿路起伏（`render/leyteGround.ts` 的 `roadHalfWidthAt`） */
export const ROAD_WIDTH = 24
/**
 * 公路中線兩側不長樹的半寬，m。**要大過路最寬處的半寬**（標稱 12 m 乘上起伏
 * 的上限 1.45 ≈ 17.4 m），不然樹會長在路面上。
 */
export const ROAD_TREE_CLEAR = 22

/**
 * 公路分組的外接矩形：每 `ROAD_GROUP` 段一組。**「離路夠不夠近」先比矩形**，
 * 植被每一個候選點都要問一次，逐段算距離的話公路一長就很貴。
 */
const ROAD_GROUP = 8
interface RoadGroup {
  readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number
  readonly i0: number; readonly i1: number
}

function groupsOf(pts: readonly { readonly x: number; readonly z: number }[]): RoadGroup[] {
  const out: RoadGroup[] = []
  for (let i0 = 1; i0 < pts.length; i0 += ROAD_GROUP) {
    const i1 = Math.min(pts.length, i0 + ROAD_GROUP)
    let x0 = Infinity
    let z0 = Infinity
    let x1 = -Infinity
    let z1 = -Infinity
    for (let i = i0 - 1; i < i1; i++) {
      const p = pts[i]!
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x)
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z)
    }
    out.push({ x0, z0, x1, z1, i0, i1 })
  }
  return out
}

const ROAD_GROUPS: readonly RoadGroup[] = groupsOf(LEYTE_ROAD)

/** (x, z) 到折線 `pts` 第 i 段（`pts[i−1]`→`pts[i]`）的距離，m */
function segmentDistance(
  pts: readonly { readonly x: number; readonly z: number }[], x: number, z: number, i: number,
): number {
  const a = pts[i - 1]!
  const b = pts[i]!
  const abx = b.x - a.x
  const abz = b.z - a.z
  const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)))
  return Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t))
}

function nearPolyline(
  pts: readonly { readonly x: number; readonly z: number }[], groups: readonly RoadGroup[],
  x: number, z: number, r: number,
): boolean {
  for (const g of groups) {
    if (x < g.x0 - r || x > g.x1 + r || z < g.z0 - r || z > g.z1 + r) continue
    for (let i = g.i0; i < g.i1; i++) if (segmentDistance(pts, x, z, i) < r) return true
  }
  return false
}

/**
 * 這一點離**車隊那一條**公路的中線是不是小於 `r`。與 `distanceToRoad(x, z) < r`
 * 等價，但先比分組的外接矩形 —— 遠離公路的點幾次比較就答完。
 */
export function isNearRoad(x: number, z: number, r: number): boolean {
  return nearPolyline(LEYTE_ROAD, ROAD_GROUPS, x, z, r)
}
/** 美軍灘頭的集結區：公路起點 */
export const BEACHHEAD = LEYTE_ROAD[0]!
/** 前線：公路終點。卡車走到這裡就算抵達 */
export const FRONT_LINE = LEYTE_ROAD[LEYTE_ROAD.length - 1]!
/** 這一點到**車隊那一條**公路中線的最短距離，m */
export function distanceToRoad(x: number, z: number): number {
  let best = Infinity
  for (let i = 1; i < LEYTE_ROAD.length; i++) {
    const d = segmentDistance(LEYTE_ROAD, x, z, i)
    if (d < best) best = d
  }
  return best
}

/** 一條路：中線折線與標稱半寬，m。實際半寬沿路起伏（`render/leyteGround.ts`） */
export interface LeyteRoad {
  readonly points: readonly { readonly x: number; readonly z: number }[]
  readonly halfWidth: number
}

/** 支線的一個路點。`on` = 接在第幾條路上（取那條路上離 (x, z) 最近的點） */
interface RoadWaypoint { readonly x: number; readonly z: number; readonly on?: number }

/**
 * 支線：半寬、蜿蜒、路點。**只畫、不走** —— 車隊只走 `LEYTE_ROAD`。
 *
 * 【接得上】頭尾標了 `on` 的路點吸到那一條路上最近的點（路是依序建的，只能接
 * 前面的）。蜿蜒在頭尾收回 0，所以接點不會被扭開。
 *
 * 【走山與山之間的縫】山脈排成蜂巢（`MAIN_MASSIFS`），三圓之間的空地與圓與圓
 * 之間的谷是平的，路大多沿那裡走；翻山的一段是土路。**全部是起始值，拿眼睛校。**
 */
const SIDE_ROADS: readonly {
  readonly halfWidth: number; readonly meander: readonly Meander[]; readonly waypoints: readonly RoadWaypoint[]
}[] = [
  // 1 海岸公路：沿岸線往內陸 700 m，橫貫全島
  {
    halfWidth: 9,
    meander: [{ amp: 40, len: 1400, phase: 1.1 }, { amp: 8, len: 450, phase: 0.3 }],
    waypoints: Array.from({ length: 21 }, (_, i) => {
      const x = -14500 + i * 1450
      return { x, z: coastZ(x) + 700 }
    }),
  },
  // 2 北路：前線往北穿過山縫，經過撤離點附近
  {
    halfWidth: 8,
    meander: [{ amp: 70, len: 1100, phase: 2.0 }, { amp: 10, len: 420, phase: 1.4 }],
    waypoints: [
      { x: -1400, z: 1200, on: 0 }, { x: -900, z: 3000 }, { x: 0, z: 5200 }, { x: 0, z: 6550 },
      { x: -300, z: 8200 }, { x: 300, z: 9800 }, { x: 0, z: 12000 }, { x: 400, z: 14500 },
    ],
  },
  // 3 東路
  {
    halfWidth: 6,
    meander: [{ amp: 60, len: 900, phase: 0.2 }, { amp: 10, len: 380, phase: 2.6 }],
    waypoints: [
      { x: 1100, z: -200, on: 0 }, { x: 3000, z: 800 }, { x: 6100, z: 3000 }, { x: 8500, z: 5200 },
      { x: 11500, z: 6500 }, { x: 14500, z: 7000 },
    ],
  },
  // 4 西路
  {
    halfWidth: 6,
    meander: [{ amp: 60, len: 950, phase: 1.7 }, { amp: 10, len: 400, phase: 0.9 }],
    waypoints: [
      { x: -600, z: 500, on: 0 }, { x: -3000, z: 2000 }, { x: -6100, z: 3000 }, { x: -8500, z: 5200 },
      { x: -11500, z: 6800 }, { x: -14500, z: 7200 },
    ],
  },
  // 5～9 土路
  {
    halfWidth: 4,
    meander: [{ amp: 50, len: 700, phase: 0.6 }, { amp: 12, len: 300, phase: 1.9 }],
    waypoints: [
      { x: 6100, z: 3000, on: 3 }, { x: 6100, z: 6000 }, { x: 5200, z: 9000 }, { x: 3500, z: 12500 },
      { x: 2800, z: 14500 },
    ],
  },
  {
    halfWidth: 4,
    meander: [{ amp: 50, len: 750, phase: 2.4 }, { amp: 12, len: 320, phase: 0.5 }],
    waypoints: [
      { x: -6100, z: 3000, on: 4 }, { x: -6100, z: 6000 }, { x: -5200, z: 9000 }, { x: -3500, z: 12500 },
      { x: -2800, z: 14500 },
    ],
  },
  {
    halfWidth: 4,
    meander: [{ amp: 45, len: 650, phase: 1.2 }, { amp: 12, len: 280, phase: 2.8 }],
    waypoints: [
      { x: -9000, z: -3000, on: 1 }, { x: -9000, z: -1500 }, { x: -8200, z: 1500 }, { x: -8500, z: 5200, on: 4 },
    ],
  },
  {
    halfWidth: 4,
    meander: [{ amp: 45, len: 680, phase: 0.1 }, { amp: 12, len: 290, phase: 1.6 }],
    waypoints: [
      { x: 9000, z: -3000, on: 1 }, { x: 9000, z: -1500 }, { x: 8300, z: 1800 }, { x: 8500, z: 5200, on: 3 },
    ],
  },
  {
    halfWidth: 4,
    meander: [{ amp: 40, len: 600, phase: 2.2 }, { amp: 12, len: 260, phase: 0.8 }],
    waypoints: [
      { x: -5500, z: -3000, on: 1 }, { x: -5000, z: -1000 }, { x: -3000, z: 2000, on: 4 },
    ],
  },
]

/** `road` 上離 (x, z) 最近的那一個折線點 */
function nearestPoint(
  road: readonly { readonly x: number; readonly z: number }[], x: number, z: number,
): { x: number; z: number } {
  let best = road[0]!
  let bd = Infinity
  for (const p of road) {
    const d = Math.hypot(p.x - x, p.z - z)
    if (d < bd) { bd = d; best = p }
  }
  return { x: best.x, z: best.z }
}

/**
 * 島上全部的路。**第 0 條就是 `LEYTE_ROAD`**（車隊走的那一條），其餘是只畫
 * 不走的支線（`SIDE_ROADS`）。地上畫的路與植被的清空帶讀這一份。
 */
export const LEYTE_ROADS: readonly LeyteRoad[] = /* @__PURE__ */ (() => {
  const roads: LeyteRoad[] = [{ points: LEYTE_ROAD, halfWidth: ROAD_WIDTH / 2 }]
  for (const s of SIDE_ROADS) {
    const wp = s.waypoints.map((w) => (w.on === undefined ? w : nearestPoint(roads[w.on]!.points, w.x, w.z)))
    roads.push({ points: buildRoad(wp, s.meander), halfWidth: s.halfWidth })
  }
  return roads
})()

/**
 * 一條路兩側不長樹的半寬，m：與車隊那一條同一個比例（`ROAD_TREE_CLEAR` 對
 * 標稱半寬 12 m）。**要大過那條路最寬處的半寬**，不然樹會長在路面上。
 */
export function roadTreeClear(road: LeyteRoad): number {
  return road.halfWidth * (ROAD_TREE_CLEAR / (ROAD_WIDTH / 2))
}

/** 清空帶索引的格邊長，m */
const CLEAR_BUCKET = 1000
const CLEAR_BUCKETS = Math.ceil((2 * FIELD_HALF) / CLEAR_BUCKET)

/**
 * 清空帶的格子索引：每一格列出清空帶碰得到它的那幾段（路的編號、段的編號、
 * 清空半寬），攤平成一個陣列。**植被每個候選點都要問一次** —— 逐條路掃分組的話
 * 路一多就把整片樹的生成拖慢一半。
 */
const CLEAR_INDEX: { readonly start: Int32Array; readonly items: Int32Array } = /* @__PURE__ */ (() => {
  const lists: number[][] = Array.from({ length: CLEAR_BUCKETS * CLEAR_BUCKETS }, () => [])
  const cellOf = (v: number): number =>
    Math.min(CLEAR_BUCKETS - 1, Math.max(0, Math.floor((v + FIELD_HALF) / CLEAR_BUCKET)))
  LEYTE_ROADS.forEach((road, k) => {
    const r = roadTreeClear(road)
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!
      const b = road.points[i]!
      for (let row = cellOf(Math.min(a.z, b.z) - r); row <= cellOf(Math.max(a.z, b.z) + r); row++) {
        for (let col = cellOf(Math.min(a.x, b.x) - r); col <= cellOf(Math.max(a.x, b.x) + r); col++) {
          lists[row * CLEAR_BUCKETS + col]!.push(k, i)
        }
      }
    }
  })
  const start = new Int32Array(lists.length + 1)
  for (let c = 0; c < lists.length; c++) start[c + 1] = start[c]! + lists[c]!.length
  const items = new Int32Array(start[lists.length]!)
  lists.forEach((l, c) => items.set(l, start[c]!))
  return { start, items }
})()

/** 這一點落在**任何一條**路的清空帶裡嗎（`roadTreeClear`）。植被每個候選點都問 */
export function isInRoadClearing(x: number, z: number): boolean {
  const col = Math.floor((x + FIELD_HALF) / CLEAR_BUCKET)
  const row = Math.floor((z + FIELD_HALF) / CLEAR_BUCKET)
  if (col < 0 || row < 0 || col >= CLEAR_BUCKETS || row >= CLEAR_BUCKETS) return false
  const c = row * CLEAR_BUCKETS + col
  const { start, items } = CLEAR_INDEX
  for (let j = start[c]!; j < start[c + 1]!; j += 2) {
    const road = LEYTE_ROADS[items[j]!]!
    if (segmentDistance(road.points, x, z, items[j + 1]!) < roadTreeClear(road)) return true
  }
  return false
}
