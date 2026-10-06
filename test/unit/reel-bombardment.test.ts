import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { createReelBombardment, type ReelReleaseActor } from '../../src/app/reel/reelBombardment'
import { createShip, SHIP_CLASSES } from '../../src/world/ships'
import { createGroundTarget } from '../../src/world/groundTargets'

function fixture() {
  const fx = { bomb: vi.fn(), torpedoSplash: vi.fn(), torpedoWake: vi.fn(), torpedoHit: vi.fn(),
    groundKill: vi.fn(), blast: vi.fn(), shipHit: vi.fn(), shipFire: vi.fn() }
  const terrain = { collisionHeightAt: () => 0, waterAt: () => -Infinity }
  const release = vi.fn((a: ReelReleaseActor, t: number, p: Vector3, v: Vector3) => {
    a.path(t, p)
    v.set(0, 0, 0)
  })
  const burn = vi.fn()
  const sim = createReelBombardment({ fx, terrain: () => terrain }, release, p => p, burn)
  const actor = { model: {} as object | null, path: (t: number, p: Vector3) => p.set(t * 10, 100, 0) }
  return { fx, terrain, release, burn, sim, actor }
}

describe('短片投射物與毀損', () => {
  it('使用每枚炸彈的事件時刻；演員被擊落後取消尚未投下的炸彈', () => {
    const f = fixture()
    f.sim.queueBomb({ kind: 'bomb', actor: 0, at: 1, count: 3, interval: 1 })
    f.sim.step(0.9, [f.actor], [], [])
    expect(f.release).not.toHaveBeenCalled()
    f.sim.step(2.2, [f.actor], [], [])
    expect(f.release.mock.calls.map(c => c[1])).toEqual([2, 1])
    expect(f.sim.bombs.p0[0]!.x).toBe(20)
    expect(f.sim.bombs.p0[1]!.x).toBe(10)
    f.actor.model = null
    f.sim.step(3.5, [f.actor], [], [])
    expect(f.release).toHaveBeenCalledTimes(2)
    f.sim.queueBomb({ kind: 'bomb', actor: 0, at: 10, count: 1, interval: 0 })
    f.sim.clear()
    f.actor.model = {}
    f.sim.step(20, [f.actor], [], [])
    expect(f.release).toHaveBeenCalledTimes(2)
    expect(f.sim.bombs.active.every(v => v === 0)).toBe(true)
  })

  it('船體命中優先於地形，火點隨船移動旋轉，換景後不殘留', () => {
    const f = fixture()
    const ship = createShip(0, SHIP_CLASSES.lst, 'blue', 0, 0, 0, 0)
    const box = ship.cls.hull[0]!
    f.actor.path = (_t, p) => p.set(box.center.x, 0, box.center.z)
    f.sim.queueBomb({ kind: 'bomb', actor: 0, at: 0, count: 1, interval: 0 })
    f.sim.step(0, [f.actor], [ship], [])
    expect(f.fx.shipHit).toHaveBeenCalledOnce()
    expect(f.fx.bomb).not.toHaveBeenCalled()
    const hit = new Vector3(...f.fx.shipHit.mock.calls[0] as [number, number, number])
    ship.position.set(200, 0, -40)
    ship.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    const expected = hit.applyQuaternion(ship.orientation).add(ship.position)
    f.sim.stepShipFires([ship], 0)
    expect(f.fx.shipFire).toHaveBeenLastCalledWith(expected.x, expected.y, expected.z)
    f.sim.clear()
    f.sim.stepShipFires([], 1)
    expect(f.fx.shipFire).toHaveBeenCalledOnce()
  })

  it('落地只引爆範圍內仍存活的目標，燃料殉爆只觸發一次', () => {
    const f = fixture()
    const near = createGroundTarget(0, 'fuelDump', 'blue', 0, 0, 0)
    const far = createGroundTarget(1, 'fuelDump', 'blue', 1000, 0, 0)
    f.actor.path = (_t, p) => p.set(0, 0, 0)
    f.sim.queueBomb({ kind: 'bomb', actor: 0, at: 0, count: 2, interval: 0 })
    f.sim.step(0, [f.actor], [], [near, far])
    expect(near.alive).toBe(false)
    expect(near.hp).toBe(0)
    expect(far.alive).toBe(true)
    expect(f.fx.groundKill).toHaveBeenCalledOnce()
    expect(f.fx.blast).toHaveBeenCalledOnce()
    expect(f.burn).toHaveBeenCalledTimes(2)
  })

  it('魚雷換景清除活動槽，但保留遞增序號；不同放映機互不清除', () => {
    const a = fixture(), b = fixture()
    const event = { kind: 'torpedo', at: 0, actor: 0, aim: { x: 0, z: -200 }, hit: true } as const
    a.sim.releaseTorpedo(event, [a.actor])
    b.sim.releaseTorpedo(event, [b.actor])
    const initial = a.sim.torpedoes.serial[0]!
    a.sim.clear()
    expect(a.sim.torpedoes.active.every(v => v === 0)).toBe(true)
    expect(b.sim.torpedoes.active[0]).toBe(1)
    const slot = a.sim.torpedoes.next
    a.sim.releaseTorpedo(event, [a.actor])
    expect(a.sim.torpedoes.serial[slot]).toBeGreaterThan(initial)
    a.actor.model = null
    a.sim.releaseTorpedo(event, [a.actor])
    expect(a.release).toHaveBeenCalledTimes(2)
  })
})
