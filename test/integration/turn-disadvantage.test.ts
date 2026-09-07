import { describe, it, expect, beforeAll } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, uniform } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_RULES } from '../../src/ai/rules'
import type { Combatant } from '../../src/world/World'

/**
 * 規則 3：迴旋吃虧的一方跟不上預瞄點時脫離，而且**脫離是有界的**。
 *
 * ── 【為什麼每一項都是單機，不是隊伍平均】────────────────────
 *
 * 人工回報看得到的只有一架飛機。隊伍平均會把陣亡早的（不再累計）與還活著
 * 的混在一起，數字自己往下漂：同一場實測，逐台的 `extend` 是 39～61%，
 * 隊伍平均報出來是 36.5%。而「有一台 230 秒沒開過一槍」在平均裡完全看不到。
 *
 * ── 【為什麼對照組是同機種】────────────────────────────
 *
 * 規則 3 的前提是 `extendTurnLatch`（機體迴旋明顯吃虧）。同機種的差值恆為
 * 0，所以這條規則對它天然休眠 —— 對照組由**資料**產生，不靠開關。
 */
const DT = 1 / 240
const SECONDS = 300
const SEED = 20260907
const FWD = new Vector3(0, 0, -1)

interface Solo {
  alive: number
  aimed: number
  longestExtend: number
  trackExtend: number
}

/** 只看一架。`seat` 是 `world.combatants` 的索引 */
function solo(blue: string, red: string, seat: number): Solo {
  const b = createBattle(
    new AiController(), battleConfigFrom(uniform(blue, 20, red, 20)), SEED,
  )
  const cs: Combatant[] = b.world.combatants
  const me = cs[seat]!
  const ai = me.controller as AiController
  const nose = new Vector3()
  const toTgt = new Vector3()
  let alive = 0
  let aimed = 0
  let run = 0
  let longestExtend = 0
  let trackExtend = 0
  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    if (!me.alive) continue
    alive += DT
    // 【只量規則 3 那一段】`extend` 還有能量與見底兩個理由，那兩個沒有
    // 時間上限，混進來這條護欄就永遠是紅的
    if (ai.rules.trackExtend > 0) trackExtend += DT
    // 【連續時間只算「真的在脫離」的格】計時器在被咬（`defend`）時暫停，
    // 一段脫離的牆鐘因此可以遠超上限 —— 但那些格飛機在破防，不在脫離。
    // 上限管的是脫離本身的長度；計時器跨過暫停累積，所以總量仍然有界。
    if (ai.rules.trackExtend > 0 && ai.intent === 'extend') {
      run += DT
      if (run > longestExtend) longestExtend = run
    } else {
      run = 0
    }
    const tgt = ai.target
    if (tgt === null) continue
    nose.copy(FWD).applyQuaternion(me.aircraft.state.orientation)
    toTgt.copy(tgt.state.position).sub(me.aircraft.state.position).normalize()
    if (nose.dot(toTgt) > Math.cos(15 * Math.PI / 180)) aimed += DT
  }
  return { alive, aimed, longestExtend, trackExtend }
}

describe('規則 3：跟不上就脫離，而且脫離有界', () => {
  let s: Solo
  beforeAll(() => { s = solo('f4f4', 'a6m5', 0) }, 600_000)

  /**
   * 【它擋的是原始缺陷】舊的判準是機體規格之差 —— 對一組機種對幾乎是常數，
   * 貼上就撕不掉。實測 F4F 對 A6M 的迴旋閂鎖佔時 100.0%，於是距離一進
   * `extendRange` 就恆為脫離、`extend` 佔到 54.6%。
   *
   * `trackExtend` 是計時器：一次脫離最多 `trackMax` 秒。
   */
  it('單次脫離不超過上限', () => {
    // 【上限是俯衝那一個】F4F 對 A6M 有紅線餘裕，規則 3 的脫離會俯衝，上限
    // 換成 trackDiveMax（見 RuleConfig）。留一拍餘裕：計時器在決策拍推進
    expect(s.longestExtend, '規則 3 的最長連續脫離')
      .toBeLessThan(DEFAULT_RULES.trackDiveMax + 1)
  })

  it('規則 3 真的有在跑 —— 否則上面那條是空的', () => {
    expect(s.trackExtend, '規則 3 的脫離佔時').toBeGreaterThan(0)
  })

  /**
   * 【它擋的是「從頭到尾沒有瞄準」】人工回報的原話。舊版實測有座位整場
   * 0.0% 的時間機首在目標 15° 錐內。
   */
  it('機首有在指著敵人', () => {
    expect(s.aimed / s.alive, '瞄準佔時').toBeGreaterThan(0.05)
  })
})

/**
 * 轟炸機不走規則 3。
 *
 * 【它擋的是一個實測過的回歸】轟炸機轉不贏攔截機是常態，`extendTurnLatch`
 * 對它永遠成立。少了機種閘門，整隊 B-17 會離開航線 —— 實測 `turrets.test.ts`
 * 的「P-51 也打下了東西」由正數變成 0，而那條測試講的是砲塔平衡，被一個
 * AI 打法的改動弄紅時成因完全看不出來。
 *
 * 【為什麼特別危險】B-17 的 `timeToBear` 實測是 5.9～8.8 s，而 `bearMax`
 * 是 8 —— 高速橫越那一格已經跨過去了。這不是理論風險。
 */
describe('轟炸機不走規則 3', () => {
  let s: Solo
  beforeAll(() => { s = solo('b17g', 'p51d', 0) }, 600_000)

  it('規則 3 一次都不觸發', () => {
    expect(s.trackExtend, '規則 3 的脫離佔時').toBe(0)
  })
})

describe('同機種對戰不受規則 3 影響', () => {
  let s: Solo
  beforeAll(() => { s = solo('f4f4', 'f4f4', 0) }, 600_000)

  it('規則 3 一次都不觸發', () => {
    expect(s.trackExtend, '規則 3 的脫離佔時').toBe(0)
  })
})
