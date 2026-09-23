import { createHeightField, type HeightFieldData } from './heightfield'
import { bakeRelief, makeLobes, SEA_FLOOR, WOBBLE_MAX, type IslandDesc } from './archipelago'
import { drawHillLobes } from './leuna'
import { HILL_GAP } from './farmland'

/**
 * # 雷伊泰的海岸線地形（日 M2）
 *
 * 一座很大的平坦島嶼：世界 −Z 是海（雷伊泰灣），+Z 是陸。陸上是平地、一條
 * 蜿蜒的公路與幾座小山丘。
 *
 * 【高度場的組成】先把丘陵烘進去（底面是 `SEA_FLOOR`），再逐格與「海岸線
 * 加平地」的基準面取 max。丘陵的瓣緣因此併入平地，不會在平地上挖出環溝。
 *
 * 【避障清單只有丘陵】平地只有 `PLAIN_HEIGHT` 高，那是地面不是障礙；AI 的
 * 圓盤法只需要知道丘陵（`ai/terrainSense.ts`）。
 *
 * 【平地的高度】高過海浪的波峰（三道波合計振幅 4.5 m，見 `render/island.ts`
 * 的 `DRAW_FLOOR`），浪才不會從陸地上冒出來；又要低到 AI 以海平面當地板時
 * 的誤差可以忽略 —— AI 的安全層讀 `seaHeight` 加丘陵的圓盤，不讀平地。
 *
 * 全部座標與數值是**起始值，由試飛裁定**。
 */

/** 高度場邊長頂點數。375 × 80 m = 30 km 見方，與農地同一個尺寸 */
export const LEYTE_SIZE = 376
/** 格距，m。平地與緩丘用 80 m 就夠；公路畫在 shader 裡，不吃格距 */
export const LEYTE_CELL = 80

/** 高度場的半邊長，m。場外由遠景陸地（`farHeight`）接上 */
export const FIELD_HALF = ((LEYTE_SIZE - 1) * LEYTE_CELL) / 2
/** 平地的高度，m */
export const PLAIN_HEIGHT = 8
/** 這個高度以下是沙灘色、不長植被，m。`render/leyteGround.ts` 與植被共用 */
export const SAND_TOP = 3
/** 丘陵峰高的上限，m。`LandField.ceiling` 用它 */
export const LEYTE_PEAK_MAX = 900

/** 岸線平均位置，m（世界 z） */
const COAST_Z = -4000
/** 岸線的三道起伏：振幅 m、波長 m、相位 rad。振幅合計 770 m */
const COAST_WAVES = [
  { amp: 400, len: 9000, phase: 0.7 },
  { amp: 250, len: 3700, phase: 2.1 },
  { amp: 120, len: 1700, phase: 4.4 },
] as const
/** 由水線升到平地的斜坡寬，m */
const SHORE_RAMP = 240
/** 海床由水線降到 `SEA_FLOOR` 的距離，m */
const SEABED_RAMP = 200
/**
 * 平地的緩坡起伏，m：疊在 `PLAIN_HEIGHT` 之上，0～12 m。
 *
 * 【上限 12 m 是 AI 的硬約束】AI 的安全層只認得丘陵清單（`IslandDesc` 圓盤），
 * 其餘一律當海平面，戰鬥機的改出餘裕是 30 m（`ai/safety.ts` 的
 * `fighterClearance`）。平地高過那個餘裕的話，低空掃射的 AI 會一頭撞進緩坡。
 * **大的起伏一律做成丘陵**，AI 才看得到。
 */
function roll(x: number, z: number): number {
  return 6 + 4 * Math.sin(x / 900 + 0.5) * Math.sin(z / 1100 + 1.2) + 2 * Math.sin((x - z) / 450 + 2)
}
/** 岸邊這麼寬的一帶不起伏，m —— 沙灘與灘頭是平的 */
const ROLL_SHORE = 600

