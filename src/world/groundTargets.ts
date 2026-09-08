import { Quaternion, Vector3 } from 'three'
import { boundingRadius } from './hit'
import { GROUND_UNITS, type GroundUnit, type GroundUnitId } from '../render/geometry/ground'
import type { Team } from './World'

/**
 * # 場上的地面目標
 *
 * 戰車、卡車、砲位、火車。**與船同一個性質，不是 `Combatant`**：沒有飛行
 * 模型、沒有控制器、不進記分板、不上 HUD 的接觸列表。它們也不動、不開火
 * —— 這一期是靶，砲位會不會還手是下一期的事。
 *
 * ## 座標系
 *
 * 本體座標與 `render/geometry/ground` 一致：X 橫向、**Y 上**、**−Z 車頭**，
 * 原點在底面 × 中線。世界座標的 `position.y` 是**地面高度**，由
 * `settleGroundTargets` 在地形接上之後填 —— 擺放時 `World.groundAt` 還是
 * 預設的 0，先擺再落地。
 */

/**
 * 血量。**起始值，由試飛裁定。**
 *
 * 【尺是 20 mm 一發 5 傷害、炸彈爆心 `BOMB_BLAST_DAMAGE`】卡車幾十發機砲就該
 * 燒起來；戰車要炸彈才炸得掉（機槍打不穿裝甲，與船的道理相同）；砲位介於
 * 兩者之間 —— 掃射得掉，但要一整條彈道。
 */
export const GROUND_HP: Readonly<Record<GroundUnitId, number>> = {
  tank: 1_200,
  truck: 120,
  flakHeavy: 400,
  flakLight: 160,
  locomotive: 800,
  tender: 300,
  boxcar: 200,
  flatcar: 200,
}

export interface GroundTarget {
  readonly index: number
  readonly team: Team
  readonly unit: GroundUnit
  /** 世界座標，底面中心。`y` 是地面高度。 */
  readonly position: Vector3
  /** 只有航向（繞 Y）。 */
  readonly orientation: Quaternion
  readonly heading: number
  /** 開局位置。`resetGroundTarget` 抄回去。 */
  readonly spawn: Vector3
  /**
   * 包圍球半徑，m。**是上界** —— 命中盒最遠的角。算小了不會報錯，子彈只在
   * 特定角度穿過去（與 `hit.ts` 的 `boundingRadius` 同一條規則）。
   */
  readonly radius: number
  hp: number
  /**
   * 還在嗎。**血量歸零就是 false**：不再擋子彈、不再是目標。旗標而不是從
   * 陣列移除 —— `index` 是事件裡指認它的鍵。
   */
  alive: boolean
}

const UP = /* @__PURE__ */ new Vector3(0, 1, 0)
const byId = new Map<GroundUnitId, GroundUnit>(GROUND_UNITS.map((u) => [u.id, u]))

export function groundUnitOf(id: GroundUnitId): GroundUnit {
  const u = byId.get(id)
  if (u === undefined) throw new Error(`登記表裡沒有地面單位 ${id}`)
  return u
}

export function createGroundTarget(
  index: number, id: GroundUnitId, team: Team,
  x: number, z: number, heading: number,
): GroundTarget {
  const unit = groundUnitOf(id)
  return {
    index,
    team,
    unit,
    position: new Vector3(x, 0, z),
    orientation: new Quaternion().setFromAxisAngle(UP, heading),
    heading,
    spawn: new Vector3(x, 0, z),
    radius: boundingRadius(unit.hull),
    hp: GROUND_HP[id],
    alive: true,
  }
}

/**
 * 把每一台放到地面上。**地形接上之後呼叫一次** —— `createBattle` 跑的時候
 * `World.groundAt` 還是預設的 0，擺在那個高度的戰車在山坡上會浮空或陷地，
 * 而且不報錯。`spawn` 一起填，重開一場才不會又回到 0。
 */
export function settleGroundTargets(
  targets: readonly GroundTarget[],
  groundAt: (x: number, z: number) => number,
): void {
  for (const t of targets) {
    const y = groundAt(t.position.x, t.position.z)
    t.position.y = y
    t.spawn.y = y
  }
}

/** 回到開局狀態。沒有波次的關重開不重建 World —— 與 `resetShip` 同一個理由。 */
export function resetGroundTarget(t: GroundTarget): void {
  t.position.copy(t.spawn)
  t.hp = GROUND_HP[t.unit.id]
  t.alive = true
}
