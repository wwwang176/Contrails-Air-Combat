import { expect, it, vi } from 'vitest'
import { createReelFireColumns } from '../../src/app/reel/reelFireColumns'
import { createShipFireSmoke } from '../../src/render/smoke'
import { createImpacts } from '../../src/world/events'

it('預先燃燒只發展獨立煙池，播放後才噴火，暫停與清場不殘留火點', () => {
  const plume = createShipFireSmoke(512)
  const fire = vi.fn()
  const glow = vi.fn()
  const other = vi.fn()
  const columns = createReelFireColumns({
    fireball: { emit: fire }, glow: { emit: glow }, smoke: { emit: other },
    dust: { emit: other }, spray: { emit: other }, splashEvents: createImpacts(1),
  }, plume)
  try {
    columns.start([{ x: 10, y: 0, z: 20, age: 10 }])
    expect(plume.live).toBeGreaterThan(90)
    expect(plume.object.visible).toBe(true)
    expect(fire).not.toHaveBeenCalled()
    expect(glow).not.toHaveBeenCalled()
    expect(other).not.toHaveBeenCalled()
    columns.step(0)
    expect(fire).not.toHaveBeenCalled()
    columns.step(0.31)
    expect(fire).toHaveBeenCalled()
    expect(glow).toHaveBeenCalled()
    columns.reset()
    expect(plume.live).toBe(0)
    expect(plume.object.visible).toBe(false)
    fire.mockClear()
    columns.step(1)
    expect(fire).not.toHaveBeenCalled()
  } finally { plume.dispose() }
})