/** 岸線在這個 x 上的世界 z。陸地在 `z > coastZ(x)` */
export function coastZ(x: number): number {
  let z = COAST_Z
  for (const w of COAST_WAVES) z += w.amp * Math.sin((2 * Math.PI * x) / w.len + w.phase)
  return z
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * 沒有丘陵時這一點的高度，m：海床、海岸斜坡、平地與它的緩坡起伏。
 *
 * 【陸地一路延伸到場地邊緣】場外由 `render/leyteGround.ts` 的遠景陸地接上 ——
 * 這座島很大，另外幾面的海岸不在視野裡。
 *
 * 【距離取 z 向】`z − coastZ(x)` 不是到岸線的真正距離，但岸線的最大斜率
 * （Σ 2π·amp/len ≈ 1.13）之下斜坡只會被拉寬到約 1.5 倍，看不出來。
 */
export function baseHeight(x: number, z: number): number {
  const d = z - coastZ(x)
  if (d <= 0) return Math.max(SEA_FLOOR, (d / SEABED_RAMP) * -SEA_FLOOR)
  return PLAIN_HEIGHT * smoothstep(0, SHORE_RAMP, d)
    + roll(x, z) * smoothstep(SHORE_RAMP, SHORE_RAMP + ROLL_SHORE, d)
}

/** 遠景的山從場地邊緣往外這麼遠才長到全高，m */
const FAR_RISE = 20000

/**
 * 場外遠景陸地的高度，m。**只畫不碰撞**（`render/leyteGround.ts`），場地半徑
 * 12 km 的界限飛不到那裡。
 *
 * 海岸線照同一條曲線延伸；陸上是場內的基準面（`baseHeight`）再加上一道往外
 * 越來越高的山脈 —— 雷伊泰島中央是山。**在場地邊緣山的高度是 0**，與場內的
 * 地形接得上。
 */
export function farHeight(x: number, z: number): number {
  const base = baseHeight(x, z)
  if (base <= 0) return base
  const out = Math.max(0, Math.abs(x) - FIELD_HALF, z - FIELD_HALF)
  const ridge = 800 + 250 * Math.sin(x / 7000 + 1) * Math.sin(z / 9000 + 0.4)
  // 【離岸近的地方山也矮】岸邊 3 km 內壓回平地，沙灘後面不會直接是山壁
  const inland = smoothstep(0, 3000, z - coastZ(x))
  return base + ridge * smoothstep(0, FAR_RISE, out) * inland
}

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

/**
 * 由 `ROAD_WAYPOINTS` 生成公路的折線：先過每一個路點畫一條平滑曲線，每
 * `ROAD_STEP` 公尺取一點，再沿法向加上蜿蜒。載入期跑一次。
 *
 * 【曲線而不是折線】折線的路點之間是一條長長的直線，從空中看是尺畫的。
 */
function buildRoad(): { x: number; z: number }[] {
  const P = ROAD_WAYPOINTS
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
    for (const m of ROAD_MEANDER) off += m.amp * Math.sin((2 * Math.PI * s[i]!) / m.len + m.phase)
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
export const LEYTE_ROAD: readonly { readonly x: number; readonly z: number }[] = buildRoad()
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
const ROAD_GROUPS: readonly { x0: number; z0: number; x1: number; z1: number; i0: number; i1: number }[] =
  /* @__PURE__ */ (() => {
    const out: { x0: number; z0: number; x1: number; z1: number; i0: number; i1: number }[] = []
    for (let i0 = 1; i0 < LEYTE_ROAD.length; i0 += ROAD_GROUP) {
      const i1 = Math.min(LEYTE_ROAD.length, i0 + ROAD_GROUP)
      let x0 = Infinity
      let z0 = Infinity
      let x1 = -Infinity
      let z1 = -Infinity
      for (let i = i0 - 1; i < i1; i++) {
        const p = LEYTE_ROAD[i]!
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x)
        z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z)
      }
      out.push({ x0, z0, x1, z1, i0, i1 })
    }
    return out
  })()

function segmentDistance(x: number, z: number, i: number): number {
  const a = LEYTE_ROAD[i - 1]!
  const b = LEYTE_ROAD[i]!
  const abx = b.x - a.x
  const abz = b.z - a.z
  const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)))
  return Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t))
}

/**
 * 這一點離公路中線是不是小於 `r`。與 `distanceToRoad(x, z) < r` 等價，但先比
 * 分組的外接矩形 —— 遠離公路的點幾次比較就答完。
 */
export function isNearRoad(x: number, z: number, r: number): boolean {
  for (const g of ROAD_GROUPS) {
    if (x < g.x0 - r || x > g.x1 + r || z < g.z0 - r || z > g.z1 + r) continue
    for (let i = g.i0; i < g.i1; i++) if (segmentDistance(x, z, i) < r) return true
  }
  return false
}
/** 美軍灘頭的集結區：公路起點 */
export const BEACHHEAD = LEYTE_ROAD[0]!
/** 前線：公路終點。卡車走到這裡就算抵達 */
export const FRONT_LINE = LEYTE_ROAD[LEYTE_ROAD.length - 1]!
/**
 * 撤離點的世界 z（x = 0）。Ki-84 從這一側進場，也從這一側撤離。
 * 離車隊區約九到十公里。**起始值，由試飛裁定。**
 */
