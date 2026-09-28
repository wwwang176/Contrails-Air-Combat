import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { isObjectiveGround, isObjectiveShip } from '../../src/battle/setup'
import type { MissionRules } from '../../src/battle/mission'
import { createGroundTarget } from '../../src/world/groundTargets'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'

/**
 * # 哪些是主要目標（HUD 的三角形上方標距離）
 *
 * 判定依當下的規則：擊沉關的敵艦、炸毀池裡不是防空的地面目標。
 */

const DESTROY_ALL: MissionRules = { kind: 'destroy', count: 6 }
const DESTROY_P51: MissionRules = { kind: 'destroy', count: 12, unit: 'parkedP51' }
const INTERDICT: MissionRules = { kind: 'interdict', count: 6, leak: 4, unit: 'usTruck' }
const EVACUATE: MissionRules = { kind: 'evacuate', point: new Vector3(), radius: 500, seconds: Infinity }
const SINK: MissionRules = { kind: 'sink', count: 3 }

describe('主要目標判定', () => {
  it('炸毀池裡的廠區構件是，同一池裡的高砲、探照燈不是', () => {
    expect(isObjectiveGround(createGroundTarget(0, 'chimney', 'red', 0, 0, 0), DESTROY_ALL)).toBe(true)
    expect(isObjectiveGround(createGroundTarget(0, 'flakHeavy', 'red', 0, 0, 0), DESTROY_ALL)).toBe(false)
    expect(isObjectiveGround(createGroundTarget(0, 'flakLight', 'red', 0, 0, 0), DESTROY_ALL)).toBe(false)
    expect(isObjectiveGround(createGroundTarget(0, 'searchlight', 'red', 0, 0, 0), DESTROY_ALL)).toBe(false)
  })

  it('指定單位的關只有那一種是；我方的不是', () => {
    expect(isObjectiveGround(createGroundTarget(0, 'parkedP51', 'red', 0, 0, 0), DESTROY_P51)).toBe(true)
    expect(isObjectiveGround(createGroundTarget(0, 'parkedB17', 'red', 0, 0, 0), DESTROY_P51)).toBe(false)
    expect(isObjectiveGround(createGroundTarget(0, 'parkedP51', 'blue', 0, 0, 0), DESTROY_P51)).toBe(false)
  })

  it('截斷關的卡車是、美軍高砲車不是；換成撤離規則之後都不是', () => {
    const truck = createGroundTarget(0, 'usTruck', 'red', 0, 0, 0)
    expect(isObjectiveGround(truck, INTERDICT)).toBe(true)
    expect(isObjectiveGround(createGroundTarget(0, 'usFlakTrack', 'red', 0, 0, 0), INTERDICT)).toBe(false)
    expect(isObjectiveGround(truck, EVACUATE)).toBe(false)
  })

  it('擊沉關的敵艦是，我方的船不是；其他規則下船都不是', () => {
    const enemy = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0)
    const own = createShip(1, SHIP_CLASSES.fletcher, 'blue', 0, 0, 0, 0)
    expect(isObjectiveShip(enemy, SINK)).toBe(true)
    expect(isObjectiveShip(own, SINK)).toBe(false)
    expect(isObjectiveShip(enemy, DESTROY_ALL)).toBe(false)
  })
})
