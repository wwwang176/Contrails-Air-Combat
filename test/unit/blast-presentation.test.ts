import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { createCameraShake } from '../../src/camera/cameraShake'
import { GUN_LOST_SHAKE } from '../../src/camera/cameraShake'
import { createBlastPresentation } from '../../src/render/blastPresentation'
import { AIR_BLAST, GUN_LOST_BLAST, LAND_BLAST, type BlastPools } from '../../src/render/blast'
import { createGroundFires } from '../../src/render/groundFires'
import { createImpacts, pushImpact } from '../../src/world/events'
import { createKills, pushKill } from '../../src/world/kills'
import { createGroundTarget } from '../../src/world/groundTargets'

function setup() {
  const fireball = { emit: vi.fn() }
  // 在粒子池的介面記下發射，不需要 WebGL 環境
  const pools = {
    fireball, smoke: { emit: vi.fn() }, dust: { emit: vi.fn() },
    glow: { emit: vi.fn() },
    spray: { emit: vi.fn() }, jets: { emit: vi.fn() }, splashEvents: createImpacts(),
  } as unknown as BlastPools
  const cameraPosition = new Vector3(1, 2, 3)
  const groundFires = createGroundFires()
  const blastSparks = { burst: vi.fn() }
  const blastLights = { flash: vi.fn(), flashMuzzle: vi.fn() }
  const muzzleBlast = { emit: vi.fn() }
  const cameraShake = createCameraShake()
  const presentation = createBlastPresentation({
    BLAST_POOLS: pools, cameraPosition, cameraShake,
    groundFires, blastSparks, blastLights, muzzleBlast, debris: { burst: vi.fn() },
  })
  return { presentation, pools, fireball, blastSparks, blastLights, muzzleBlast, groundFires, cameraPosition, cameraShake }
}

