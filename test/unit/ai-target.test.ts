import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import {
  countLocks, createTargetBoard, targetScore, DEFAULT_TARGET, type TargetCandidate,
} from '../../src/ai/target'
import type { Team } from '../../src/world/World'
import { P51D } from '../../src/specs/p51d'

const UP = new Vector3(0, 1, 0)

/** 把飛機擺在 (x, y, z)，機首繞 Y 軸轉 yaw 弧度（0 = 朝 −Z）。 */
function place(x: number, y: number, z: number, yaw: number): Aircraft {
  const a = new Aircraft(P51D, 4000, 200)
  a.state.position.set(x, y, z)
  a.state.orientation.copy(new Quaternion().setFromAxisAngle(UP, yaw))
  return a
}

describe('targetScore 的機會項', () => {
  it('我在他正後方時最高（他背對我）', () => {
    // 我在 z = 0，他在 z = −300 且機首朝 −Z（背對我）
    const me = place(0, 4000, 0, 0)
    const tail = place(0, 4000, -300, 0)
    // 同距離、他機首朝 +Z（正對我）
    const nose = place(0, 4000, -300, Math.PI)
    const cfg = { ...DEFAULT_TARGET, opportunityWeight: 1, threatWeight: 0 }
    expect(targetScore(me, tail, 0, cfg)).toBeGreaterThan(targetScore(me, nose, 0, cfg))
  })

  it('側面時歸零（不是負的）', () => {
    const me = place(0, 4000, 0, 0)
    const beam = place(0, 4000, -300, Math.PI / 2)
    const cfg = { ...DEFAULT_TARGET, opportunityWeight: 1, threatWeight: 0 }
    expect(targetScore(me, beam, 0, cfg)).toBeCloseTo(0, 9)
  })
})

describe('targetScore 的威脅項', () => {
  it('他機首正對我時最高', () => {
    const me = place(0, 4000, 0, 0)
    const nose = place(0, 4000, -300, Math.PI)
    const tail = place(0, 4000, -300, 0)
    const cfg = { ...DEFAULT_TARGET, opportunityWeight: 0, threatWeight: 1 }
    expect(targetScore(me, nose, 0, cfg)).toBeGreaterThan(targetScore(me, tail, 0, cfg))
  })

  it('機會與威脅是兩個獨立的權重，不會退化成一個', () => {
    // 若用 0.5(1±b)，兩者相加恆為 1，score 只剩 (ow−tw) 一個自由度。
    // 取正部之後：純尾追時威脅權重完全不影響分數。
    const me = place(0, 4000, 0, 0)
    const tail = place(0, 4000, -300, 0)
    const a = targetScore(me, tail, 0, { ...DEFAULT_TARGET, opportunityWeight: 1, threatWeight: 0 })
    const b = targetScore(me, tail, 0, { ...DEFAULT_TARGET, opportunityWeight: 1, threatWeight: 5 })
    expect(b).toBeCloseTo(a, 9)
  })
})

describe('targetScore 的折扣項', () => {
  it('距離越遠分數越低', () => {
    const me = place(0, 4000, 0, 0)
    const near = place(0, 4000, -200, 0)
    const far = place(0, 4000, -2000, 0)
    expect(targetScore(me, near, 0, DEFAULT_TARGET))
      .toBeGreaterThan(targetScore(me, far, 0, DEFAULT_TARGET))
  })

  it('rangeScale 處恰好打對折', () => {
    const cfg = { ...DEFAULT_TARGET, rangeScale: 500, crowdPenalty: 0 }
    const me = place(0, 4000, 0, 0)
    const at0 = place(0, 4000, -1e-6, 0)
    const at500 = place(0, 4000, -500, 0)
    expect(targetScore(me, at500, 0, cfg) / targetScore(me, at0, 0, cfg)).toBeCloseTo(0.5, 4)
  })

  it('鎖定的人越多分數越低', () => {
    const me = place(0, 4000, 0, 0)
    const t = place(0, 4000, -300, 0)
    const s0 = targetScore(me, t, 0, DEFAULT_TARGET)
    const s1 = targetScore(me, t, 1, DEFAULT_TARGET)
    const s3 = targetScore(me, t, 3, DEFAULT_TARGET)
    expect(s1).toBeLessThan(s0)
    expect(s3).toBeLessThan(s1)
  })

  it('分數恆非負——乘法遲滯的前提', () => {
    const me = place(0, 4000, 0, 0)
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.3) {
      for (const locks of [0, 1, 5, 40]) {
        const t = place(300, 4000, -300, yaw)
        expect(targetScore(me, t, locks, DEFAULT_TARGET)).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('targetScore 的退化處理', () => {
  it('兩機重疊時不產生 NaN', () => {
    const me = place(0, 4000, 0, 0)
    const same = place(0, 4000, 0, 0)
    expect(Number.isFinite(targetScore(me, same, 0, DEFAULT_TARGET))).toBe(true)
  })
})

/** 造一組候選：teams 決定陣營，索引即為陣列位置。 */
function candidates(teams: readonly Team[]): TargetCandidate[] {
  return teams.map((team, index) => ({
    index, team, alive: true, aircraft: place(index * 50, 4000, 0, 0),
  }))
}

describe('createTargetBoard', () => {
  it('assignments 長度等於候選數，初值全為 −1', () => {
    const b = createTargetBoard(candidates(['blue', 'blue', 'red']))
    expect(b.assignments).toHaveLength(3)
    expect(Array.from(b.assignments)).toEqual([-1, -1, -1])
  })

  it('index 與陣列位置不符時直接拋錯', () => {
    const cs = candidates(['blue', 'red'])
    const broken = [cs[0]!, { ...cs[1]!, index: 7 }]
    expect(() => createTargetBoard(broken)).toThrow()
  })
})

describe('countLocks', () => {
  it('只數同隊的', () => {
    // 0、1 藍，2、3 紅。全部都鎖定候選 2
    const cs = candidates(['blue', 'blue', 'red', 'red'])
    const b = createTargetBoard(cs)
    b.assignments.set([2, 2, 2, 2])
    // 站在 0（藍）的角度：同隊的只有 1
    expect(countLocks(b, 'blue', 0, 2)).toBe(1)
  })

  it('不數自己', () => {
    const cs = candidates(['blue', 'blue', 'red'])
    const b = createTargetBoard(cs)
    b.assignments.set([2, -1, -1])
    expect(countLocks(b, 'blue', 0, 2)).toBe(0)
  })

  it('不數已退場的', () => {
    const cs = candidates(['blue', 'blue', 'blue', 'red'])
    const b = createTargetBoard(cs)
    b.assignments.set([3, 3, 3, -1])
    cs[1]!.alive = false
    expect(countLocks(b, 'blue', 0, 3)).toBe(1)
  })

  it('沒有人鎖定時回傳 0', () => {
    const cs = candidates(['blue', 'red'])
    const b = createTargetBoard(cs)
    expect(countLocks(b, 'blue', 0, 1)).toBe(0)
  })
})
