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
  // 中性態勢只有一架敵機，最近的就是他
  s.nearestRange = 3000
  s.closureRate = 0
  s.timeToMerge = Infinity
  s.aspectAngle = Math.PI / 2
  s.angleOffTail = Math.PI / 2
  s.losRate = 0
  s.energyAdvantage = 0
  s.turnAdvantage = 0
  s.airframeTurnAdvantage = 0
  // 速度充足：遠高於 cornerEnter
  s.cornerRatio = 1.2
  s.stallMargin = 2
  s.speedMargin = 2
  s.threatInstant = 0
  s.shotInstant = 0
  // 【中性 = 追得到】`createSituation` 的預設是 `Infinity`（「不知道」），
  // 而那對規則 3 是「轉不過去」——中性態勢不該觸發脫離。要測規則 3 的案例
  // 自己把它設大。
  s.timeToBear = 1
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
  /**
   * 【六種而不是五種】`rally` 由指揮層加進來，而它**不由
   * `arbitrate` 產生** —— 它是 `AiController` 的外部覆寫（見 `rules.ts` 的
   * `Intent` 註解）。放進聯集是因為 HUD、telemetry 與測試都以 `Intent` 當
   * 意圖的全集，少了它「AI 現在在幹嘛」就有一格顯示不出來。
   *
   * 這一條守的是「`INTENTS` 與 `Intent` 不會漏掉彼此」，所以聯集依設計成長
   * 時它本來就該跟著改 —— 不是放寬門檻。下面「仲裁只會吐出這五種」那一條
   * 才是優先序的護欄，它刻意不含 `rally`。
   */
  it('六種意圖齊全', () => {
    expect([...INTENTS].sort())
      .toEqual(['approach', 'defend', 'engage', 'extend', 'merge', 'rally'])
  })

  /**
   * 【`arbitrate` 永遠不吐 `rally`】指揮層是覆寫，不是仲裁表裡的一列。
   * 這一條若紅了，代表有人把命令插進了優先序 —— 那會動到整組實測逐條談定
   * 的關係（相對理由 vs 絕對理由、`defend` 的絕對優先權）。
   */
  it('仲裁的產出不含 rally', () => {
    const s = createRuleState()
    const sit = createSituation()
    for (const danger of [0, 0.5, 1]) {
      for (const cornerRatio of [0.3, 0.75, 1.5]) {
        for (const range of [200, 900, 3000]) {
          sit.cornerRatio = cornerRatio
          sit.range = range
          expect(stepRules(s, sit, danger, 0.1)).not.toBe('rally')
        }
      }
    }
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

  it('能量劣勢**且**速度沒補回來 → extend', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.energyAdvantage = -800
    // 【要明寫】`neutral()` 的 cornerRatio 是 1.2，那會讓
    // `extendRecoveredLatch` 成立，而「因能量脫離」是兩者的合取。
    sit.cornerRatio = 0.80
    sit.range = 900
    expect(stepRules(s, sit, 0, DT)).toBe('extend')
  })

  /**
   * 【轉彎劣勢不是脫離的理由】它是**打法的選擇** —— 轉不贏他的飛機照樣
   * 要靠近他打，只是不能跟他繞圈。閂鎖照常點亮供戰術層徵召，但意圖落在
   * `approach`。
   *
   * 【壞掉會怎樣】`airframeTurnAdvantage` 對一組機種對幾乎是常數，差距
   * 超過遲滯帶的配對閂鎖永不解除。讓它推 `extend`，飛機在 `extendRange`
   * 內就恆為脫離，而脫離的卸載操舵讓射擊解起不來、開火豁免因此永遠不
   * 成立 —— 自鎖。
   */
  it('轉彎劣勢 → 閂鎖點亮，但意圖不是 extend', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.airframeTurnAdvantage = -0.2
    sit.range = 900
    const intent = stepRules(s, sit, 0, DT)
    expect(s.extendTurnLatch).toBe(true)
    expect(intent).toBe('approach')
  })

  it('轉彎優勢且即將接觸 → engage', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.airframeTurnAdvantage = 0.15
    sit.timeToMerge = 4
    sit.range = 500
    expect(stepRules(s, sit, 0, DT)).toBe('engage')
  })

  it('最小停留時間：意圖切換後短時間內不再切', () => {
    // 遲滯處理的是「單一述詞在門檻附近抖」，最小停留處理的是「多個述詞
    // 輪流跨越門檻造成的意圖輪播」。兩者都需要。
    const s = createRuleState()
    const sit = neutral()
    sit.airframeTurnAdvantage = 0.15
    sit.timeToMerge = 4
    sit.range = 500
    expect(stepRules(s, sit, 0, DT)).toBe('engage')

    // 立刻把條件改成 extend 該成立，但停留時間還沒到。
    // 【用速度見底不用迴旋劣勢】迴旋劣勢不再推 `extend`（見上面那一條）
    sit.cornerRatio = DEFAULT_RULES.cornerEnter * 0.9
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
    sit.airframeTurnAdvantage = 0.15
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
      sit.airframeTurnAdvantage = 0.3 * Math.sin(i * 0.07)
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
    sit.airframeTurnAdvantage = DEFAULT_RULES.turnEnter * 2
    stepRules(s, sit, 0, DT)
    expect(s.extendTurnLatch).toBe(true)
    expect(s.extendLatch).toBe(true)

    // 劣勢消失後必須跟著關掉 —— 能量閂鎖從頭到尾都沒被點著
    sit.airframeTurnAdvantage = 0.05
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
    sit.airframeTurnAdvantage = DEFAULT_RULES.turnEnter * 2
    stepRules(s, sit, 0, DT)

    // 轉彎劣勢消失，但能量仍在維持區間內（< energyExit）。跟著門檻走而不
    // 寫死 —— 這條測的是兩個閂鎖互不汙染，不是門檻訂在哪個值
    sit.airframeTurnAdvantage = 0.05
    sit.energyAdvantage = DEFAULT_RULES.energyExit - 100
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
    sit.airframeTurnAdvantage = -0.005          // 0.29°/s
    for (let i = 0; i < 40; i++) stepRules(s, sit, 0, DT)
    expect(s.extendTurnLatch).toBe(false)
    expect(s.intent).not.toBe('extend')
  })
})

