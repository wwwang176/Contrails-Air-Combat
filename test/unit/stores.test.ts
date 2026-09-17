import { describe, it, expect } from 'vitest'
import { A6M5_BOMB_LOADOUT, LOADOUT_BY_AIRCRAFT, loadoutOf } from '../../src/weapons/stores'
import { ALL_SPECS } from '../../src/battle/skirmish'

/**
 * 掛載表。**三張表（容量／傷害／裝填）併成這一張之後，「兩份清單不同步」
 * 這個失效就不存在了** —— 上一輪真的踩過：彈艙表寫 G4M 500 kg × 2，傷害表
 * 卻是 800 kg 的數字。
 */
describe('掛載表', () => {
  it('三台各掛各的', () => {
    expect(loadoutOf('b17g')).toEqual({
      kind: 'bomb', count: 10, damage: 9_000, reloadSeconds: 20,
    })
    expect(loadoutOf('he111')).toEqual({
      kind: 'bomb', count: 8, damage: 9_300, reloadSeconds: 20,
    })
    expect(loadoutOf('g4m')).toEqual({
      kind: 'torpedo', count: 1, damage: 15_000, reloadSeconds: 45,
    })
  })

  /**
   * 【戰鬥機預設都不掛】零戰也一樣 —— 護航瓜島那一天掛的是副油箱。掛彈的
   * 爆戦只在需要它的任務卡上掛（盟 M3，`MissionBattle.loadouts`）。
   */
  it('五台戰鬥機預設都掛不了東西，零戰也一樣', () => {
    for (const id of ['a6m5', 'p51d', 'bf109k4', 'f6f5', 'ki84']) {
      expect(loadoutOf(id), id).toBeNull()
    }
  })

  it('零戰的爆戦掛載是兩顆 60 kg', () => {
    expect(A6M5_BOMB_LOADOUT).toEqual({
      kind: 'bomb', count: 2, damage: 1_000, reloadSeconds: 20,
    })
  })

  it('不存在的代號也回 null，不丟例外', () => {
    expect(loadoutOf('')).toBeNull()
    expect(loadoutOf('spitfire')).toBeNull()
  })

  /**
   * 【為什麼要對 `ALL_SPECS`】表上打錯一個字（`he111` 寫成 `he-111`）不會有
   * 任何編譯錯誤，那一台就靜靜地變成掛不了彈 —— 與 `HISTORICAL` 由測試守
   * 完整性是同一條理由。
   */
  it('表上的每一個代號都是真的機種', () => {
    const ids = new Set(ALL_SPECS.map((s) => s.id))
    for (const id of Object.keys(LOADOUT_BY_AIRCRAFT)) {
      expect(ids.has(id)).toBe(true)
    }
  })

  /**
   * 【為什麼寫成比較而不是釘 45】「魚雷投失敗不等於這一關結束，但代價要比
   * 炸彈大」是規則；45 是那條規則現在的值。
   */
  it('魚雷的裝填比任何一台炸彈久', () => {
    const bombs = Object.values(LOADOUT_BY_AIRCRAFT).filter((l) => l.kind === 'bomb')
    const torps = Object.values(LOADOUT_BY_AIRCRAFT).filter((l) => l.kind === 'torpedo')
    expect(bombs.length).toBeGreaterThan(0)
    expect(torps.length).toBeGreaterThan(0)
    for (const t of torps) {
      for (const b of bombs) expect(t.reloadSeconds).toBeGreaterThan(b.reloadSeconds)
    }
  })

  it('魚雷單枚比任何一枚炸彈痛', () => {
    const bombs = Object.values(LOADOUT_BY_AIRCRAFT).filter((l) => l.kind === 'bomb')
    const torps = Object.values(LOADOUT_BY_AIRCRAFT).filter((l) => l.kind === 'torpedo')
    for (const t of torps) {
      for (const b of bombs) expect(t.damage).toBeGreaterThan(b.damage)
    }
  })

  it('每一筆都是正的 —— 0 枚或 0 傷害的掛載等於沒掛', () => {
    for (const l of Object.values(LOADOUT_BY_AIRCRAFT)) {
      expect(l.count).toBeGreaterThan(0)
      expect(l.damage).toBeGreaterThan(0)
      expect(l.reloadSeconds).toBeGreaterThan(0)
    }
  })
})
