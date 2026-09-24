import { createHeightField, type HeightFieldData } from './heightfield'
import { bakeRelief, SEA_FLOOR, WOBBLE_MAX, type IslandDesc, type LobeDesc } from './archipelago'
import { HILL_GAP } from './farmland'

/**
 * # 雷伊泰的海岸線地形（日 M2）
 *
 * 一座很大的島：世界 −Z 是海（雷伊泰灣），+Z 是陸。陸上是平地、一條蜿蜒的
 * 公路與一群山脈。
 *
 * 【高度場的組成】「海岸線加平地」的基準面，再逐格疊上山脈的起伏（瓣緣是 0，
 * 所以瓣緣自然併入平地）。
 *
 * 【避障清單只有山脈】平地只有 `PLAIN_HEIGHT` 高，那是地面不是障礙；AI 的
 * 圓盤法只需要知道山脈（`ai/terrainSense.ts`）。
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
/** 高度場最高處的上界，m：山脈的起伏最多 450 m，疊在最高 `PLAIN_TOP` 的平地上。`LandField.ceiling` 用它 */
export const LEYTE_PEAK_MAX = 470

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
/** 基準面的最高處，m：平地加上緩坡起伏的上限（6 + 4 + 2） */
export const PLAIN_TOP = PLAIN_HEIGHT + 12
/** 岸邊這麼寬的一帶不起伏，m —— 沙灘與灘頭是平的 */
const ROLL_SHORE = 600
/**
 * 場地邊緣往內這麼寬的一帶，緩坡起伏收回 0，m。
 *
 * 【為什麼】場外的遠景陸地格子比場內粗得多（`render/leyteGround.ts`），兩邊只在
 * 粗格的頂點上對得上。邊緣上的高度若有起伏，粗格那條直線跟不上，接縫會裂開
 * 看得到底下。收平之後邊緣是一條水平線，兩邊都是它。
 */
const ROLL_EDGE = 1000

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
  const edge = Math.min(FIELD_HALF - Math.abs(x), FIELD_HALF - Math.abs(z))
  return PLAIN_HEIGHT * smoothstep(0, SHORE_RAMP, d)
    + roll(x, z) * smoothstep(SHORE_RAMP, SHORE_RAMP + ROLL_SHORE, d) * smoothstep(0, ROLL_EDGE, edge)
}

/** 遠景的山從場地邊緣往外這麼遠才長到全高，m */
const FAR_RISE = 15000
/** 遠景的丘陵從場地邊緣往外這麼遠長到全高，m。比山脈快 —— 出了場地就是丘陵地 */
const FAR_HILL_RISE = 4000
/**
 * 遠景丘陵的幾道起伏：振幅 m、方向 rad、波長 m、相位 rad。方向各不相同，疊出來
 * 不成排；振幅合計 630 m —— 比場內的山脈高，島的中央本來就是山。
 */
const FAR_HILLS = [
  { amp: 260, dir: 0.4, len: 5200, phase: 0.3 },
  { amp: 180, dir: 1.9, len: 3700, phase: 2.1 },
  { amp: 120, dir: 2.8, len: 2600, phase: 4.0 },
  { amp: 70, dir: 5.1, len: 1500, phase: 1.2 },
] as const

/** 遠景丘陵的起伏，m（0～振幅合計）：多道斜向正弦取絕對值疊出稜線 */
function farHills(x: number, z: number): number {
  let h = 0
  for (const w of FAR_HILLS) {
    const s = (x * Math.cos(w.dir) + z * Math.sin(w.dir)) / w.len
    // 【取 1 − |sin|】稜是尖的、谷是圓的，像山；純正弦是一排排圓丘
    h += w.amp * (1 - Math.abs(Math.sin(Math.PI * s + w.phase)))
  }
  return h
}

/**
 * 場外這一點有多「在山上」，0～1：丘陵起伏的上半段與往外升高的山脈。遠景的林相
 * 照它畫（`render/flora.ts` 的 `leyteFarCover`）—— 谷地是草、稜上是林子。
 *
 * 【不能拿「高出基準面多少」】場外的丘陵處處都高出基準面幾十公尺，照場內那一條
 * 算的話整片都是山林，遠景是一片均勻的暗綠。
 */
