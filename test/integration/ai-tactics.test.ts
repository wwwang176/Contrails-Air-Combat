import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, resetBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { PlayerController } from '../../src/control/PlayerController'
import { createInputState } from '../../src/input/InputState'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_TACTICS } from '../../src/ai/tactics'
import type { TacticalPhase } from '../../src/ai/tactics'

const DT = 1 / 240
const SECONDS = 150
const SEED = 20260805

function battle(quota: number) {
  const card = MISSIONS.allies.find((c) => c.id === 'allies-intercept')!
  const b = createBattle(
    new PlayerController(createInputState()), missionConfigFrom(card, 'allies'), SEED,
  )
  for (const c of b.world.combatants) {
    if (c.controller instanceof AiController) {
      c.controller.tacticalConfig = { ...DEFAULT_TACTICS, quota }
    }
  }
  return b
}

describe('戰術層的整合行為', () => {
  it('至少有一架完成過一整圈 build → perch → dive → zoom → build', () => {
    // 【這是這份 spec 的主判準】先證明循環跑得起來，才值得談勝率。
    const b = battle(1)
    const seen = new Map<number, TacticalPhase[]>()
    for (let k = 0; k < Math.round(SECONDS / DT); k++) {
      stepBattle(b, DT)
      for (const c of b.world.combatants) {
        const ai = c.controller
        if (!(ai instanceof AiController) || !c.alive) continue
        let seq = seen.get(c.index)
        if (seq === undefined) { seq = []; seen.set(c.index, seq) }
        const p = ai.tactics.phase
        if (seq[seq.length - 1] !== p) seq.push(p)
      }
    }
    const WANT: TacticalPhase[] = ['build', 'perch', 'dive', 'zoom', 'build']
    let completed = 0
    for (const seq of seen.values()) {
      for (let i = 0; i + WANT.length <= seq.length; i++) {
        let ok = true
        for (let j = 0; j < WANT.length; j++) {
          if (seq[i + j] !== WANT[j]) { ok = false; break }
        }
        if (ok) { completed++; break }
      }
    }
    expect(completed).toBeGreaterThan(0)
  }, 300_000)

  it('護航機的交戰佔時上升', () => {
    // 改動前：攔截卡的 Bf 109 只有 2.2% 在 engage，而同一批 AI 在掃蕩卡
    // 是 28.3%。
    function engageShare(quota: number): number {
      const b = battle(quota)
      let engaged = 0
      let alive = 0
      for (let k = 0; k < Math.round(SECONDS / DT); k++) {
        stepBattle(b, DT)
        for (const c of b.world.combatants) {
          const ai = c.controller
          if (!(ai instanceof AiController) || !c.alive) continue
          if (c.team !== 'red' || c.aircraft.spec.role !== 'fighter') continue
          alive += DT
          if (ai.intent === 'engage') engaged += DT
        }
      }
      return alive > 0 ? engaged / alive : 0
    }
    expect(engageShare(1)).toBeGreaterThan(engageShare(0))
  }, 300_000)

  it('rematch 之後戰術狀態是乾淨的', () => {
    const b = battle(1)
    // 【要問「曾經離開過」，不是「此刻在不在」】`off` 的佔時約九成，取一個
    // 瞬間看「有沒有人不在 off」是在賭機率 —— 17 架同時都在 off 的機率約
    // 兩成，任何無關的軌跡擾動都會讓這條隨機紅。
    let busy = false
    for (let k = 0; k < Math.round(60 / DT); k++) {
      stepBattle(b, DT)
      if (busy) continue
      busy = b.world.combatants.some((c) =>
        c.controller instanceof AiController && c.controller.tactics.phase !== 'off')
    }
    // 先確認機制真的動過 —— 否則這一條會在機制沒接上時也是綠的
    expect(busy).toBe(true)

    resetBattle(b, SEED)
    for (const c of b.world.combatants) {
      if (c.controller instanceof AiController) {
        expect(c.controller.tactics.phase).toBe('off')
        expect(c.controller.tactics.dwell).toBe(0)
        expect(c.controller.tactics.dryRounds).toBe(0)
      }
    }
  }, 300_000)
})
