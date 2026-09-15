import { describe, expect, it } from 'vitest'
import { PointLight, Texture } from 'three'
import { LOW_RES_TRANSPARENCY_LAYER } from '../../src/render/lowResTransparency'
import {
  createFlareLights, FLARE_LIGHT_COUNT, flareBrightness, flareFlicker,
} from '../../src/render/flares'
import { createFlares, FLARE_BURN, spawnFlare } from '../../src/world/flares'

describe('照明彈的光', () => {
  it('FLARE_LIGHT_COUNT 盞點光源開場就在、池空時強度 0', () => {
    const lights = createFlareLights(new Texture())
    const found: PointLight[] = []
    lights.object.traverse((o) => { if ((o as PointLight).isPointLight) found.push(o as PointLight) })
    expect(found).toHaveLength(FLARE_LIGHT_COUNT)
    lights.update(createFlares(), 0)
    for (const l of found) expect(l.intensity).toBe(0)
  })

  /**
   * 【燈要在每一個圖層都亮】three 只收 `light.layers.test(camera.layers)` 的燈。
   * 低解析度煙那一趟只開第 1 層；燈只在第 0 層的話，有煙的每一幀兩趟燈數不同，
   * `lights.state.version` 每幀變，每個吃光照的材質每幀重算 shader program。
   */
  it('每一盞點光源在第 0 層與低解析度煙那一層都啟用', () => {
    const lights = createFlareLights(new Texture())
    const found: PointLight[] = []
    lights.object.traverse((o) => { if ((o as PointLight).isPointLight) found.push(o as PointLight) })
    expect(found.length).toBeGreaterThan(0)
    for (const l of found) {
      expect(l.layers.isEnabled(0)).toBe(true)
      expect(l.layers.isEnabled(LOW_RES_TRANSPARENCY_LAYER)).toBe(true)
    }
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

  it('亮著的枚數超過燈數時，燒最久的先熄、最新的幾枚有光', () => {
    const lights = createFlareLights(new Texture())
    const f = createFlares()
    const n = FLARE_LIGHT_COUNT + 2
    for (let k = 0; k < n; k++) {
      spawnFlare(f, k * 100, 1000, 0, 0)
      f.age[k] = 100 - k * 10
    }
    lights.update(f, 0)
    const lit: number[] = []
    lights.object.traverse((o) => {
      const l = o as PointLight
      if (l.isPointLight && l.intensity > 0) lit.push(l.position.x)
    })
    const want: number[] = []
    for (let k = 2; k < n; k++) want.push(k * 100)
    expect(lit.sort((a, b) => a - b)).toEqual(want)
  })

  it('亮度：點燃後兩秒漸亮到 1、最後 15 秒衰減到 0', () => {
    expect(flareBrightness(0)).toBe(0)
    expect(flareBrightness(1)).toBeCloseTo(0.5, 6)
    expect(flareBrightness(2)).toBe(1)
    expect(flareBrightness(FLARE_BURN - 15)).toBe(1)
    expect(flareBrightness(FLARE_BURN - 7.5)).toBeCloseTo(0.5, 6)
    expect(flareBrightness(FLARE_BURN)).toBe(0)
  })
})
