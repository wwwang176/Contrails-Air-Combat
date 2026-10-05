import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { createCameraShake } from '../../src/camera/cameraShake'
import { createBlastPresentation } from '../../src/render/blastPresentation'
import { AIR_BLAST, LAND_BLAST, type BlastPools } from '../../src/render/blast'
import { createGroundFires } from '../../src/render/groundFires'
import { createImpacts, pushImpact } from '../../src/world/events'
import { createKills, pushKill } from '../../src/world/kills'
import { createGroundTarget } from '../../src/world/groundTargets'

function setup() {
  const fireball = { emit: vi.fn() }
  // Record particle emissions at the pool boundary; no WebGL context is needed.
  const pools = {
    fireball, smoke: { emit: vi.fn() }, dust: { emit: vi.fn() },
    spray: { emit: vi.fn() }, jets: { emit: vi.fn() }, splashEvents: createImpacts(),
  } as unknown as BlastPools
  const cameraPosition = new Vector3(1, 2, 3)
  const groundFires = createGroundFires()
  const blastSparks = { burst: vi.fn() }
  const blastLights = { flash: vi.fn() }
  const presentation = createBlastPresentation({
    BLAST_POOLS: pools, cameraPosition, cameraShake: createCameraShake(),
    groundFires, blastSparks, blastLights, debris: { burst: vi.fn() },
  })
  return { presentation, fireball, blastSparks, blastLights, groundFires, cameraPosition }
}

describe('爆炸呈現的事件邊界', () => {
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