export function farUpland(x: number, z: number): number {
  const out = Math.max(0, Math.abs(x) - FIELD_HALF, z - FIELD_HALF)
  const hills = farHills(x, z) * smoothstep(0, FAR_HILL_RISE, out)
  return Math.min(1, smoothstep(210, 440, hills) + smoothstep(0.4, 0.9, smoothstep(0, FAR_RISE, out)))
}

/**
 * 場外遠景陸地的高度，m。**只畫不碰撞**（`render/leyteGround.ts`），戰場半徑
 * 12 km（`world/arena.ts`）飛不到那裡。
 *
 * 海岸線照同一條曲線延伸；陸上是場內的基準面（`baseHeight`），疊上丘陵地，再
 * 疊一道往外越來越高的山脈 —— 雷伊泰島中央是山。**在場地邊緣兩者都是 0**，
 * 與場內的地形接得上。
 */
export function farHeight(x: number, z: number): number {
  const base = baseHeight(x, z)
  if (base <= 0) return base
  const out = Math.max(0, Math.abs(x) - FIELD_HALF, z - FIELD_HALF)
  const ridge = 1000 + 300 * Math.sin(x / 7000 + 1) * Math.sin(z / 9000 + 0.4)
  // 【離岸近的地方山也矮】岸邊 3 km 內壓回平地，沙灘後面不會直接是山壁
  const inland = smoothstep(0, 3000, z - coastZ(x))
  return base + (ridge * smoothstep(0, FAR_RISE, out) + farHills(x, z) * smoothstep(0, FAR_HILL_RISE, out)) * inland
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
/**
 * 撤離點的世界 z（x = 0）。Ki-84 從這一側進場，也從這一側撤離。
 * 離車隊區約九到十公里。**起始值，由試飛裁定。**
 */
export const EVACUATE_Z = 9000

/**
 * 灘頭與前線的固定防空砲位，世界座標。**不動、會開火**，照陸上砲位的規格
 * （`world/shipGuns.ts`）。全部在平地上、離公路中線至少 40 m（`leyte.test.ts`）。
 *
 * 【灘頭重、前線輕】灘頭是卸貨點，三座重高砲（美軍的 90 mm，雷達射控）加兩輛
 * 停著的 M16 防空半履帶車；前線兩輛 M16。重高砲的射控在任務卡上複寫
 * （`MissionBattle.flakSpec`）。**座數與位置是起始值，由試飛裁定。**
 *
 * 【重高砲仍是 Flak 18 的模型】美軍 90 mm 還沒有模型；打起來照任務卡的規格。
 */
export const LEYTE_FLAK_SITES: readonly {
  readonly unit: 'usFlakTrack' | 'flakHeavy'; readonly x: number; readonly z: number
}[] = [
  { unit: 'usFlakTrack', x: 2753, z: -3031 },
  { unit: 'usFlakTrack', x: 2500, z: -3250 },
  { unit: 'flakHeavy', x: 2519, z: -2706 },
  { unit: 'flakHeavy', x: 2900, z: -2900 },
  { unit: 'flakHeavy', x: 2300, z: -2900 },
  { unit: 'usFlakTrack', x: -1228, z: 1169 },
  { unit: 'usFlakTrack', x: -1346, z: 1033 },
]

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
/** 艦體中點到跳板末端，m（`tools/blender/build_lst.py` 的跳板末端在艦體座標 z −53.5） */
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

/**
 * 一座山脈的佈局：一個圓盤，裡面沿一條彎曲的主稜排一串互相重疊的瓣，再從
 * 主稜岔出幾道支稜（`buildMassif`）。
 *
 * 【AI 眼中一座山脈就是一座「島」】`IslandDesc` 的圓盤是整座山脈，瓣是裡面
 * 所有的瓣。`ai/terrainSense.ts` 逐瓣估高度，所以同一座山脈裡的瓣怎麼重疊
 * 都看得見；**要隔 `HILL_GAP` 的只有山脈與山脈**（AI 一次只處理一個圓盤）。
 */
export interface LeyteMassifLayout {
  /** 圓盤中心與半徑，m。**所有瓣連同 wobble 都夾在圓內** */
  readonly cx: number
  readonly cz: number
  readonly reach: number
  /** 主稜最高處的峰高，m */
  readonly peak: number
  readonly seed: number
}

/**
 * 大山脈的圓盤半徑，m，與相鄰兩個圓盤之間的縫，m。
 *
 * 【排成蜂巢】圓盤之間的縫是平地（AI 要求圓盤不重疊，見 `HILL_GAP`），
 * 圓越多越小、縫就越多。等大的圓排成蜂巢，縫最少，三圓之間的三角縫再由
 * `FILL_TIERS` 的小緩丘補。
 */
const MAIN_REACH = 6000
const MAIN_SEAM = 210
const HEX_DX = 2 * MAIN_REACH + MAIN_SEAM
const HEX_DZ = (HEX_DX * Math.sqrt(3)) / 2
const HEX_Z0 = -500

/**
 * 手擺的大山脈：蜂巢的兩排。南排中間那一座包著公路，瓣讓開路之後是走廊兩側
 * 的緩丘；其餘是高的山脈。北排兩端的圓心在場外，只有場內那一部分長得出來。
 * 峰高是起伏，疊在平地上。
 */
const MAIN_MASSIFS: readonly LeyteMassifLayout[] = [
  { cx: -HEX_DX, cz: HEX_Z0, reach: MAIN_REACH, peak: 400, seed: 401 },
  { cx: 0, cz: HEX_Z0, reach: MAIN_REACH, peak: 160, seed: 402 },
  { cx: HEX_DX, cz: HEX_Z0, reach: MAIN_REACH, peak: 380, seed: 403 },
  { cx: -1.5 * HEX_DX, cz: HEX_Z0 + HEX_DZ, reach: MAIN_REACH, peak: 330, seed: 404 },
  { cx: -0.5 * HEX_DX, cz: HEX_Z0 + HEX_DZ, reach: MAIN_REACH, peak: 450, seed: 405 },
  { cx: 0.5 * HEX_DX, cz: HEX_Z0 + HEX_DZ, reach: MAIN_REACH, peak: 420, seed: 406 },
  { cx: 1.5 * HEX_DX, cz: HEX_Z0 + HEX_DZ, reach: MAIN_REACH, peak: 340, seed: 407 },
]

/**
 * 補縫的緩丘：由大到小幾輪，每輪一個網格，網格上每一格抽一個候選。
 * **網格比圓盤小**，大的放完之後剩下的縫由小的塞。**起始值，拿眼睛校**
 */
const FILL_TIERS = [
  { reach: [650, 900], step: 600 },
  { reach: [400, 550], step: 400 },
  { reach: [250, 380], step: 300 },
] as const
const FILL_JITTER = 0.5
/**
 * 緩丘的峰高是圓盤半徑的幾成。**跟著半徑走** —— 小圓盤配固定的峰高就是
 * 平地上一根尖錐。
 */
const FILL_PEAK = [0.08, 0.15] as const
const FILL_SEED = 20260924

/** 主稜上瓣的標稱半徑是圓盤半徑的幾成 */
const RIDGE_WIDTH = 0.42
/** 主稜的半長是圓盤半徑的幾成 */
const RIDGE_HALF = 0.72
/** 主稜最多轉幾度（全長），rad */
const RIDGE_BEND = 1.2
/**
 * 沿稜線每隔「瓣半徑的幾成」放一瓣。**小於 1 稜線才連得起來**：相鄰兩瓣
 * 中點的鞍部約是峰高的八成五。
 */
const RIDGE_STEP = 0.5
/** 峰高沿主稜的起伏：兩端比最高處矮這麼多成 */
const RIDGE_DROOP = 0.35
/** 支稜：道數、長度（圓盤半徑的幾成）、瓣半徑與峰高（相對主稜那一點） */
const SPUR_COUNT = 5
const SPUR_LENGTH = 0.6
const SPUR_WIDTH = 0.7
const SPUR_PEAK = 0.75
/**
 * 山麓：一圈一圈排滿整個圓盤的寬矮瓣，把稜線之間與圓盤邊緣的平地墊成緩坡。
 * 每一圈離圓心多遠（圓盤半徑的幾成）、幾瓣。
 *
 * 【排成圈而不是隨機撒】瓣要連同 wobble 整顆落在圓內，越靠圓邊能放的越小
 * —— 隨機撒的話外圈幾乎沒有瓣，圓盤邊緣那一圈（佔圓盤面積三成多）全是平地。
 */
const FOOT_RINGS = [
  { d: 0.3, n: 6 },
  { d: 0.55, n: 10 },
  { d: 0.75, n: 16 },
  { d: 0.9, n: 28 },
] as const
/**
 * 上面的瓣數是這個圓盤半徑下的，m。圓盤越大一圈越長，瓣數跟著半徑等比例
 * 加（至少 3），外圈才排得滿
 */
const FOOT_RING_REACH = 3600
/** 山麓瓣的半徑上限（圓盤半徑的幾成）與峰高（山脈峰高的幾成） */
const FOOT_WIDTH = 0.3
const FOOT_PEAK = [0.2, 0.35] as const
/**
 * 山麓瓣的峰高不超過自己半徑的這麼多倍。**AI 的安全約束**：瓣越小越陡，
 * 80 m 格的內插在瓣腳高出解析值越多，超過 `terrainCeiling` 的餘裕 AI 就會
 * 把山看矮（`leyte.test.ts` 對著高度場驗）。
 */
const FOOT_SLOPE = 0.15
/** 山麓峰高隨方位起伏的幅度：0.4 = 最矮的方位是平均的六成、最高的一倍四 */
const FOOT_SWAY = 0.4
/**
 * 圓頂：圓心一顆塞滿整個圓盤的矮瓣，峰高是山脈峰高的幾成。整座山脈因此坐在
 * 一片緩坡上；補空地的小圓盤放不下山麓瓣，靠它才不會只剩一顆小點。
 */
const DOME_PEAK = 0.35
const DOME_COUNT = 3
/** 瓣夾小之後小於這個半徑就不放，m */
const LOBE_MIN = 150
/** 一座山脈至少要剩這麼多瓣才放。只剩一兩瓣的就是平地上孤立的尖丘 */
const MASSIF_MIN_LOBES = 3
/** 瓣心離岸線至少這麼遠，m。瓣緣可以伸進海裡成為岬角 */
const LOBE_INLAND = 600
/** 瓣的膨脹圓離公路中線、撤離點、砲位至少這麼遠，m */
const ROAD_CLEAR = 400
const EVAC_CLEAR = 300
const FLAK_CLEAR = 200

/** 種子進、序列出。**不得 `Math.random`** —— 同一張地圖每次都要長一樣 */
function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * 一瓣在 (x, z) 最大能放多大的標稱半徑，m；0 = 不放。
 *
 * 膨脹圓（`r × WOBBLE_MAX`）要落在山脈的圓盤與場地之內，並讓開公路、撤離點與
 * 砲位。**放不下就縮**，不是整瓣丟掉 —— 主稜靠近公路的那一頭因此漸漸收窄，
 * 不會斷成一截一截。
 */
function fitLobe(m: LeyteMassifLayout, x: number, z: number, r: number): number {
  if (z < coastZ(x) + LOBE_INLAND) return 0
  let lim = r * WOBBLE_MAX
  lim = Math.min(lim, m.reach - Math.hypot(x - m.cx, z - m.cz))
  lim = Math.min(lim, FIELD_HALF - Math.abs(x), FIELD_HALF - Math.abs(z))
  lim = Math.min(lim, distanceToRoad(x, z) - ROAD_CLEAR)
  lim = Math.min(lim, Math.hypot(x, z - EVACUATE_Z) - EVAC_CLEAR)
  for (const s of LEYTE_FLAK_SITES) lim = Math.min(lim, Math.hypot(x - s.x, z - s.z) - FLAK_CLEAR)
  const fit = lim / WOBBLE_MAX
  return fit >= LOBE_MIN ? fit : 0
}

/** 主稜上的一個取樣點：位置、走向與那裡的峰高 */
interface RidgePoint { x: number; z: number; heading: number; peak: number }

/**
 * 由 (x, z) 沿 `heading` 走 `length` 公尺，每 `step` 公尺記一點；每公尺轉
 * `curve` rad。回傳的第一點是起點本身。
 */
function trace(
  x: number, z: number, heading: number, curve: number, length: number, step: number,
): { x: number; z: number; heading: number }[] {
  const out = [{ x, z, heading }]
  const n = Math.max(1, Math.round(length / step))
  const ds = length / n
  for (let i = 0; i < n; i++) {
    heading += curve * ds
    x += Math.cos(heading) * ds
    z += Math.sin(heading) * ds
    out.push({ x, z, heading })
  }
  return out
}

/**
 * 把一座山脈的佈局換成 AI 與烘焙讀的 `IslandDesc`；放得下的瓣不到
 * `MASSIF_MIN_LOBES` 時回 null。
 *
 * 【主稜是一段圓弧】由圓心往兩頭各走 `RIDGE_HALF × reach`，沿路每
 * `RIDGE_STEP × 瓣半徑` 放一瓣。峰高在稜上某一處最高、往兩頭下垂。支稜由
 * 主稜上隨機一點往側面岔出，越往外越窄越矮。
 *
 * 【亂數每座山脈自己一串，而且無條件抽完】瓣放不放得下（`fitLobe`）不影響
 * 後面抽到什麼 —— 挪一下公路不會讓整座山換樣子。
 *
 * 【`outerRadius` 取瓣實際伸到的最遠處】≤ `reach`。AI 的圓盤越貼身，掠過山脈
 * 外圍空地時越不會被嚇到。
 */
function buildMassif(m: LeyteMassifLayout): IslandDesc | null {
  const rand = makeRand(m.seed)
  const width = RIDGE_WIDTH * m.reach
  const half = RIDGE_HALF * m.reach
  const heading = rand() * Math.PI * 2
  const curve = ((rand() * 2 - 1) * RIDGE_BEND) / (2 * half)
  const crest = (rand() * 2 - 1) * 0.4
  const step = RIDGE_STEP * width

  // 往前一頭與往後一頭；往後走的那一頭沿同一條圓弧，所以轉向相反
  const fwd = trace(m.cx, m.cz, heading, curve, half, step)
  const back = trace(m.cx, m.cz, heading + Math.PI, -curve, half, step)
  const ridge: RidgePoint[] = []
  for (let i = back.length - 1; i >= 1; i--) {
    const p = back[i]!
    ridge.push({ x: p.x, z: p.z, heading: p.heading - Math.PI, peak: 0 })
  }
  for (const p of fwd) ridge.push({ x: p.x, z: p.z, heading: p.heading, peak: 0 })

  const lobes: LobeDesc[] = []
  const add = (x: number, z: number, r: number, peak: number, pa: number, pb: number): void => {
    const fit = fitLobe(m, x, z, r)
    if (fit === 0) return
    // 【縮了半徑就等比例壓低】不然讓路的那一瓣會變成一根尖錐
    lobes.push({
      cx: x, cz: z, offset: Math.hypot(x - m.cx, z - m.cz),
      radius: fit, peak: (peak * fit) / r, pa, pb,
    })
  }

  for (let i = 0; i < ridge.length; i++) {
    const p = ridge[i]!
    const u = ridge.length > 1 ? (2 * i) / (ridge.length - 1) - 1 : 0
    const k = Math.max(0, 1 - RIDGE_DROOP * (u - crest) * (u - crest))
    p.peak = m.peak * k * (0.85 + 0.15 * rand())
    const r = width * (0.8 + 0.4 * rand()) * (1 - 0.3 * Math.abs(u))
    const side = (rand() * 2 - 1) * 0.2 * width
    const pa = rand() * Math.PI * 2
    const pb = rand() * Math.PI * 2
    add(
      p.x - Math.sin(p.heading) * side, p.z + Math.cos(p.heading) * side,
      r, p.peak, pa, pb,
    )
  }

  for (let s = 0; s < SPUR_COUNT; s++) {
    const base = ridge[Math.min(ridge.length - 1, Math.floor(rand() * ridge.length))]!
    const dir = base.heading + (rand() < 0.5 ? -1 : 1) * (Math.PI / 2 + (rand() * 2 - 1) * 0.5)
    const length = SPUR_LENGTH * m.reach * (0.6 + 0.4 * rand())
    const bend = ((rand() * 2 - 1) * 0.6) / length
    const spur = trace(base.x, base.z, dir, bend, length, step * SPUR_WIDTH)
    for (let i = 1; i < spur.length; i++) {
      const v = i / (spur.length - 1)
      const p = spur[i]!
      const r = width * SPUR_WIDTH * (0.8 + 0.4 * rand()) * (1 - 0.4 * v)
      const peak = base.peak * SPUR_PEAK * (1 - 0.5 * v) * (0.85 + 0.15 * rand())
      add(p.x, p.z, r, peak, rand() * Math.PI * 2, rand() * Math.PI * 2)
    }
  }

  // 圓頂：半徑取剛好放得進圓盤。瓣緣是波浪形，最凹的方向只到圓盤的一半多，
  // 所以疊幾顆相位不同的，凹處互相補上
  for (let k = 0; k < DOME_COUNT; k++) {
    add(m.cx, m.cz, (m.reach / WOBBLE_MAX) * 0.999, m.peak * DOME_PEAK, rand() * Math.PI * 2, rand() * Math.PI * 2)
  }

  /**
   * 山麓：每一圈等角排開再抖一下；半徑取「這一圈還放得下」與上限的小者。
   * 峰高隨方位起伏（`FOOT_SWAY`）—— 每一方位一樣高的話，整座山是一顆圓坐墊，
   * 圓盤的輪廓從空中一眼看得出來。
   */
  const sway1 = rand() * Math.PI * 2
  const sway2 = rand() * Math.PI * 2
  for (const ring of FOOT_RINGS) {
    const phase = rand() * Math.PI * 2
    const n = Math.max(3, Math.round((ring.n * m.reach) / FOOT_RING_REACH))
    for (let f = 0; f < n; f++) {
      const a = phase + ((f + (rand() - 0.5) * 0.6) / n) * Math.PI * 2
      const d = ring.d * m.reach * (0.92 + 0.16 * rand())
      const room = (m.reach - d) / WOBBLE_MAX
      const r = Math.min(FOOT_WIDTH * m.reach, room) * (0.85 + 0.15 * rand())
      const sway = 1 + FOOT_SWAY * (0.6 * Math.sin(2 * a + sway1) + 0.4 * Math.sin(3 * a + sway2))
      const peak = sway * Math.min(
        FOOT_SLOPE * r, m.peak * (FOOT_PEAK[0] + rand() * (FOOT_PEAK[1] - FOOT_PEAK[0])))
      add(m.cx + Math.cos(a) * d, m.cz + Math.sin(a) * d, r, peak, rand() * Math.PI * 2, rand() * Math.PI * 2)
    }
  }

  // 【孤立的瓣不放】讓路讓掉旁邊的瓣之後，剩下與同一座其他瓣都不相接的那一顆
  // 就是平地上一根孤丘
  const joined = lobes.filter((a) => lobes.some((b) => b !== a
    && Math.hypot(a.cx - b.cx, a.cz - b.cz) < a.radius + b.radius))
  if (joined.length < MASSIF_MIN_LOBES) return null
  let peak = 0
  let outer = 0
  for (const lo of joined) {
    peak = Math.max(peak, lo.peak)
    outer = Math.max(outer, lo.offset + lo.radius * WOBBLE_MAX)
  }
  return { cx: m.cx, cz: m.cz, radius: outer / WOBBLE_MAX, outerRadius: outer, peak, lobes: joined }
}

/**
 * 補空地的緩丘，圓盤本身要能放：中心在陸上、讓開公路／撤離點／砲位、與已經
 * 放好的山脈隔開。
 *
 * 【比的是對方實際的 `outerRadius`，不是它的 `reach`】建好的山脈圓盤只會比
 * 佈局小，縫因此塞得更滿；自己這一座還沒建，用 `reach` 當上界。
 */
function massifFits(m: LeyteMassifLayout, placed: readonly IslandDesc[]): boolean {
  if (m.cz < coastZ(m.cx) + LOBE_INLAND) return false
  if (distanceToRoad(m.cx, m.cz) - m.reach < ROAD_CLEAR) return false
  if (Math.hypot(m.cx, m.cz - EVACUATE_Z) - m.reach < EVAC_CLEAR) return false
  for (const s of LEYTE_FLAK_SITES) if (Math.hypot(m.cx - s.x, m.cz - s.z) - m.reach < FLAK_CLEAR) return false
  for (const o of placed) {
    if (Math.hypot(m.cx - o.cx, m.cz - o.cz) - m.reach - o.outerRadius < HILL_GAP) return false
  }
  return true
}

/**
 * 全部的山脈：先建手擺的大山脈，再由大到小一輪一輪把空地補上緩丘（`FILL_TIERS`）。
 *
 * 【所有亂數都無條件抽完，篩選在後】與農地同一個理由：條件式的抽樣會讓後面
 * 的序列跟著前面放不放得下而漂，改一座山就整片換樣子。
 */
function buildMassifs(): IslandDesc[] {
  const placed: IslandDesc[] = []
  for (const m of MAIN_MASSIFS) {
    const d = buildMassif(m)
    if (d) placed.push(d)
  }
  const rand = makeRand(FILL_SEED)
  let seed = 500
  for (const tier of FILL_TIERS) {
    const jitter = FILL_JITTER * tier.step
    for (let z = -FIELD_HALF + tier.step / 2; z < FIELD_HALF; z += tier.step) {
      for (let x = -FIELD_HALF + tier.step / 2; x < FIELD_HALF; x += tier.step) {
        const cx = x + (rand() * 2 - 1) * jitter
        const cz = z + (rand() * 2 - 1) * jitter
        const reach = tier.reach[0] + rand() * (tier.reach[1] - tier.reach[0])
        const peak = reach * (FILL_PEAK[0] + rand() * (FILL_PEAK[1] - FILL_PEAK[0]))
        const m: LeyteMassifLayout = { cx, cz, reach, peak, seed: seed++ }
        if (!massifFits(m, placed)) continue
        const d = buildMassif(m)
        if (d) placed.push(d)
      }
    }
  }
  return placed
}

/**
 * 全部的山脈與緩丘。**AI 的避障清單就是它**。
 *
 * 約束（`leyte.test.ts` 守著）：圓盤兩兩至少隔 `HILL_GAP`（AI 一次只處理一個
 * 圓盤）、每一瓣都在自己的圓盤與場地內、瓣的膨脹圓離公路至少 `ROAD_CLEAR`、
 * 不蓋住撤離點與砲位。靠海的山脈可以伸到海裡，是岬角。
 */
export const LEYTE_MASSIFS: readonly IslandDesc[] = buildMassifs()

/** 山谷最深挖掉山高的幾成 */
const CARVE_DEPTH = 0.35

/**
 * 山谷的刻痕：兩道彎曲的正弦帶交疊出的谷線，這一點要保留山高的幾成，
 * `1 − CARVE_DEPTH`～1。谷線上最低、離開谷線很快回到 1。
 *
 * 【只往下挖】乘在瓣的起伏上，所以山只會變矮不會變高 —— AI 知道的峰高
 * （`IslandDesc.peak`）仍然是上界，避山判斷不受影響。
 */
export function carveFactor(x: number, z: number): number {
  const v = Math.sin(x * 0.0041 + 1.8 * Math.sin(z * 0.0027))
    + 0.6 * Math.sin(z * 0.0063 - 1.5 * Math.sin(x * 0.0033))
  const ridge = 1 - Math.min(1, Math.abs(v))
  return 1 - CARVE_DEPTH * ridge * ridge * ridge
}

/**
 * AI 讀的那一份：每一瓣的峰高加上 `PLAIN_TOP`。
 *
 * 【為什麼要加】高度場是基準面**加上**瓣的起伏，而 `terrainCeiling` 只知道瓣
 * —— 不加的話 AI 會把整座山看矮最多 `PLAIN_TOP`。加在每一瓣上，所以逐瓣算的
 * 上界照樣成立（`leyte.test.ts` 對著內插後的高度場驗）。
 */
function liftForAi(m: IslandDesc): IslandDesc {
  return {
    ...m,
    peak: m.peak + PLAIN_TOP,
    lobes: m.lobes.map((lo) => ({ ...lo, peak: lo.peak + PLAIN_TOP })),
  }
}

export function createLeyte(): { field: HeightFieldData; hills: IslandDesc[] } {
  const field = createHeightField(LEYTE_SIZE, LEYTE_CELL)
  // 先只烘瓣的起伏（底面 0），再逐格疊到基準面上
  bakeRelief(field, LEYTE_MASSIFS, 0)
  const { size, cell, data } = field
  const half = (size - 1) / 2
  for (let row = 0; row < size; row++) {
    const z = (row - half) * cell
    for (let col = 0; col < size; col++) {
      const x = (col - half) * cell
      const i = row * size + col
      /**
       * 【疊上去，不是取 max】取 max 的話瓣要先高過平地（8～20 m）才看得見，
       * 矮的山麓與緩丘整片被平地吃掉。
       */
      data[i] = baseHeight(x, z) + data[i]! * carveFactor(x, z)
    }
  }
  return { field, hills: LEYTE_MASSIFS.map(liftForAi) }
}
