import { Quaternion, Vector3 } from 'three'
import { boundingRadius, type Box } from './hit'
import { GROUND_UNITS, type GroundUnit, type GroundUnitId } from '../render/geometry/ground'
import type { StrikeTarget } from './strikeTarget'
import type { Team } from './World'

/**
 * # 場上的地面目標
 *
 * 戰車、卡車、砲位、火車、油廠的構件。**與船同一個性質，不是 `Combatant`**：
 * 沒有飛行模型、沒有控制器、不進記分板、不上 HUD 的接觸列表。它們也不動、
 * 不開火 —— 砲位是靶，陸上砲位的瞄準與發射沒有接（`shipGuns.ts` 綁在
 * `Ship` 上）。
 *
 * 它同時是 AI 轟炸機的打擊目標（`StrikeTarget`）：靜止、`hull` 就是命中盒、
 * 落點求解的平面是頂。
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
 * 【尺是 20 mm 一發 5 傷害、炸彈爆心 `BOMB_BLAST_DAMAGE`（9,000）】卡車幾十發
 * 機砲就該燒起來；砲位介於兩者之間 —— 掃射得掉，但要一整條彈道。戰車的
 * 「要炸彈才炸得掉」不是靠血量，是靠 `GROUND_ARMOUR` 的口徑門檻。
 *
 * 【油廠的構件用「幾枚炸彈」訂】一枚 9,000、30 m 線性衰減，直擊算滿：塔、
 * 煙囪、油槽一枚，鍋爐房、氣櫃、冷卻塔兩枚。機槍打得到但 5 對 8,000 是
 * 實質免疫。
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
  hydroTower: 8_000,
  chimney: 8_000,
  boilerHouse: 16_000,
  oilTank: 6_000,
  gasHolder: 14_000,
  coolingTower: 14_000,
}

/**
 * 裝甲，mm。**與 `ShipClass.armour` 同一條規則**（`weapons/armour.ts`）：口徑
 * 小於它的子彈只扣底線 1 點。
 *
 * 【只有戰車非零】T-34 的車體裝甲 45 mm 傾斜，機槍與 20 mm 機砲都打不穿，
 * 30 mm 也打不穿 —— 所以戰車只有炸彈炸得掉，而不是靠一個很大的血量硬撐。
 * 卡車、露天砲座、火車、廠房都是 0：掃射就該打得爛（廠房是血量擋著）。
 */
export const GROUND_ARMOUR: Readonly<Record<GroundUnitId, number>> = {
  tank: 45,
  truck: 0,
  flakHeavy: 0,
  flakLight: 0,
  locomotive: 0,
  tender: 0,
  boxcar: 0,
  flatcar: 0,
  hydroTower: 0,
  chimney: 0,
  boilerHouse: 0,
  oilTank: 0,
  gasHolder: 0,
  coolingTower: 0,
}

export interface GroundTarget extends StrikeTarget {
  readonly kind: 'ground'
  readonly index: number
  readonly team: Team
  readonly unit: GroundUnit
  /** 裝甲，mm。見 `GROUND_ARMOUR`。 */
  readonly armour: number
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
  /** 就是 `unit.hull`。打擊目標視圖讀這一格 */
  readonly hull: readonly Box[]
  /** 恆 0：地面目標不動 */
  readonly speed: 0
  /** 落點求解的平面：地面高度加命中盒的頂，世界高度 */
  readonly impactY: number
  /** 選目標用：就是血量上限 */
  readonly value: number
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

/** 命中盒的頂，本體座標 */
export function groundTopOf(unit: GroundUnit): number {
  let top = 0
  for (const b of unit.hull) {
    const t = b.center.y + b.half.y
    if (t > top) top = t
  }
  return top
}

export function createGroundTarget(
  index: number, id: GroundUnitId, team: Team,
  x: number, z: number, heading: number,
): GroundTarget {
  const unit = groundUnitOf(id)
  const position = new Vector3(x, 0, z)
  const top = groundTopOf(unit)
  return {
    kind: 'ground',
    index,
    team,
    unit,
    armour: GROUND_ARMOUR[id],
    position,
    orientation: new Quaternion().setFromAxisAngle(UP, heading),
    heading,
    spawn: new Vector3(x, 0, z),
    radius: boundingRadius(unit.hull),
    hull: unit.hull,
    speed: 0,
    // 【getter 而不是常數】`position.y` 由 `settleGroundTargets` 之後才填
    get impactY() { return position.y + top },
    value: GROUND_HP[id],
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
