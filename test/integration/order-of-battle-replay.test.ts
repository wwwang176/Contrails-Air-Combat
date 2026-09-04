import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle } from '../../src/battle/setup'
import {
  Idle, SCENES, SEED, STEPS, DT, spawnLines, replayDigest,
} from '../tools/spawn-snapshot'
import * as BASE from '../fixtures/spawn-baseline'

/**
 * 編組表重構（spec 2026-08-21）的驗收。**兩半強度不同，刻意分開講。**
 *
 * 【一、出生表逐字相同 —— 真的逐位元】`String(number)` 對有限值是可逆的
 * 最短表示（負零由 `num()` 特判），所以字串相等就是位元相等。這一半正好
 * 涵蓋這個重構會弄壞的東西：生成幾何、生成順序、小隊分組、玩家的位置。
 *
 * 【二、30 秒重播的 SHA-256 —— 高可信校驗】涵蓋範圍與刻意不涵蓋的東西
 * 見 `test/tools/spawn-snapshot.ts` 的 `replayDigest`。
 *
 * 【為什麼判準是「逐字相同」而不是「差在容差內」】這一輪宣稱的就是**同一個
 * 浮點運算序列**。容許 1e-9 的差等於承認算式變了，而那時「哪裡變了」沒有人
 * 答得出來。
 *
 * 【重構期間紅了怎麼查】先看出生表那一條：
 *
 * ```
 *   行數不同        編組表產出的架數不對
 *   順序不同        藍紅順序或小隊順序（world.add 的順序決定 combatant 索引，
 *                   而索引決定 AI 決策相位、名字指派、砲塔點放的錯開）
 *   某一架的 x 不同  leadX 的乘法順序，或 lane 算錯
 *   某一架的 y 不同  tier 沒有等於改動前的 f
 *   「小隊」那幾行   sizes 沒傳進 createFlights，或順序錯
 *   出生表全對但校驗和不同   生成之後的東西被動到了
 * ```
 */
describe('編組表重構：行為逐位元不變', () => {
  /**
   * 【場景是逐一列出來的，不是掃 SCENES】新增一個場景時要記得加進來 ——
   * 忘了的話那個場景有基準卻沒有人比對，是一條靜靜失效的護欄。
   *
   * ESCORT_B17 守的是砲塔那條路：前兩個場景只有固定槍。
   */
  for (const name of ['HEADON_20V20', 'PURSUIT_MIRROR_8V8', 'ESCORT_B17'] as const) {
    it(`${name}：出生表與編制表逐字相同`, () => {
      const b = createBattle(new Idle(), SCENES[name](), SEED)
      const got = spawnLines(b)
      const want = BASE[name]
      expect(got.length).toBe(want.length)
      for (let i = 0; i < want.length; i++) expect(got[i]).toBe(want[i])
    }, 60 * 1000)

    it(`${name}：30 秒重播的校驗和相同`, async () => {
      const b = createBattle(new Idle(), SCENES[name](), SEED)
      for (let k = 0; k < STEPS; k++) stepBattle(b, DT)
      expect(await replayDigest(b)).toBe(BASE[`${name}_REPLAY`])
    }, 5 * 60 * 1000)
  }
})
