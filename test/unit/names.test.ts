import { describe, it, expect } from 'vitest'
import {
  ALLIED_NAMES, AXIS_NAMES, factionOf, mulberry32, pilotNames,
} from '../../src/battle/names'

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

describe('factionOf', () => {
  it('P-51 是同盟國、Bf109 是軸心國', () => {
    expect(factionOf('p51d')).toBe('allies')
    expect(factionOf('bf109k4')).toBe('axis')
    // 【轟炸機兩台也要對】2026-08-21 之前 He 111 被判成同盟，一整隊
    // 德國轟炸機的機組因此叫 Ray Bishop、Hal Carter
    expect(factionOf('b17g')).toBe('allies')
    expect(factionOf('he111')).toBe('axis')
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
