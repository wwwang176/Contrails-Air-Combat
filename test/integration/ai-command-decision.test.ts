import { describe, it, expect } from 'vitest'
import {
  createBattle, stepBattle, DEFAULT_BATTLE, type Battle, type BattleConfig,
} from '../../src/battle/setup'
import { HEAD_ON } from '../../src/battle/entry'
import { lineAbreast } from '../../src/battle/order'
import { P51D } from '../../src/specs/p51d'
import { AiController } from '../../src/ai/AiController'
import type { Controller } from '../../src/control/Controller'

const DT = 1 / 240
const SECONDS = 120

/**
 * 【margin 在跑之前定死】0.10。看到結果再定
 * 門檻等於量到綠為止 —— 這個專案在第二份 §11.7 剛踩過。
 *
 * **這個值從頭到尾沒有動過**，包含判準被否決的時候。
 */
const MARGIN = 0.10

/**
 * 這個檔原本要驗的東西，以及為什麼它現在驗的是別的（spec §10.8）。
 *
 * ## 原本的判準
 *
 * 第三份 spec §2 與 §7.3：跑三場 20v20、120 秒 —— 基準場兩隊都不指揮，
 * 另外兩場各只有一隊指揮 —— 指揮的那一方兩場都要贏過基準的 1.10 倍。
 *
 * ## 為什麼否決
 *
 * **那把尺的雜訊比要量的效果大一個數量級。**
 *
 * 拿六個**依對稱性真值必為 1.0** 的編成（兩隊同機種、兩隊都是 AI、都不
 * 指揮，只差出生幾何的微調）去量交換比，得到：
 *
 * ```
 * 0.528  0.789  0.964  2.692  0.374  0.689
 * 幾何平均 0.808   1σ = ×1.85   範圍 0.374~2.692（7.2 倍）
 * ```
 *
 * 真值 1.0 的量測散在 0.37 到 2.69 之間。**1σ 是 ×1.85，而 margin 是
 * ×1.10** —— 判準要解析的效果比儀器的解析度小六倍。空戰是混沌的：一次
 * 早期的擊墜改變局部人數，人數優勢再複利下去，單場的最終比值因此是一個
 * 極吵的統計量。
 *
 * 在這個雜訊下解析 10% 的效果，每一格需要約 42 場才到 1σ，真正的檢定要
 * 170~380 場。單場 120 秒的 20v20 約 23 秒，那是好幾個小時。
 *
 * ## 為什麼不是「多跑幾場平均」就好
 *
 * `createBattle` 的 seed **只影響飛行員名字**，不進入任何物理路徑
 * （M9 spec §6.2）—— 同一個編成跑一百次逐位元相同。複本只能靠改出生幾何
 * 造，而每改一次就同時改了戰局本身。這不是「加大 n」，是換題目。
 *
 * ## 所以這個檔現在驗什麼
 *
 * 驗**那把尺的解析度**，而且是可證偽的：對稱基準的散布必須大於 margin
 * ——那正是「比值判準不可用」這句話的內容。哪天模擬變得不那麼混沌、或者
 * 有人做出便宜的複本機制，這一條會轉紅，那時比值判準就重新可用了。
 *
 * 決策層實際買到什麼，由 `ai-command-channel` 那三條轉綠的觀測值回答
 * （離場佔時 33.51% → 18.53%、命令期間撞地接管 134 → 0、`multi-battle`
 * 開局巡航編隊 353 m → < 100 m）。詳見 spec §10.5。
 */
const RETIRED = 'spec §10.8'

/**
 * 【玩家座位放一個會打的 AI，不是平飛的靶】其他驗收檔用平飛的 `Idle`，
 * 因為它們量的是通道與機制，一架不動的飛機不影響。
 *
 * 這個檔不行：平飛的靶是**送給對方的免費擊墜**，而且該隊等於少一架戰鬥
 * 機。實測同機種、都不指揮時基準因此歪到 0.277 —— 一架靶把 20v20 拉成
 * 一面倒。`createBattle` 的接線迴圈（`setup.ts` 的「AI 接線」）對**任何**
 * `AiController` 都會接指派板、自身索引與難度，所以玩家座位那一架與其他
 * 19 架完全一樣。
 */
function player(): Controller {
  return new AiController()
}

