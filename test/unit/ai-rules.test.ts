import { describe, it, expect } from 'vitest'
import {
  createRuleState, latch, stepRules, DEFAULT_RULES, INTENTS,
} from '../../src/ai/rules'
import { createSituation, type Situation } from '../../src/ai/assess'

const DT = 1 / 10

/** 一組「什麼都不觸發」的態勢，各測試只改自己關心的欄位。 */
function neutral(): Situation {
  const s = createSituation()
  s.range = 3000
  s.closureRate = 0
  s.timeToMerge = Infinity
  s.aspectAngle = Math.PI / 2
  s.angleOffTail = Math.PI / 2
  s.losRate = 0
  s.energyAdvantage = 0
  s.turnAdvantage = 0
  s.cornerRatio = 1
  s.stallMargin = 2
  s.threatInstant = 0
  s.shotInstant = 0
  return s
}

describe('latch（遲滯）', () => {
  it('enter > exit 代表「高於才觸發」', () => {
    expect(latch(false, 0.5, 0.7, 0.3)).toBe(false)
    expect(latch(false, 0.8, 0.7, 0.3)).toBe(true)
    expect(latch(true, 0.5, 0.7, 0.3)).toBe(true)    // 中間帶維持現狀
    expect(latch(true, 0.2, 0.7, 0.3)).toBe(false)
  })

  it('enter < exit 代表「低於才觸發」', () => {
    expect(latch(false, -100, -300, 100)).toBe(false)
    expect(latch(false, -400, -300, 100)).toBe(true)
    expect(latch(true, -100, -300, 100)).toBe(true)  // 中間帶維持現狀
    expect(latch(true, 200, -300, 100)).toBe(false)
  })

  /**
   * 【這是遲滯存在的唯一理由】沒有它，述詞在門檻附近抖動時 AI 會一秒
   * 切換數十次，飛機看起來像在抽搐。M1 的前緣縫翼用的是同一招（展開與
   * 收回兩個不同的迎角 + 一個布林閂鎖）。
   */
  it('在中間帶來回震盪時，狀態一次都不變', () => {
    let active = latch(false, 0.8, 0.7, 0.3)   // 觸發
    expect(active).toBe(true)
    for (const v of [0.5, 0.4, 0.6, 0.35, 0.65, 0.45]) {
      active = latch(active, v, 0.7, 0.3)
      expect(active).toBe(true)
    }
  })
})

describe('stepRules（優先序）', () => {
  it('五種意圖齊全', () => {
    expect([...INTENTS].sort())
      .toEqual(['approach', 'defend', 'engage', 'extend', 'merge'])
  })

  it('什麼都不觸發時走預設的 approach', () => {
    const s = createRuleState()
    expect(stepRules(s, neutral(), 0, DT)).toBe('approach')
  })

  it('高威脅 → defend，而且它壓過其他所有規則', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.threatInstant = 1
    // 同時讓 engage 與 extend 的條件也成立
    sit.turnAdvantage = 1
    sit.timeToMerge = 3
    sit.energyAdvantage = -1000
    expect(stepRules(s, sit, 1, DT)).toBe('defend')
  })

  it('對頭匯合 → merge，不是 engage 也不是 defend', () => {
    // 【為什麼 merge 要獨立一條】對頭時雙方都有預瞄解、都在對方射界內，
    // 沒有這一條的話 defend 與 engage 會在匯合的瞬間反覆互搶。正確行為是
    // 「短暫的正面快照射擊之後脫離」——那是第三種行為，不是前兩者的中間值。
    const s = createRuleState()
    const sit = neutral()
    sit.timeToMerge = 1.5
    sit.aspectAngle = 0.1
    sit.angleOffTail = Math.PI - 0.1   // 他也朝我
    sit.turnAdvantage = 1
    expect(stepRules(s, sit, 0, DT)).toBe('merge')
  })

  it('能量劣勢 → extend', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.energyAdvantage = -800
    sit.range = 900
    expect(stepRules(s, sit, 0, DT)).toBe('extend')
  })

  it('轉彎劣勢 → extend（即使能量持平）', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.turnAdvantage = -0.2
    sit.range = 900
    expect(stepRules(s, sit, 0, DT)).toBe('extend')
  })

  it('轉彎優勢且即將接觸 → engage', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.turnAdvantage = 0.15
    sit.timeToMerge = 4
    sit.range = 500
    expect(stepRules(s, sit, 0, DT)).toBe('engage')
  })

  it('最小停留時間：意圖切換後短時間內不再切', () => {
    // 遲滯處理的是「單一述詞在門檻附近抖」，最小停留處理的是「多個述詞
    // 輪流跨越門檻造成的意圖輪播」。兩者都需要。
    const s = createRuleState()
    const sit = neutral()
    sit.turnAdvantage = 0.15
    sit.timeToMerge = 4
    sit.range = 500
    expect(stepRules(s, sit, 0, DT)).toBe('engage')

    // 立刻把條件改成 extend 該成立，但停留時間還沒到
    sit.turnAdvantage = -0.5
    expect(stepRules(s, sit, 0, DT)).toBe('engage')

    // 等過最小停留時間
    for (let i = 0; i < Math.ceil(DEFAULT_RULES.minDwell / DT) + 1; i++) {
      stepRules(s, sit, 0, DT)
    }
    expect(stepRules(s, sit, 0, DT)).toBe('extend')
  })

  it('defend 可以立刻插隊，不受最小停留限制', () => {
    // 【為什麼 defend 是例外】最小停留是為了行為穩定，但「有人正在打我」
    // 不能等 0.8 秒才反應。spec §9 對安全層也有同樣的豁免。
    const s = createRuleState()
    const sit = neutral()
    sit.turnAdvantage = 0.15
    sit.timeToMerge = 4
    sit.range = 500
    expect(stepRules(s, sit, 0, DT)).toBe('engage')

    sit.threatInstant = 1
    expect(stepRules(s, sit, 1, DT)).toBe('defend')
  })

  it('連續一千步不拋錯，且回傳值恆為五種之一', () => {
    const s = createRuleState()
    const sit = neutral()
    for (let i = 0; i < 1000; i++) {
      // 讓每個欄位都掃過門檻附近
      sit.threatInstant = 0.5 + 0.5 * Math.sin(i * 0.11)
      sit.turnAdvantage = 0.3 * Math.sin(i * 0.07)
      sit.energyAdvantage = 600 * Math.sin(i * 0.05)
      sit.timeToMerge = 6 + 5 * Math.sin(i * 0.13)
      sit.range = 800 + 700 * Math.sin(i * 0.09)
      const intent = stepRules(s, sit, sit.threatInstant, DT)
      expect(INTENTS).toContain(intent)
    }
  })
})

