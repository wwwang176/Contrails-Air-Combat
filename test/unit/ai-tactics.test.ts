import { describe, it, expect } from 'vitest'
import {
  createTacticalState, resetTacticalState, teamIndexOf, hasSlot, DEFAULT_TACTICS,
} from '../../src/ai/tactics'
import { createTargetBoard } from '../../src/ai/target'
import type { TargetCandidate } from '../../src/ai/target'
import type { Team } from '../../src/world/World'

/**
 * 造一組只有 `index` / `team` / `alive` 有意義的候選。
 *
 * 【為什麼可以這樣造】名額只讀那三個欄位。給一台真的 `Aircraft` 會讓這幾條
 * 測試同時依賴飛行模型 —— 那不是它們在問的事。
 */
function board(blue: number, red: number) {
  const cs: TargetCandidate[] = []
  for (let i = 0; i < blue + red; i++) {
    cs.push({
      index: i,
      team: (i < blue ? 'blue' : 'red') as Team,
      alive: true,
    } as unknown as TargetCandidate)
  }
  return createTargetBoard(cs)
}

describe('戰術層的名額', () => {
  it('隊內序號是「我是我方第幾架」', () => {
    const b = board(4, 4)
    expect(teamIndexOf(b, 0)).toBe(0)
    expect(teamIndexOf(b, 3)).toBe(3)
    // 紅隊的第一架全域索引是 4，隊內序號回到 0
    expect(teamIndexOf(b, 4)).toBe(0)
    expect(teamIndexOf(b, 7)).toBe(3)
  })

  it('索引越界回 −1', () => {
    const b = board(2, 2)
    expect(teamIndexOf(b, -1)).toBe(-1)
    expect(teamIndexOf(b, 4)).toBe(-1)
  })

  it('兩隊拿到相同的名額數 —— 這是隊內序號存在的唯一理由', () => {
    // 【為什麼不能用全域 selfIndex】編組表是一隊一個連續區塊，低差異序列在
    // 兩個區塊上會取到不同的比例。實算 quota = 0.5：6v6 是藍 4 紅 2（33%
    // 的偏差）、14v14 是藍 8 紅 6、20v20 是藍 10 紅 11。那會直接變成平衡
    // 偏差，而且沒有任何測試會紅。
    for (const n of [3, 4, 6, 7, 10, 14, 16, 20]) {
      const b = board(n, n)
      let blue = 0
      let red = 0
      for (let i = 0; i < n; i++) if (hasSlot(teamIndexOf(b, i), 0.5)) blue++
      for (let i = n; i < 2 * n; i++) if (hasSlot(teamIndexOf(b, i), 0.5)) red++
      expect(blue).toBe(red)
    }
  })

  it('quota = 0 一律沒有名額，quota = 1 一律有', () => {
    for (let k = 0; k < 40; k++) {
      expect(hasSlot(k, 0)).toBe(false)
      expect(hasSlot(k, 1)).toBe(true)
    }
  })

  it('隊內序號為負時沒有名額 —— 負數取模的陷阱', () => {
    // 【為什麼要專門釘住】JavaScript 的 (−1 × 0.618) % 1 = −0.618，而
    // −0.618 < 0.5 為真。沒有接指派板的單元測試會意外啟用戰術層。
    expect(hasSlot(-1, 0.5)).toBe(false)
    expect(hasSlot(-1, 0.999)).toBe(false)
    expect(hasSlot(-7, 0.5)).toBe(false)
  })

  it('名額的比例大致等於 quota', () => {
    for (const q of [0.25, 0.5, 0.75]) {
      let n = 0
      for (let k = 0; k < 400; k++) if (hasSlot(k, q)) n++
      expect(Math.abs(n / 400 - q)).toBeLessThan(0.02)
    }
  })

  it('同一個序號的答案不隨呼叫改變 —— 逐位元重播的前提', () => {
    for (let k = 0; k < 20; k++) {
      const first = hasSlot(k, 0.5)
      for (let n = 0; n < 5; n++) expect(hasSlot(k, 0.5)).toBe(first)
    }
  })
})

describe('戰術狀態的建立與重置', () => {
  it('createTacticalState 起始是 off', () => {
    const s = createTacticalState()
    expect(s.phase).toBe('off')
    expect(s.dwell).toBe(0)
    expect(s.perchLatch).toBe(false)
    expect(s.lastTarget).toBe(-2)
    expect(Number.isNaN(s.lastCooldownRatio)).toBe(true)
  })

  it('resetTacticalState 回到與新建完全相同的形狀', () => {
    // 【為什麼要逐欄比而不是只看 phase】漏掉任何一欄的症狀是「第二場的第一
    // 秒有幾架飛機從別人的 perch 中途開始」，而那不會讓任何測試變紅。
    const s = createTacticalState()
    s.phase = 'perch'
    s.dwell = 12
    s.perchLatch = true
    s.farLatch = true
    s.commit = 3
    s.closed = true
    s.passing = 2
    s.cooldown = 9
    s.cycleBase = 0.7
    s.cycleValid = true
    s.cycleShot = true
    s.dryRounds = 3
    s.lastCooldownRatio = 0.4
    s.lastTarget = 17
    resetTacticalState(s)
    // NaN !== NaN，所以逐欄比之前先把那一欄挑出來單獨驗
    expect(Number.isNaN(s.lastCooldownRatio)).toBe(true)
    s.lastCooldownRatio = 0
    const fresh = createTacticalState()
    fresh.lastCooldownRatio = 0
    expect(s).toEqual(fresh)
  })
})

describe('起始設定的內部一致性', () => {
  const c = DEFAULT_TACTICS

  it('遲滯的方向對：離開門檻比進入門檻鬆', () => {
    expect(c.perchExit).toBeLessThan(c.perchEnter)
    expect(c.exitRange).toBeLessThan(c.enterRange)
  })

  it('等待不該比建能久', () => {
    expect(c.perchMax).toBeLessThan(c.buildMax)
  })

  it('盤旋半徑落在兩個距離門檻之間', () => {
    expect(c.perchRange).toBeGreaterThan(c.exitRange)
    expect(c.perchRange).toBeLessThan(c.enterRange)
  })

  it('長冷卻比一般冷卻長，zoom 的下限比上限短', () => {
    expect(c.cooldownSeconds).toBeLessThan(c.longCooldownSeconds)
    expect(c.zoomMin).toBeLessThan(c.zoomMax)
  })

  it('開發期間預設是關掉的', () => {
    // 【為什麼】戰術層一開就會改變 order-of-battle-replay 的 digest，而那個
    // 基準每重跑一次都要專案負責人裁定。出 0 的話整個開發期間那條測試都是
    // 綠的，所有參數定案後才翻開，只需要重跑一次。
    expect(c.quota).toBe(0)
  })
})
