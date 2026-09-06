import { describe, it, expect } from 'vitest'
import {
  ALLIED_NAMES, AXIS_NAMES, JAPAN_NAMES, mulberry32, pilotNames,
} from '../../src/battle/names'
import { ALL_SPECS } from '../../src/battle/skirmish'

describe('mulberry32', () => {
  it('同種子同序列', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    for (let i = 0; i < 20; i++) expect(a()).toBe(b())
  })

  it('不同種子不同序列', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    let same = 0
    for (let i = 0; i < 20; i++) if (a() === b()) same++
    expect(same).toBe(0)
  })

  it('值域是 [0, 1)', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 500; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('機種的陣營（決定名冊）', () => {
  it('每一台在編的機種都拿到對的那一本名冊', () => {
    // 【這一條取代了舊的 `factionOf` id 白名單】2026-08-21 之前 He 111 被判
    // 成同盟，一整隊德國轟炸機的機組因此叫 Ray Bishop、Hal Carter。陣營現在
    // 是 `AircraftSpec` 的必填欄位，漏填是編譯錯誤 —— 這一條守的是「填對了」
    const want: Record<string, string> = {
      p51d: 'allies', b17g: 'allies', f6f5: 'allies', f4f4: 'allies',
      bf109k4: 'axis', he111: 'axis',
      ki84: 'japan', a6m5: 'japan', g4m: 'japan',
    }
    for (const spec of ALL_SPECS) {
      expect(spec.faction, spec.id).toBe(want[spec.id])
      // 抽出來的名字真的來自那一本
      const pool = spec.faction === 'axis' ? AXIS_NAMES
        : spec.faction === 'japan' ? JAPAN_NAMES : ALLIED_NAMES
      for (const n of pilotNames(7, spec.faction, 4)) expect(pool, spec.id).toContain(n)
    }
    // 【對照組】少了它，`want` 漏列一台時上面那一圈會拿 undefined 比 undefined
    expect(Object.keys(want)).toHaveLength(ALL_SPECS.length)
  })

  it('三本名冊各 24 個，而且彼此不重疊', () => {
    // 【為什麼要驗不重疊】同一場只用一本，但「Hans Richter 也在日本名冊裡」
    // 這種事會讓上面那條的來源檢查失去意義
    for (const pool of [ALLIED_NAMES, AXIS_NAMES, JAPAN_NAMES]) {
      expect(pool).toHaveLength(24)
      expect(new Set(pool).size).toBe(24)
    }
    const all = [...ALLIED_NAMES, ...AXIS_NAMES, ...JAPAN_NAMES]
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('pilotNames（M9 spec §6.1）', () => {
  it('同種子同結果 —— 一場內名字不會變', () => {
    expect(pilotNames(999, 'allies', 20)).toEqual(pilotNames(999, 'allies', 20))
  })

  it('不同種子換一批名字', () => {
    const a = pilotNames(1, 'allies', 20)
    const b = pilotNames(2, 'allies', 20)
    expect(a).not.toEqual(b)
  })

  it('一場內不重複', () => {
    const names = pilotNames(42, 'axis', 20)
    expect(new Set(names).size).toBe(20)
  })

  it('名字來自該陣營的名冊', () => {
    for (const n of pilotNames(5, 'allies', 20)) expect(ALLIED_NAMES).toContain(n)
    for (const n of pilotNames(5, 'axis', 20)) expect(AXIS_NAMES).toContain(n)
  })

  it('兩個陣營的名冊沒有交集', () => {
    for (const n of ALLIED_NAMES) expect(AXIS_NAMES).not.toContain(n)
  })

  it('名冊要夠大 —— 每隊上限 20', () => {
    // 【為什麼要守這一條】名冊小於隊伍上限時 pilotNames 會開始加羅馬數字，
    // 那是一個沒有人想看到的降級。上限是 M10 的每隊 20。
    expect(ALLIED_NAMES.length).toBeGreaterThanOrEqual(20)
    expect(AXIS_NAMES.length).toBeGreaterThanOrEqual(20)
  })

  it('超出名冊時加羅馬數字，不會無聲重複', () => {
    const names = pilotNames(3, 'allies', ALLIED_NAMES.length + 2)
    expect(new Set(names).size).toBe(names.length)
  })

  it('count 為 0 時回傳空陣列', () => {
    expect(pilotNames(3, 'allies', 0)).toEqual([])
  })
})
