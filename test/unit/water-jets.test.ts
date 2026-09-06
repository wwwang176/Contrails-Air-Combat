import { describe, it, expect } from 'vitest'
import { ShaderLib } from 'three'
import { SPLASH_SHOULDER, SPLASH_TOP_RATIO } from '../../src/render/splash'
import {
  JET_FADE, JET_SEED,
  injectJetAlpha, jetAlpha, jetFalloff, jetProfileRadius, jetScale,
} from '../../src/render/waterJets'

describe('jetScale：瞬間衝起、塌回水面', () => {
  it('出生是種子高度，rise 那一刻是滿高', () => {
    expect(jetScale(0, 0.06)).toBeCloseTo(JET_SEED, 9)
    expect(jetScale(0.06, 0.06)).toBeCloseTo(1, 9)
  })

  it('壽命結束時回到 0', () => {
    expect(jetScale(1, 0.06)).toBe(0)
  })

  it('上升比下墜快得多 —— 那是「衝」出來的', () => {
    const rise = 0.06
    const up = (1 - JET_SEED) / rise
    const down = 1 / (1 - rise)
    expect(up / down).toBeGreaterThan(10)
  })

  it('到頂之後單調下降', () => {
    let prev = 1
    for (let t = 0.06; t <= 1.0001; t += 0.02) {
      const s = jetScale(t, 0.06)
      expect(s).toBeLessThanOrEqual(prev + 1e-9)
      prev = s
    }
  })
})

describe('jetAlpha', () => {
  it('前段實心', () => {
    for (const t of [0, 0.2, JET_FADE]) expect(jetAlpha(t, 0.8)).toBe(0.8)
  })

  it('尾段淡到 0', () => {
    expect(jetAlpha(1, 0.8)).toBeCloseTo(0, 9)
    expect(jetAlpha(0.9, 0.8)).toBeGreaterThan(0)
    expect(jetAlpha(0.9, 0.8)).toBeLessThan(0.8)
  })
})

describe('jetFalloff：水冠是常態分佈', () => {
  it('中央最高', () => {
    expect(jetFalloff(0)).toBeCloseTo(1, 9)
  })

  it('往外單調遞減 —— 不是一圈等高的柵欄', () => {
    let prev = 1.1
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const f = jetFalloff(u)
      expect(f).toBeLessThan(prev)
      prev = f
    }
  })

  it('最外圈仍然看得見 —— 收到 0 的話外圈等於沒生', () => {
    expect(jetFalloff(1)).toBeGreaterThan(0.1)
    expect(jetFalloff(1)).toBeLessThan(0.3)
  })
})

describe('jetProfileRadius：柱身的輪廓', () => {
  it('柱腳是滿徑、頂點收到 0', () => {
    expect(jetProfileRadius(0)).toBe(1)
    expect(jetProfileRadius(1)).toBe(0)
  })

  it('肩部就是 SPLASH_TOP_RATIO —— 與幾何同一條曲線', () => {
    expect(jetProfileRadius(SPLASH_SHOULDER)).toBeCloseTo(SPLASH_TOP_RATIO, 9)
  })

  it('由下往上單調遞減', () => {
    let prev = 1.1
    for (let up = 0; up <= 1.0001; up += 0.02) {
      const r = jetProfileRadius(up)
      expect(r).toBeLessThanOrEqual(prev + 1e-9)
      prev = r
    }
  })

  it('柱身那一段收得慢、圓頭那一段收得快', () => {
    const body = jetProfileRadius(0) - jetProfileRadius(SPLASH_SHOULDER)
    const nose = jetProfileRadius(SPLASH_SHOULDER) - jetProfileRadius(1)
    expect(nose).toBeGreaterThan(body)
  })
})

/**
 * 【為什麼拿 three 真正的 `ShaderLib` 來測】`String.replace` 找不到目標時
 * 不報錯。逐實例 alpha 一旦沒注入，水柱會整根維持不透明到消失那一刻 ——
 * 沒有任何東西會失敗。
 */
describe('injectJetAlpha：注入真的發生了', () => {
  const make = (): { vertexShader: string; fragmentShader: string } => ({
    vertexShader: ShaderLib.basic.vertexShader,
    fragmentShader: ShaderLib.basic.fragmentShader,
  })

  it('頂點端有 aAlpha，片段端吃到它', () => {
    const s = make()
    injectJetAlpha(s)
    expect(s.vertexShader).toContain('attribute float aAlpha')
    expect(s.vertexShader).toContain('vAlpha = aAlpha')
    expect(s.fragmentShader).toContain('gl_FragColor.a *= vAlpha')
  })
})
