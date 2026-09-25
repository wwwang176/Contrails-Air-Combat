import { beforeAll, describe, expect, it } from 'vitest'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { BOMB_PROFILE } from '../../src/ai/bombRun'
import { TORPEDO_PROFILE } from '../../src/ai/torpedoRun'
import { clearImpacts } from '../../src/world/events'
import type { Controller } from '../../src/control/Controller'

/**
 * # 盟 M2：洛伊納廠區的高砲有接上線
 *
 * 射控綁在地面目標上。接線漏一處（`placeGround` 沒掛砲、`World` 沒跑那個
 * 迴圈）的症狀是整段接近航路上一發都不打、這一關變得很輕鬆 —— **不會報錯**。
 *
 * 【只驗接線】88 砲的規格（引信、射程、射速、分攤）在
 * `test/unit/ground-flak.test.ts`。
 *
 * 【開場把紅方全部打掉】戰鬥機造成的傷害會混進去，分不出是誰造成的。
 *
 * 【模擬呼叫端的排空】`World` 不排空落點事件，呼叫端每一步自己清。
 */
const card = MISSIONS.allies.find((c) => c.id === 'allies-m2') as ReadyMissionCard
const IDLE: Controller = { update() {} }
const DT = 1 / 240
const SEED = 1234
const SECONDS = 240

function wire(b: Battle): void {
  for (const c of b.world.combatants) {
    const ctl = c.controller
    if (!(ctl instanceof AiController)) continue
    ctl.ships = b.world.ships
    ctl.groundTargets = b.world.groundTargets
    ctl.bombBay = c.bombBay
    ctl.bombDrag = b.world.bombDrag
    ctl.strikeProfile = c.loadout?.kind === 'torpedo' ? TORPEDO_PROFILE : BOMB_PROFILE
  }
}

interface Run {
  b: Battle
  /** 全程射出過幾發高砲彈。引信到期會清空槽位，所以看的是增量 */
  flakFired: number
  /** 有幾個物理步至少有一座砲位鎖著目標 */
  flakLocked: number
}

function simulate(): Run {
  const b = createBattle(IDLE, missionConfigFrom(card), SEED)
  for (const c of b.world.combatants) if (c.team === 'red') b.world.applyDamage(c, 1e9, 'fuselage')
  const run: Run = { b, flakFired: 0, flakLocked: 0 }
  let live = 0
  for (let i = 0; i < SECONDS * 240; i++) {
    wire(b)
    stepBattle(b, DT)
    const f = b.world.flak
    let now = 0
    for (let k = 0; k < f.capacity; k++) if (f.team[k] !== -1) now++
    if (now > live) run.flakFired += now - live
    live = now
    for (const t of b.world.groundTargets) {
      if (t.guns.some((g) => g.targetIndex >= 0)) { run.flakLocked++; break }
    }
    clearImpacts(b.world.bombEvents)
    clearImpacts(b.world.groundKillEvents)
  }
  return run
}

describe('洛伊納的高砲', () => {
  // 【放 beforeAll 而不是 describe 本體】reporter 只算 it 與 hook 的時間，
  // 本體裡的四分鐘模擬會憑空消失
  let run: Run
  beforeAll(() => { run = simulate() }, 600_000)

  it('四十八個砲位都掛了砲，其餘地面目標沒有', () => {
    let armed = 0
    for (const t of run.b.world.groundTargets) {
      if (t.unit.id === 'flakHeavy') {
        expect(t.guns.length, '砲位沒掛砲').toBe(1)
        armed++
      } else {
        expect(t.guns.length, `${t.unit.id} 不該掛砲`).toBe(0)
      }
    }
    expect(armed).toBe(48)
  })

  it('接近航路上射得出高砲彈', () => {
    expect(run.flakFired, '整場一發高砲彈都沒有').toBeGreaterThan(0)
  })

  /** 【砲位有選到目標】射得出來但目標永遠是 −1 的話，那是別的東西在射 */
  it('砲位鎖得到 B-17', () => {
    expect(run.flakLocked, '沒有任何一座砲位鎖上過目標').toBeGreaterThan(0)
  })
})
