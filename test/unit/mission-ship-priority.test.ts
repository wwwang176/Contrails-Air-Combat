import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { AiController } from '../../src/ai/AiController'
import { wireBattleAi } from '../../src/app/wireBattleAi'
import { createBattle, resetBattle } from '../../src/battle/setup'
import { reinforce } from '../../src/battle/reinforcements'
import { missionConfigFrom } from '../../src/battle/missions'
import type { ReinforceBeat } from '../../src/battle/beats'
import { createGroundTarget } from '../../src/world/groundTargets'
import { A6M5 } from '../../src/specs/a6m5'
import { G4M } from '../../src/specs/g4m'
import { A6M5_BOMB_LOADOUT } from '../../src/weapons/stores'
import { cardWith, KILL_CARD } from '../fixtures/mission'

/**
 * 卡片的 `shipPriority` 指定紅隊攻哪一級艦。巡洋艦擺在紅隊來的方向、比航母近，
 * 優先權沒接上的話紅隊會先打巡洋艦，而且不報錯。
 */
const card = () => cardWith(KILL_CARD, {
  redSpec: A6M5,
  loadouts: { a6m5: A6M5_BOMB_LOADOUT },
  shipPriority: { theirs: 'essex' },
  fleet: {
    center: new Vector3(0, 0, 0), heading: 0, speed: 8,
    ships: [
      { cls: 'essex', team: 'blue', offset: new Vector3(0, 0, 0) },
      { cls: 'wichita', team: 'blue', offset: new Vector3(0, 0, -1500) },
    ],
  },
  waves: [{
    when: { kind: 'clock', at: 999 }, warnKey: 'mission.allies-m1.wave.more', warnLead: 0,
    side: 'theirs', spec: G4M, count: 1,
  }],
})

describe('任務指定攻擊艦級', () => {
  it('紅隊優先航母，重開與魚雷機增援都保留設定', () => {
    const cfg = missionConfigFrom(card())
    const battle = createBattle({ update() {} }, cfg, 1)
    const playerAi = new AiController()
    const wire = () => wireBattleAi(battle.world, cfg.tuning, battle.player, playerAi, { islands: [] })
    wire()
    expect(battle.red.length).toBeGreaterThan(0)
    for (const c of battle.red) {
      const ai = c.controller as AiController
      expect(ai.priorityShipClass).toBe('essex')
      ai.update(c.aircraft, 0.1, c.command)
      expect(battle.world.ships[ai.shipAim.ship]?.cls.id).toBe('essex')
    }
    expect(playerAi.priorityShipClass).toBeNull()
    resetBattle(battle)
    wire()
    expect((battle.red[0]!.controller as AiController).priorityShipClass).toBe('essex')
    const beat = cfg.beats!.find(b => b.kind === 'reinforce') as ReinforceBeat
    const seats = reinforce(battle, beat.flight)
    expect(seats.length).toBeGreaterThan(0)
    wire()
    for (const seat of seats) {
      const c = battle.world.combatants[seat]!
      const ai = c.controller as AiController
      expect(ai.priorityShipClass).toBe('essex')
      // 加入更近的地面目標，驗證轟炸機的跨類型選擇仍尊重攻艦任務。
      c.aircraft.state.position.set(0, 1000, -2500)
      battle.world.groundTargets.push(createGroundTarget(0, 'oilTank', 'blue', 0, -2200, 0))
      ai.update(c.aircraft, 0.1, c.command)
      expect(ai.strikeRef.kind).toBe('ship')
      expect(battle.world.ships[ai.strikeRef.index]?.cls.id).toBe('essex')
    }
  })

  /** 【小隊的覆寫在出生時帶上那幾架】編組表上的 `priorityShipClass` 蓋過整隊的設定 */
  it('編組表的小隊覆寫蓋過卡片的艦級', () => {
    const cfg = missionConfigFrom(card())
    const units = cfg.units.map(unit => unit.team === 'red'
      ? { ...unit, priorityShipClass: 'wichita' as const } : unit)
    const battle = createBattle({ update() {} }, { ...cfg, units }, 1)
    for (const c of battle.red) expect((c.controller as AiController).priorityShipClass).toBe('wichita')
  })
})
