import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { ALERT_ALTITUDE, ALERT_RANGE, alertTriggered, type AlertWorld } from '../../src/battle/alert'
import { Projectiles } from '../../src/world/Projectiles'
import { Torpedoes } from '../../src/world/torpedo'
import { Bombs } from '../../src/world/bomb'

/**
 * 警戒條件（倫內爾島，SPEC §4.1）。只驗判斷本身；誰在什麼時候呼叫它在 `battle-alert-step.test.ts`。
 */
type Unit = AlertWorld['combatants'][number]
type Hull = AlertWorld['ships'][number]

function plane(team: 'blue' | 'red', x: number, y: number, z: number, hp = 100): Unit {
  return { alive: true, team, hp, aircraft: { spec: { hp: 100 }, state: { position: new Vector3(x, y, z) } } } as Unit
}

function ship(x: number, z: number, hp = 1000): Hull {
  return { alive: true, team: 'red', hp, cls: { hp: 1000 }, position: new Vector3(x, 0, z) } as Hull
}

function world(combatants: Unit[], ships: Hull[] = []): AlertWorld {
  return { combatants, ships, projectiles: new Projectiles(64), torpedoes: new Torpedoes(8), bombs: new Bombs(8) }
}

describe('alertTriggered', () => {
  it('雙方離得遠、藍方貼海、沒人開火也沒人受損時不觸發', () => {
    expect(alertTriggered(world([plane('blue', 0, 250, 5000), plane('red', 0, 800, -5000)], [ship(0, 0)]))).toBe(false)
  })

  it('藍機高於 500 m 觸發；剛好 500 m 不觸發', () => {
    expect(ALERT_ALTITUDE).toBe(500)
    expect(alertTriggered(world([plane('blue', 0, 501, 5000)]))).toBe(true)
    expect(alertTriggered(world([plane('blue', 0, 500, 5000)]))).toBe(false)
  })

  /** 900 m 是 G4M 機槍（九二式 7.7 mm）的射程：745 m/s × 1.2 s ≈ 894 m */
  it('藍機與紅船三維距離小於 900 m 觸發；剛好 900 m 不觸發', () => {
    expect(ALERT_RANGE).toBe(900)
    // √(100² + 890²) ≈ 895.6 m
    expect(alertTriggered(world([plane('blue', 0, 100, 890)], [ship(0, 0)]))).toBe(true)
    expect(alertTriggered(world([plane('blue', 0, 0, 900)], [ship(0, 0)]))).toBe(false)
  })

  it('藍機與紅機三維距離小於 900 m 觸發（高度差也算進去）', () => {
    expect(alertTriggered(world([plane('blue', 0, 200, 0), plane('red', 600, 800, 0)]))).toBe(true)
    expect(alertTriggered(world([plane('blue', 0, 200, 0), plane('red', 700, 800, 0)]))).toBe(false)
  })

  it('紅機彼此靠近、藍機彼此靠近都不算', () => {
    expect(alertTriggered(world([plane('blue', 0, 200, 5000), plane('blue', 10, 200, 5000),
      plane('red', 0, 800, -5000), plane('red', 10, 800, -5000)]))).toBe(false)
  })

  it('死掉的藍機、死掉的紅機、沉掉的紅船不算', () => {
    const b = plane('blue', 0, 800, 0)
    b.alive = false
    expect(alertTriggered(world([b]))).toBe(false)
    const near = plane('blue', 0, 200, 100)
    const r = plane('red', 0, 200, 0)
    r.alive = false
    expect(alertTriggered(world([near, r]))).toBe(false)
    const s = ship(0, 0)
    s.alive = false
    expect(alertTriggered(world([plane('blue', 0, 100, 100)], [s]))).toBe(false)
  })

  it('場上有藍方的子彈觸發；紅方的子彈與空槽不算', () => {
    const w = world([plane('blue', 0, 250, 5000)])
    w.projectiles.owner[3] = 7
    w.projectiles.team[3] = 1
    expect(alertTriggered(w)).toBe(false)
    w.projectiles.team[3] = 0
    expect(alertTriggered(w)).toBe(true)
    w.projectiles.owner[3] = -1
    expect(alertTriggered(w)).toBe(false)
  })

  it('水裡有藍方的魚雷、空中有藍方的炸彈觸發', () => {
    const w = world([plane('blue', 0, 250, 5000)])
    w.torpedoes.active[2] = 1
    w.torpedoes.team[2] = 1
    expect(alertTriggered(w)).toBe(false)
    w.torpedoes.team[2] = 0
    expect(alertTriggered(w)).toBe(true)
    w.torpedoes.active[2] = 0
    w.bombs.active[1] = 1
    w.bombs.team[1] = 0
    expect(alertTriggered(w)).toBe(true)
  })

  it('紅機或紅船不是滿血就觸發；藍機受損不算', () => {
    expect(alertTriggered(world([plane('blue', 0, 250, 5000), plane('red', 0, 800, -5000, 99)]))).toBe(true)
    expect(alertTriggered(world([plane('blue', 0, 250, 5000)], [ship(0, 0, 999)]))).toBe(true)
    expect(alertTriggered(world([plane('blue', 0, 250, 5000, 50)], [ship(0, 0)]))).toBe(false)
  })
})
