import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { Idle, SCENES, SEED, STEPS, DT, replayDigest } from '../tools/spawn-snapshot'

/** 跑滿 30 秒，回傳完整狀態的校驗和 */
async function snapshot(): Promise<string> {
  const b = createBattle(new Idle(), SCENES.HEADON_20V20(), SEED)
  for (let k = 0; k < STEPS; k++) stepBattle(b, DT)
  return replayDigest(b)
}

/**
 * 同一組設定、同一個種子跑兩次，結果必須完全相同。
 *
 * 【為什麼專案需要這一條】`rematch.test.ts` 測的是換設定、戰績隔離與十場
 * 效能，**不是**逐位元重播，不回答「同一組設定跑兩次會不會不一樣」—— 而那
 * 正是 `Math.random`、`Map` 迭代順序、未初始化記憶體這幾類缺陷的唯一症狀。
 * 這一條不存基準值，兩次互相比，所以調 AI、改武器都不會讓它紅。
 *
 * 【紅了怎麼查】先找非決定性的來源（`Math.random`、`Map` / `Set` 的迭代
 * 順序、未初始化的欄位），**不要**放寬比較。
 */
describe('同設定雙跑', () => {
  // 【`300_000` 的 timeout 不能省】跑兩次 30 秒的 20v20 模擬
  it('兩次完全相同', async () => {
    expect(await snapshot()).toBe(await snapshot())
  }, 300_000)
})
