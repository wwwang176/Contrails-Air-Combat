import { describe, it, expect } from 'vitest'
import {
  createBattle, stepBattle, resetBattle, reviveFlight, DEFAULT_BATTLE, type Battle,
} from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { AiController } from '../../src/ai/AiController'
import { clearKills } from '../../src/world/kills'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import type { BattleConfig } from '../../src/battle/setup'
import type { RecycleBeat } from '../../src/battle/beats'

/**
 * # 整隊重生 —— 開場的小隊被殲滅之後回收席位再進場
 *
 * 席位不長大：復活的是同一組 `Combatant`，模型以外的每一樣依索引的狀態都
 * 要回到「剛進場」。這一份守的是那幾樣，以及勝負判定不能搶在重生之前。
 */

class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

const DT = 1 / 240

/** 重生從比開場更遠的縱深進場，測試才分得出「回到開場點」與「重生點」 */
const ENTRY = { ...HEAD_ON.red, along: -0.8 }

const RECYCLE: RecycleBeat = {
  kind: 'recycle', team: 'red', role: 'fighter', batches: 2,
  warn: '再來', warnLead: 5, entry: ENTRY,
}

/** 藍 4（分隊 0，玩家）、紅 8（分隊 1、2） */
function battle(patch: Partial<BattleConfig> = {}): Battle {
  const cfg: BattleConfig = {
    ...DEFAULT_BATTLE,
    units: lineAbreast(HEAD_ON, P51D, 4, BF109K4, 8),
    beats: [RECYCLE],
    ...patch,
  }
  return createBattle(new Idle(), cfg, 20260909)
}

function killFlight(b: Battle, f: number): void {
  for (const i of b.flights.flights[f]!.roster) b.world.destroy(b.world.combatants[i]!)
}

/**
 * 【每步清擊墜事件】畫面那一層放完爆炸才清（`main.ts`），無頭跑的話同一批
 * 事件每步重排一次 —— 復活的席位會被上一條命的擊墜再標一次死亡
 */
function run(b: Battle, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    stepBattle(b, DT)
    clearKills(b.world.killEvents)
  }
}

function seats(b: Battle, f: number) {
  return b.flights.flights[f]!.roster.map((i) => b.world.combatants[i]!)
}