describe('extend 的三個理由與射擊否決權', () => {
  /**
   * 【為什麼要分「相對」與「絕對」兩類理由】人工驗收抓到 AI 咬在敵機後方
   * 236 m、正在開火時切到 extend，直飛 21 秒。加一條「有射擊解就不准跑」的
   * 護欄可以解掉它——但早期版本無差別地擋掉**所有** extend，結果把最後的
   * 觸發機會也堵死：`energyAdvantage` 是相對量，兩台一起把能量磨光時它一直
   * 接近 0，共速共高開局因此螺旋下沉到離海 109 m。
   *
   * 分野在於理由的性質：相對理由談的是接下來的交換（有槍在手就先開槍），
   * 絕對理由談的是我還能不能飛（開著槍也得走）。
   */
  const shooting = (sit: Situation) => { sit.shotInstant = 0.5 }

  it('有射擊解時，能量劣勢不是離開的理由', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 500
    sit.energyAdvantage = DEFAULT_RULES.energyEnter * 1.5
    shooting(sit)
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT)
    expect(s.extendEnergyLatch).toBe(true)      // 閂鎖本身有點著
    expect(s.intent).not.toBe('extend')          // 但沒有拿它當離開的理由
  })

  it('有射擊解時，轉彎劣勢也不是離開的理由', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 500
    sit.airframeTurnAdvantage = DEFAULT_RULES.turnEnter * 2
    shooting(sit)
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT)
    expect(s.extendTurnLatch).toBe(true)
    expect(s.intent).not.toBe('extend')
  })

  it('速度見底時，就算正在開火也要走', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 500
    sit.cornerRatio = DEFAULT_RULES.cornerEnter * 0.9   // 轉彎能力已經不足
    shooting(sit)
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT)
    expect(s.extendFloorLatch).toBe(true)
    expect(s.intent).toBe('extend')
  })

  it('沒有射擊解時，相對理由照常成立', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 500
    // 【相對理由只剩能量】迴旋劣勢不推 `extend`。合取的另一半要
    // `extendRecoveredLatch` 不成立，所以速度也得壓下來
    sit.energyAdvantage = -800
    sit.cornerRatio = 0.80
    sit.shotInstant = 0
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT)
    expect(s.extendEnergyLatch).toBe(true)
    expect(s.intent).toBe('extend')
  })

  /**
   * 【`extendRange` 也只約束相對理由】`extend` 有兩個出口：跑滿 `extendRange`，
   * 或閂鎖釋放。絕對理由觸發時**永遠是距離先到** —— 速度要爬回 `cornerExit`
   * 需要幾十秒，而拉開到 1,500 m 只要 1.2 秒。少了這條豁免，AI 每次都在還沒
   * 補到速度時就回頭，等於沒補，很快又見底。
   *
   * 【為什麼 90 秒的對戰矩陣看不到這個】復原要幾十秒，四組開局的仗都在那之前
   * 就結束了。所以這一條只能在單元層釘死。
   */
  it('速度見底時，跑滿 extendRange 也不回頭', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = DEFAULT_RULES.extendRange * 3   // 遠遠超過脫離距離
    sit.cornerRatio = DEFAULT_RULES.cornerEnter * 0.9
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT)
    expect(s.extendFloorLatch).toBe(true)
    expect(s.intent).toBe('extend')
  })

  it('相對理由則照樣受 extendRange 約束', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = DEFAULT_RULES.extendRange * 3
    sit.airframeTurnAdvantage = DEFAULT_RULES.turnEnter * 2
    sit.shotInstant = 0
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT)
    expect(s.extendTurnLatch).toBe(true)     // 閂鎖有點著
    expect(s.intent).not.toBe('extend')       // 但距離已經夠遠，不需要再跑
  })

  /** 速度閂鎖的遲滯：剛好回到進入門檻不夠，要真的補回一點才鬆手。 */
  it('速度閂鎖有遲滯：回到進入門檻不解除，補足 cornerExit 才解除', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 500
    sit.cornerRatio = DEFAULT_RULES.cornerEnter * 0.9
    stepRules(s, sit, 0, DT)
    expect(s.extendFloorLatch).toBe(true)

    // 回到進入門檻與離開門檻之間 —— 遲滯帶內，不解除
    sit.cornerRatio = (DEFAULT_RULES.cornerEnter + DEFAULT_RULES.cornerExit) / 2
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT)
    expect(s.extendFloorLatch).toBe(true)

    sit.cornerRatio = DEFAULT_RULES.cornerExit * 1.05
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT)
    expect(s.extendFloorLatch).toBe(false)
  })

  /**
   * 【破防壓過「我飛不動了」是刻意的 —— 一個被實測否決的設計】
   *
   * `arbitrate` 第一行是 `if (s.defendLatch) return 'defend'`，它把同一個
   * 檔案自己定義的分野（相對理由 vs 絕對理由）對 `defend` 整條蓋掉。task #136
   * 曾經打算把絕對理由那一行搬到它之前，理由是實測三機場景 400 m 時破防期間
   * 有 **50.1% / 45.1%** 的時間 `cornerRatio` 已經低於 `cornerEnter` ——
   * AI 一邊轉不動一邊繼續硬破防。
   *
   * **改了之後量出來明顯更糟，已退回。** `ai-visible-evasion` 的主判準：
   *
   * ```
   *                        原樣    搬到 defend 之前
   * 700 m 壓得住準星的時間  6.3%       14.6%   ← 2.3 倍
   * 900 m                   5.5%        8.3%   ← 1.5 倍
   * 700 m 射手有射擊解格數   551         956
   * 觸發涵蓋率            96 / 97%   40 / 44%
   * 破防的同向性            0.99        1.00   ← 完美直線
   * ```
   *
   * 設計文件 §2.2 事先寫下的風險原封不動地發生了：「被咬時切 `extend` 就是
   * 沿速度向量直線飛（`unloadAim`），那是把尾巴送給對方」。同向性剛好 1.00
   * 就是那句話的量測形式。能量赤字是真的，但**在被咬的當下它比不上「別被
   * 打中」**，而低空的高度問題已經由 `steer.ts` 的離地底限（`floorPitch`）
   * 從另一個方向解掉了。
   *
   * 這一條測試守著現況：**破防仍然壓過絕對理由**。
   */
  it('速度見底但正在被咬時，破防仍然壓過脫離', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 500
    sit.cornerRatio = DEFAULT_RULES.cornerEnter * 0.9
    // 威脅拉滿：threatEnter 以上，defendLatch 一定閂上
    for (let i = 0; i < 20; i++) stepRules(s, sit, 1, DT)

    expect(s.defendLatch).toBe(true)        // 破防的閂鎖確實閂著
    expect(s.extendFloorLatch).toBe(true)   // 速度見底的閂鎖也閂著
    expect(s.intent).toBe('defend')          // 破防勝出
  })

  /**
   * 【相對理由當然也輸給破防】「比他弱」不是丟下防禦不管的理由。
   * 與上一條合起來看：`defend` 壓過 extend 的**全部**三個理由。
   */
  it('能量劣勢不能把正在被咬的 AI 拉去 extend', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 500
    sit.energyAdvantage = DEFAULT_RULES.energyEnter * 1.5
    for (let i = 0; i < 20; i++) stepRules(s, sit, 1, DT)

    expect(s.defendLatch).toBe(true)
    expect(s.extendEnergyLatch).toBe(true)
    expect(s.intent).toBe('defend')
  })

  /**
   * 【`floorExempt` 的豁免對 defend 也要成立】佔著明顯能量優勢時，
   * 「我飛不動了」不強制脫離 —— 缺的是此刻的速度，低頭換就有。
   */
  it('能量優勢夠大時，速度見底也不脫離', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.range = 500
    sit.cornerRatio = DEFAULT_RULES.cornerEnter * 0.9
    sit.energyAdvantage = DEFAULT_RULES.floorExempt * 1.5
    for (let i = 0; i < 20; i++) stepRules(s, sit, 1, DT)

    expect(s.extendFloorLatch).toBe(true)
    expect(s.intent).toBe('defend')
  })
})

