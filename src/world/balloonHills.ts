import { BALLOON_TOP, type Balloon } from './balloons'
import { WOBBLE_MAX, type IslandDesc, type LobeDesc } from './archipelago'
import { HILL_GAP } from './farmland'

// ── AI 看到的山 ─────────────────────────────────────────────

/**
 * 一顆氣球那一瓣的標稱半徑，m。山延伸到 `× WOBBLE_MAX` ≈ 103 m。
 *
 * 【剖面】AI 的高度是 `peak·(1 − 3t² + 2t³)`、t = 距離 / 103：離鋼索 20 m
 * （半個氣囊加半個翼展）還有 0.90·peak。`BALLOON_HILL_MARGIN` 讓那一圈仍然
 * 高過整顆氣球。
 */
export const BALLOON_HILL_RADIUS = 80
/** 山頂比氣球的最高點再高多少，m */
export const BALLOON_HILL_MARGIN = 60

interface MutableLobe { cx: number; cz: number; offset: number; radius: number; peak: number; pa: number; pb: number }
interface MutableIsland {
  cx: number; cz: number; radius: number; outerRadius: number; peak: number; lobes: MutableLobe[]
}

/** 氣球還在的話這一瓣的山頂；破了是 0 —— AI 不必再繞一座不存在的山 */
function hillPeak(b: Balloon): number {
  return b.alive ? b.top.y + BALLOON_TOP + BALLOON_HILL_MARGIN : 0
}

/** `balloonHills` 的產物。`islands` 是 AI 該用的**完整**清單（地形原有的加上氣球的） */
export interface BalloonHillSet {
  readonly islands: IslandDesc[]
  /** 第 i 顆氣球的那一瓣 */
  readonly lobeOf: LobeDesc[]
  /** 有氣球瓣的那幾座（新建的，或地形原有那座的複本）。`syncBalloonHills` 重算它們的 `peak` */
  readonly touched: IslandDesc[]
}

/**
 * 把氣球變成 AI 看得到的山，**只給 AI**：不烘進高度場、不影響撞地與畫面。
 *
 * 回傳的清單與 `balloons` 同一個生命週期：一場建一次，之後每幀
 * `syncBalloonHills` 就地改高度 —— **不增不減**，AI 的鎖存記的是清單裡的索引。
 * 地形原有的那幾座保持原來的次序，氣球自成的那幾座接在後面。
 *
 * 【為什麼不能各自一座】AI 只對航跡上**最早撞到**的那一個圓盤做爬升判斷
 * （`ai/terrainSense.ts` 的 `findThreat`），圓盤重疊時前面那一座會把後面的
 * 遮掉 —— 與丘陵之間要留 `HILL_GAP` 同一個理由。所以：
 *
 * - 氣球的山碰到地形原有的某一座（圓盤間隙小於 `HILL_GAP`）：**接成那一座的
 *   一瓣**。雷伊泰的山脈在 AI 那邊是一個涵蓋灘頭的大圓盤，另立一座的話永遠
 *   被它遮住
 * - 其餘的氣球彼此靠近就併成一座多瓣的山，併完圓盤變大、可能又碰到別座，
 *   所以反覆併到沒有為止
 *
 * 每一座的主瓣排第一（`IslandDesc` 的約定）；氣球自成的那幾座，主瓣是最高的
 * 那一顆。**建一場跑一次，不在熱路徑上。**
 */
export function balloonHills(
  balloons: readonly Balloon[], base: readonly IslandDesc[] = [],
): BalloonHillSet {
  const lobeOf: MutableLobe[] = []
  const reach = BALLOON_HILL_RADIUS * WOBBLE_MAX
  // 1. 接到地形原有的那一座
  const islands: IslandDesc[] = [...base]
  const touched: IslandDesc[] = []
  const free: number[] = []
  balloons.forEach((b, i) => {
    const k = base.findIndex((isl) =>
      Math.hypot(b.top.x - isl.cx, b.top.z - isl.cz) - isl.outerRadius - reach < HILL_GAP)
    if (k < 0) { free.push(i); return }
    let host = islands[k]! as MutableIsland
    if (!touched.includes(host)) {
      host = { ...host, lobes: [...host.lobes] as MutableLobe[] }
      islands[k] = host
      touched.push(host)
    }
    const offset = Math.hypot(b.top.x - host.cx, b.top.z - host.cz)
    const lobe: MutableLobe = {
      cx: b.top.x, cz: b.top.z, offset, radius: BALLOON_HILL_RADIUS, peak: hillPeak(b), pa: 0, pb: 0,
    }
    host.lobes.push(lobe)
    host.outerRadius = Math.max(host.outerRadius, offset + reach)
    lobeOf[i] = lobe
  })
  // 2. 其餘的自成幾座
  let groups = free.map((i) => [i])
  for (;;) {
    const discs = groups.map((g) => islandOf(balloons, g))
    let merged = false
    for (let i = 0; i < discs.length && !merged; i++) {
      for (let j = i + 1; j < discs.length && !merged; j++) {
        const a = discs[i]!
        const b = discs[j]!
        if (Math.hypot(a.cx - b.cx, a.cz - b.cz) - a.outerRadius - b.outerRadius < HILL_GAP) {
          groups = [...groups.filter((_, k) => k !== i && k !== j), [...groups[i]!, ...groups[j]!]]
          merged = true
        }
      }
    }
    if (!merged) break
  }
  for (const g of groups) {
    const island = islandOf(balloons, g)
    island.lobes.forEach((lobe, k) => { lobeOf[island.members[k]!] = lobe })
    const { members: _members, ...desc } = island
    islands.push(desc)
    touched.push(desc)
  }
  const set = { islands, lobeOf, touched }
  syncBalloonHills(balloons, set)
  return set
}

/** 一群氣球的山：主瓣是最高的那一顆，`members[k]` 是第 k 瓣的氣球索引 */
function islandOf(balloons: readonly Balloon[], members: readonly number[]): MutableIsland & { members: number[] } {
  const main = members.reduce((m, i) => (balloons[i]!.top.y > balloons[m]!.top.y ? i : m))
  const c = balloons[main]!.top
  const order = [main, ...members.filter((i) => i !== main)]
  const lobes = order.map((i): MutableLobe => {
    const t = balloons[i]!.top
    return {
      cx: t.x, cz: t.z, offset: Math.hypot(t.x - c.x, t.z - c.z),
      radius: BALLOON_HILL_RADIUS, peak: hillPeak(balloons[i]!), pa: 0, pb: 0,
    }
  })
  return {
    cx: c.x, cz: c.z, radius: BALLOON_HILL_RADIUS,
    outerRadius: Math.max(...lobes.map((l) => l.offset + l.radius * WOBBLE_MAX)),
    peak: Math.max(...lobes.map((l) => l.peak)),
    lobes,
    members: order,
  }
}

/**
 * 氣球破了就把那一瓣壓平、重生了就長回來。**每幀呼叫、不配置。**
 *
 * `lobeOf[i]` 是第 i 顆氣球的那一瓣；有氣球瓣的那幾座，`peak` 跟著重算（各瓣
 * 取最大 —— 接在山脈上的氣球可能比山脈還高）。
 */
export function syncBalloonHills(balloons: readonly Balloon[], hills: BalloonHillSet): void {
  for (let i = 0; i < balloons.length; i++) {
    (hills.lobeOf[i] as MutableLobe).peak = hillPeak(balloons[i]!)
  }
  for (const island of hills.touched) {
    let peak = 0
    for (const lo of island.lobes) if (lo.peak > peak) peak = lo.peak
    ;(island as MutableIsland).peak = peak
  }
}
