import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, reinforce, DEFAULT_BATTLE } from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { AiController } from '../../src/ai/AiController'
import { pushKill } from '../../src/world/kills'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import type { BattleConfig } from '../../src/battle/setup'
import type { FlightPlan } from '../../src/battle/order'

/**
 * # `reinforce` —— 戰鬥進行中讓一支分隊進場
 *
 * 容量是建構期配好的（`BattleConfig.reserve`），所以這裡**不重配任何東西**。
 * 那正是最要緊的一條：`World.add` 的擴容路徑會把 `killEvents` 換成空的、
 * 把 `damageTime` 整張抹掉，而這一步是在戰鬥中做的。
 *
 * 【交易性】機種、隊伍、架數、容量任何一項不合法都要在**動世界之前**擋下來。
 * 驗到一半才發現的話會只加入半個波次，而那個狀態沒有人能收拾。
 */

class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

const RESERVE = [{ team: 'red' as const, count: 4 }]

function battle(reserve: BattleConfig['reserve'] = RESERVE) {
  const cfg: BattleConfig = {
    ...DEFAULT_BATTLE,
    units: lineAbreast(HEAD_ON, P51D, 4, BF109K4, 4),
    reserve,
  }
  return createBattle(new Idle(), cfg, 20260901)
}

/** 完全沒有 `reserve` 欄位的場。**不能用 `battle(undefined)`** ——
 *  那個參數有預設值，會拿到 `RESERVE` */
function battleNoReserve() {
  const cfg: BattleConfig = {
    ...DEFAULT_BATTLE,
    units: lineAbreast(HEAD_ON, P51D, 4, BF109K4, 4),
  }
  return createBattle(new Idle(), cfg, 20260901)
}

/** 一支四架 Bf109 的紅方增援，從遠方進場 */
function wave(count = 4): FlightPlan {
  return {
    team: 'red',
    members: Array.from({ length: count }, () => BF109K4),
    entry: { along: -0.5, across: 0.5, gap: 0, climb: 0, heading: Math.PI, speed: 1 },
    duty: 'combat',
    lane: 2,
    tier: 3,
  }
}

describe('reinforce', () => {
  it('加人之後 killEvents 與 damageTime 逐位元不變', () => {
    // 【這是整條路上最要緊的一條】沒有預留容量的話，這一步會把這一幀還沒
    // 被排空的擊墜事件丟掉（戰績記到了、爆炸不見了），並抹掉全場的助攻窗口
    const b = battle()
    b.world.time = 12.5
    b.world.damageTime[0 * b.world.damageStride + 1] = b.world.time
    pushKill(b.world.killEvents, 1, 2, 3, 4, 5, 6, 1, 0)
    const kills = b.world.killEvents
    const damage = b.world.damageTime
    const snapshot = Float32Array.from(damage)

    reinforce(b, wave())

    expect(b.world.killEvents).toBe(kills)
    expect(b.world.killEvents.count).toBe(1)
    expect(b.world.damageTime).toBe(damage)
    expect(Array.from(b.world.damageTime)).toEqual(Array.from(snapshot))
  })

  it('指派板的三個陣列參考不變，舊值不動，新格是中性的', () => {
    const b = battle()
    const assignments = b.board.assignments
    assignments[0] = 5
    const priority = b.board.priority
    const mask = b.board.protectedMask

    reinforce(b, wave())

    expect(b.board.assignments).toBe(assignments)
    expect(b.board.priority).toBe(priority)
    expect(b.board.protectedMask).toBe(mask)
    expect(b.board.assignments[0]).toBe(5)
    for (let i = 8; i < 12; i++) {
      expect(b.board.assignments[i]).toBe(-1)
      expect(b.board.priority[i]).toBe(1)
      expect(b.board.protectedMask[i]).toBe(0)
    }
  })

  it('回傳新座位的索引，而且它們接在尾端', () => {
    const b = battle()
    expect(reinforce(b, wave())).toEqual([8, 9, 10, 11])
    expect(b.world.combatants).toHaveLength(12)
  })

  it('新座位的 AI 接上了板子、索引與難度', () => {
    const b = battle()
    reinforce(b, wave())
    for (let i = 8; i < 12; i++) {
      const ai = b.world.combatants[i]!.controller
      expect(ai).toBeInstanceOf(AiController)
      expect((ai as AiController).board).toBe(b.board)
      expect((ai as AiController).selfIndex).toBe(i)
    }
  })

  it('新座位進了 red、commandUnits、spawnOrientations 與名冊', () => {
    const b = battle()
    reinforce(b, wave())
    expect(b.red).toHaveLength(8)
    expect(b.commandUnits).toHaveLength(12)
    expect(b.spawnOrientations).toHaveLength(12)
    expect(b.roster.pilots).toHaveLength(12)
    for (let i = 8; i < 12; i++) {
      expect(b.roster.pilots[i]!.name.length).toBeGreaterThan(0)
      expect(b.roster.pilots[i]!.isPlayer).toBe(false)
    }
  })

  it('下一個物理步之後，新座位拿得到編制', () => {
    // 【擋的是 compactFlights 的越界靜默失效】沒有這一條，新飛機永遠沒有
    // flightOf 與 positionOf 而且不會有任何錯誤
    const b = battle()
    reinforce(b, wave())
    stepBattle(b, 1 / 240)
    for (let i = 8; i < 12; i++) {
      expect(b.flights.flightOf[i]).toBe(2)
      expect(b.flights.positionOf[i]).toBe(i - 8)
    }
    expect(b.flights.flights[2]!.count).toBe(4)
  })

  it('沒有預留就拋錯，而且世界沒有被改到', () => {
    const b = battleNoReserve()
    expect(() => reinforce(b, wave())).toThrow()
    expect(b.world.combatants).toHaveLength(8)
    expect(b.red).toHaveLength(4)
    expect(b.roster.pilots).toHaveLength(8)
  })

  it('架數與預留的不符就拋錯，而且世界沒有被改到', () => {
    const b = battle()
    expect(() => reinforce(b, wave(3))).toThrow()
    expect(b.world.combatants).toHaveLength(8)
  })

  it('隊伍與預留的不符就拋錯，而且世界沒有被改到', () => {
    const b = battle()
    const blueWave = { ...wave(), team: 'blue' as const }
    expect(() => reinforce(b, blueWave)).toThrow()
    expect(b.world.combatants).toHaveLength(8)
  })

  it('預留用完之後再叫就拋錯', () => {
    const b = battle()
    reinforce(b, wave())
    expect(() => reinforce(b, wave())).toThrow()
    expect(b.world.combatants).toHaveLength(12)
  })

  it('同一組設定跑兩次，新座位的出生狀態逐位元相同', () => {
    // 【決定性】增援若有任何一處吃到亂數或殘留狀態，這一條會紅
    const dump = () => {
      const b = battle()
      reinforce(b, wave())
      return b.world.combatants.slice(8).map((c) => {
        const s = c.aircraft.state
        return [s.position.x, s.position.y, s.position.z,
          s.velocity.x, s.velocity.y, s.velocity.z].join(',')
      })
    }
    expect(dump()).toEqual(dump())
  })
})
