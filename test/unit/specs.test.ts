import { describe, it, expect } from 'vitest'
import { derivedClMax } from '../../src/specs/types'
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109G6, BF109G6_HISTORICAL } from '../../src/specs/bf109g6'

const CASES = [
  { spec: P51D, hist: P51D_HISTORICAL },
  { spec: BF109G6, hist: BF109G6_HISTORICAL },
]

describe('機種資料', () => {
  for (const { spec, hist } of CASES) {
    describe(spec.name, () => {
      it('推導的 CL_max 落在史實值 ±8% 內', () => {
        const cl = derivedClMax(spec, false)
        expect(cl).toBeGreaterThan(hist.clMax * 0.92)
        expect(cl).toBeLessThan(hist.clMax * 1.08)
      })

      it('展弦比落在二戰戰鬥機合理範圍', () => {
        const ar = (spec.wing.span * spec.wing.span) / spec.wing.area
        expect(ar).toBeGreaterThan(4)
        expect(ar).toBeLessThan(8)
      })

      it('阻尼導數符號正確（阻尼必為負）', () => {
        expect(spec.moments.clP).toBeLessThan(0)
        expect(spec.moments.cmQ).toBeLessThan(0)
        expect(spec.moments.cnR).toBeLessThan(0)
      })

      it('靜穩定性符號正確', () => {
        expect(spec.moments.cmAlpha).toBeLessThan(0) // 縱向靜穩定
        expect(spec.moments.cnBeta).toBeGreaterThan(0) // 風標穩定
        expect(spec.moments.clBeta).toBeLessThan(0) // 上反角效應
      })

      it('操縱導數符合本專案約定（正舵面指令 → 正力矩）', () => {
        expect(spec.moments.clDa).toBeGreaterThan(0)
        expect(spec.moments.cmDe).toBeGreaterThan(0)
        expect(spec.moments.cnDr).toBeGreaterThan(0)
      })

      it('增壓器檔位的臨界高度遞增', () => {
        const alts = spec.engine.gears.map((g) => g.altCritical)
        for (let i = 1; i < alts.length; i++) {
          expect(alts[i]!).toBeGreaterThan(alts[i - 1]!)
        }
      })

      it('過載限制符號正確', () => {
        expect(spec.limits.gPositive).toBeGreaterThan(0)
        expect(spec.limits.gNegative).toBeLessThan(0)
      })
    })
  }

  it('Bf 109 縫翼展開後 CL_max 顯著提高', () => {
    const clean = derivedClMax(BF109G6, false)
    const slats = derivedClMax(BF109G6, true)
    expect(slats).toBeGreaterThan(clean * 1.1)
    expect(slats).toBeCloseTo(1.55, 1) // 史實縫翼展開值
  })

  it('P-51 無縫翼，展開與否 CL_max 相同', () => {
    expect(derivedClMax(P51D, true)).toBe(derivedClMax(P51D, false))
  })

  it('P-51 的 cd0 明顯低於 Bf 109（層流翼）', () => {
    expect(P51D.drag.cd0).toBeLessThan(BF109G6.drag.cd0 * 0.8)
  })

  it('Bf 109 的副翼高速衰減指數遠大於 P-51', () => {
    expect(BF109G6.controlStiffening.aileronK).toBeGreaterThan(
      P51D.controlStiffening.aileronK * 3,
    )
  })
})