/**
 * 把一隊的命令清乾淨。
 *
 * 【為什麼是清而不是不接線】兩邊跑的是**完全同一份程式**，差別只有命令有
 * 沒有真的傳到戰機端 —— 這比改生產程式碼誠實（第一份的做法，沿用）。
 */
function suppress(b: Battle, team: 'blue' | 'red'): void {
  const st = team === 'blue' ? b.blueCommand : b.redCommand
  st.orders.fill(null)
  for (const c of b.world.combatants) {
    if (c.team !== team) continue
    const ai = c.controller
    if (ai instanceof AiController) {
      ai.order = null
      ai.focusTarget = null
    }
  }
}

interface Damage {
  blue: number
  red: number
}

/**
 * 跑一場 20v20，指定哪一隊有指揮官。
 *
 * @param commanded `'none'` = 兩隊都沒有；`'blue'` / `'red'` = 只有那一隊有
 */
function observe(commanded: 'none' | 'blue' | 'red', cfg: BattleConfig): Damage {
  const b: Battle = createBattle(player(), cfg)
  const hp0 = b.world.combatants.map((c) => c.hp)

  for (let s = 0; s < SECONDS * 240; s++) {
    stepBattle(b, DT)
    if (commanded !== 'blue') suppress(b, 'blue')
    if (commanded !== 'red') suppress(b, 'red')
  }

  const out: Damage = { blue: 0, red: 0 }
  for (const c of b.world.combatants) {
    const lost = hp0[c.index]! - c.hp
    if (c.team === 'blue') out.blue += lost
    else out.red += lost
  }
  return out
}

/**
 * 四個**依對稱性真值必為 1.0** 的編成：兩隊同機種，只差出生幾何。
 *
 * 【為什麼同機種】`DEFAULT_BATTLE` 是 P-51D 對 Bf 109 G-6，兩個機種的
 * 性能不同，所以它的基準本來就不是 1.0（實測 3.129），拿它量不出雜訊 ——
 * 分不清偏離是機種造成的還是抽樣造成的。同機種把真值釘死在 1.0。
 */
const SYMMETRIC: readonly BattleConfig[] = (() => {
  // 【兩隊同機種】不可以寫成 `redSpec: DEFAULT_BATTLE.blueSpec`，
  // 也就是「紅隊換成藍隊那一台」。編組表版本把它寫明白
  const same: BattleConfig = {
    ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 20, P51D, 20),
  }
  return [
    same,
    { ...same, lateralOffset: same.lateralOffset * 1.1 },
    { ...same, altitudeSpread: same.altitudeSpread + 50 },
    { ...same, tas: same.tas + 10 },
  ]
})()

describe('傷害交換比這把尺的解析度（20v20、120 秒、四個對稱編成）', () => {
  const ratios = SYMMETRIC.map((cfg) => {
    const d = observe('none', cfg)
    return d.red / Math.max(d.blue, 1)
  })

  /**
   * 【比值判準為什麼被否決】見 `RETIRED`。這一條是那句話的可證偽形式：
   * 真值 1.0 的量測散得比 margin 還開，就代表這把尺解析不了 10% 的效果。
   *
   * **散布用幾何標準差**：比值的自然尺度是乘法的（0.5 與 2.0 一樣偏），
   * 算術標準差會把大於 1 的那一半算得比較重。
   */
  it('對稱基準的散布大於 margin —— 比值判準解析不了 10% 的效果', () => {
    const logs = ratios.map((r) => Math.log(r))
    const mean = logs.reduce((a, b) => a + b, 0) / logs.length
    const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / logs.length)
    const spread = Math.exp(sd)
    console.log(JSON.stringify({
      retired: RETIRED,
      ratios: ratios.map((r) => r.toFixed(3)),
      geomean: Math.exp(mean).toFixed(3),
      spread: '×' + spread.toFixed(3),
      margin: '×' + (1 + MARGIN).toFixed(3),
    }))
    // 【場景要成立】四場都要真的打起來，否則比值全是 0 也會「散布很小」
    for (const r of ratios) expect(r).toBeGreaterThan(0)
    expect(spread).toBeGreaterThan(1 + MARGIN)
  }, 10 * 60 * 1000)
}, 30 * 60 * 1000)
