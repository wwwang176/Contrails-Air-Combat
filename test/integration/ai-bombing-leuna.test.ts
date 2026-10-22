import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { B17G } from '../../src/specs/b17g'
import { createGroundTarget } from '../../src/world/groundTargets'
import { createGroundBattery } from '../../src/world/shipGuns'
import type { Controller } from '../../src/control/Controller'

/**
 * # 陸上重高砲位的接線
 *
 * 射控綁在地面目標上。接線漏一處（`placeGround` 沒掛砲、`World` 沒跑那個
 * 迴圈）的症狀是整段接近航路上一發都不打、那一關變得很輕鬆 —— **不會報錯**。
 *
 * 【只驗接線】88 砲的規格（引信、射程、射速、分攤）在
 * `test/unit/ground-flak.test.ts`，那一支直接呼叫 `stepGunPlatform`。
 */
const card = MISSIONS.allies.find((c) => c.id === 'allies-m2') as ReadyMissionCard
const IDLE: Controller = { update() {} }
const DT = 1 / 240

describe('洛伊納的重高砲位', () => {
  it('卡片上的每一個重高砲位都掛了一門砲，其餘地面目標沒有', () => {
    const b = createBattle(IDLE, missionConfigFrom(card), 1234)
    const expected = (card.battle.ground ?? []).filter((e) => e.unit === 'flakHeavy').length
    expect(expected).toBeGreaterThan(0)
    let armed = 0
    for (const t of b.world.groundTargets) {
      if (t.unit.id === 'flakHeavy') {
        expect(t.guns.length, '砲位沒掛砲').toBe(1)
        armed++
      } else {
        expect(t.guns.length, `${t.unit.id} 不該掛砲`).toBe(0)
      }
    }
    expect(armed).toBe(expected)
  })
})

/**
 * 一座掛好砲的重高砲位、一架 3 km 外的敵機，走 `World.step`。
 *
 * 【秒數】砲要先轉向、找目標；8 秒內一定開得了火（`ground-flak.test.ts` 同一個量）。
 */
describe('World 的迴圈推得動陸上砲位', () => {
  const SECONDS = 8

  function simulate() {
    const w = new World()
    // 【關掉墜地】量的是砲，不是飛機撞地
    w.crashPolicy = () => false
    const t = createGroundTarget(0, 'flakHeavy', 'red', 0, 0, 0)
    t.guns = createGroundBattery()
    w.groundTargets.push(t)
    // 【在砲位的 +Z、機首朝 −Z】一路飛向砲位，整段都在射程裡
    const spawn = new Vector3(0, 1500, 3000)
    const c = w.add(new Aircraft(B17G), IDLE, 'blue', spawn)
    c.aircraft.state.position.copy(spawn)
    c.aircraft.prevPosition.copy(spawn)
    let fired = 0
    let locked = 0
    let live = 0
    for (let i = 0; i < SECONDS * 240; i++) {
      w.step(DT)
      // 【看增量】引信到期會清空槽位，`live` 只是天上當下有幾發
      if (w.flak.live > live) fired += w.flak.live - live
      live = w.flak.live
      if (t.guns.some((g) => g.targetIndex === c.index)) locked++
    }
    return { fired, locked }
  }

  it('射得出高砲彈', () => {
    expect(simulate().fired, '一發高砲彈都沒有').toBeGreaterThan(0)
  })

  /** 【砲位有選到目標】射得出來但目標永遠是 −1 的話，那是別的東西在射 */
  it('砲位鎖得到敵機', () => {
    expect(simulate().locked, '砲位沒有鎖上過目標').toBeGreaterThan(0)
  })
})
