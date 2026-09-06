import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_TACTICS } from '../../src/ai/tactics'
import { Idle, SCENES, SEED, STEPS, DT, replayDigest } from '../tools/spawn-snapshot'
import * as BASE from '../fixtures/tactics-baseline'

interface Run {
  /** 完整狀態的校驗和 */
  digest: string
  /** 全場所有 AI 在整場裡量到的最大交戰距離，m */
  maxRange: number
}

/** 跑滿 30 秒 */
async function run(name: keyof typeof SCENES, quota: number): Promise<Run> {
  const b = createBattle(new Idle(), SCENES[name](), SEED)
  const ais: AiController[] = []
  for (const c of b.world.combatants) {
    if (c.controller instanceof AiController) {
      c.controller.tacticalConfig = { ...DEFAULT_TACTICS, quota }
      ais.push(c.controller)
    }
  }
  let maxRange = 0
  for (let k = 0; k < STEPS; k++) {
    stepBattle(b, DT)
    // 【每 0.1 s 取樣一次】與決策節拍同頻，不影響 digest（唯讀）
    if (k % 24 !== 0) continue
    for (const a of ais) if (a.sit.range > maxRange) maxRange = a.sit.range
  }
  // 【用專案既有的那一支】它把完整狀態（含速度、姿態、作動器、指派、彈丸）
  // 轉成 Float64Array 再做 SHA-256。自己挑幾個欄位比會漏掉整條積分。
  return { digest: await replayDigest(b), maxRange }
}

/**
 * 戰術層關掉時，必須與**它上線之前**逐位元相同。
 *
 * 【為什麼單元測試不夠】`stepTactics` 恆回 `off` 只證明那個純函數。
 * `AiController` 整體是否等價還牽涉到新增的 `Situation` 欄位有沒有被別處
 * 讀到、覆寫的順序、早退路徑的推進、以及 `raw` 有沒有被多寫過。
 *
 * 【為什麼把等價寫成永久測試而不是一次性的人工步驟】人工步驟需要「暫時改
 * 一行預設值、跑、記得改回來」，而那一行如果忘了改回去就會被 commit 進去。
 */
describe('戰術層關掉時等於它上線之前', () => {
  for (const name of ['HEADON_20V20', 'PURSUIT_MIRROR_8V8'] as const) {
    // 【`300_000` 的 timeout 不能省】vitest 預設 5 秒，而這裡是 30 秒的
    // 20v20 模擬
    it(`${name}：quota = 0 的校驗和等於基準`, async () => {
      expect((await run(name, 0)).digest).toBe(BASE[`${name}_BEFORE_TACTICS`])
    }, 300_000)
  }

  /**
   * 【為什麼要這一條】一個「永遠沒接上」的機制會讓所有等價測試都綠，而消融
   * 表會顯示「開關沒有差別」—— 那看起來像「這個功能沒用」，不是「這個功能
   * 沒裝」。
   *
   * ── `PURSUIT_MIRROR_8V8` 為什麼在這裡 ─────────────────────────
   *
   * 原本那一場單獨成一格，斷言的是**距離閘擋住了**：全程量到的最遠交戰距離
   * 2174 m 低於 `enterRange` 2500 m，`farLatch` 一次都沒開，所以 quota 0.5
   * 與 quota 0 的校驗和相同。那一格的註解寫著「日後 `enterRange` 一改動這條
   * 就會紅，而紅的訊息會直接指向那個參數」—— 它確實紅了，只是動的不是
   * `enterRange`，是命中盒。
   *
   * 命中盒改貼合外形之後彈道與傷害都變了，那一場的軌跡跟著變：
   *
   * ```
   *   最遠交戰距離        2174 → 2742 m
   *   超過閘門的取樣         0 → 13 次
   *   quota 0 vs 0.5     相同 → **不同**
   * ```
   *
   * 前提死了，而且結論跟著翻面：那一場現在**會**打開距離閘。所以它不再是
   * 「開關沒差別」的例子，而是與 `HEADON_20V20` 同一類。量測腳本
   * `test/tools/tactics-gate.probe.ts`。
   */
  for (const name of ['HEADON_20V20', 'PURSUIT_MIRROR_8V8'] as const) {
    it(`${name}：quota = 0.5 的校驗和不同 —— 否則這一層沒接上`, async () => {
      const on = await run(name, 0.5)
      // 【連成因一起釘】兩場現在都打得到 enterRange。哪天有人把它調高到
      // 擋住其中一場，這一行會先紅，訊息直接指向那個參數。
      expect(on.maxRange).toBeGreaterThan(DEFAULT_TACTICS.enterRange)
      expect(on.digest).not.toBe(BASE[`${name}_BEFORE_TACTICS`])
    }, 300_000)
  }
})