/**
 * 【為什麼要明寫 `ON`】`DEFAULT_RULES.recoveredExit` **預設是 `false`**
 * （實測否決，見該欄位的註解）。下面這些測的是機制本身，所以要自己把它
 * 打開；出貨行為由 `recoveredExit 關掉時…` 那幾條守。
 */
const ON = { ...DEFAULT_RULES, recoveredExit: true }

describe('extendRecoveredLatch —— 絕對的「我回到能打的狀態」', () => {
  it('初始 false，門檻夾在 cornerEnter 與 cornerExit 之間', () => {
    expect(createRuleState().extendRecoveredLatch).toBe(false)
    expect(DEFAULT_RULES.recoverExit).toBeGreaterThan(DEFAULT_RULES.cornerEnter)
    expect(DEFAULT_RULES.recoverExit).toBeLessThan(DEFAULT_RULES.cornerExit)
  })

  it('高於 cornerExit 才進場，掉到 recoverExit（含）才出場', () => {
    const s = createRuleState()
    const sit = neutral()
    sit.cornerRatio = DEFAULT_RULES.cornerExit
    stepRules(s, sit, 0, DT, ON)
    expect(s.extendRecoveredLatch).toBe(false)   // 嚴格 >，等於不算

    sit.cornerRatio = DEFAULT_RULES.cornerExit + 0.01
    stepRules(s, sit, 0, DT, ON)
    expect(s.extendRecoveredLatch).toBe(true)

    sit.cornerRatio = 0.90                        // 遲滯帶內維持
    stepRules(s, sit, 0, DT, ON)
    expect(s.extendRecoveredLatch).toBe(true)

    // 【等值就解除，不是「低於才解除」】latch 的維持條件是 value > exit
    sit.cornerRatio = DEFAULT_RULES.recoverExit
    stepRules(s, sit, 0, DT, ON)
    expect(s.extendRecoveredLatch).toBe(false)
  })

  /**
   * 【為什麼關掉時閂鎖也不能更新】消融的兩檔不得有不同的狀態演進，
   * 否則差異會在日後打開時以「殘留的舊值」的形式冒出來。
   */
  it('recoveredExit 關掉時閂鎖不更新', () => {
    const s = createRuleState()
    const sit = neutral()   // cornerRatio 預設 1.2，遠高於進場門檻
    stepRules(s, sit, 0, DT, { ...DEFAULT_RULES, recoveredExit: false })
    expect(s.extendRecoveredLatch).toBe(false)
  })
})

