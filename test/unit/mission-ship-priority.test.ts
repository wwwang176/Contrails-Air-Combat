import { describe, expect, it } from 'vitest'
import { AiController } from '../../src/ai/AiController'
import { wireBattleAi } from '../../src/app/wireBattleAi'
import { createBattle, resetBattle } from '../../src/battle/setup'
import { reinforce } from '../../src/battle/reinforcements'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import type { ReinforceBeat } from '../../src/battle/beats'
import { createGroundTarget } from '../../src/world/groundTargets'

const card = (id: string) => Object.values(MISSIONS).flat().find(c => c.id === id) as ReadyMissionCard

describe('任務指定攻擊艦級', () => {
  it('美 M3 零戰優先航母，重開與魚雷機增援都保留設定', () => {
    const cfg = missionConfigFrom(card('allies-m3'))
    const battle = createBattle({ update() {} }, cfg, 1)
    const playerAi = new AiController()
    const wire = () => wireBattleAi(battle.world, cfg.tuning, battle.player, playerAi, { islands: [] })
    wire()
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

  it('小隊可覆寫為巡洋艦，日 M2 維持卡車任務且沒有優先艦級', () => {
    const cfg = missionConfigFrom(card('allies-m3'))
    const units = cfg.units.map(unit => unit.team === 'red'
      ? { ...unit, priorityShipClass: 'wichita' as const } : unit)
    const battle = createBattle({ update() {} }, { ...cfg, units }, 1)
    for (const c of battle.red) expect((c.controller as AiController).priorityShipClass).toBe('wichita')
    const japan = createBattle({ update() {} }, missionConfigFrom(card('japan-m2')), 1)
    for (const c of japan.blue) {
      if (!(c.controller instanceof AiController)) continue
      expect(c.controller.priorityShipClass).toBeNull()
      expect(c.controller.priorityGroundUnit).toBe('usTruck')
    }
  })
})
