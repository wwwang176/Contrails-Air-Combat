import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { createGroundTarget, type GroundTarget } from '../../src/world/groundTargets'
import { airframePose } from '../../src/world/groundAirframe'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'
import { createBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { readyCard } from '../fixtures/mission'
import type { Command, Controller } from '../../src/control/Controller'
import type { HitPart } from '../../src/world/hit'

/**
 * # 地上的飛機照飛機算；打中地面目標與船都亮命中 X
 */

const DT = 1 / 240

class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.firing = false
  }
}

function setup(): { w: World; t: GroundTarget; shooter: number } {
  const w = new World()
  const s = w.add(new Aircraft(P51D, 3000, 150), new Idle(), 'blue', new Vector3(0, 3000, 5000))
  const t = createGroundTarget(0, 'parkedP51', 'red', 0, 0, 0.7)
  t.airframe = P51D
  t.hp = P51D.hp
  w.groundTargets.push(t)
  return { w, t, shooter: s.index }
}

/** 從部位盒中心正上方往下打一發，回傳這幾步裡射手累計的 hitsDealt */
function shootDown(w: World, shooter: number, at: Vector3): number {
  w.projectiles.spawn(at.x, at.y + 8, at.z, 0, -900, 0, 10, shooter, 0, 1, 12.7)
  let hits = 0
  for (let i = 0; i < 12; i++) {
    w.step(DT)
    hits += w.combatants[shooter]!.hitsDealt
  }
  return hits
}

function partCenter(t: GroundTarget, part: HitPart): Vector3 {
  const box = P51D.hitBoxes.find((b) => b.part === part)!
  const pos = new Vector3()
  const quat = new Quaternion()
  airframePose(t, pos, quat)
  return box.center.clone().applyQuaternion(quat).add(pos)
}

describe('停在地上的 P-51', () => {
  it('德 M3 的停機線：血量與天上那一架相同（1,000）', () => {
    const b = createBattle(new Idle(), missionConfigFrom(readyCard('germany-m3')), 1)
    const parked = b.world.groundTargets.filter((t) => t.unit.id === 'parkedP51')
    expect(parked.length).toBeGreaterThan(0)
    for (const t of parked) {
      expect(t.airframe).not.toBeNull()
      expect(t.airframe!.id).toBe('p51d')
      expect(t.hp).toBe(1000)
      expect(t.hp).toBe(t.airframe!.hp)
    }
    // 不是飛機的地面目標不掛
    for (const t of b.world.groundTargets) {
      if (t.unit.id !== 'parkedP51') expect(t.airframe).toBeNull()
    }
  })

  it('打座艙比打翼傷得多（部位倍率生效），而且命中 X 亮', () => {
    const a = setup()
    expect(shootDown(a.w, a.shooter, partCenter(a.t, 'cockpit'))).toBe(1)
    const cockpit = P51D.hp - a.t.hp
    const b = setup()
    expect(shootDown(b.w, b.shooter, partCenter(b.t, 'wingLeft'))).toBe(1)
    const wing = P51D.hp - b.t.hp
    expect(wing).toBeGreaterThan(0)
    expect(cockpit).toBeGreaterThan(wing)
  })

  it('打在部位盒外（停放盒內的空處）打不中', () => {
    const { w, t, shooter } = setup()
    // 平尾翼尖外側、主翼後方：不在任何部位盒裡，但在停放盒（整架的外框）裡
    const beside = new Vector3(4.5, 0, 3.5).applyQuaternion(t.orientation).add(t.position)
    expect(shootDown(w, shooter, beside)).toBe(0)
    expect(t.hp).toBe(P51D.hp)
  })
})

describe('命中 X', () => {
  it('打中一般地面目標，射手的 hitsDealt 加一', () => {
    const w = new World()
    const s = w.add(new Aircraft(P51D, 3000, 150), new Idle(), 'blue', new Vector3(0, 3000, 5000))
    const t = createGroundTarget(0, 'fuelDump', 'red', 0, 0, 0)
    w.groundTargets.push(t)
    expect(shootDown(w, s.index, new Vector3(0, t.impactY, 0))).toBe(1)
  })

  it('打中船，射手的 hitsDealt 加一', () => {
    const w = new World()
    const s = w.add(new Aircraft(P51D, 3000, 150), new Idle(), 'blue', new Vector3(0, 3000, 5000))
    w.ships.push(createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0))
    expect(shootDown(w, s.index, new Vector3(0, 30, 0))).toBe(1)
  })
})