describe('因能量脫離改成合取', () => {
  /** 四個象限，只有「弱且飛不動」才脫離 */
  const cases: [string, number, number, boolean][] = [
    ['弱、飛不動 → extend', -800, 0.80, true],
    ['弱、飛得動 → 不 extend', -800, 1.10, false],
    ['不弱、飛不動 → 不 extend', 0, 0.80, false],
    ['不弱、飛得動 → 不 extend', 0, 1.10, false],
  ]
  for (const [name, energy, ratio, want] of cases) {
    it(name, () => {
      const s = createRuleState()
      const sit = neutral()
      sit.energyAdvantage = energy
      sit.cornerRatio = ratio
      sit.range = 900
      for (let i = 0; i < 5; i++) stepRules(s, sit, 0, DT, ON)
      expect(s.intent === 'extend').toBe(want)
    })
  }

  /**
   * 【迴旋劣勢完全不參與這個合取】它談的是機體，而機體決定的是**用哪種
   * 打法**，不是要不要脫離。飛得動的時候它不脫離，飛不動的時候脫離也是
   * 能量那一半說了算。
   */
  it('迴旋劣勢時，飛得動就不脫離', () => {
    const s = createRuleState()
    const sit = neutral()              // cornerRatio 1.2，recovered 會成立
    sit.airframeTurnAdvantage = DEFAULT_RULES.turnEnter * 2
    sit.range = 900
    for (let i = 0; i < 5; i++) stepRules(s, sit, 0, DT, ON)
    expect(s.extendTurnLatch).toBe(true)
    expect(s.extendRecoveredLatch).toBe(true)
    expect(s.intent).not.toBe('extend')
  })

  /** 【關掉時退回舊行為】消融的恆等基準 */
  it('recoveredExit 關掉時，弱且飛得動仍然 extend', () => {
    const cfg = { ...DEFAULT_RULES, recoveredExit: false }
    const s = createRuleState()
    const sit = neutral()
    sit.energyAdvantage = -800
    sit.cornerRatio = 1.10
    sit.range = 900
    for (let i = 0; i < 5; i++) stepRules(s, sit, 0, DT, cfg)
    expect(s.intent).toBe('extend')
  })
})

