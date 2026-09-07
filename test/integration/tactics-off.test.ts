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
  /** 相位離開 `off` 的取樣數。`quota = 0` 時不為 0 只可能來自徵召 */
  phaseOn: number
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
  let phaseOn = 0
  for (let k = 0; k < STEPS; k++) {
    stepBattle(b, DT)
    // 【每 0.1 s 取樣一次】與決策節拍同頻，不影響 digest（唯讀）
    if (k % 24 !== 0) continue
    for (const a of ais) {
      if (a.sit.range > maxRange) maxRange = a.sit.range
      if (a.tactics.phase !== 'off') phaseOn++
    }
  }
  // 【用專案既有的那一支】它把完整狀態（含速度、姿態、作動器、指派、彈丸）
  // 轉成 Float64Array 再做 SHA-256。自己挑幾個欄位比會漏掉整條積分。
  return { digest: await replayDigest(b), maxRange, phaseOn }
}

/**
 * 戰術層不徵召、`quota` 也是 0 的機種對，必須與**它上線之前**逐位元相同。
 *
 * 【為什麼單元測試不夠】`stepTactics` 恆回 `off` 只證明那個純函數。
 * `AiController` 整體是否等價還牽涉到新增的 `Situation` 欄位有沒有被別處
 * 讀到、覆寫的順序、早退路徑的推進、以及 `raw` 有沒有被多寫過。
 *
 * 【為什麼把等價寫成永久測試而不是一次性的人工步驟】人工步驟需要「暫時改
 * 一行預設值、跑、記得改回來」，而那一行如果忘了改回去就會被 commit 進去。
 */
describe('戰術層對不徵召的機種對維持等價', () => {
  /**
   * 【為什麼只剩鏡像對戰】戰術層現在由**機體迴旋明顯吃虧**徵召
   * （`AiController` 的 `ti.mandatory`），`quota = 0` 不再代表沒有飛機進去。
   * 同機種的 `airframeTurnAdvantage` 恆為 0、恆不徵召 —— 它因此是這個等價性
   * 唯一還成立的場景，而且是由**資料**決定的，不靠開關。
   *
   * `HEADON_20V20` 是 P-51D vs Bf 109 K-4，迴旋差值 −0.026～−0.044 低於
   * `turnEnter`（−0.02），會被徵召。它的 digest 必然改變 —— 那不是回歸，
   * 是設計，改成下面那一組斷言。
   */
  it('PURSUIT_MIRROR_8V8：quota = 0 的校驗和等於基準', async () => {
    // 【`300_000` 的 timeout 不能省】vitest 預設 5 秒，而這裡是 30 秒的模擬
    const off = await run('PURSUIT_MIRROR_8V8', 0)
    expect(off.phaseOn, '同機種不得被徵召').toBe(0)
    expect(off.digest).toBe(BASE.PURSUIT_MIRROR_8V8_BEFORE_TACTICS)
  }, 300_000)

  /**
   * 【徵召確實發生】`quota = 0` 而相位仍然離開 `off`，只可能來自徵召。
   *
   * 【為什麼不比對一個新的 digest】那會是「單次量測當基準」，任何無關的
   * 改動都會讓它假紅。這裡問的是機制有沒有接上，不是數字有沒有變。
   */
  it('HEADON_20V20：迴旋吃虧的一方會被徵召，quota = 0 也一樣', async () => {
    const off = await run('HEADON_20V20', 0)
    expect(off.phaseOn, '徵召的取樣數').toBeGreaterThan(0)
    expect(off.digest, '徵召改變了軌跡').not.toBe(BASE.HEADON_20V20_BEFORE_TACTICS)
  }, 300_000)

  /**
   * 【為什麼要這一條】一個「永遠沒接上」的機制會讓所有等價測試都綠，而消融
   * 表會顯示「開關沒有差別」—— 那看起來像「這個功能沒用」，不是「這個功能
   * 沒裝」。
   *
   * 【為什麼只用鏡像對戰】`HEADON_20V20` 在 `quota = 0` 就已經因為徵召而與
   * 基準不同，所以「`quota = 0.5` 也不同」對它是恆真的，證明不了 `quota`
   * 這條路還接著。鏡像對戰不被徵召，是唯一還分得出來的場景。
   *
   * 這一場的最遠交戰距離是 2742 m，高於 `enterRange` 2500 m —— 距離閘打得
   * 開，所以 `quota` 真的有作用空間。量測腳本 `test/tools/tactics-gate.probe.ts`。
   */
  it('PURSUIT_MIRROR_8V8：quota = 0.5 的校驗和不同 —— 否則 quota 這條路沒接上', async () => {
    const on = await run('PURSUIT_MIRROR_8V8', 0.5)
    // 【連成因一起釘】這一場打得到 enterRange。哪天有人把它調高到擋住它，
    // 這一行會先紅，訊息直接指向那個參數。
    expect(on.maxRange).toBeGreaterThan(DEFAULT_TACTICS.enterRange)
    expect(on.digest).not.toBe(BASE.PURSUIT_MIRROR_8V8_BEFORE_TACTICS)
  }, 300_000)
})
