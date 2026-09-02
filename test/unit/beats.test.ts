import { describe, it, expect } from 'vitest'
import { conditionMet, createBeatStates, type Beat, type BeatCondition } from '../../src/battle/beats'
import { BF109K4 } from '../../src/specs/bf109k4'
import { HEAD_ON } from '../../src/battle/entry'
import type { Team } from '../../src/world/World'
import type { AircraftSpec } from '../../src/specs/types'

/**
 * # 節拍的條件 —— 純函數那一半
 *
 * 戰場上會不會真的發生第二波是**戰場的產物**；這一份守的是條件本身：
 * 時鐘到了就成立、存活數降下來就成立、兜底的時限一定會讓它成立。
 */

/** 一張假的存活表：`counts['red:fighter']` */
function aliveTable(counts: Record<string, number>) {
  return (team: Team, role?: AircraftSpec['role']): number =>
    counts[role === undefined ? team : `${team}:${role}`] ?? 0
}

const NONE = aliveTable({})

describe('節拍的條件', () => {
  it('時鐘：到了那一秒才成立', () => {
    const when: BeatCondition = { kind: 'clock', at: 90 }
    expect(conditionMet(when, 89.9, NONE)).toBe(false)
    expect(conditionMet(when, 90, NONE)).toBe(true)
    expect(conditionMet(when, 200, NONE)).toBe(true)
  })

  it('存活數：降到門檻以下才成立', () => {
    const when: BeatCondition = { kind: 'alive', team: 'red', atMost: 2, byLatest: 999 }
    expect(conditionMet(when, 10, aliveTable({ red: 5 }))).toBe(false)
    expect(conditionMet(when, 10, aliveTable({ red: 3 }))).toBe(false)
    expect(conditionMet(when, 10, aliveTable({ red: 2 }))).toBe(true)
    expect(conditionMet(when, 10, aliveTable({ red: 0 }))).toBe(true)
  })

  it('存活數的選擇器：只數指定角色', () => {
    // 【這一條是盟 M4 的形狀】「打退戰鬥機之後魚雷機才來」，
    // 不是「紅隊剩幾架」—— 轟炸機還活著不該擋住第二波
    const when: BeatCondition = {
      kind: 'alive', team: 'red', role: 'fighter', atMost: 2, byLatest: 999,
    }
    const table = aliveTable({ 'red:fighter': 1, 'red:bomber': 4, red: 5 })
    expect(conditionMet(when, 10, table)).toBe(true)
  })

  it('byLatest 兜底：條件永遠不成立時仍然會成立', () => {
    // 【沒有它那一關就卡死】玩家太慢打不完第一波、或太快繞過去時，
    // 存活數那一條可能永遠不會降下來
    const when: BeatCondition = { kind: 'alive', team: 'red', atMost: 0, byLatest: 120 }
    const many = aliveTable({ red: 20 })
    expect(conditionMet(when, 119.9, many)).toBe(false)
    expect(conditionMet(when, 120, many)).toBe(true)
  })

  it('byLatest 不影響時鐘條件 —— 那一種本來就是時鐘', () => {
    expect(conditionMet({ kind: 'clock', at: 10 }, 5, NONE)).toBe(false)
  })

  it('狀態一開始都是 waiting，而且每個節拍各一格', () => {
    const flight = {
      team: 'red' as const, members: [BF109K4], entry: HEAD_ON.red,
      duty: 'combat' as const, lane: 0, tier: 0,
    }
    const beats: Beat[] = [
      { kind: 'reinforce', when: { kind: 'clock', at: 10 }, warn: 'x', warnLead: 5, flight },
      { kind: 'reinforce', when: { kind: 'clock', at: 20 }, warn: 'y', warnLead: 5, flight },
    ]
    const st = createBeatStates(beats)
    expect(st).toHaveLength(2)
    expect(st.every((s) => s.phase === 'waiting')).toBe(true)
    // 【每一格是自己的物件】共用一個的話第一個節拍觸發會把全部都標成 done
    expect(st[0]).not.toBe(st[1])
  })
})
