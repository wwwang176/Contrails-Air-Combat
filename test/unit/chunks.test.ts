import { describe, it, expect } from 'vitest'
import { Color, ShaderLib, Vector3 } from 'three'
import {
  CHUNK_FADE, CHUNK_GROW, CHUNK_SEED,
  blastFireColor, chunkAlpha, chunkColorRate, chunkScale, chunkSpin, injectFacetShade,
} from '../../src/render/chunks'

describe('chunkScale：瞬間脹滿，之後只微微續脹', () => {
  it('出生是種子尺寸，膨脹結束時是滿的', () => {
    expect(chunkScale(0)).toBeCloseTo(CHUNK_SEED, 9)
    expect(chunkScale(CHUNK_GROW)).toBeCloseTo(1, 9)
  })

  it('膨脹佔壽命的一小段 —— 爆炸不是被吹起來的氣球', () => {
    expect(CHUNK_GROW).toBeLessThan(0.15)
  })

  it('脹滿之後不收縮 —— 消失是 chunkAlpha 的事', () => {
    let prev = 0
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const s = chunkScale(t)
      expect(s).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = s
    }
    expect(chunkScale(1)).toBeGreaterThan(1)
  })
})

describe('chunkAlpha：尾段淡出', () => {
  it('前段完全不透明 —— 那一段的遮擋才逐塊正確', () => {
    for (const t of [0, 0.2, 0.5, CHUNK_FADE]) expect(chunkAlpha(t)).toBe(1)
  })

  it('壽命結束時是 0，中間單調下降', () => {
    expect(chunkAlpha(1)).toBe(0)
    let prev = 1
    for (let t = CHUNK_FADE; t <= 1.0001; t += 0.02) {
      const a = chunkAlpha(t)
      expect(a).toBeLessThanOrEqual(prev + 1e-9)
      prev = a
    }
  })

  it('淡出佔的時間很短 —— alpha hash 的雜點只在這一段', () => {
    expect(1 - CHUNK_FADE).toBeLessThanOrEqual(0.3)
  })
})

describe('blastFireColor：紅球一路轉黑', () => {
  const c = new Color()
  const lum = (t: number): number => {
    blastFireColor(t, c)
    return c.r + c.g + c.b
  }

  it('全程在 [0,1] 之內', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      blastFireColor(t, c)
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('是紅的 —— 紅遠大於綠與藍', () => {
    for (const t of [0.1, 0.3, 0.5]) {
      blastFireColor(t, c)
      expect(c.r).toBeGreaterThan(c.g * 2)
      expect(c.r).toBeGreaterThan(c.b * 2)
    }
  })

  it('炸開那一瞬最亮，之後單調變暗到近黑', () => {
    let prev = Infinity
    for (let t = 0.08; t <= 1.0001; t += 0.04) {
      const l = lum(t)
      expect(l).toBeLessThanOrEqual(prev + 1e-6)
      prev = l
    }
    expect(lum(1)).toBeLessThan(0.12)
  })

  it('白熱只有開頭一瞬 —— 之後不再回到那個亮度', () => {
    expect(lum(0)).toBeGreaterThan(lum(0.2))
    expect(CHUNK_GROW).toBeLessThanOrEqual(0.1)
  })
})

describe('chunkColorRate：每一塊各自的轉黑速度', () => {
  it('倍率跨過 1 —— 有的提早燒完、有的還紅著', () => {
    const rates: number[] = []
    for (let i = 0; i < 64; i++) rates.push(chunkColorRate(i))
    expect(Math.min(...rates)).toBeLessThan(1)
    expect(Math.max(...rates)).toBeGreaterThan(1)
  })

  it('恆為正 —— 0 或負數會讓那一塊卡在白熱', () => {
    for (let i = 0; i < 256; i++) expect(chunkColorRate(i)).toBeGreaterThan(0)
  })

  it('同一格恆得同一個值 —— 重播靠這條', () => {
    expect(chunkColorRate(17)).toBe(chunkColorRate(17))
    expect(chunkColorRate(17)).not.toBe(chunkColorRate(18))
  })
})

describe('chunkSpin', () => {
  it('軸是單位向量，角速度為正', () => {
    const v = new Vector3()
    for (let i = 0; i < 64; i++) {
      const rate = chunkSpin(i, v)
      expect(v.length()).toBeCloseTo(1, 6)
      expect(rate).toBeGreaterThan(0)
    }
  })

  it('軸散在整個球面上 —— 不是全部朝同一邊', () => {
    const v = new Vector3()
    let up = 0
    let down = 0
    for (let i = 0; i < 128; i++) {
      chunkSpin(i, v)
      if (v.y > 0) up++
      else down++
    }
    expect(up).toBeGreaterThan(30)
    expect(down).toBeGreaterThan(30)
  })
})

/**
 * 【為什麼拿 three 真正的 `ShaderLib` 來測】`String.replace` 找不到目標時
 * **不報錯**。three 改版重新命名 chunk，假光照與逐實例 alpha 會靜靜地消失，
 * 而球塊只是變成一團平塗的剪影 —— 沒有任何東西會失敗。
 */
describe('injectFacetShade：注入真的發生了', () => {
  const make = (): { vertexShader: string; fragmentShader: string } => ({
    vertexShader: ShaderLib.basic.vertexShader,
    fragmentShader: ShaderLib.basic.fragmentShader,
  })

  it('頂點端拿得到法線與逐實例 alpha', () => {
    const s = make()
    injectFacetShade(s)
    expect(s.vertexShader).toContain('attribute float aAlpha')
    expect(s.vertexShader).toContain('vFacetN')
    expect(s.vertexShader).toContain('instanceMatrix')
  })

  it('片段端有假光照，而且吃到法線的仰角', () => {
    const s = make()
    injectFacetShade(s)
    expect(s.fragmentShader).toContain('vFacetN.y')
    expect(s.fragmentShader).toContain('gl_FragColor.rgb *=')
  })

  it('alpha 寫在 alphahash 之前 —— 寫到 gl_FragColor.a 已經太晚', () => {
    const s = make()
    injectFacetShade(s)
    const alpha = s.fragmentShader.indexOf('diffuseColor.a *= vAlpha')
    const hash = s.fragmentShader.indexOf('alphahash_fragment')
    expect(alpha).toBeGreaterThan(0)
    expect(hash).toBeGreaterThan(0)
    expect(alpha).toBeLessThan(hash)
  })
})