/**
 * 規則 3：轉不到他身上就脫離，而且脫離有頭有尾。
 *
 * 【它取代了什麼】舊的判準是機體規格之差（`airframeTurnAdvantage`），
 * 對一組機種對幾乎是常數 —— 貼上就撕不掉。實測 F4F 對 A6M5 的迴旋閂鎖
 * 佔時 100.0%，`extend` 因此佔到 54.6%。`timeToBear` 是態勢量，敵人變遠、
 * 橫越變慢時它自己就縮回來。
 */
describe('規則 3：轉不到就脫離', () => {
  /** 轉不贏他（前提）＋ 轉不到他（觸發） */
  function stuck(): Situation {
    const sit = neutral()
    sit.airframeTurnAdvantage = DEFAULT_RULES.turnEnter * 2
    sit.range = 900
    sit.nearestRange = 900
    sit.timeToBear = DEFAULT_RULES.bearMax + 1
    return sit
  }

  it('轉不贏而且轉不到 → extend', () => {
    const s = createRuleState()
    expect(stepRules(s, stuck(), 0, DT)).toBe('extend')
    expect(s.trackExtend).toBeGreaterThan(0)
  })

  it('轉得贏的話，轉不到也不脫離', () => {
    // 【為什麼】轉得贏的飛機該做的是繼續轉，不是脫離。這條規則是給沒有
    // 那個選項的一方的
    const s = createRuleState()
    const sit = stuck()
    sit.airframeTurnAdvantage = 0.05
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT)
    expect(s.trackExtend).toBe(0)
    expect(s.intent).not.toBe('extend')
  })

  it('轟炸機不走這條規則', () => {
    // 【它擋的是實測過的回歸】轟炸機轉不贏攔截機是常態，少了機種閘門整隊
    // 會離開航線 —— `turrets.test.ts` 的「P-51 也打下了東西」曾因此變成 0
    const s = createRuleState()
    const sit = stuck()
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT, DEFAULT_RULES, false)
    expect(s.trackExtend).toBe(0)
  })

  /**
   * 【承諾擋的是抖動】沒有它：脫離 → 飛開 → 敵人變遠、變好追 → 立刻回頭
   * → 一接近又追不到 → 又脫離。每隔幾秒抽搐一次，是「永不解除」的鏡像。
   */
  it('承諾期內，就算變得追得到也不反悔', () => {
    const s = createRuleState()
    const sit = stuck()
    stepRules(s, sit, 0, DT)
    expect(s.trackExtend).toBeGreaterThan(0)
    // 立刻變成追得到，但承諾還沒跑完
    sit.timeToBear = 1
    const n = Math.floor(DEFAULT_RULES.trackCommit / DT) - 2
    for (let i = 0; i < n; i++) stepRules(s, sit, 0, DT)
    expect(s.trackExtend).toBeGreaterThan(0)
  })

  /**
   * 【「追得到了」不是出口】脫離一拉開，視線角速度就掉、`timeToBear` 就縮
   * 回門檻以下 —— 那是脫離自己造成的。拿它當出口，每一段都在承諾到期那一
   * 格結束，實測 83% 的段落如此、一段只換到 60 m。
   */
  it('過了承諾、追得到了也不結束 —— 出口只認距離與上限', () => {
    const s = createRuleState()
    const sit = stuck()
    stepRules(s, sit, 0, DT)
    sit.timeToBear = 1
    for (let i = 0; i < Math.ceil(DEFAULT_RULES.trackCommit / DT) + 2; i++) {
      stepRules(s, sit, 0, DT)
    }
    expect(s.trackExtend).toBeGreaterThan(0)
  })

  it('過了承諾而且離最近敵機拉開到 extendRange → 結束脫離', () => {
    const s = createRuleState()
    const sit = stuck()
    stepRules(s, sit, 0, DT)
    sit.range = DEFAULT_RULES.extendRange + 1
    sit.nearestRange = DEFAULT_RULES.extendRange + 1
    for (let i = 0; i < Math.ceil(DEFAULT_RULES.trackCommit / DT) + 2; i++) {
      stepRules(s, sit, 0, DT)
    }
    expect(s.trackExtend).toBe(0)
    // 正常出場不罰冷卻
    expect(s.trackCooldown).toBe(0)
  })

  /**
   * 【它擋的是「換目標把尺歸零」的反面】目標換成遠的那一架時 `range` 會跳
   * 過 `extendRange`，但球裡最近的敵機還在 400 m —— 這時候沒有拉開，不准
   * 結束。實測 20v20 換目標 1169 次，45% 換完距離變近，反過來的也一樣多。
   */
  it('當前目標很遠、但最近的敵機還在身邊 → 不結束', () => {
    const s = createRuleState()
    const sit = stuck()
    stepRules(s, sit, 0, DT)
    sit.range = DEFAULT_RULES.extendRange + 1
    sit.nearestRange = 400
    for (let i = 0; i < Math.ceil(DEFAULT_RULES.trackCommit / DT) + 2; i++) {
      stepRules(s, sit, 0, DT)
    }
    expect(s.trackExtend).toBeGreaterThan(0)
  })

  /**
   * 【上限擋的是永久脫離】他比我快時距離永遠拉不開，只靠距離出場會變成
   * 一路逃到天邊 —— 那正是這一整輪要修的原始缺陷的形狀。
   */
  it('一直追不到又拉不開，上限也會把它結束', () => {
    const s = createRuleState()
    const sit = stuck()
    const n = Math.ceil(DEFAULT_RULES.trackMax / DT) + 2
    for (let i = 0; i < n; i++) stepRules(s, sit, 0, DT)
    expect(s.trackExtend).toBe(0)
  })

  /**
   * 【上限要真的有界限作用】只把計時器歸零的話，下一拍條件仍然成立、立刻
   * 重新觸發 —— 變成每 `trackMax` 秒一段的無限接續，看起來就是「一直在跑」。
   *
   * 【為什麼冷卻是計時器不是條件式】用「等幾何改變」的話，對手就是比我快時
   * 那個條件永遠不成立，飛機整場再也不脫離 —— 與 `extendTurnLatch` 那個原始
   * 缺陷同一個形狀（閂鎖因為出場條件不可達而永久卡住）。計時器一定會走完。
   */
  it('撞上限之後的冷卻期內不會立刻重新脫離', () => {
    const s = createRuleState()
    const sit = stuck()
    // 跑滿上限
    for (let i = 0; i < Math.ceil(DEFAULT_RULES.trackMax / DT) + 2; i++) {
      stepRules(s, sit, 0, DT)
    }
    expect(s.trackExtend).toBe(0)
    // 條件完全沒變，但冷卻期內不准再觸發
    const n = Math.floor(DEFAULT_RULES.trackCooldown / DT) - 2
    for (let i = 0; i < n; i++) {
      stepRules(s, sit, 0, DT)
      expect(s.trackExtend).toBe(0)
    }
  })

  it('冷卻走完之後可以再脫離 —— 不是永久禁止', () => {
    const s = createRuleState()
    const sit = stuck()
    for (let i = 0; i < Math.ceil(DEFAULT_RULES.trackMax / DT) + 2; i++) {
      stepRules(s, sit, 0, DT)
    }
    // 幾何一個字都沒變（他就是比我快），冷卻仍然要自己走完
    for (let i = 0; i < Math.ceil(DEFAULT_RULES.trackCooldown / DT) + 2; i++) {
      stepRules(s, sit, 0, DT)
    }
    expect(s.trackExtend).toBeGreaterThan(0)
  })

  /**
   * 【它擋的是「計時器在跑、動作沒做」】`defend` 壓過規則 3，被咬的那幾秒
   * 飛機在破防。計時器照走的話會在破防期間燒完上限、進冷卻，而那趟脫離
   * 沒有飛過一格。實測 39% 的計時器時間是這樣空轉掉的。
   */
  it('被咬（defend）時，規則 3 的計時器暫停，放開後繼續', () => {
    const s = createRuleState()
    const sit = stuck()
    stepRules(s, sit, 0, DT)
    const before = s.trackExtend
    expect(before).toBeGreaterThan(0)
    // 高威脅 → defendLatch 閂上，計時器不動
    for (let i = 0; i < 50; i++) stepRules(s, sit, 1, DT)
    expect(s.intent).toBe('defend')
    expect(s.trackExtend).toBe(before)
    // 威脅消失 → 閂鎖放開，計時器繼續走
    for (let i = 0; i < 50; i++) stepRules(s, sit, 0, DT)
    expect(s.trackExtend).toBeGreaterThan(before)
  })

  it('暫停之後上限仍然有界 —— 不會因為暫停過就永遠脫離', () => {
    const s = createRuleState()
    const sit = stuck()
    stepRules(s, sit, 0, DT)
    for (let i = 0; i < 50; i++) stepRules(s, sit, 1, DT)
    const n = Math.ceil(DEFAULT_RULES.trackMax / DT) + 2
    for (let i = 0; i < n; i++) stepRules(s, sit, 0, DT)
    expect(s.trackExtend).toBe(0)
    expect(s.trackCooldown).toBeGreaterThan(0)
  })

  it('正在開火時不走這條規則', () => {
    // 【與其他相對理由同一條分野】有槍在手就先開槍
    const s = createRuleState()
    const sit = stuck()
    sit.shotInstant = 0.5
    for (let i = 0; i < 20; i++) stepRules(s, sit, 0, DT)
    expect(s.intent).not.toBe('extend')
  })

  it('起始設定：上限比承諾長', () => {
    // 【它擋的是參數自我否定】上限比承諾短的話承諾永遠跑不完，「一旦決定
    // 就飛完」這件事等於不存在
    expect(DEFAULT_RULES.trackMax).toBeGreaterThan(DEFAULT_RULES.trackCommit)
  })
})
