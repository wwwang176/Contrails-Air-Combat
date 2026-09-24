import { Quaternion, Vector3 } from 'three'
import { hitAircraft, type Box, type HitBox, type HitResult } from './hit'
import { obbOverlap } from './obb'
import { WOBBLE_MAX, type IslandDesc, type LobeDesc } from './archipelago'
import { HILL_GAP } from './farmland'
import type { Team } from './World'

/**
 * # 防空氣球
 *
 * 一顆氣囊繫在一條垂直的鋼索上：鋼索下端是錨點（LST 的艉甲板，或灘頭地面的
 * 絞車），上端是吊索的匯集點。**不是 `Combatant`、不是任務目標、不動**。
 *
 * - 飛機碰到鋼索或氣囊就墜毀（`balloonCollision`）；撞上氣囊的話氣球也破
 * - 子彈打得到氣囊，血量歸零就破（`World.resolveHits`）；破了之後鋼索與氣囊
 *   都不再擋東西
 * - AI 看到的是一座**看不見的山**（`balloonHills`）：山頂在氣球之上、往四周
 *   降坡，既有的丘陵避讓就會爬過去或繞開
 *
 * ## 座標系
 *
 * 與 GLB（`models-src/balloon.glb`）一致：X 橫向、**Y 上**、**−Z 艇首**，原點在
 * 吊索的匯集點（`Balloon.top`）。
 */

/**
 * 氣囊的碰撞盒，氣球座標。尾翼不在盒裡 —— 與船的盒同一個性質，是粗體積。
 * 數字照 `tools/blender/build_balloon.py`：艇首 z −9.5、艇尾 +11、中心線在
 * 匯集點上方 9.5 m、最大半徑 3.8。
 */
export const BALLOON_ENVELOPE: Box = {
  center: new Vector3(0, 9.5, 0.75),
  half: new Vector3(4.5, 4.5, 10.25),
}
/** 氣囊盒最遠角到盒心的距離，m：子彈與飛機的粗篩用它 */
export const BALLOON_REACH = Math.hypot(4.5, 4.5, 10.25)
/** 整顆氣球的最高點離匯集點多高，m（朝上那片尾翼的頂） */
export const BALLOON_TOP = 15.7
/**
 * 氣囊的血量。**起始值，由試飛裁定。**
 *
 * 氣囊是布，但灌的是氫氣、分成好幾個氣室 —— 史實上要燒夷彈才打得下來。
 * 40 大約是一架疾風一小段連射。
 */
export const BALLOON_HP = 40

export interface Balloon {
  readonly index: number
  readonly team: Team
  /** 鋼索下端，世界座標。地面絞車的高度由 `settleBalloons` 照地形填 */
  readonly anchor: Vector3
  /** 吊索匯集點（鋼索上端、模型原點），世界座標。x、z 與錨點相同 —— 鋼索是直的 */
  readonly top: Vector3
  /** 艇首朝向。0 = 朝 −Z */
  readonly orientation: Quaternion
  /** 錨點在地面上：落地時照地形取高度。LST 甲板上的錨點不動 */
  readonly grounded: boolean
  hp: number
  alive: boolean
}

const UP = /* @__PURE__ */ new Vector3(0, 1, 0)

/**
 * @param altitude 吊索匯集點的海拔，m
 * @param anchorY  錨點的高度，m。地面絞車填什麼都行，`settleBalloons` 會蓋掉
 */
export function createBalloon(
  index: number, team: Team, x: number, anchorY: number, z: number,
  altitude: number, heading: number, grounded: boolean,
): Balloon {
  return {
    index, team, grounded,
    anchor: new Vector3(x, anchorY, z),
    top: new Vector3(x, altitude, z),
    orientation: new Quaternion().setFromAxisAngle(UP, heading),
    hp: BALLOON_HP,
    alive: true,
  }
}

export function resetBalloon(b: Balloon): void {
  b.hp = BALLOON_HP
  b.alive = true
}

/** 地面絞車照地形落地。**地形接上之後呼叫** —— 建戰鬥時 `groundAt` 還是 0 */
export function settleBalloons(
  balloons: readonly Balloon[], groundAt: (x: number, z: number) => number,
): void {
  for (const b of balloons) {
    if (b.grounded) b.anchor.y = groundAt(b.anchor.x, b.anchor.z)
  }
}

/** 氣囊盒的中心，世界座標。寫進 `out` */
export function envelopeCenter(b: Balloon, out: Vector3): Vector3 {
  return out.copy(BALLOON_ENVELOPE.center).applyQuaternion(b.orientation).add(b.top)
}

/** `balloonCollision` 的結果 */
export const BALLOON_MISS = 0
export const BALLOON_TETHER = 1
export const BALLOON_ENVELOPE_HIT = 2

const ENV_C = /* @__PURE__ */ new Vector3()
const BODY_C = /* @__PURE__ */ new Vector3()

/**
 * 這一架飛機這一步有沒有碰到這顆氣球。
 *
 * 【鋼索用飛機的命中盒判】`hitAircraft` 本來就是「線段對命中盒」—— 鋼索就是
 * 一條垂直線段。240 Hz 下一步約 1 m，比翼弦短，不會從翼中間穿過去。
 *
 * 【氣囊與撞船同一個做法】命中盒（機體 AABB ＋ 姿態 ＝ OBB）對氣囊盒做分離軸。
 *
 * 【先粗篩】鋼索看水平距離與高度範圍、氣囊看包圍球 —— 絕大多數的步數在這裡
 * 就結束了。
 */
export function balloonCollision(
  b: Balloon, boxes: readonly HitBox[], pos: Vector3, q: Quaternion, hitRadius: number,
  scratch: HitResult,
): number {
  if (!b.alive) return BALLOON_MISS
  const dx = pos.x - b.top.x
  const dz = pos.z - b.top.z
  const horiz2 = dx * dx + dz * dz
  if (horiz2 < hitRadius * hitRadius
    && pos.y > b.anchor.y - hitRadius && pos.y < b.top.y + hitRadius
    && hitAircraft(boxes, pos, q, b.anchor, b.top, scratch)) return BALLOON_TETHER
  envelopeCenter(b, ENV_C)
  const reach = hitRadius + BALLOON_REACH
  if (pos.distanceToSquared(ENV_C) > reach * reach) return BALLOON_MISS
  for (const hb of boxes) {
    BODY_C.copy(hb.center).applyQuaternion(q).add(pos)
    if (obbOverlap(BODY_C, hb.half, q, ENV_C, BALLOON_ENVELOPE.half, b.orientation)) {
      return BALLOON_ENVELOPE_HIT
    }
  }
  return BALLOON_MISS
}

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