describe('爆炸呈現的事件邊界', () => {
  it.each(['砲口', '落點'])('%s 只在近處微震，多發不累加，也不蓋掉較強的爆炸', (kind) => {
    const { presentation, cameraPosition, cameraShake } = setup()
    const pulse = cameraShake.cannon[kind === '砲口' ? 'muzzle' : 'impact']
    const fire = () => kind === '砲口'
      ? presentation.emitMuzzleBlast(0, 0, 0, 0, 0, -1)
      : presentation.emitMortarBlast(0, 0, 0)
    cameraPosition.set(5, 0, 0)
    fire()
    const near = pulse.amplitude
    expect(near).toBeGreaterThan(0)
    expect(near).toBeLessThan(0.5)
    for (let i = 0; i < 20; i++) fire()
    expect(pulse.amplitude).toBe(near)
    cameraShake.reset(); cameraPosition.set(30, 0, 0); fire()
    expect(pulse.amplitude).toBeGreaterThan(0)
    expect(pulse.amplitude).toBeLessThan(near)
    cameraShake.reset(); cameraPosition.set(kind === '砲口' ? 140 : 180, 0, 0); fire()
    expect(pulse.amplitude).toBe(0)
    cameraShake.trauma = 0.8; cameraPosition.set(5, 0, 0); fire()
    expect(cameraShake.trauma).toBe(0.8)
  })

  it('砲口火球朝管口前方擴散，同步短暫點光源，不附帶地面爆炸效果', () => {
    const { presentation, pools, fireball, blastLights, muzzleBlast, blastSparks, groundFires, cameraPosition } = setup()
    presentation.emitMuzzleBlast(10, 20, 30, 0, 0, -1)
    expect(muzzleBlast.emit).toHaveBeenCalledTimes(1)
    expect(muzzleBlast.emit).toHaveBeenCalledWith(10, 20, 30, 0, 0, -1, 1)
    expect(fireball.emit).not.toHaveBeenCalled()
    expect(pools.glow!.emit).not.toHaveBeenCalled()
    expect(pools.smoke.emit).not.toHaveBeenCalled()
    expect(pools.dust.emit).not.toHaveBeenCalled()
    expect(pools.spray.emit).not.toHaveBeenCalled()
    expect(pools.jets!.emit).not.toHaveBeenCalled()
    expect(blastLights.flash).not.toHaveBeenCalled()
    expect(blastLights.flashMuzzle).toHaveBeenCalledTimes(1)
    expect(blastLights.flashMuzzle).toHaveBeenCalledWith(10, 20, 30, cameraPosition, 1)
    expect(blastSparks.burst).not.toHaveBeenCalled()
    expect(groundFires.live.some(Boolean)).toBe(false)
    presentation.emitMuzzleBlast(30, 40, 50, 1, 0, 0, 0.85)
    expect(muzzleBlast.emit).toHaveBeenLastCalledWith(30, 40, 50, 1, 0, 0, 0.85)
    expect(blastLights.flashMuzzle).toHaveBeenLastCalledWith(30, 40, 50, cameraPosition, 0.85)
  })

  it('ship gun loss emits compact fire and smoke with a point light and no halo', () => {
    const { presentation, pools, fireball, blastLights, cameraPosition } = setup()
    const callback = presentation.emitGunLostBlast
    callback(10, 20, 30)
    expect(fireball.emit).toHaveBeenCalledTimes(GUN_LOST_BLAST.fireCount)
    expect(pools.smoke.emit).toHaveBeenCalledTimes(GUN_LOST_BLAST.smokeCount)
    expect(pools.glow!.emit).not.toHaveBeenCalled()
    expect(pools.dust.emit).not.toHaveBeenCalled()
    expect(pools.spray.emit).not.toHaveBeenCalled()
    expect(blastLights.flash).toHaveBeenCalledWith(10, 20, 30, GUN_LOST_SHAKE, cameraPosition)
    for (const args of fireball.emit.mock.calls) expect(args.slice(0, 3)).toEqual([10, 20, 30])
    cameraPosition.set(100, 200, 300)
    callback(40, 50, 60)
    expect(blastLights.flash).toHaveBeenLastCalledWith(40, 50, 60, GUN_LOST_SHAKE, cameraPosition)
    expect(fireball.emit).toHaveBeenCalledTimes(GUN_LOST_BLAST.fireCount * 2)
  })

  it('墜地壓到地面，撞海仍用空爆；呼叫者持有擊墜事件', () => {
    const { presentation, fireball } = setup()
    const events = createKills(1)
    pushKill(events, 10, 15, 20, 50, -20, 30, 0)
    presentation.emitKillBlasts(events, 7, { collisionHeightAt: () => 10, waterAt: () => -Infinity })
    expect(fireball.emit).toHaveBeenCalledTimes(LAND_BLAST.fireCount)
    expect(fireball.emit.mock.calls.every(c => c[1] === 10)).toBe(true)
    fireball.emit.mockClear()
    presentation.emitKillBlasts(events, 7, { collisionHeightAt: () => 0, waterAt: () => 0 })
    expect(fireball.emit).toHaveBeenCalledTimes(AIR_BLAST.fireCount)
    expect(fireball.emit.mock.calls.every(c => c[1] === 15)).toBe(true)
    expect(events.count).toBe(1)
  })

  it('人員不爆炸，炸彈擊毀油桶只點火；處理後排空地面擊毀事件', () => {
    const { presentation, fireball, groundFires, blastLights } = setup()
    const targets = [
      createGroundTarget(0, 'infantry', 'red', 0, 0, 0),
      createGroundTarget(1, 'fuelDump', 'red', 10, 0, 0),
    ]
    const events = createImpacts(2)
    pushImpact(events, 0, 0, 0, 0, 0, 0)
    pushImpact(events, 10, 0, 0, 1, 0, 1)
    presentation.emitGroundKills(events, 4, targets)
    expect(fireball.emit).not.toHaveBeenCalled()
    expect(blastLights.flash).not.toHaveBeenCalled()
    expect(groundFires.live.reduce((sum, live) => sum + live, 0)).toBe(6)
    expect(events.count).toBe(0)
  })

  it('戰鬥與短片共用火星序列，換場讀新的地形、時間與鏡頭', () => {
    const { presentation, blastSparks, cameraPosition } = setup()
    const terrain = { collisionHeightAt: () => 12, waterAt: () => -Infinity }
    const events = createImpacts(1)
    pushImpact(events, 10, 20, 30, 1, 100, 0)
    presentation.emitBombBlasts(events, 3, terrain, 40)
    expect(blastSparks.burst).not.toHaveBeenCalled()
    events.data[3] = 0
    presentation.emitBombBlasts(events, 3, terrain, 40)
    const first = blastSparks.burst.mock.calls[0]!
    expect(first[3]).toBe(11.5)
    expect(first.slice(6)).toEqual([1, 40, 1, 2, 3])
    cameraPosition.set(7, 8, 9)
    presentation.reelBomb(10, 20, 30, false,
      { collisionHeightAt: () => 90, waterAt: () => -Infinity }, 80)
    const second = blastSparks.burst.mock.calls[1]!
    expect(second[3]).toBe(89.5)
    expect(second.slice(6)).toEqual([2, 80, 7, 8, 9])
    expect(events.count).toBe(1)
  })
})
