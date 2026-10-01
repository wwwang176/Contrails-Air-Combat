import { describe, expect, it } from 'vitest'
import { BELT_CHANCE, fieldGlslWithSite } from '../../src/render/fields'
import { KURSK_SITE } from '../../src/render/terrain'
import { BELT_FRAME } from '../../src/world/kursk'

/**
 * # 遠處的防風林帶（著色器）
 *
 * 只測字串層：判準的鑰匙與機率、方框的數字要與近處種樹的那一邊同一組。畫面上的對位由截圖驗收。
 */

const n = (v: number): string => v.toFixed(5)

describe('庫斯克的遠處林帶', () => {
  const glsl = fieldGlslWithSite('julyWheat', KURSK_SITE)

  it('用田界的身分（edgeKey ^ 0x2be1）與 BELT_CHANCE 判定哪些田界有林帶，只畫在遠層', () => {
    expect(glsl).toContain('fieldHash1(edgeKey ^ 0x2be1u)')
    expect(glsl).toContain(`< ${n(BELT_CHANCE)}`)
    expect(glsl).toContain('fieldFar > 0.35')
  })

  it('戰場方框與漸增距離是 world/kursk.ts 的 BELT_FRAME 那一組數', () => {
    for (const v of [BELT_FRAME.ox, BELT_FRAME.oz, BELT_FRAME.rx, BELT_FRAME.rz, BELT_FRAME.fx, BELT_FRAME.fz,
      BELT_FRAME.half, BELT_FRAME.north, BELT_FRAME.south, BELT_FRAME.ramp]) {
      expect(glsl).toContain(n(v))
    }
  })

  it('沒有 belts 的場地不產生這一段（歐陸與洛伊納不受影響）', () => {
    const { belts, ...rest } = KURSK_SITE
    expect(belts).toBeDefined()
    const without = fieldGlslWithSite('julyWheat', rest)
    expect(without).not.toContain('0x2be1u')
    expect(without).not.toContain('beltFade')
  })
})
