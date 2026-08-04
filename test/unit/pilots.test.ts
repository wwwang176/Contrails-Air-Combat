import { describe, it, expect } from 'vitest'
import { createRoster, recordKill, swapPilots } from '../../src/battle/pilots'

const NAMES = ['A', 'B', 'C', 'D']

describe('createRoster', () => {
  it('每個座位一位飛行員，戰績歸零、全員存活', () => {
    const r = createRoster(NAMES, 0)
    expect(r.pilots).toHaveLength(4)
    for (const p of r.pilots) {
      expect(p.kills).toBe(0)
      expect(p.deaths).toBe(0)
      expect(p.assists).toBe(0)
      expect(p.alive).toBe(true)
    }
  })

  it('只有一位是玩家，而且在指定的座位', () => {
    const r = createRoster(NAMES, 2)
    expect(r.pilots.filter((p) => p.isPlayer)).toHaveLength(1)
    expect(r.pilots[2]!.isPlayer).toBe(true)
  })

  it('名字依座位順序', () => {
    const r = createRoster(NAMES, 0)
    expect(r.pilots.map((p) => p.name)).toEqual(NAMES)
  })
})

describe('recordKill（M9 spec §4）', () => {
  it('受害者陣亡、兇手加一次擊墜', () => {
    const r = createRoster(NAMES, 0)
    recordKill(r, 3, 1, [])
    expect(r.pilots[3]!.alive).toBe(false)
    expect(r.pilots[3]!.deaths).toBe(1)
    expect(r.pilots[1]!.kills).toBe(1)
  })

  it('兇手是 −1 時沒有人加擊墜', () => {
    const r = createRoster(NAMES, 0)
    recordKill(r, 3, -1, [])
    expect(r.pilots[3]!.alive).toBe(false)
    expect(r.pilots.reduce((s, p) => s + p.kills, 0)).toBe(0)
  })

  it('助攻各加一次', () => {
    const r = createRoster(NAMES, 0)
    recordKill(r, 3, 1, [0, 2])
    expect(r.pilots[0]!.assists).toBe(1)
    expect(r.pilots[2]!.assists).toBe(1)
    expect(r.pilots[1]!.assists).toBe(0)
  })

  it('同一位不會死兩次', () => {
    // 【為什麼要守】擊墜事件在呼叫端沒有排空時會累積。重複處理不該讓
    // 陣亡數與擊墜數失衡 —— 那會直接打破整合測試的守恆律。
    const r = createRoster(NAMES, 0)
    recordKill(r, 3, 1, [0])
    recordKill(r, 3, 1, [0])
    expect(r.pilots[3]!.deaths).toBe(1)
    expect(r.pilots[1]!.kills).toBe(1)
    expect(r.pilots[0]!.assists).toBe(1)
  })
})

describe('swapPilots（M9 spec §7.1）', () => {
  it('名字與戰績一起搬', () => {
    const r = createRoster(NAMES, 0)
    r.pilots[0]!.kills = 3
    r.pilots[0]!.assists = 2
    r.pilots[1]!.kills = 7
    swapPilots(r, 0, 1)
    expect(r.pilots[0]!.name).toBe('B')
    expect(r.pilots[0]!.kills).toBe(7)
    expect(r.pilots[1]!.name).toBe('A')
    expect(r.pilots[1]!.kills).toBe(3)
    expect(r.pilots[1]!.assists).toBe(2)
  })

  it('玩家的標記跟著人走', () => {
    const r = createRoster(NAMES, 0)
    swapPilots(r, 0, 2)
    expect(r.pilots[0]!.isPlayer).toBe(false)
    expect(r.pilots[2]!.isPlayer).toBe(true)
  })

  it('交換自己是空操作', () => {
    const r = createRoster(NAMES, 0)
    swapPilots(r, 1, 1)
    expect(r.pilots[1]!.name).toBe('B')
  })
})