export const EVACUATE_Z = 9000

/**
 * 灘頭與前線的固定防空砲位，世界座標。**不動、會開火**，照陸上砲位的規格
 * （`world/shipGuns.ts`）。全部在平地上、離公路中線至少 40 m（`leyte.test.ts`）。
 *
 * 【灘頭重、前線輕】灘頭是卸貨點，三座重高砲（美軍的 90 mm，雷達射控）加兩座
 * 輕砲；前線兩座輕砲。重高砲的射控在任務卡上複寫（`MissionBattle.flakSpec`）。
 * **座數與位置是起始值，由試飛裁定。**
 */
export const LEYTE_FLAK_SITES: readonly {
  readonly unit: 'flakLight' | 'flakHeavy'; readonly x: number; readonly z: number
}[] = [
  { unit: 'flakLight', x: 2753, z: -3031 },
  { unit: 'flakLight', x: 2500, z: -3250 },
  { unit: 'flakHeavy', x: 2519, z: -2706 },
  { unit: 'flakHeavy', x: 2900, z: -2900 },
  { unit: 'flakHeavy', x: 2300, z: -2900 },
  { unit: 'flakLight', x: -1228, z: 1169 },
  { unit: 'flakLight', x: -1346, z: 1033 },
]

/** 這一點到公路中線的最短距離，m */
export function distanceToRoad(x: number, z: number): number {
  let best = Infinity
  for (let i = 1; i < LEYTE_ROAD.length; i++) {
    const d = segmentDistance(x, z, i)
    if (d < best) best = d
  }
  return best
}

/**
 * 一座丘陵：中心、標稱半徑、峰高、兩個起伏相位，與抽瓣的種子。瓣的形狀用
 * `drawHillLobes` 依種子抽，與洛伊納、阿什同一套。
 */
export interface LeyteHill {
  readonly cx: number
  readonly cz: number
  readonly radius: number
  readonly peak: number
  readonly pa: number
  readonly pb: number
  readonly seed: number
}

/** 手擺的大山：圍著公路走廊的那一圈主峰 */
const MAIN_HILLS: readonly LeyteHill[] = [
  { cx: -7500, cz: 0, radius: 3500, peak: 900, pa: 0.9, pb: 3.4, seed: 401 },
  { cx: 7500, cz: 1500, radius: 3000, peak: 820, pa: 2.1, pb: 4.6, seed: 402 },
  { cx: -3500, cz: 7500, radius: 2500, peak: 750, pa: 3.0, pb: 1.2, seed: 403 },
  { cx: 5000, cz: 9500, radius: 2500, peak: 780, pa: 1.4, pb: 5.3, seed: 404 },
  { cx: -11500, cz: 8500, radius: 2500, peak: 700, pa: 4.2, pb: 0.6, seed: 405 },
  { cx: 11700, cz: 7700, radius: 2500, peak: 720, pa: 5.1, pb: 2.8, seed: 406 },
  { cx: 0, cz: 12500, radius: 1800, peak: 600, pa: 0.3, pb: 4.0, seed: 407 },
  { cx: 1500, cz: 4800, radius: 1200, peak: 450, pa: 1.8, pb: 2.2, seed: 408 },
]

/** 補空地的中型丘陵：候選網格、抖動、半徑、峰高。**起始值，拿眼睛校** */
const FILL_STEP = 1300
const FILL_JITTER = 450
const FILL_RADIUS = [450, 1000] as const
const FILL_PEAK = [260, 560] as const
const FILL_SEED = 20260924

/** 種子進、序列出。**不得 `Math.random`** —— 同一張地圖每次都要長一樣 */
function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 這一座能不能放：與既有的丘陵、公路、撤離點、砲位、場地邊界的約束 */
function hillFits(h: LeyteHill, placed: readonly LeyteHill[]): boolean {
  const r = h.radius * WOBBLE_MAX
  if (Math.abs(h.cx) + r > FIELD_HALF || Math.abs(h.cz) + r > FIELD_HALF) return false
  if (h.cz < coastZ(h.cx) + 1500) return false
  if (distanceToRoad(h.cx, h.cz) - r < 400) return false
  if (Math.hypot(h.cx, h.cz - EVACUATE_Z) - r < 300) return false
  for (const s of LEYTE_FLAK_SITES) if (Math.hypot(h.cx - s.x, h.cz - s.z) - r < 200) return false
  for (const o of placed) {
    if (Math.hypot(h.cx - o.cx, h.cz - o.cz) - r - o.radius * WOBBLE_MAX < HILL_GAP) return false
  }
  return true
}

