import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { pickGroundTarget, SHIP_ATTACK_RANGE } from '../../src/ai/shipAttack'
import { SHIP_CLASSES, createShip, deckHeightOf } from '../../src/world/ships'
import { GROUND_HP, createGroundTarget, settleGroundTargets } from '../../src/world/groundTargets'
import {
  insideWindow, releaseWindowOf, RELEASE_ACROSS_HULLS, RELEASE_HULLS, shipAt,
} from '../../src/ai/bombRun'

/**
 * 打擊目標的視圖：船與地面目標都滿足它，`bombRun.ts` 那幾支只讀視圖。
 */
describe('船是打擊目標', () => {
  it('hull、impactY、value 是艦級資料的複本；speed 與 alive 是活的', () => {
    const s = createShip(2, SHIP_CLASSES.fletcher, 'red', 100, 200, 0.3, 8)
    expect(s.kind).toBe('ship')
    expect(s.hull).toBe(s.cls.hull)
    expect(s.impactY).toBe(deckHeightOf(s.cls))
    expect(s.value).toBe(s.cls.hp)
    s.speed = 3
    s.alive = false
    expect(s.speed).toBe(3)
    expect(s.alive).toBe(false)
  })
})

describe('地面目標是打擊目標', () => {
  it('shipAt 是常數、窗用第一個盒、impactY 跟著落地的高度', () => {
    const t = createGroundTarget(0, 'boilerHouse', 'red', 10, 20, 0)
    const out = new Vector3()
    expect(shipAt(t, 14, out)).toEqual(t.position)
    // 鍋爐房 60 × 18 × 30：沿 −Z 的半長 15、橫的半寬 30
    expect(releaseWindowOf(t.hull)).toEqual({ along: 15 * RELEASE_HULLS, across: 30 * RELEASE_ACROSS_HULLS })
    expect(insideWindow(t, 5, 5)).toBe(true)
    expect(insideWindow(t, 0, 40)).toBe(false)
    expect(t.impactY).toBe(18)
    settleGroundTargets([t], () => 7)
    expect(t.impactY).toBe(25)
  })
})

describe('pickGroundTarget', () => {
  const me = new Vector3(0, 4000, 5000)

  it('價值優先、同價值比距離、跳過死的與同隊', () => {
    const list = [
      createGroundTarget(0, 'oilTank', 'red', 0, -100, 0),
      createGroundTarget(1, 'boilerHouse', 'red', 0, -300, 0),
      createGroundTarget(2, 'boilerHouse', 'red', 0, -200, 0),
      createGroundTarget(3, 'boilerHouse', 'blue', 0, 0, 0),
    ]
    expect(GROUND_HP.boilerHouse).toBeGreaterThan(GROUND_HP.oilTank)
    expect(pickGroundTarget(me, 'blue', list, SHIP_ATTACK_RANGE)).toBe(2)
    list[2]!.alive = false
    expect(pickGroundTarget(me, 'blue', list, SHIP_ATTACK_RANGE)).toBe(1)
    list[1]!.alive = false
    expect(pickGroundTarget(me, 'blue', list, SHIP_ATTACK_RANGE)).toBe(0)
  })

  /**
   * 【停放的 B-17 是關卡的目標本身】它的血量比油桶堆低，照血量挑會先去炸
   * 油桶堆、砲位 —— 而卡片寫的是「炸毀停放的 B-17」。價值與血量分開。
   */
  it('停放的 B-17 比較近的油桶堆與砲位都優先，即使它比較遠', () => {
    const list = [
      createGroundTarget(0, 'fuelDump', 'red', 0, -100, 0),
      createGroundTarget(1, 'flakLight', 'red', 0, -150, 0),
      createGroundTarget(2, 'searchlight', 'red', 0, -200, 0),
      createGroundTarget(3, 'parkedB17', 'red', 0, -900, 0),
    ]
    expect(GROUND_HP.fuelDump).toBeGreaterThan(GROUND_HP.parkedB17)
    expect(pickGroundTarget(me, 'blue', list, SHIP_ATTACK_RANGE)).toBe(3)
    list[3]!.alive = false
    expect(pickGroundTarget(me, 'blue', list, SHIP_ATTACK_RANGE)).toBe(0)
  })

  it('超出接戰半徑回 −1；空清單回 −1', () => {
    const list = [createGroundTarget(0, 'oilTank', 'red', 0, -20000, 0)]
    expect(pickGroundTarget(me, 'blue', list, SHIP_ATTACK_RANGE)).toBe(-1)
    expect(pickGroundTarget(me, 'blue', [], SHIP_ATTACK_RANGE)).toBe(-1)
  })
})
