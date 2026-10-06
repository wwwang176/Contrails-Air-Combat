import { createHeightField, type HeightFieldData } from './heightfield'
import { bakeRelief, WOBBLE_MAX, type IslandDesc, type LobeDesc } from './archipelago'
import { HILL_GAP } from './farmland'
import { baseHeight, coastZ, FIELD_HALF, LEYTE_CELL, LEYTE_SIZE, PLAIN_TOP } from './leyteCoast'
import { distanceToRoad } from './leyteRoads'
import { EVACUATE_Z, LEYTE_FLAK_SITES } from './leyteSites'
import { makeLeyteRand as makeRand } from './leyteRandom'

export {
  LEYTE_SIZE, LEYTE_CELL, FIELD_HALF, PLAIN_HEIGHT, SAND_TOP, LEYTE_PEAK_MAX, PLAIN_TOP,
  coastZ, baseHeight, farUpland, farHeight,
} from './leyteCoast'
export {
  LEYTE_ROAD, ROAD_WIDTH, ROAD_TREE_CLEAR, isNearRoad, BEACHHEAD, FRONT_LINE,
  distanceToRoad, LEYTE_ROADS, roadTreeClear, isInRoadClearing, type LeyteRoad,
} from './leyteRoads'
export { EVACUATE_Z, LEYTE_FLAK_SITES } from './leyteSites'
export {
  LEYTE_LSTS, LST_RAMP_REACH, LEYTE_BALLOONS, LST_BALLOON_DECK, LEYTE_BEACH,
  isInBeachClearing, type LeyteLst, type LeyteBalloon, type BeachDump, type BeachVehicle,
} from './leyteBeach'

/**
 * # 雷伊泰的海岸線地形（日 M2）
 *
 * 一座很大的島：世界 −Z 是海（雷伊泰灣），+Z 是陸。陸上是平地、一條蜿蜒的
 * 公路與一群山脈。
 *
 * 本檔組合山脈與高度場；海岸高度、公路查詢、任務地點與灘頭佈景各自維護。
 * 既有呼叫端仍從這裡取得相同的資料與函數。
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
