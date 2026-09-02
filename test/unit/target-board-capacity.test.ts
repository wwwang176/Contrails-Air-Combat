import { describe, it, expect } from 'vitest'
import { createTargetBoard, type TargetCandidate } from '../../src/ai/target'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import type { Team } from '../../src/world/World'

/**
 * # 指派板的容量 —— 中途加入的目標選擇那一半
 *
 * `candidates` 收的就是 `world.combatants` **那一個活陣列**，所以它自己會
 * 跟著長。跟不上的是另外三個 typed array（`assignments`、`priority`、
 * `protectedMask`）。
 *
 * 它們**不重配**：戰鬥中換掉參考的話，`readonly` 這道護欄就沒了，而且持有
 * 舊參考的呼叫端會靜靜地寫到一個沒有人在讀的陣列上。改成建構期就照最終
 * 架數配。
 */

function candidate(index: number, team: Team): TargetCandidate {
  return { index, aircraft: new Aircraft(P51D, 4000, 200), team, alive: true }
}

function fleet(n: number): TargetCandidate[] {
  const out: TargetCandidate[] = []
  for (let i = 0; i < n; i++) out.push(candidate(i, i % 2 === 0 ? 'blue' : 'red'))
  return out
}

describe('指派板的容量', () => {
  it('capacity 大於候選數時，三個 typed array 照 capacity 配', () => {
    const b = createTargetBoard(fleet(8), undefined, undefined, undefined, 12)
    expect(b.assignments.length).toBe(12)
    expect(b.priority.length).toBe(12)
    expect(b.protectedMask.length).toBe(12)
  })

  it('預留出來的格子是中性值 —— 指派 −1、倍率 1、不是被保護單位', () => {
    const b = createTargetBoard(fleet(8), undefined, undefined, undefined, 12)
    for (let i = 8; i < 12; i++) {
      expect(b.assignments[i]).toBe(-1)
      expect(b.priority[i]).toBe(1)
      expect(b.protectedMask[i]).toBe(0)
    }
  })

  it('省略 capacity 時逐字回到改動前', () => {
    const b = createTargetBoard(fleet(8))
    expect(b.assignments.length).toBe(8)
    expect(b.priority.length).toBe(8)
    expect(b.protectedMask.length).toBe(8)
  })

  it('傳進來的 priority 與 protectedMask 長度要對的是 capacity', () => {
    const all = fleet(8)
    const priority = new Float64Array(12).fill(1)
    const mask = new Uint8Array(12)
    expect(() => createTargetBoard(all, undefined, priority, mask, 12)).not.toThrow()
    // 照候選數配的長度在有 capacity 時是錯的
    expect(() => createTargetBoard(
      all, undefined, new Float64Array(8).fill(1), mask, 12)).toThrow()
  })

  it('capacity 小於候選數是錯的', () => {
    expect(() => createTargetBoard(fleet(8), undefined, undefined, undefined, 4)).toThrow()
  })

  it('候選陣列長大之後，三個陣列的參考不變', () => {
    // 【這一條守的是「不重配」】`candidates` 是活陣列，會自己長；另外三個
    // 是建構期配好的，任何情況下都不該被換掉
    const all = fleet(8)
    const b = createTargetBoard(all, undefined, undefined, undefined, 12)
    const assignments = b.assignments
    const priority = b.priority
    const mask = b.protectedMask
    all.push(candidate(8, 'red'))
    expect(b.candidates).toHaveLength(9)
    expect(b.assignments).toBe(assignments)
    expect(b.priority).toBe(priority)
    expect(b.protectedMask).toBe(mask)
  })
})
