import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { groundStrafeReattackRange, FIGHTER_BOMB_EGRESS_SCALE } from '../../src/ai/shipAttack'
import { sustainedTurnRate } from '../../src/analysis/envelope'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { World } from '../../src/world/World'
import { A6M5 } from '../../src/specs/a6m5'
import { KI84 } from '../../src/specs/ki84'
import { createBombBay } from '../../src/weapons/bomb'
import { A6M5_BOMB_LOADOUT, KI84_BOMB_LOADOUT } from '../../src/weapons/stores'
import { createShip, SHIP_CLASSES } from '../../src/world/ships'
import { createShipGuns } from '../../src/world/shipGuns'
import { createGroundTarget } from '../../src/world/groundTargets'
import { withinBombUprightRange, BOMB_AIM_RANGE, GROUND_BOMB_AIM_RANGE } from '../../src/ai/bombRun'

function setup(ground = false) {
  const world = new World()
  const ai = new AiController()
  const aircraft = new Aircraft(ground ? KI84 : A6M5, 200, 120)
  const c = world.add(aircraft, ai, 'blue', new Vector3(0, 200, 600), 200, 120)
  aircraft.state.position.copy(c.spawnPosition)
  c.bombBay = createBombBay(ground ? KI84_BOMB_LOADOUT : A6M5_BOMB_LOADOUT)
  ai.bombBay = c.bombBay
  ai.bombDrag = world.bombDrag
  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = c.index
  if (ground) {
    ai.groundTargets = [createGroundTarget(0, 'usTruck', 'red', 0, 0, 0)]
    ai.priorityGroundUnit = 'usTruck'
  } else {
    const ship = createShip(0, SHIP_CLASSES.essex, 'red', 0, 0, 0, 8)
    ship.guns = createShipGuns(ship.cls)
    ai.ships = [ship]
  }
  const update = () => ai.update(aircraft, 0.1, c.command)
  return { ai, c, aircraft, update }
}

describe('掛炸彈戰鬥機離場', () => {
  for (const ground of [false, true]) {
    it(`${ground ? '疾風對地' : '零戰對艦'}飛越後離場，空艙不取消；拉開才回頭`, () => {
      const { ai, c, aircraft, update } = setup(ground)
      update()
      expect(ai.groundStrafePhase).toBe('approach')
      aircraft.state.position.z = -600
      update()
      expect(ai.groundStrafePhase).toBe('egress')
      expect(ai.bombAim.active).toBe(false)
      expect(c.command.upright).toBe(false)
      expect(ai.groundStrafeReattackRange).toBeCloseTo(
        groundStrafeReattackRange(aircraft, FIGHTER_BOMB_EGRESS_SCALE), 6)
      c.bombBay.load = 0
      c.bombBay.queue = 0
      update()
      expect(ai.groundStrafePhase).toBe('egress')
      expect(c.command.bombing).toBe(false)
      aircraft.state.position.z = -ai.groundStrafeReattackRange - 500
      update()
      expect(ai.groundStrafePhase).toBe('approach')
    })
  }

  for (const ground of [false, true]) {
    it(`${ground ? '對地' : '對艦'}只有接近投彈帶且有彈時限制坡度`, () => {
      const { c, aircraft, update } = setup(ground)
      aircraft.state.position.z = 3000
      update()
      expect(c.command.upright).toBe(false)
      aircraft.state.position.z = 600
      update()
      expect(c.command.upright).toBe(true)
      c.bombBay.load = 0
      c.bombBay.queue = 0
      update()
      expect(c.command.upright).toBe(false)
    })
  }

  it('以目標斜距的 1.05 倍為界，艦體瞄點跟著船的方向轉換', () => {
    const { aircraft } = setup()
    const target = createShip(0, SHIP_CLASSES.essex, 'red', 0, 0, 0, 0)
    for (const [range, limit] of [[BOMB_AIM_RANGE, 1050], [GROUND_BOMB_AIM_RANGE, 2100]]) {
      aircraft.state.position.set(0, limit!, 0)
      expect(withinBombUprightRange(aircraft, target, range)).toBe(true)
      aircraft.state.position.y += 0.01
      expect(withinBombUprightRange(aircraft, target, range)).toBe(false)
    }
    target.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    const point = new Vector3(0, 0, 100)
    aircraft.state.position.set(1100, 0, 0)
    expect(withinBombUprightRange(aircraft, target)).toBe(false)
    expect(withinBombUprightRange(aircraft, target, BOMB_AIM_RANGE, point)).toBe(true)
  })

  it('半距離仍不得小於迴轉直徑；純機槍保持原距離', () => {
    const { aircraft } = setup()
    for (const speed of [80, 120, 180]) {
      aircraft.state.velocity.set(0, 0, -speed)
      const full = groundStrafeReattackRange(aircraft)
      const short = groundStrafeReattackRange(aircraft, FIGHTER_BOMB_EGRESS_SCALE)
      const omega = sustainedTurnRate(aircraft.spec, aircraft.state.position.y, speed)
      if (!(omega > 0)) {
        expect(short).toBe(Infinity)
      } else {
        expect(short).toBeCloseTo(Math.max(full * 0.5, 2 * speed / omega), 6)
        expect(short).toBeLessThanOrEqual(full)
      }
    }
  })

  it('魚雷掛載與無掛載的戰鬥機不進入新攻艦離場流程', () => {
    for (const torpedo of [false, true]) {
      const { ai, c, aircraft, update } = setup()
      if (torpedo) ai.ordnanceKind = 'torpedo'
      else c.bombBay.capacity = 0
      update()
      aircraft.state.position.z = -600
      update()
      expect(ai.groundStrafePhase).toBe('approach')
    }
  })
})
