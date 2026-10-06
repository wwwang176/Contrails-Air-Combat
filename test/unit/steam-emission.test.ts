import { describe, expect, it, vi } from 'vitest'
import { createSteamEmission } from '../../src/render/steamEmission'
import { createGroundTarget } from '../../src/world/groundTargets'
import { createFlares, spawnFlare } from '../../src/world/flares'
import { PLANT_STACKS } from '../../src/world/leuna'

describe('白煙發射的時間與場景邊界', () => {
  it('保留不足一顆的時間，暫停不發射，目標摧毀後停止', () => {
    const emit = vi.fn()
    const emission = createSteamEmission({ emit })
    const chimney = createGroundTarget(0, 'chimney', 'red', 10, 20, 30)
    emission.emitPlantSteam(0.1, [chimney], 'archipelago')
    expect(emit).not.toHaveBeenCalled()
    emission.emitPlantSteam(0, [chimney], 'archipelago')
    expect(emit).not.toHaveBeenCalled()
    emission.emitPlantSteam(0.1, [chimney], 'archipelago')
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]![1]).toBe(chimney.impactY)
    chimney.alive = false
    emission.emitPlantSteam(1, [chimney], 'archipelago')
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('換場只在勒烏納發射佈景煙囪，呈現器之間不共用種子', () => {
    const emit = vi.fn()
    const emission = createSteamEmission({ emit })
    const otherEmit = vi.fn()
    const other = createSteamEmission({ emit: otherEmit })
    emission.emitPlantSteam(1, [], 'leuna')
    expect(emit).toHaveBeenCalledTimes(PLANT_STACKS.length * 6)
    emission.emitPlantSteam(1, [], 'archipelago')
    expect(emit).toHaveBeenCalledTimes(PLANT_STACKS.length * 6)
    other.emitPlantSteam(1, [], 'leuna')
    expect(otherEmit.mock.calls).toEqual(emit.mock.calls)
  })

  it('沒有照明彈時不累積，未點燃時不冒煙，點燃後照節拍發射', () => {
    const emit = vi.fn()
    const emission = createSteamEmission({ emit })
    const flares = createFlares(1)
    emission.emitFlareSmoke(10, flares)
    spawnFlare(flares, 10, 20, 30, 0, 1)
    emission.emitFlareSmoke(0.25, flares)
    expect(emit).not.toHaveBeenCalled()
    flares.age[0] = 0
    emission.emitFlareSmoke(0.125, flares)
    expect(emit).not.toHaveBeenCalled()
    emission.emitFlareSmoke(0.125, flares)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]!.slice(0, 3)).toEqual([10, 20, 30])
  })
})
