import { describe, expect, it } from 'vitest'
import { Color, type ShaderMaterial } from 'three'
import {
  FLASH_SECONDS, STRIKE_DISTANCE, STRIKE_INTERVAL, THUNDER_CUTOFF_HZ, THUNDER_DB, THUNDER_RATE,
  applyFlash, createStorm, flashEnvelope, rollThunder, stepStorm,
} from '../../src/render/storm'
import { DAY_PALETTES } from '../../src/render/timeOfDay'
import { createLights } from '../../src/render/lighting'
import { createSky } from '../../src/render/sky'

/**
 * # 雷雨：閃電與雷聲的時機
 *
 * 守的是小部件：閃光的形狀、閃電多久打一次、雷聲晚幾秒、閃光套到燈與天空
 * 之後能完整放回來。好不好看、嚇不嚇人由試玩決定。
 */

/** 固定序列的亂數，測試才可重現 */
function seq(...values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]!
}

describe('閃光的包絡', () => {
  it('打下的那一刻最亮，走完就歸零', () => {
    expect(flashEnvelope(0)).toBeGreaterThan(0.9)
    expect(flashEnvelope(-0.01)).toBe(0)
    expect(flashEnvelope(FLASH_SECONDS)).toBe(0)
  })

  it('會閃不只一下（亮 → 暗 → 又亮）', () => {
    let rises = 0
    let prev = flashEnvelope(0)
    for (let t = 0.01; t < FLASH_SECONDS; t += 0.01) {
      const v = flashEnvelope(t)
      if (v > prev + 1e-6) rises++
      prev = v
    }
    expect(rises).toBeGreaterThan(0)
  })
})

describe('閃電多久打一次', () => {
  it('間隔落在 STRIKE_INTERVAL 之內，距離落在 STRIKE_DISTANCE 之內，方位是隨機的', () => {
    const s = createStorm(seq(0.1, 0.5, 0.9, 0.3, 0.7))
    const times: number[] = []
    const dists: number[] = []
    const bearings = new Set<number>()
    const dt = 1 / 60
    for (let t = 0; t < 200; t += dt) {
      stepStorm(s, dt, (d, b) => { times.push(t); dists.push(d); bearings.add(b) })
    }
    expect(bearings.size).toBeGreaterThan(1)
    for (const b of bearings) {
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(2 * Math.PI)
    }
    expect(times.length).toBeGreaterThan(5)
    for (let i = 1; i < times.length; i++) {
      const gap = times[i]! - times[i - 1]!
      expect(gap).toBeGreaterThanOrEqual(STRIKE_INTERVAL[0] - dt)
      expect(gap).toBeLessThanOrEqual(STRIKE_INTERVAL[1] + dt)
    }
    for (const d of dists) {
      expect(d).toBeGreaterThanOrEqual(STRIKE_DISTANCE[0])
      expect(d).toBeLessThanOrEqual(STRIKE_DISTANCE[1])
    }
  })

  it('兩道閃電之間是暗的；打下的那一步是亮的', () => {
    const s = createStorm(seq(0.5))
    let lit = 0
    let dark = 0
    for (let t = 0; t < 60; t += 1 / 60) {
      let struck = false
      const f = stepStorm(s, 1 / 60, () => { struck = true })
      if (struck) { expect(f).toBeGreaterThan(0.5); lit++ } else if (f === 0) dark++
    }
    expect(lit).toBeGreaterThan(0)
    expect(dark).toBeGreaterThan(lit)
  })

  it('時間不走（暫停）就不打', () => {
    const s = createStorm(seq(0.5))
    let n = 0
    for (let i = 0; i < 10000; i++) stepStorm(s, 0, () => { n++ })
    expect(n).toBe(0)
  })
})

describe('雷聲的隨機', () => {
  it('播放速度、低通、音量各自落在範圍內，而且每一聲不一樣', () => {
    const rand = seq(0, 0.25, 0.5, 0.999, 0.4, 0.8, 0.1)
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const v = rollThunder(rand)
      expect(v.rate).toBeGreaterThanOrEqual(THUNDER_RATE[0])
      expect(v.rate).toBeLessThanOrEqual(THUNDER_RATE[1])
      expect(v.cutoffHz).toBeGreaterThanOrEqual(THUNDER_CUTOFF_HZ[0])
      expect(v.cutoffHz).toBeLessThanOrEqual(THUNDER_CUTOFF_HZ[1])
      expect(v.extraDb).toBeGreaterThanOrEqual(THUNDER_DB[0])
      expect(v.extraDb).toBeLessThanOrEqual(THUNDER_DB[1])
      seen.add(`${v.rate}|${v.cutoffHz}|${v.extraDb}`)
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('閃光套到燈與天空', () => {
  const base = DAY_PALETTES.storm
  const uniforms = (sky: ReturnType<typeof createSky>) => (sky.material as ShaderMaterial).uniforms

  it('強度 0 就是原本的色盤，一點都不留', () => {
    const lights = createLights(base)
    const sky = createSky()
    applyFlash(lights, sky, base, 1)
    applyFlash(lights, sky, base, 0)
    expect(lights.hemi.intensity).toBe(base.hemiIntensity)
    expect(lights.ambient.intensity).toBe(base.ambientIntensity)
    expect((uniforms(sky).horizon!.value as Color).getHex()).toBe(new Color(base.skyHorizon).getHex())
    expect((uniforms(sky).zenith!.value as Color).getHex()).toBe(new Color(base.skyZenith).getHex())
  })

  it('強度 1 時燈更亮、天空更亮', () => {
    const lights = createLights(base)
    const sky = createSky()
    applyFlash(lights, sky, base, 1)
    expect(lights.hemi.intensity).toBeGreaterThan(base.hemiIntensity)
    expect(lights.ambient.intensity).toBeGreaterThan(base.ambientIntensity)
    const h = uniforms(sky).horizon!.value as Color
    const b0 = new Color(base.skyHorizon)
    expect(h.r + h.g + h.b).toBeGreaterThan(b0.r + b0.g + b0.b)
  })
})