describe('整隊重生', () => {
  it('殲滅一支 → 同一步預警、批數加一、席位還是死的', () => {
    const b = battle()
    killFlight(b, 1)
    stepBattle(b, DT)
    expect(b.batches).toBe(1)
    expect(b.reviveAt[1]).toBeGreaterThan(0)
    expect(b.message).toBe('再來')
    for (const c of seats(b, 1)) expect(c.alive).toBe(false)
  })

  it('少一架都不算殲滅', () => {
    const b = battle()
    const [a, ...rest] = seats(b, 1)
    for (const c of rest) b.world.destroy(c)
    stepBattle(b, DT)
    expect(b.batches).toBe(0)
    expect(a!.alive).toBe(true)
  })

  it('過 warnLead 之後四席復活、滿血、歸隊、同一列戰績', () => {
    // 【同名同列】記分板的一列是一個席位；換名字或清戰績會讓兇手記到一次
    // 沒有人陣亡的擊墜，擊墜總和 = 陣亡總和就破了
    const b = battle()
    const names = seats(b, 1).map((c) => b.roster.pilots[c.index]!.name)
    killFlight(b, 1)
    run(b, RECYCLE.warnLead + 0.1)
    for (const c of seats(b, 1)) {
      expect(c.alive).toBe(true)
      expect(c.hp).toBe(c.aircraft.spec.hp)
      expect(b.roster.pilots[c.index]!.alive).toBe(true)
      expect(c.controller).toBeInstanceOf(AiController)
    }
    expect(b.flights.flights[1]!.count).toBe(4)
    expect(seats(b, 1).map((c) => b.roster.pilots[c.index]!.name)).toEqual(names)
    expect(b.reviveAt[1]).toBe(-1)
  })

  it('復活在重生的進場框，不是開場點', () => {
    // 【直接呼叫，不走時鐘】位置要在第一個物理步之前量
    const b = battle()
    killFlight(b, 1)
    b.board.assignments[seats(b, 1)[0]!.index] = 3
    reviveFlight(b, 1, RECYCLE)
    // 上一條命鎖定的目標不帶過來
    for (const c of seats(b, 1)) expect(b.board.assignments[c.index]).toBe(-1)
    const lead = seats(b, 1)[0]!
    const p = lead.aircraft.state.position
    expect(p.z).toBeCloseTo(ENTRY.along * DEFAULT_BATTLE.entryRange, 3)
    expect(p.distanceTo(lead.spawnPosition)).toBeGreaterThan(1000)
    // 【出生點不動】「再打一場」要回開場點
    expect(lead.spawnPosition.z).toBeCloseTo(HEAD_ON.red.along * DEFAULT_BATTLE.entryRange, 3)
    expect(lead.aircraft.prevPosition.distanceTo(p)).toBe(0)
    // 朝向與速度是進場框的：紅隊朝 +Z
    expect(lead.aircraft.state.velocity.z).toBeGreaterThan(50)
  })

  it('兩支同時殲滅，落在不同的橫向槽位', () => {
    const b = battle()
    killFlight(b, 1)
    killFlight(b, 2)
    run(b, RECYCLE.warnLead + 0.1)
    const x1 = seats(b, 1)[0]!.aircraft.state.position.x
    const x2 = seats(b, 2)[0]!.aircraft.state.position.x
    expect(Math.abs(x1 - x2)).toBeGreaterThan(DEFAULT_BATTLE.schwarmSpacing * 0.9)
  })

  it('批數用完之後死光就死光，節拍走完', () => {
    const b = battle()
    for (let k = 0; k < RECYCLE.batches; k++) {
      killFlight(b, 1)
      run(b, RECYCLE.warnLead + 0.1)
      expect(seats(b, 1).every((c) => c.alive)).toBe(true)
    }
    killFlight(b, 1)
    run(b, RECYCLE.warnLead + 0.1)
    expect(seats(b, 1).every((c) => !c.alive)).toBe(true)
    expect(b.batches).toBe(RECYCLE.batches)
    expect(b.beatsLeft).toBe(0)
  })

  it('玩家釘住的小隊不回收', () => {
    const b = battle({ beats: [{ ...RECYCLE, team: 'blue' }] })
    killFlight(b, 0)
    run(b, RECYCLE.warnLead + 0.1)
    expect(b.batches).toBe(0)
    expect(seats(b, 0).every((c) => !c.alive)).toBe(true)
  })

  it('預警期間紅方歸零不判勝', () => {
    // 【守住艦隊的規則讀 redInbound】少了重生那一格，最後一支殲滅到重生
    // 之間那五秒紅方是零，會先判勝
    const b = battle({ rules: { kind: 'defend' } })
    killFlight(b, 1)
    killFlight(b, 2)
    run(b, RECYCLE.warnLead - 1)
    expect(b.outcome).toBe('fighting')
    run(b, 1.1)
    expect(b.world.combatants.filter((c) => c.team === 'red' && c.alive).length).toBe(8)
  })

  it('復活不重配世界：killEvents 與 damageTime 參考不變', () => {
    const b = battle()
    const kills = b.world.killEvents
    const damage = b.world.damageTime
    killFlight(b, 1)
    reviveFlight(b, 1, RECYCLE)
    expect(b.world.killEvents).toBe(kills)
    expect(b.world.damageTime).toBe(damage)
  })

  it('沒排空的擊墜事件不會在復活之後再記一次', () => {
    // 【無頭路徑】畫面那一層每幀排空擊墜緩衝，headless 的呼叫端不排 ——
    // 同一筆事件每步重掃。復活之前靠「已陣亡就略過」擋住；復活之後那一筆
    // 會被當成第二次陣亡：陣亡數多一、兇手的擊墜多一、復活的人立刻又死
    const b = battle()
    const victim = seats(b, 1)[0]!
    const killer = seats(b, 0)[1]!
    b.world.destroy(victim, killer)
    stepBattle(b, DT)
    expect(b.roster.pilots[victim.index]!.deaths).toBe(1)
    expect(b.roster.pilots[killer.index]!.kills).toBe(1)
    for (const c of seats(b, 1)) if (c.alive) b.world.destroy(c)
    stepBattle(b, DT)
    reviveFlight(b, 1, RECYCLE)
    stepBattle(b, DT)
    expect(b.roster.pilots[victim.index]!.alive).toBe(true)
    expect(b.roster.pilots[victim.index]!.deaths).toBe(1)
    expect(b.roster.pilots[killer.index]!.kills).toBe(1)
    // 真正的第二次陣亡照記
    b.world.destroy(victim, killer)
    stepBattle(b, DT)
    expect(b.roster.pilots[victim.index]!.deaths).toBe(2)
    expect(b.roster.pilots[killer.index]!.kills).toBe(2)
  })

  it('排空之後的新事件照記，游標不與它錯位', () => {
    const b = battle()
    const killer = seats(b, 0)[1]!
    const [a, c2] = seats(b, 1)
    b.world.destroy(a!, killer)
    stepBattle(b, DT)
    clearKills(b.world.killEvents)
    b.world.destroy(c2!, killer)
    stepBattle(b, DT)
    expect(b.roster.pilots[killer.index]!.kills).toBe(2)
  })

  it('再打一場：重生狀態歸零，上一場沒排空的擊墜不帶進來', () => {
    // 【節拍本身不在這裡重設】有節拍的一場「再打一場」是整場重建
    // （`main.ts` 的 `restartBattle`），`resetBattle` 只負責自己的狀態
    const b = battle()
    killFlight(b, 1)
    stepBattle(b, DT)
    resetBattle(b, 1)
    expect(Array.from(b.reviveAt).every((t) => t === -1)).toBe(true)
    expect(b.batches).toBe(0)
    stepBattle(b, DT)
    for (const c of seats(b, 1)) expect(b.roster.pilots[c.index]!.deaths).toBe(0)
  })
})
