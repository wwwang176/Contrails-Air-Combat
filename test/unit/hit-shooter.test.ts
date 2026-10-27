import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { World } from '../../src/world/World'
import { DAMAGE_STRIDE } from '../../src/world/damage'
import { IMPACT_STRIDE, type ImpactEvents } from '../../src/world/events'
import { createGroundTarget } from '../../src/world/groundTargets'
import { createHeightField } from '../../src/world/heightfield'
import type { LandField } from '../../src/world/occlusion'

/**
 * # 命中事件記下射手
 *
 * 音效要分得出「自己打中的」（立刻響的回饋）與別人打中的，所以每一筆命中都帶開火那一架的座位；
 * 不是飛機打的（船砲）是 −1。
 */

const DT = 1 / 240
const idle = { update() {} }

/** 射手：一架停在遠處高空的藍隊飛機，不擋任何一發 */
function worldWithShooter(): { world: World; shooter: number } {
  const world = new World()
  const c = world.add(new Aircraft(P51D), idle, 'blue', new Vector3(5000, 3000, 5000))
  return { world, shooter: c.index }
}

function fire(world: World, owner: number, from: Vector3, vel: Vector3): void {
  world.projectiles.spawn(from.x, from.y, from.z, vel.x, vel.y, vel.z, 100, owner, 0, 0.5, 20)
  for (let i = 0; i < 60; i++) world.step(DT)
}

/** 整張圖高 100 m 的高台 */
function flatLand(): LandField {
  const f = createHeightField(16, 40)
  f.data.fill(100)
  return { field: f, ceiling: 100, landAbove: 0 }
}

const shooters = (e: ImpactEvents): number[] =>
  Array.from({ length: e.count }, (_, k) => e.data[k * IMPACT_STRIDE + 6]!)

describe('命中事件的射手', () => {
  it('打到車輛：材質命中帶射手的座位', () => {
    const { world, shooter } = worldWithShooter()
    world.groundAt = () => 0
    world.waterAt = () => -Infinity
    world.groundTargets.push(createGroundTarget(0, 'truck', 'red', 0, 0, 0))
    fire(world, shooter, new Vector3(0, 1, -40), new Vector3(0, 0, 800))
    expect(shooters(world.materialHits)).toContain(shooter)
  })

  it('打進地面：材質命中與土柱都帶射手', () => {
    const { world, shooter } = worldWithShooter()
    world.land = flatLand()
    fire(world, shooter, new Vector3(0, 120, 0), new Vector3(0, -800, 0))
    expect(shooters(world.materialHits)).toEqual([shooter])
    expect(shooters(world.terrainHitEvents)).toEqual([shooter])
  })

  it('打到海面：水柱帶射手', () => {
    const { world, shooter } = worldWithShooter()
    fire(world, shooter, new Vector3(0, 20, 0), new Vector3(0, -800, 0))
    expect(shooters(world.splashEvents)).toEqual([shooter])
  })

  it('打中飛機：受擊事件第六格是射手', () => {
    const { world, shooter } = worldWithShooter()
    // 【停在原地】有速度的話一步就飛離彈道
    const target = new Aircraft(P51D)
    target.state.position.set(0, 1000, 0)
    target.state.velocity.set(0, 0, 0)
    const victim = world.add(target, idle, 'red', target.state.position.clone(), 1000, 0)
    fire(world, shooter, new Vector3(0, 1000, -40), new Vector3(0, 0, 800))
    const d = world.damageEvents
    expect(d.count).toBeGreaterThan(0)
    expect(d.data[0]).toBe(victim.index)
    expect(d.data[5]).toBe(shooter)
    expect(DAMAGE_STRIDE).toBe(6)
  })

  it('船砲打的（owner 在負數區）記 −1', () => {
    const world = new World()
    world.land = flatLand()
    fire(world, -2, new Vector3(0, 120, 0), new Vector3(0, -800, 0))
    expect(shooters(world.materialHits)).toEqual([-1])
  })
})
