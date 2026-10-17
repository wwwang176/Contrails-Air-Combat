import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { threatFactor } from '../../src/ai/assess'
import { createTargetBoard } from '../../src/ai/target'
import { A6M5 } from '../../src/specs/a6m5'
import { G4M } from '../../src/specs/g4m'
import { JU87 } from '../../src/specs/ju87'
import { World } from '../../src/world/World'
import { createShip, SHIP_CLASSES } from '../../src/world/ships'
import { createBombBay } from '../../src/weapons/bomb'
import { A6M5_BOMB_LOADOUT, LOADOUT_BY_AIRCRAFT } from '../../src/weapons/stores'
import { TORPEDO_PROFILE } from '../../src/ai/torpedoRun'

function setup(spec = A6M5) {
  const world = new World()
  const ai = new AiController()
  const self = new Aircraft(spec, 200, 120)
  const c = world.add(self, ai, 'blue', new Vector3(0, 200, 600), 200, 120)
  self.state.position.copy(c.spawnPosition)
  c.bombBay = createBombBay(A6M5_BOMB_LOADOUT)
  ai.bombBay = c.bombBay
  ai.bombDrag = world.bombDrag
  const attacker = new Aircraft(A6M5, 200, 120)
  const enemy = world.add(attacker, { update() {} }, 'red', new Vector3(700, 200, 600), 200, 120)
  attacker.state.position.copy(enemy.spawnPosition)
  const decoy = new Aircraft(A6M5, 200, 120)
  const other = world.add(decoy, { update() {} }, 'red', new Vector3(1000, 200, -1000), 200, 120)
  decoy.state.position.copy(other.spawnPosition)
  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = c.index
  ai.focusTarget = decoy
  ai.ships = [createShip(0, SHIP_CLASSES.essex, 'red', 0, 0, 0, 0)]
  const update = (dt = 0.1) => ai.update(self, dt, c.command)
  const threaten = () => {
    attacker.state.position.copy(self.state.position).add(new Vector3(0, 0, 500))
    expect(threatFactor(attacker, self)).toBeGreaterThan(0)
  }
  return { ai, self, c, attacker, enemy, update, threaten }
}

describe('掛炸彈戰鬥機攻艦自衛', () => {
  it('附近有敵機但沒有直接射擊威脅時，仍持續攻艦', () => {
    const { ai, self, c, attacker, update } = setup()
    expect(threatFactor(attacker, self)).toBe(0)
    update()
    expect(ai.shipAim.ship).toBe(0)
    expect(ai.bombAim.active).toBe(true)
    expect(c.command.upright).toBe(true)
  })

  it('直接威脅蓋過集火目標並清掉投彈解；威脅解除後重新進場', () => {
    const { ai, c, attacker, enemy, update, threaten } = setup()
    update()
    expect(ai.bombAim.active).toBe(true)
    threaten()
    update()
    expect(ai.target).toBe(attacker)
    expect(ai.board!.assignments[ai.selfIndex]).toBe(enemy.index)
    expect(ai.bombAim.active).toBe(false)
    expect(ai.bombAim.release).toBe(false)
    expect(c.command.bombing).toBe(false)
    expect(c.command.upright).toBe(false)
    // 敵機仍活著，只是移到側方，確保恢復攻艦不必等待敵機死亡。
    attacker.state.position.set(700, 200, 600)
    ai.setDecisionPhase(0.5)
    update(1 / 240)
    expect(ai.groundStrafePhase).toBe('approach')
    expect(ai.bombAim.active).toBe(false)
    expect(c.command.bombing).toBe(false)
    update()
    expect(ai.shipAim.ship).toBe(0)
    expect(ai.bombAim.active).toBe(true)
  })

  it('離場途中也能自衛，空艙仍保留此能力', () => {
    const { ai, self, c, update, threaten } = setup()
    update()
    self.state.position.z = -600
    update()
    expect(ai.groundStrafePhase).toBe('egress')
    c.bombBay.load = 0
    c.bombBay.queue = 0
    threaten()
    update()
    expect(ai.groundStrafePhase).toBe('approach')
    expect(ai.groundStrafeReattackRange).toBe(0)
    expect(c.command.bombing).toBe(false)
    expect(c.command.upright).toBe(false)
  })

  for (const kind of ['友船', '沉船', '超距船'] as const) {
    it(`只有${kind}時不以攻艦自衛覆寫原本集火目標`, () => {
      const { ai, update, threaten } = setup()
      const ship = createShip(0, SHIP_CLASSES.essex, kind === '友船' ? 'blue' : 'red', 0, 0, 0, 0)
      if (kind === '沉船') ship.alive = false
      if (kind === '超距船') ship.position.z = -20000
      ai.ships = [ship]
      threaten()
      update()
      expect(ai.target).toBe(ai.focusTarget)
      expect(ai.shipAim.ship).toBe(-1)
    })
  }

  for (const spec of [G4M, JU87]) {
    it(`${spec.id} 保留原本攻艦流程，不套用戰鬥機自衛中斷`, () => {
      const { ai, update, threaten } = setup(spec)
      threaten()
      update()
      expect(ai.shipAim.ship).toBe(0)
      expect(ai.strikeRef.kind).toBe('ship')
      expect(ai.strikeRef.index).toBe(0)
    })
  }

  it('魚雷掛載的戰鬥機仍沿用原本攻艦流程', () => {
    const { ai, update, threaten } = setup()
    ai.ordnanceKind = 'torpedo'
    threaten()
    update()
    expect(ai.shipAim.ship).toBe(0)
    expect(ai.bombAim.active).toBe(true)
  })

  it('G4M 魚雷攻擊不被戰鬥機自衛規則中斷', () => {
    const { ai, c, update, threaten } = setup(G4M)
    c.bombBay = createBombBay(LOADOUT_BY_AIRCRAFT.g4m!)
    ai.bombBay = c.bombBay
    ai.ordnanceKind = 'torpedo'
    ai.strikeProfile = TORPEDO_PROFILE
    threaten()
    update()
    expect(ai.strikeRef.kind).toBe('ship')
    expect(ai.strikeRef.index).toBe(0)
  })
})