describe('extend 的兩個閂鎖互不汙染', () => {
  /**
   * 【人工驗收抓到的缺陷】原本寫成
   *
   *   s.extendLatch = latch(s.extendLatch, energyAdvantage, −300, 100) || turnAdvantage < 0
   *
   * `||` 的結果被寫回閂鎖自己的記憶，遲滯於是被毒化：只要有任何一格
   * `turnAdvantage` 落到 0 以下，下一格 `latch(active = true, …)` 走的就是
   * 維持條件 `energyAdvantage < 100` —— 勢均力敵時那幾乎恆真，閂鎖再也
   * 關不掉。實測正面對頭時 0.29°/s 的瞬間劣勢就足以讓 AI 在 1,400 m 轉為
   * 脫離，而當下 `turnAdvantage` 早已回正。
   */
  it('轉彎劣勢消失後，能量沒問題就不該再脫離', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 1000                    // 在 extendRange 之內
    sit.energyAdvantage = 0             // 能量勢均力敵，遠不到 −300

    // 一格明確的轉彎劣勢，讓轉彎閂鎖真的被點著
    sit.turnAdvantage = DEFAULT_RULES.turnEnter * 2
    stepRules(s, sit, 0, DT)
    expect(s.extendTurnLatch).toBe(true)
    expect(s.extendLatch).toBe(true)

    // 劣勢消失後必須跟著關掉 —— 能量閂鎖從頭到尾都沒被點著
    sit.turnAdvantage = 0.05
    for (let i = 0; i < 40; i++) stepRules(s, sit, 0, DT)
    expect(s.extendTurnLatch).toBe(false)
    expect(s.extendEnergyLatch).toBe(false)
    expect(s.extendLatch).toBe(false)
    expect(s.intent).not.toBe('extend')
  })

  it('反過來也一樣：能量閂鎖不會被轉彎劣勢的消失關掉', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 1000
    sit.energyAdvantage = DEFAULT_RULES.energyEnter * 1.5   // 真的能量劣勢
    sit.turnAdvantage = DEFAULT_RULES.turnEnter * 2
    stepRules(s, sit, 0, DT)

    // 轉彎劣勢消失，但能量仍在維持區間內（< energyExit）
    sit.turnAdvantage = 0.05
    sit.energyAdvantage = 0
    for (let i = 0; i < 40; i++) stepRules(s, sit, 0, DT)
    expect(s.extendTurnLatch).toBe(false)
    expect(s.extendEnergyLatch).toBe(true)
    expect(s.extendLatch).toBe(true)
  })

  /** 死區：戰術上無意義的劣勢不該觸發脫離。 */
  it('微小的轉彎劣勢不觸發（0.29°/s 是實測到的誤觸發值）', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 1000
    sit.turnAdvantage = -0.005          // 0.29°/s
    for (let i = 0; i < 40; i++) stepRules(s, sit, 0, DT)
    expect(s.extendTurnLatch).toBe(false)
    expect(s.intent).not.toBe('extend')
  })
})
