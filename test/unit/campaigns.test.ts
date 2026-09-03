import { describe, it, expect } from 'vitest'
import { MISSIONS, CAMPAIGNS, missionConfigFrom } from '../../src/battle/missions'
import { ALL_SPECS } from '../../src/battle/skirmish'
import type { MissionCard, ReadyMissionCard } from '../../src/battle/missions'

/**
 * # 三條戰役與 12 張卡
 *
 * 卡片拆成兩層：**目錄**（選單畫得出來就靠它）與**戰鬥設定**（`battle`）。
 * `battle === null` 就是「還沒做」——那取代了原本的 `playable` 旗標，
 * 而且把「資料要嘛完整、要嘛全空」從一條測試變成型別保證。
 */

const ALL: readonly MissionCard[] = CAMPAIGNS.flatMap((c) => MISSIONS[c])

const ready = (m: MissionCard): m is ReadyMissionCard => m.battle !== null

describe('三條戰役', () => {
  it('三條線各 4 關', () => {
    expect(CAMPAIGNS).toEqual(['allies', 'germany', 'japan'])
    for (const c of CAMPAIGNS) expect(MISSIONS[c], c).toHaveLength(4)
  })

  it('12 個 id 唯一，而且前綴就是戰役', () => {
    expect(new Set(ALL.map((m) => m.id)).size).toBe(12)
    for (const c of CAMPAIGNS) {
      for (const m of MISSIONS[c]) expect(m.id.startsWith(`${c}-`), m.id).toBe(true)
    }
  })

  it('全部標題不重複，而且每一張都有一行說明', () => {
    expect(new Set(ALL.map((m) => m.title)).size).toBe(12)
    for (const m of ALL) expect(m.summary.length, m.id).toBeGreaterThan(0)
  })

  it('五張打得起來，七張是目錄卡', () => {
    const playable = ALL.filter(ready)
    expect(playable.map((m) => m.id).sort()).toEqual([
      'allies-m1', 'germany-m1', 'germany-m4', 'japan-m1', 'japan-m3',
    ])
    expect(ALL.length - playable.length).toBe(7)
  })
})

describe('可玩卡的戰鬥設定', () => {
  const playable = ALL.filter(ready)

  it('機種是 ALL_SPECS 裡的同一個物件，不是等值的複本', () => {
    // 【為什麼是 toBe 不是 toEqual】下游三張依物件識別的快取（envelope、
    // doctrine、ceilings）認的是參考。等值的複本會讓那三張表全部落空，
    // 症狀是進場那一瞬間的卡頓，而且沒有任何錯誤
    for (const m of playable) {
      const b = m.battle
      expect(ALL_SPECS, `${m.id} blue`).toContain(b.blueSpec)
      expect(ALL_SPECS, `${m.id} red`).toContain(b.redSpec)
      if (b.convoySpec !== null) expect(ALL_SPECS, `${m.id} convoy`).toContain(b.convoySpec)
    }
  })

  it('護送與攔截有被護送的機種，其餘沒有', () => {
    for (const m of playable) {
      const wants = m.type === '護航' || m.type === '攔截'
      expect(m.battle.convoySpec !== null, `${m.id}／${m.type}`).toBe(wants)
      expect(m.battle.convoyCount > 0, `${m.id}／${m.type}`).toBe(wants)
    }
  })

  it('地形逐關指定，不是全部群島', () => {
    // 【為什麼要這一條】只加欄位不給值的話，五關全填 archipelago 一樣通得過
    // 「地形是合法的一種」，而日 M3 仍然開在群島上
    const of = (id: string) => playable.find((m) => m.id === id)!.battle.terrain
    expect(of('japan-m3')).toBe('sea')
    expect(of('germany-m4')).toBe('farmland')
    expect(new Set(playable.map((m) => m.battle.terrain)).size).toBeGreaterThan(1)
  })

  it('架數都是正整數', () => {
    for (const m of playable) {
      const b = m.battle
      for (const [k, v] of [['blue', b.blueCount], ['red', b.redCount]] as const) {
        expect(Number.isInteger(v), `${m.id} ${k}`).toBe(true)
        expect(v, `${m.id} ${k}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('目錄卡', () => {
  it('七張都是 battle: null —— 沒有「半套」這個狀態', () => {
    // 【型別保證，這一條是覆核】原本靠一條測試守「資料要嘛完整要嘛全空」，
    // 因為欄位散在根層、可以只填一半。搬進 `battle` 之後拿得到它就一定
    // 拿得到裡面每一格
    for (const m of ALL) {
      if (ready(m)) continue
      expect(m.battle, m.id).toBeNull()
      expect(m.title.length, m.id).toBeGreaterThan(0)
    }
  })
})

describe('missionConfigFrom', () => {
  it('只吃可玩的卡，不再吃陣營', () => {
    for (const m of ALL.filter(ready)) {
      const cfg = missionConfigFrom(m)
      expect(cfg.units.length, m.id).toBeGreaterThan(0)
    }
  })

  it('雙方的機種照卡片，不是照陣營推出來的', () => {
    // 【這是整輪的本體】日 M3 玩家開 Ki-84 —— 那是「第三架」，
    // 舊的 `specsFor(f)[0]` 永遠選不到它
    const m3 = ALL.filter(ready).find((m) => m.id === 'japan-m3')!
    const cfg = missionConfigFrom(m3)
    const blue = cfg.units.find((u) => u.team === 'blue')!
    expect(blue.members[0]!.id).toBe('ki84')
    const convoy = cfg.units.filter((u) => u.duty === 'transit')
    expect(convoy.length).toBeGreaterThan(0)
    expect(convoy[0]!.members[0]!.id).toBe('g4m')
  })
})
