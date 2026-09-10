import { describe, expect, it } from 'vitest'
import { PointLight, Texture } from 'three'
import {
  createFlareLights, FLARE_LIGHT_COUNT, flareBrightness, flareFlicker,
} from '../../src/render/flares'
import { createFlares, FLARE_BURN, spawnFlare } from '../../src/world/flares'

describe('照明彈的光', () => {
  it('四盞點光源開場就在、池空時強度 0', () => {
    const lights = createFlareLights(new Texture())
    const found: PointLight[] = []
    lights.object.traverse((o) => { if ((o as PointLight).isPointLight) found.push(o as PointLight) })
    expect(found).toHaveLength(FLARE_LIGHT_COUNT)
    lights.update(createFlares(), 0)
    for (const l of found) expect(l.intensity).toBe(0)
  })

  it('還沒點燃的不亮', () => {
    const lights = createFlareLights(new Texture())
    const f = createFlares()
    spawnFlare(f, 0, 1000, 0, 0, 10)
    lights.update(f, 0)
    lights.object.traverse((o) => {
      const l = o as PointLight
      if (l.isPointLight) expect(l.intensity).toBe(0)
    })
  })

  it('閃爍在 0.8 到 1 之間、每一枚不同、是時間的純函數', () => {
    let lo = 1
    let hi = 0
    for (let t = 0; t < 10; t += 0.013) {
      const v = flareFlicker(0, t)
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    expect(lo).toBeGreaterThanOrEqual(0.8)
    expect(hi).toBeLessThanOrEqual(1)
    expect(hi - lo).toBeGreaterThan(0.1)
    expect(flareFlicker(1, 2.5)).not.toBe(flareFlicker(2, 2.5))
    expect(flareFlicker(3, 4.4)).toBe(flareFlicker(3, 4.4))
  })

  it('亮著的枚數超過四時，燒最久的先熄、最新的四枚有光', () => {
    const lights = createFlareLights(new Texture())
    const f = createFlares()
    for (let k = 0; k < 6; k++) {
      spawnFlare(f, k * 100, 1000, 0, 0)
      f.age[k] = 100 - k * 10
    }
    lights.update(f, 0)
    const lit: number[] = []
    lights.object.traverse((o) => {
      const l = o as PointLight
      if (l.isPointLight && l.intensity > 0) lit.push(l.position.x)
    })
    expect(lit.sort((a, b) => a - b)).toEqual([200, 300, 400, 500])
  })

  it('亮度最後 30 秒衰減到 0', () => {
    expect(flareBrightness(0)).toBe(1)
    expect(flareBrightness(FLARE_BURN - 30)).toBe(1)
    expect(flareBrightness(FLARE_BURN - 15)).toBeCloseTo(0.5, 6)
    expect(flareBrightness(FLARE_BURN)).toBe(0)
  })
})