/**
 * 大山之間的空地，用中型丘陵補起來。網格上每一格抽一個候選，放得下才放。
 *
 * 【所有亂數都無條件抽完，篩選在後】與農地同一個理由：條件式的抽樣會讓後面
 * 的序列跟著前面放不放得下而漂，改一座山就整片換樣子。
 */
function fillHills(): LeyteHill[] {
  const rand = makeRand(FILL_SEED)
  const placed: LeyteHill[] = [...MAIN_HILLS]
  const out: LeyteHill[] = []
  let seed = 500
  for (let z = -FIELD_HALF + FILL_STEP / 2; z < FIELD_HALF; z += FILL_STEP) {
    for (let x = -FIELD_HALF + FILL_STEP / 2; x < FIELD_HALF; x += FILL_STEP) {
      const h: LeyteHill = {
        cx: x + (rand() * 2 - 1) * FILL_JITTER,
        cz: z + (rand() * 2 - 1) * FILL_JITTER,
        radius: FILL_RADIUS[0] + rand() * (FILL_RADIUS[1] - FILL_RADIUS[0]),
        peak: FILL_PEAK[0] + rand() * (FILL_PEAK[1] - FILL_PEAK[0]),
        pa: rand() * Math.PI * 2,
        pb: rand() * Math.PI * 2,
        seed: seed++,
      }
      if (!hillFits(h, placed)) continue
      placed.push(h)
      out.push(h)
    }
  }
  return out
}

/**
 * 全部的丘陵：手擺的主峰，加上補空地的中型丘陵。
 *
 * 約束（`leyte.test.ts` 守著）：中心離岸至少 1.5 km、膨脹圓離公路至少 400 m、
 * 兩兩至少隔 `HILL_GAP`（AI 一次只繞一座）、整座在場地內、不蓋住撤離點與砲位。
 * 靠海的大山一路延伸到海裡，是岬角。
 */
export const LEYTE_HILLS: readonly LeyteHill[] = [...MAIN_HILLS, ...fillHills()]

/** 每一座丘陵幾瓣。瓣多，稜線就多 */
const HILL_LOBE_COUNT = 7

/** 山谷最深挖掉山高的幾成 */
const CARVE_DEPTH = 0.35

/**
 * 山谷的刻痕：兩道彎曲的正弦帶交疊出的谷線，這一點要保留山高的幾成，
 * `1 − CARVE_DEPTH`～1。谷線上最低、離開谷線很快回到 1。
 *
 * 【只往下挖】乘在「高出基準面的那一段」上，所以山只會變矮不會變高 ——
 * AI 知道的峰高（`IslandDesc.peak`）仍然是上界，避山判斷不受影響。
 */
export function carveFactor(x: number, z: number): number {
  const v = Math.sin(x * 0.0041 + 1.8 * Math.sin(z * 0.0027))
    + 0.6 * Math.sin(z * 0.0063 - 1.5 * Math.sin(x * 0.0033))
  const ridge = 1 - Math.min(1, Math.abs(v))
  return 1 - CARVE_DEPTH * ridge * ridge * ridge
}

export function createLeyte(): { field: HeightFieldData; hills: IslandDesc[] } {
  const field = createHeightField(LEYTE_SIZE, LEYTE_CELL)
  const hills: IslandDesc[] = []
  for (const h of LEYTE_HILLS) {
    const outerRadius = h.radius * WOBBLE_MAX
    const peak = Math.min(LEYTE_PEAK_MAX, h.peak)
    hills.push({
      cx: h.cx, cz: h.cz, radius: h.radius, outerRadius, peak,
      lobes: makeLobes(
        h.cx, h.cz, h.radius, outerRadius, peak, h.pa, h.pb, drawHillLobes(h.seed, HILL_LOBE_COUNT),
      ),
    })
  }
  bakeRelief(field, hills, SEA_FLOOR)
  const { size, cell, data } = field
  const half = (size - 1) / 2
  for (let row = 0; row < size; row++) {
    const z = (row - half) * cell
    for (let col = 0; col < size; col++) {
      const x = (col - half) * cell
      const i = row * size + col
      const b = baseHeight(x, z)
      const h = data[i]!
      // 【高出基準面的才刻】平地與海床不動
      data[i] = h > b ? b + (h - b) * carveFactor(x, z) : b
    }
  }
  return { field, hills }
}
