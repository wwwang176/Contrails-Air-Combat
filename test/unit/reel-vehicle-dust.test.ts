import { expect, it, vi } from 'vitest'
import { createReelVehicleDust } from '../../src/app/reel/reelVehicleDust'
import type { ReelProp } from '../../src/app/reel/reelTypes'
import { createGroundTarget } from '../../src/world/groundTargets'
import { DUST_LIFE, DUST_LIFE_JITTER } from '../../src/render/blastParticles'

it('跳接重建的是車尾歷史塵跡，粒子有不同年齡，且不移動車輛', () => {
  let elapsed = 0
  const emitted: { x: number, y: number, z: number, born: number }[] = []
  const dust = createReelVehicleDust({
    trackDust: (x, y, z) => emitted.push({ x, y, z, born: elapsed }),
    stepTrackDust: (dt) => { elapsed += dt },
  })
  const truck = createGroundTarget(0, 'truck', 'red', 10, 100, Math.PI / 2)
  const spec: ReelProp = { id: 'truck', x: 0, z: 0, heading: 0, speed: 8 }
  const before = truck.position.clone()
  dust.rebuild(24.4, [truck], [spec], () => 3)
  expect(emitted.length).toBeGreaterThan(8)
  expect(elapsed).toBeCloseTo(DUST_LIFE * (1 + DUST_LIFE_JITTER))
  expect(emitted.at(-1)!.x).toBeLessThan(emitted[0]!.x)
  for (const p of emitted) {
    const time = 24.4 - elapsed + p.born + 1 / 30
    expect(p.x).toBeCloseTo(10 - 8 * time + truck.unit.realLength / 2, 4)
    expect(p.y).toBe(3.5)
    expect(p.z).toBeCloseTo(100)
  }
  expect(truck.position.equals(before)).toBe(true)
})

it('煞停及炸毀後不產生新塵，但舊塵繼續消散；定格不推進', () => {
  const trackDust = vi.fn(), stepTrackDust = vi.fn()
  const dust = createReelVehicleDust({ trackDust, stepTrackDust })
  const truck = createGroundTarget(0, 'truck', 'red', 0, 0, 0)
  const spec: ReelProp = {
    id: 'truck', x: 0, z: 0, heading: 0, speed: 8, brake: { at: 2, seconds: 1 },
  }
  dust.step(0.4, 1, [truck], [spec], () => 0)
  expect(trackDust).toHaveBeenCalledTimes(1)
  trackDust.mockClear()
  stepTrackDust.mockClear()
  dust.step(0, 1, [truck], [spec], () => 0)
  expect(stepTrackDust).not.toHaveBeenCalled()
  dust.step(0.4, 4, [truck], [spec], () => 0)
  truck.alive = false
  dust.step(0.4, 1, [truck], [spec], () => 0)
  expect(trackDust).not.toHaveBeenCalled()
  expect(stepTrackDust).toHaveBeenCalledTimes(2)
})
