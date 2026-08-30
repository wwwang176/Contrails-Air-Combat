import { describe, it, expect } from 'vitest'
import { derivedClMax } from '../../src/specs/types'
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109K4, BF109K4_HISTORICAL } from '../../src/specs/bf109k4'
import { HE111 } from '../../src/specs/he111'
import { B17G } from '../../src/specs/b17g'
import { F6F5, F6F5_HISTORICAL } from '../../src/specs/f6f5'
import { MAX_TURRETS } from '../../src/weapons/turret'

const CASES = [
  { spec: P51D, hist: P51D_HISTORICAL },
  { spec: BF109K4, hist: BF109K4_HISTORICAL },
  { spec: F6F5, hist: F6F5_HISTORICAL },
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

  /**
   * 調參旋鈕的物理護欄。
   *
   * Task 14 之前這些界限只存在於任務簡報的散文裡，而 Task 14 結束後有三個
   * 出貨值**恰好坐在界限上**（P51D.prop.etaMax = 0.90、P51D.prop.figureOfMerit
   * = 0.80、P51D.wing.oswald = 0.88）。把界限寫成斷言，未來任何調參越界都會
   * 立刻現形，成本為零。每一條都附上該界限的物理理由。
   *
   * 注意：這些是「物理可辯護區間」的斷言，不是史實值的斷言——後者由
   * test/performance/historical.test.ts 負責。
   */
  describe('調參旋鈕的物理界限', () => {
    for (const { spec } of CASES) {
      describe(spec.name, () => {
        it('cd0 落在二戰活塞戰鬥機的合理區間', () => {
          // 下限 0.014：層流翼 P-51D 的物理下限，低於此即宣稱一副比史實
          // Mustang 更乾淨的機體。上限 0.035：比帶鼓包與外掛的 Bf 109 G-6
          //（0.0279）更髒的單發戰鬥機不合理。
          expect(spec.drag.cd0).toBeGreaterThanOrEqual(0.014)
          expect(spec.drag.cd0).toBeLessThanOrEqual(0.035)
        })

        it('oswald 落在合理區間，且不超過本專案接受的樂觀上緣', () => {
          // 上限 0.88：教科書給層流翼的 Oswald 因子區間是 0.70~0.85，
          // P-51D 的 0.88 已在其上緣之外，是 Task 14 中最弱的一個調參值。
          // 它是 load-bearing 的——退回 0.75 會使實用升限掉到 −7.59% 而失敗
          // ——接受的理由是本模型 cd0 為常數、不含 CL 相依黏性項，此處的
          // oswald 比教科書的 Oswald 因子更接近純展向效率（見 p51d.ts 註解）。
          // 這條斷言的用途是：不准再往上飄。
          expect(spec.wing.oswald).toBeGreaterThanOrEqual(0.7)
          expect(spec.wing.oswald).toBeLessThanOrEqual(0.88)
        })

        it('etaMax 不超過 1940 年代定速螺旋槳的物理上限', () => {
          // 0.90 是 1940 年代定速螺旋槳的峰值效率上限；超過即宣稱一副
          // 該年代不存在的螺旋槳。下限 0.7 只是防呆。
          expect(spec.prop.etaMax).toBeGreaterThanOrEqual(0.7)
          expect(spec.prop.etaMax).toBeLessThanOrEqual(0.9)
        })

        it('figureOfMerit 落在螺旋槳靜推力效率的合理區間', () => {
          // 靜推力相對於動量理論理想值的比例，真實螺旋槳約 0.5~0.8。
          // 高槳距的戰鬥機螺旋槳在靜止狀態表現本來就差，0.8 是合理上緣。
          expect(spec.prop.figureOfMerit).toBeGreaterThanOrEqual(0.5)
          expect(spec.prop.figureOfMerit).toBeLessThanOrEqual(0.8)
        })

        it('ramEfficiency 落在 0~1（總壓恢復不可能超過 100%）', () => {
          // 進氣道的總壓恢復率，物理上不可能超過 1——超過即等於憑空
          // 製造總壓。1.0 本身是理想無損進氣道。
          expect(spec.engine.ramEfficiency).toBeGreaterThanOrEqual(0)
          expect(spec.engine.ramEfficiency).toBeLessThanOrEqual(1)
        })

        it('vRef 為正（螺旋槳效率曲線的特徵速度）', () => {
          expect(spec.prop.vRef).toBeGreaterThan(0)
        })
      })
    }
  })

  it('Bf 109 縫翼展開後 CL_max 顯著提高', () => {
    const clean = derivedClMax(BF109K4, false)
    const slats = derivedClMax(BF109K4, true)
    expect(slats).toBeGreaterThan(clean * 1.1)
    expect(slats).toBeCloseTo(1.55, 1) // 史實縫翼展開值
  })

  it('P-51 無縫翼，展開與否 CL_max 相同', () => {
    expect(derivedClMax(P51D, true)).toBe(derivedClMax(P51D, false))
  })

  it('P-51 的 cd0 明顯低於 Bf 109（層流翼）', () => {
    expect(P51D.drag.cd0).toBeLessThan(BF109K4.drag.cd0 * 0.8)
  })

  it('Bf 109 的副翼高速衰減指數遠大於 P-51', () => {
    expect(BF109K4.controlStiffening.aileronK).toBeGreaterThan(
      P51D.controlStiffening.aileronK * 3,
    )
  })
})

/**
 * 【為什麼還是硬編一份清單】這個專案沒有機種 registry，硬編清單散在十幾個
 * 檔案裡（見 `.claude/skills/aircraft-from-reference` 的「不要為外型寫測試」
 * 末段）。這裡照既有做法，但 `turrets` 是**必填**欄位，所以漏掉的機種會先被
 * 型別擋下來，不會靜靜地沒有測試在跑。
 */
const ALL = [P51D, BF109K4, F6F5, HE111, B17G]

describe('砲塔欄位', () => {
  it('戰鬥機沒有砲塔', () => {
    expect(P51D.turrets).toHaveLength(0)
    expect(BF109K4.turrets).toHaveLength(0)
  })

  /**
   * 砲塔的槍焰與槍管用「架數 × MAX_TURRETS」預配實例，超出上界的那一座會
   * **靜靜地畫不出來**。與 `weapons.test.ts` 守 MAX_MOUNTS 的那一條同理。
   */
  it('沒有任何機種的砲塔數超過 MAX_TURRETS', () => {
    for (const spec of ALL) {
      expect(spec.turrets.length, `${spec.id} 超過 MAX_TURRETS`)
        .toBeLessThanOrEqual(MAX_TURRETS)
    }
  })
})
