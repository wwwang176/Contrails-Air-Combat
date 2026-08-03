import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  aliveCount, createBattle, stepBattle, DEFAULT_BATTLE, type Battle,
} from '../../src/battle/setup'
import { countLocks } from '../../src/ai/target'
import { AI_DECISION_HZ, AiController } from '../../src/ai/AiController'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

const DT = 1 / 240
const SECONDS = 60
/** 一個決策週期是幾個物理步。10 Hz 決策、240 Hz 物理 → 24 */
const STEPS_PER_DECISION = 240 / AI_DECISION_HZ

/**
 * 最大同時鎖定數的上限。
 *
 * 【怎麼來的】20v20 的實測值是 **1** —— 也就是完全均勻（20 個獵人分 20 個
 * 目標）。門檻取 2 留一格餘裕，同時仍然遠低於「全隊撲同一架」（那會是 19）。
 * 這一條要抓的是分攤失效，不是抓正常的擁擠。
 *
 * **實測若本身就 ≥ 8，那是分攤沒在運作的證據，回去查 `crowdPenalty`，
 * 不是提高這個門檻。**
 */
const MAX_LOCKS = 2

/**
 * 60 秒內全隊換目標的次數上限。
 *
 * 【怎麼來的】實測 74 次，取 1.5 倍。上界的意義：遲滯完全失效時，40 架
 * 每個決策節拍都可能換一次 = 40 × 60 × 10 Hz = 24,000 次。111 離那個數字
 * 有兩個數量級，離實測值只有 50%。
 */
const MAX_SWITCHES = 111

/**
 * 活著的 AI 可以抱著一個已退場目標多少步。
 *
 * 【為什麼是兩個決策週期而不是一個】命中判定排在控制器之後（`World.step`
 * 的四段順序），所以目標可能在**同一個物理步、該 AI 剛決策完之後**才死。
 * 最壞情形是「決策時他還活著 → 同步死掉 → 等滿一個週期才重選」，也就是
 * 一個週期的殘餘加上一個完整週期。實測 41 步，界在 48。
 */
const MAX_DEAD_TARGETED_STEPS = STEPS_PER_DECISION * 2

/** 39 架 AI 攤在 24 步裡，平均 1.6 架。實測尖峰 5，門檻取 6。 */
const MAX_DECISIONS_IN_ONE_STEP = 6

/** 玩家位置放一個恆平飛的假駕駛——這是 AI 對 AI 的測試。 */
class Idle implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim)
    out.throttle = 0.7
    out.firing = false
  }
}

interface Observed {
  /** 全程任一抽樣時刻，單一目標被同隊多少架同時鎖定的最大值 */
  maxLocks: number
  /** 全程是否有**存活的**飛機出現在海面之下 */
  wentUnderwater: boolean
  /** 退場的飛機自己的指派槽位沒有歸 −1 的次數 */
  ownSlotDirty: number
  /** 活著的 AI 連續抱著一個已退場目標的最大步數 */
  maxDeadTargetedSteps: number
  /** 全隊換目標的總次數 */
  switches: number
  /** 單一物理步的最大決策架數 */
  maxDecisionsInOneStep: number
  /** 整場重置了幾次 */
  resets: number
}

