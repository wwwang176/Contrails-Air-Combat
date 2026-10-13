import { describe, expect, it, vi } from 'vitest'
import { createVehicleDustEmission, TRACK_DUST_EVERY } from '../../src/render/groundVehicleDust'
import { createGroundTarget } from '../../src/world/groundTargets'
import type { GroundUnitId } from '../../src/specs/ground'

describe('車尾行進揚塵', () => {
  it.each<GroundUnitId>(['tank', 'usTank', 'usTruck', 'usFlakTrack'])(
    '%s 從車尾貼地發射，轉向後位置跟隨車尾', id => {
      const emit = vi.fn()
      const dust = createVehicleDustEmission({ emit })
      const t = createGroundTarget(0, id, 'red', 10, 20, 0)
      t.position.y = 3
      t.speed = 10
      dust.update([t], 1 / 60)
      expect(emit).toHaveBeenLastCalledWith(10, 3.5, 20 + t.unit.realLength / 2, 0, 0.8, 0, 0.6)
      t.orientation.set(0, Math.SQRT1_2, 0, Math.SQRT1_2)
      dust.update([t], TRACK_DUST_EVERY + 0.01)
      const call = emit.mock.lastCall!
      expect(call[0]).toBeCloseTo(10 + t.unit.realLength / 2)
      expect(call[2]).toBeCloseTo(20)
    },
  )

  it('靜止、未出場、摧毀與抵達不發射，暫停也不補發', () => {
    const emit = vi.fn()
    const dust = createVehicleDustEmission({ emit })
    const t = createGroundTarget(0, 'usTruck', 'red', 0, 0, 0)
    dust.update([t], 1)
    t.speed = 10
    dust.update([t], 0)
    for (const state of ['dormant', 'arrived'] as const) {
      t[state] = true
      dust.update([t], 1)
      t[state] = false
    }
    t.alive = false
    dust.update([t], 1)
    expect(emit).not.toHaveBeenCalled()
    t.alive = true
    dust.update([t], 1 / 60)
    expect(emit).toHaveBeenCalledTimes(1)
    dust.update([t], 1 / 60)
    expect(emit).toHaveBeenCalledTimes(1)
    dust.reset()
    dust.update([t], 1 / 60)
    expect(emit).toHaveBeenCalledTimes(2)
  })
})
