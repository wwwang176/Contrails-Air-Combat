import { describe, it, expect, beforeAll } from 'vitest'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, uniform } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import type { Combatant } from '../../src/world/World'

/**
 * 紅線：F4F 對 A6M。
 *
 * ── 【每一條都釘一個機制，門檻由「關掉它」的量測定】──────────
 *
 *   俯衝目標關掉（diveTargetRatio = 10）：F4F 規則 3 期間 IAS/vne 最高 0.54
 *   俯衝目標開著：                                              0.80
 *   守線關掉（overspeedRatio = 2）：A6M IAS/vne 最高 1.21
 *   守線開著：                                    1.00
 *
 * 門檻取兩者中間，關掉就紅、開著就綠。
 *
 * 【為什麼不量存活數】同一場改一個小地方存活數在 0～14 之間亂跳，那是混沌
 * 不是訊號。存活與手感交給試飛。
 */
const DT = 1 / 240
const SECONDS = 300
const SEED = 20260907

interface Redline {
  /** F4F 在規則 3 脫離期間的 IAS/vne 最高值（所有 F4F、所有格） */
  f4fDiveRatio: number
  /** A6M 活著時的 IAS/vne 最高值 */
  a6mRatio: number
  /** A6M 非戰損陣亡數：hp 還有卻死了、或死在海面 */
  a6mCrashes: number
}

function measure(): Redline {
  const b = createBattle(
    new AiController(), battleConfigFrom(uniform('f4f4', 20, 'a6m5', 20)), SEED,
  )
  const cs: Combatant[] = b.world.combatants
  const blue = cs.filter((c) => c.team === 'blue')
  const red = cs.filter((c) => c.team === 'red')
  const ias = (c: Combatant): number => c.aircraft.diag.aero.tas * Math.sqrt(c.aircraft.diag.air.sigma)
  const wasAlive = red.map(() => true)
  let f4fDiveRatio = 0
  let a6mRatio = 0
  let a6mCrashes = 0
  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    for (const c of blue) {
      if (!c.alive) continue
      const ai = c.controller as AiController
      if (ai.rules.trackExtend > 0 && ai.intent === 'extend') {
        const r = ias(c) / c.aircraft.spec.limits.vne
        if (r > f4fDiveRatio) f4fDiveRatio = r
      }
    }
    for (let i = 0; i < red.length; i++) {
      const c = red[i]!
      if (!c.alive) {
        if (wasAlive[i]) {
          wasAlive[i] = false
          if (c.hp > 0 || c.aircraft.state.position.y < 10) a6mCrashes++
        }
        continue
      }
      const r = ias(c) / c.aircraft.spec.limits.vne
      if (r > a6mRatio) a6mRatio = r
    }
  }
  return { f4fDiveRatio, a6mRatio, a6mCrashes }
}

describe('紅線：F4F 對 A6M', () => {
  let s: Redline
  beforeAll(() => { s = measure() }, 900_000)

  it('F4F 規則 3 的俯衝真的在換速度 —— 過了零戰放手的速度', () => {
    // 0.67 × 700 km/h = 469，剛好是 A6M5 的 0.9 vne（471）。關掉俯衝目標只到 0.54
    expect(s.f4fDiveRatio, 'F4F 規則 3 期間 IAS/vne 最高').toBeGreaterThan(0.67)
  })

  /**
   * ── 【停用：這一場守線根本沒觸發，開關對照量不到東西】──────────
   *
   * 這一場（seed 20260907、20v20）實測，開局速度是 IAS 夾 0.8 vne、守線是
   * 怠速加減速板那一版：
   *
   *   守線開著  A6M IAS/vne 最高 0.896
   *   守線關掉                    0.896
   *
   * 兩組逐位元相同 —— A6M 整場沒有碰到 `overspeedRatio` 的 0.9，守線一次
   * 都沒介入，「關掉它」自然什麼都不改變。門檻 1.10 在這一場是空過。量法在
   * `test/tools/redline-onoff.probe.ts`。
   *
   * 【重啟條件】換一組開局讓 A6M 真的追下去（開關對照回到分得開的差距，
   * 例如 1.00 對 1.21）之後，照「取中間」重定門檻、拿掉 `.skip`。
   *
   * 【它不在的期間誰在守】上面「F4F 俯衝真的在換速度」與下面「A6M 沒有
   * 撞海」仍然生效；守線本身的單元行為由 `test/unit/ai-safety.test.ts` 守。
   */
  it.skip('A6M 追下來會守線 —— 沒有守線會衝到 1.21', () => {
    expect(s.a6mRatio, 'A6M IAS/vne 最高').toBeLessThan(1.10)
  })

  it('A6M 沒有撞海', () => {
    expect(s.a6mCrashes).toBe(0)
  })
})
