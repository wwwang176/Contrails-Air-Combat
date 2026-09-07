import { describe, it, expect, beforeAll } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, uniform } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import type { Combatant } from '../../src/world/World'

/**
 * 規則 3 在真的一場仗裡跑得到。
 *
 * ── 【這一支只守「可達性」，不守規則本身】──────────────────
 *
 * 規則 3 的**行為**全部由 `test/unit/ai-rules.test.ts` 用純函數守著：上限會
 * 結束脫離、承諾期內不反悔、冷卻期不立刻重來、轟炸機不走這條、轉得贏就
 * 不走。那些是 `stepRules` 的契約，餵 `Situation` 就證得完，成本是微秒。
 *
 * 純測試證不了的只有一件事：**餵進去的 `Situation` 真的會長成那個樣子嗎。**
 * `timeToBear > bearMax` 與 `extendTurnLatch` 同時成立、而且距離在
 * `extendRange` 以內 —— 這三件事湊在一起是模擬跑出來的，不是設定出來的。
 * 少了這一支，規則 3 可以整段死掉而所有純測試照樣全綠。
 *
 * ── 【為什麼是單機而不是隊伍平均】────────────────────────
 *
 * 人工回報看得到的只有一架飛機。隊伍平均會把陣亡早的（不再累計）與還活著
 * 的混在一起，數字自己往下漂：同一場實測，逐台的 `extend` 是 39～61%，
 * 隊伍平均報出來是 36.5%。而「有一台整場沒開過一槍」在平均裡完全看不到。
 *
 * ── 【機種對不能換】──────────────────────────────────
 *
 * F4F 對 A6M 是**迴旋吃虧**的那一側，`extendTurnLatch` 才會亮。換成同機種
 * 或換成轉得贏的一方，這一支會綠得毫無意義（規則對它天然休眠）。
 */
const DT = 1 / 240
/** 4v4 × 90 秒。**這是量出來的下限**：見 `trackExtend` 那條斷言的註解 */
const SECONDS = 90
const COUNT = 4
const SEED = 20260907
const FWD = new Vector3(0, 0, -1)

interface Solo {
  alive: number
  aimed: number
  trackExtend: number
}

/** 只看一架。`seat` 是 `world.combatants` 的索引 */
function solo(blue: string, red: string, seat: number): Solo {
  const b = createBattle(
    new AiController(), battleConfigFrom(uniform(blue, COUNT, red, COUNT)), SEED,
  )
  const cs: Combatant[] = b.world.combatants
  const me = cs[seat]!
  const ai = me.controller as AiController
  const nose = new Vector3()
  const toTgt = new Vector3()
  let alive = 0
  let aimed = 0
  let trackExtend = 0
  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    if (!me.alive) continue
    alive += DT
    // 【只量規則 3 那一段】`extend` 還有能量與見底兩個理由，那兩個沒有
    // 時間上限，混進來這條護欄就永遠是紅的
    if (ai.rules.trackExtend > 0) trackExtend += DT
    const tgt = ai.target
    if (tgt === null) continue
    nose.copy(FWD).applyQuaternion(me.aircraft.state.orientation)
    toTgt.copy(tgt.state.position).sub(me.aircraft.state.position).normalize()
    if (nose.dot(toTgt) > Math.cos(15 * Math.PI / 180)) aimed += DT
  }
  return { alive, aimed, trackExtend }
}

describe('規則 3 在真的一場仗裡跑得到（F4F-4 對 A6M5、4v4、90 秒）', () => {
  let s: Solo
  beforeAll(() => { s = solo('f4f4', 'a6m5', 0) }, 300_000)

  /**
   * 【這一條是本檔存在的理由】規則 3 的三個前提在模擬裡真的會同時成立。
   *
   * 【場景縮到 4v4 × 90 秒是量過的，不是猜的】20v20 × 300 秒實測脫離佔時
   * 39～61%，縮到 4v4 × 90 秒仍有數十秒 —— 這條斷言離 0 非常遠。再縮下去
   * 就會踩到「還沒接敵仗就結束了」，那時紅的不是缺陷是場景不成立。
   */
  it('規則 3 真的觸發過', () => {
    console.log(
      `規則 3 脫離 ${s.trackExtend.toFixed(1)}s / 存活 ${s.alive.toFixed(1)}s`
      + `　瞄準佔時 ${(100 * s.aimed / s.alive).toFixed(1)}%`,
    )
    expect(s.trackExtend, '規則 3 的脫離佔時').toBeGreaterThan(0)
  })

  /**
   * 【它擋的是「從頭到尾沒有瞄準」】人工回報的原話。舊版實測有座位整場
   * 0.0% 的時間機首在目標 15° 錐內。
   *
   * **5% 是病理下限，不是品質指標** —— 瞄得準不準是試飛的事，這一條只擋
   * 「規則 3 把 AI 拖進永久脫離，整場不回頭」。
   */
  it('機首有在指著敵人', () => {
    expect(s.aimed / s.alive, '瞄準佔時').toBeGreaterThan(0.05)
  })
})