function observe(): Observed {
  const b: Battle = createBattle(new Idle())
  const cs = b.world.combatants
  const last = new Int32Array(cs.length).fill(-1)
  const deadTargetedRun = new Int32Array(cs.length)
  const o: Observed = {
    maxLocks: 0, wentUnderwater: false, ownSlotDirty: 0, maxDeadTargetedSteps: 0,
    switches: 0, maxDecisionsInOneStep: 0, resets: 0,
  }

  const ais = cs.map((c) => (c.controller instanceof AiController ? c.controller : null))
  const prevDecisions = ais.map((a) => a?.decisionsMade ?? 0)
  let prevCountdown = 0

  for (let i = 0; i < SECONDS / DT; i++) {
    stepBattle(b, DT)
    if (prevCountdown > 0 && b.countdown === 0) o.resets++
    prevCountdown = b.countdown

    let decidedThisStep = 0
    for (let k = 0; k < ais.length; k++) {
      const now = ais[k]?.decisionsMade ?? 0
      if (now > prevDecisions[k]!) decidedThisStep++
      prevDecisions[k] = now
    }
    if (decidedThisStep > o.maxDecisionsInOneStep) o.maxDecisionsInOneStep = decidedThisStep

    for (const c of cs) {
      if (c.alive && c.aircraft.state.position.y < 0) o.wentUnderwater = true

      const a = b.board.assignments[c.index]!
      if (a !== last[c.index]!) {
        if (last[c.index]! >= 0 && a >= 0) o.switches++
        last[c.index] = a
      }
      if (!c.alive && a >= 0) o.ownSlotDirty++

      // 活著的 AI 鎖定一架已退場的飛機，連續幾步
      if (c.alive && a >= 0 && !cs[a]!.alive) {
        deadTargetedRun[c.index]!++
        if (deadTargetedRun[c.index]! > o.maxDeadTargetedSteps) {
          o.maxDeadTargetedSteps = deadTargetedRun[c.index]!
        }
      } else {
        deadTargetedRun[c.index] = 0
      }
    }

    // 最大同時鎖定數。每 0.5 s 抽樣一次——逐步算是 40 × 40 × 14,400 次掃描
    if (i % 120 === 0) {
      for (const target of cs) {
        if (!target.alive) continue
        const hunters = target.team === 'blue' ? 'red' : 'blue'
        const n = countLocks(b.board, hunters, -1, target.index)
        if (n > o.maxLocks) o.maxLocks = n
      }
    }
  }
  return o
}

describe('20v20 跑滿 60 秒', () => {
  const o = observe()

  it('沒有任何一架被超過 MAX_LOCKS 架同時鎖定（M5 spec §3.1 條件 3）', () => {
    expect(o.maxLocks).toBeLessThanOrEqual(MAX_LOCKS)
  })

  it('分攤真的有在起作用——不是因為沒人選目標', () => {
    expect(o.maxLocks).toBeGreaterThan(0)
  })

  it('沒有存活的飛機在海面之下（M5 spec §3.1 條件 4）', () => {
    expect(o.wentUnderwater).toBe(false)
  })

  it('退場的飛機自己的指派槽位一定歸 −1（M5 spec §7）', () => {
    // 【這一條抓過一個真缺陷】World.step 跳過退場者的控制器，所以
    // selectTarget 永遠沒機會替它清槽位。第一次量到 87,740 次。
    expect(o.ownSlotDirty).toBe(0)
  })

  it('退場的目標在兩個決策週期內被放掉（M5 spec §3.1 條件 5、6）', () => {
    expect(o.maxDeadTargetedSteps).toBeLessThanOrEqual(MAX_DEAD_TARGETED_STEPS)
  })

  it('換目標次數在遲滯的上限之內（M5 spec §3.1 條件 10）', () => {
    expect(o.switches).toBeLessThan(MAX_SWITCHES)
  })

  it('決策相位真的攤開了（M5 spec §6.4）', () => {
    expect(o.maxDecisionsInOneStep).toBeLessThanOrEqual(MAX_DECISIONS_IN_ONE_STEP)
  })

  it('戰鬥真的打起來了，而且一方全滅會重置（M5 spec §3.1 條件 9）', () => {
    expect(o.resets).toBeGreaterThan(0)
  })
})

describe('全滅重置（M5 spec §3.1 條件 9）', () => {
  it('人為打光紅隊後，resetCountdown 內回到滿編', () => {
    const b = createBattle(new Idle())
    for (const c of b.red) b.world.destroy(c)
    const steps = Math.ceil(b.cfg.resetCountdown / DT) + 4
    for (let i = 0; i < steps; i++) stepBattle(b, DT)
    expect(aliveCount(b.red)).toBe(DEFAULT_BATTLE.perSide)
    expect(aliveCount(b.blue)).toBe(DEFAULT_BATTLE.perSide)
  })
})
