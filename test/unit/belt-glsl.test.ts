import { describe, expect, it } from 'vitest'
import { BELT_CHANCE, fieldGlslWithSite } from '../../src/render/fields'
import { RZHEV_SITE } from '../../src/render/terrain'
import { BELT_FRAME } from '../../src/world/rzhev'

/**
 * # 遠處的防風林帶（著色器）
 *
 * 只測字串層：判準的鑰匙與機率、方框的數字要與近處種樹的那一邊同一組。畫面上的對位由截圖驗收。
 */

const n = (v: number): string => v.toFixed(5)

describe('庫斯克的遠處林帶', () => {
  const glsl = fieldGlslWithSite('julyWheat', RZHEV_SITE)

  it('用田界的身分（edgeKey ^ 0x2be1）與 BELT_CHANCE 判定哪些田界有林帶，只畫在遠層', () => {
    expect(glsl).toContain('fieldHash1(edgeKey ^ 0x2be1u)')
    expect(glsl).toContain(`< ${n(BELT_CHANCE)}`)
    expect(glsl).toContain('fieldFar > 0.35')
  })

  /** 【凹路壓過林帶】近處的樹離路緣至少 10 m；遠處的帶子蓋在路上的話，遠近切換時路面會變色 */
  it('帶子的濃度扣掉凹路的覆蓋：凹路壓過林帶，與樹籬同一個優先序', () => {
    const at = glsl.indexOf('// 防風林帶（遠處）')
    const belt = glsl.slice(at, glsl.indexOf('\n  }', at))
    expect(belt).toContain('(1.0 - bandCoverage(trackGap(world, s1, s2), trackWidthAt(world), px))')
  })

  it('戰場方框與漸增距離是 world/rzhev.ts 的 BELT_FRAME 那一組數', () => {
    for (const v of [BELT_FRAME.ox, BELT_FRAME.oz, BELT_FRAME.rx, BELT_FRAME.rz, BELT_FRAME.fx, BELT_FRAME.fz,
      BELT_FRAME.half, BELT_FRAME.north, BELT_FRAME.south, BELT_FRAME.ramp]) {
      expect(glsl).toContain(n(v))
    }
  })

  it('沒有 belts 的場地不產生這一段（歐陸與洛伊納不受影響）', () => {
    const { belts, ...rest } = RZHEV_SITE
    expect(belts).toBeDefined()
    const without = fieldGlslWithSite('julyWheat', rest)
    expect(without).not.toContain('0x2be1u')
    expect(without).not.toContain('beltFade')
  })
})
