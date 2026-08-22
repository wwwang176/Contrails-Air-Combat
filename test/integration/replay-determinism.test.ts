import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_TACTICS } from '../../src/ai/tactics'
import { Idle, SCENES, SEED, STEPS, DT, replayDigest } from '../tools/spawn-snapshot'

/** 跑滿 30 秒，回傳完整狀態的校驗和 */
async function snapshot(quota: number): Promise<string> {
  const b = createBattle(new Idle(), SCENES.HEADON_20V20(), SEED)
  for (const c of b.world.combatants) {
    if (c.controller instanceof AiController) {
      c.controller.tacticalConfig = { ...DEFAULT_TACTICS, quota }
    }
  }
  for (let k = 0; k < STEPS; k++) stepBattle(b, DT)
  return replayDigest(b)
}

/**
 * 同一組設定、同一個種子跑兩次，結果必須完全相同。
 *
 * 【為什麼專案需要這一條】`rematch.test.ts` 測的是換設定、戰績隔離與十場
 * 效能，**不是**逐位元重播；`order-of-battle-replay.test.ts` 比的是與一個
 * 固定基準的校驗和，那條會在任何行為改動時紅掉。兩者都不回答「同一組設定
 * 跑兩次會不會不一樣」—— 而那正是 `Math.random`、`Map` 迭代順序、未初始化
 * 記憶體這幾類缺陷的唯一症狀。
 *
 * 【紅了怎麼查】先找非決定性的來源（`Math.random`、`Map` / `Set` 的迭代
 * 順序、未初始化的欄位），**不要**放寬比較。
 */
describe('同設定雙跑', () => {
  // 【`300_000` 的 timeout 不能省】每條各跑兩次 30 秒的 20v20 模擬
  it('戰術層關掉時兩次完全相同', async () => {
    expect(await snapshot(0)).toBe(await snapshot(0))
  }, 300_000)

  it('戰術層開著時兩次也完全相同', async () => {
    // 【這一條才驗得到戰術層自己的決定性】名額用低差異序列而不是亂數、
    // 隊內序號由候選陣列的順序推導 —— 兩者都必須是確定的。
    expect(await snapshot(0.5)).toBe(await snapshot(0.5))
  }, 300_000)
})
