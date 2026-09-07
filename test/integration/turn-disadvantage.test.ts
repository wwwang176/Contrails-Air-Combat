import { describe, it, expect, beforeAll } from 'vitest'
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

/**
 * 【為什麼量一次、分開斷言】五條寫在同一個 `it` 裡的話，第一條失敗之後
 * 其餘四條**根本不會執行** —— 於是「每一條都先驗過紅」是假的，只有第一條
 * 驗過。分開之後每一條各自報告，先驗紅才有意義。
 *
 * 【為什麼不是各自跑一次】一次 20v20 300 秒要 20 秒。量一次共用。
 */
describe('轉不贏的一方改打能量戰', () => {
  let s: Sample
  beforeAll(() => { s = measure('f4f4', 'a6m5', 20) }, 600_000)

  it('engage 不再是結構上不可達', () => {
    // 改動前 0.0% —— `airframeTurnAdvantage > turnEnter` 對這一對恆為 false，
    // 意圖層那條路走不到。改動後由戰術層的 `dive` 相位授權
    expect(s.engage / s.alive, 'engage 佔時').toBeGreaterThan(0)
  })

  it('完整循環走得到攻擊相位', () => {
    // 改動前 0 次
    expect(s.dives, 'dive 進入次數').toBeGreaterThanOrEqual(5)
  })

  it('逃跑的自鎖斷開', () => {
    // 改動前 54.6%
    expect(s.extend / s.alive, 'extend 佔時').toBeLessThan(0.45)
  })

  it('俯衝時真的有高度優勢', () => {
    // 單位是公尺 —— 判準本來就是用公尺講的，不必換算就讀得懂
    expect(s.diveAltMedian, '俯衝時高度優勢中位').toBeGreaterThan(300)
  })

  /**
   * 【這一條是改動後的回歸護欄，不是先驗紅的】改動前 `build` 佔時必然是
   * 0.0%（戰術層根本沒啟動），所以它在改動前一定綠。它擋的是**改動之後**
   * 才可能出現的失效模式：飛機把時間全花在爬升，一次都不攻擊。
   *
   * 它殺得死 —— 把 `build` 撞期限的去向改回 `cooldown`，循環會退化成
   * 「爬完逃、逃完爬」，這一條就會紅。
   */
  it('不會變成無腦爬升', () => {
    expect(s.build / s.alive, 'build 佔時').toBeLessThan(0.30)
  })
})

/**
 * 轉得贏的一方不受影響。
 *
 * 【它斷言的是機制惰性，不是數字相等】同機種的 `airframeTurnAdvantage`
 * 恆為 0，徵召條件天然不成立，而 `quota` 出貨值是 0 —— 所以戰術層對它
 * **一次都不會啟動**。相位從未離開 `off`，下游就沒有任何東西會不同。
 *
 * 【為什麼不比對意圖分布的數字】那需要把改動前的百分比寫死成常數，而
 * 「單次量測當門檻是變更偵測器不是設計判準」（`ai-withdraw-anchor` 的
 * 註解逐字警告過）。機制惰性是更強的保證，而且不會因為別的改動而假紅。
 *
 * 【為什麼這是變異測試的錨】把徵召條件寫成恆真、或把 `||` 寫成 `&&`，
 * 上面那一組看起來會更好（全隊都去蓄能就不容易死），只有這一組會紅。
 * 實測抓過一次：掃描第一版誤用「`quota = 1` 徵召所有人」，這一組的
 * `engage` 由 12.1% 掉到 0.0%。
 */
describe('同機種對戰不受影響', () => {
  let s: Sample
  beforeAll(() => { s = measure('f4f4', 'f4f4', 20) }, 600_000)

  it('戰術層一次都不啟動', () => {
    expect(s.dives, '不得進入攻擊相位').toBe(0)
    expect(s.build, '不得進入蓄能相位').toBe(0)
  })

  it('照常盤旋交戰', () => {
    expect(s.engage / s.alive, 'engage 佔時').toBeGreaterThan(0.10)
  })
})
