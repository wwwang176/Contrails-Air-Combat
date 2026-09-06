import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { PlayerController } from '../../src/control/PlayerController'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_AI_BURST as AI_BURST } from '../../src/ai/fire'
import { createInputState } from '../../src/input/InputState'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'

const DT = 1 / 240

/**
 * AI 戰鬥機的扳機點放。**AI 的戰鬥機與轟炸機
 * 的機槍一樣，會有冷卻時間（只是頻率可以高一點）」**，隨後補充「AI 代飛的
 * 時候也要有這個機制，但代飛結束要改回來（人接手的時候不需要冷卻）」。
 *
 * 【這一支不驗「幾何成立時真的會打」】那是 `shouldFire` 的四條，
 * `test/unit/ai-fire.test.ts` 已經逐條釘住。點放與它是 AND，兩件事分開驗。
 */
describe('AI 戰鬥機的點放', () => {
  const cmd = createCommand()

  /** 一架在平飛、沒有目標的 AI。點放與「有沒有目標」無關 —— 見第二條。 */
  function flying(selfIndex: number): { self: Aircraft, ai: AiController } {
    const self = new Aircraft(BF109K4, 4000, 180)
    self.update(new Vector3(0, 0, -1), 0.7, DT)
    const ai = new AiController()
    ai.selfIndex = selfIndex
    return { self, ai }
  }

  it('工作週期等於 on / (on + off)', () => {
    const { self, ai } = flying(0)
    const steps = Math.round((AI_BURST.on + AI_BURST.off) * 40 / DT)
    let open = 0
    for (let k = 0; k < steps; k++) {
      ai.update(self, DT, cmd)
      if (ai.burstFiring) open++
    }
    expect(open / steps).toBeCloseTo(AI_BURST.on / (AI_BURST.on + AI_BURST.off), 2)
  })

  it('頻率比砲塔高 —— 週期短、工作週期高', async () => {
    // 【為什麼在這裡對照而不是各自寫死】「只是頻率可以高一點」是一句
    // **相對**的裁定。兩邊各記一個絕對值的話，日後有人調砲塔的節奏，
    // 這個關係會靜靜地反過來而沒有任何測試變紅。
    const t = await import('../../src/weapons/burst')
    expect(AI_BURST.on + AI_BURST.off).toBeLessThan(t.BURST_ON + t.BURST_OFF)
    expect(AI_BURST.on / (AI_BURST.on + AI_BURST.off))
      .toBeGreaterThan(t.BURST_ON / (t.BURST_ON + t.BURST_OFF))
  })

  it('沒有目標的那幾秒時鐘照走 —— 早退路徑也推進', () => {
    // 【為什麼這一條重要】`update` 有三條 `return`（飛站位、飛集合點、
    // 平飛）。只在交戰那條推進的話，每一架都是從「上次脫離時停下來的
    // 地方」繼續，一場打下來錯開的相位就糊成一團。
    const { self, ai } = flying(0)
    const flips = new Set<boolean>()
    for (let k = 0; k < Math.round(3 / DT); k++) {
      ai.update(self, DT, cmd)
      flips.add(ai.burstFiring)
    }
    expect(flips.size).toBe(2)
  })

  it('座位不同的兩架不同相位 —— 整隊不是同一根扳機', () => {
    const a = flying(0)
    const b = flying(1)
    let differ = 0
    const steps = Math.round((AI_BURST.on + AI_BURST.off) * 4 / DT)
    for (let k = 0; k < steps; k++) {
      a.ai.update(a.self, DT, cmd)
      b.ai.update(b.self, DT, cmd)
      if (a.ai.burstFiring !== b.ai.burstFiring) differ++
    }
    // 完全同相位時這個數是 0。門檻取一成，只是要排除「碰巧幾乎同步」
    expect(differ / steps).toBeGreaterThan(0.1)
  })

  it('off = 0 等於沒有這一層 —— 消融旋鈕真的關得掉', () => {
    // 【為什麼要釘住這個】`test/tools/targeting-burst.probe.ts` 的第一列
    // 靠它代表「上線前的行為」。若 `off: 0` 其實沒關乾淨，那一列量到的
    // 就不是基準，而整張消融表的結論會建立在一個錯的對照組上。
    const { self, ai } = flying(3)
    ai.burstConfig = { on: 1, off: 0 }
    for (let k = 0; k < Math.round(5 / DT); k++) {
      ai.update(self, DT, cmd)
      expect(ai.burstFiring).toBe(true)
    }
  })

  it('人接手時完全沒有冷卻 —— 扣著扳機就是一直開火', () => {
    // 【這一條守的是「代飛結束要改回來」】機制住在 `AiController` 上，而
    // 玩家那一架在人接手時掛的是 `PlayerController`（`main.ts` 換的是
    // `player.controller` 這個參考）。所以「改回來」不是一段要維護的程式碼，
    // 是**換了一個控制器**的結果 —— 這一條把那個結果釘住。
    const self = new Aircraft(P51D, 4000, 180)
    self.update(new Vector3(0, 0, -1), 0.7, DT)
    const input = createInputState()
    input.firing = true
    const pc = new PlayerController(input)
    const steps = Math.round((AI_BURST.on + AI_BURST.off) * 3 / DT)
    for (let k = 0; k < steps; k++) {
      pc.update(self, DT, cmd)
      expect(cmd.firing).toBe(true)
    }
  })
})
