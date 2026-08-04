import { describe, it, expect } from 'vitest'
import { MISSIONS } from '../../src/ui/missions'

describe('任務卡（M10 spec §10）', () => {
  it('兩個陣營各五張', () => {
    expect(MISSIONS.allies).toHaveLength(5)
    expect(MISSIONS.axis).toHaveLength(5)
  })

  it('難度落在 1~5', () => {
    for (const list of [MISSIONS.allies, MISSIONS.axis]) {
      for (const m of list) {
        expect(m.difficulty).toBeGreaterThanOrEqual(1)
        expect(m.difficulty).toBeLessThanOrEqual(5)
        expect(Number.isInteger(m.difficulty)).toBe(true)
      }
    }
  })

  it('全部標題不重複', () => {
    const all = [...MISSIONS.allies, ...MISSIONS.axis].map((m) => m.title)
    expect(new Set(all).size).toBe(all.length)
  })

  it('五種任務類型各出現一次', () => {
    for (const list of [MISSIONS.allies, MISSIONS.axis]) {
      expect(new Set(list.map((m) => m.type)).size).toBe(5)
    }
  })

  it('每一張都有一行說明', () => {
    for (const m of [...MISSIONS.allies, ...MISSIONS.axis]) {
      expect(m.summary.length).toBeGreaterThan(0)
    }
  })
})
