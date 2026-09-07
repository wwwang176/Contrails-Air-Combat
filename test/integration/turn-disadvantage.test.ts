import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, uniform } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import type { Combatant } from '../../src/world/World'

/**
 * 迴旋吃虧的一方要改打能量戰，不是拒戰。
 *
 * 【為什麼場景是 20v20 而不是 1v1】`dive` 相位要有一個它比得贏的目標，
 * 而能量帳是對**當前目標**算的。1v1 只有一個目標，能量劣勢時整場都不成立
 * —— 實測 1v1 的循環進不到 `perch`，20v20 進得去。這一層本來就是混戰用的。
 *
 * 【為什麼對照組是同機種而不是關掉功能】關掉功能要多一個旗標，而旗標會被
 * 忘記拿掉。同機種對戰的 `airframeTurnAdvantage` 恆為 0，徵召條件天然不
 * 成立 —— 對照組因此由**資料**產生而不是由開關產生。
 *
 * 【為什麼不列「射擊解提升」】改動前 4.1%、改動後 4.3%，本設計解不掉。
 * 把解不掉的東西寫成護欄只會得到一條永遠紅的測試。
 */
const DT = 1 / 240
const SECONDS = 300
const SEED = 20260907

interface Sample {
  alive: number
  extend: number
  engage: number
  build: number
  dives: number
  diveAltMedian: number
}

function measure(blue: string, red: string, perSide: number): Sample {
  const b = createBattle(
    new AiController(), battleConfigFrom(uniform(blue, perSide, red, perSide)), SEED,
  )
  const cs: Combatant[] = b.world.combatants
  const isBlue = cs.map(c => b.blue.includes(c))
  const diveAlt: number[] = []
  const prevPhase: string[] = cs.map(() => 'off')
  let alive = 0
  let extend = 0
  let engage = 0
  let build = 0
  let dives = 0
  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      const a = c.controller
      if (!(a instanceof AiController) || !c.alive || !isBlue[i]) continue
      alive += DT
      if (a.intent === 'extend') extend += DT
      if (a.intent === 'engage') engage += DT
      const p = a.tactics.phase
      if (p === 'build') build += DT
      if (p === 'dive' && prevPhase[i] !== 'dive') {
        dives++
        diveAlt.push(a.sit.altitudeAdvantage)
      }
      prevPhase[i] = p
    }
  }
  const sorted = [...diveAlt].sort((x, y) => x - y)
  return {
    alive,
    extend,
    engage,
    build,
    dives,
    diveAltMedian: sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : Number.NaN,
  }
}

describe('轉不贏的一方改打能量戰', () => {
  it('F4F 對 A6M：機制要通', { timeout: 600_000 }, () => {
    const s = measure('f4f4', 'a6m5', 20)

    // `engage` 不再是結構上不可達（改動前 0.0%）
    expect(s.engage / s.alive, 'engage 佔時').toBeGreaterThan(0)

    // 完整循環真的走到攻擊相位（改動前 0 次）
    expect(s.dives, 'dive 進入次數').toBeGreaterThanOrEqual(5)

    // 自鎖斷開（改動前 54.6%）
    expect(s.extend / s.alive, 'extend 佔時').toBeLessThan(0.45)

    // 俯衝時真的有高度優勢。單位是公尺 —— 判準本來就是用公尺講的
    expect(s.diveAltMedian, '俯衝時高度優勢中位').toBeGreaterThan(300)

    // 不會變成「無腦爬升」
    expect(s.build / s.alive, 'build 佔時').toBeLessThan(0.30)
  })

  /**
   * 轉得贏的一方一個字都不能變。
   *
   * 【為什麼這是變異測試的錨】把徵召條件寫成恆真、或把 `||` 寫成 `&&`，
   * 上面那一組看起來會更好（全隊都去蓄能就不容易死），只有這一條會紅。
   * 實測抓過一次：掃描第一版誤用「`quota = 1` 徵召所有人」，這一組的
   * `engage` 由 12.1% 掉到 0.0%。
   */
  it('同機種對戰不受影響', { timeout: 600_000 }, () => {
    const s = measure('f4f4', 'f4f4', 20)
    expect(s.dives, '同機種不得進入攻擊相位').toBe(0)
    expect(s.build, '同機種不得進入蓄能相位').toBe(0)
    expect(s.engage / s.alive, '同機種的 engage 佔時').toBeGreaterThan(0.10)
  })
})
