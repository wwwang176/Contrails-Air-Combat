import { describe, expect, it } from 'vitest'
import { ALL_SPECS } from '../../src/battle/skirmish'
import { SHIP_CLASSES } from '../../src/world/ships'
import { GROUND_UNITS } from '../../src/specs/ground'
import {
  aircraftNameKey, groundUnitName, groundUnitNameKey, shipNameKey, weaponNameKey,
} from '../../src/i18n/names'
import { LANGS, setLang, t } from '../../src/i18n'

/**
 * # 顯示名稱都在表上
 *
 * 機種與武器的 id 是字串，漏填不會編譯失敗 —— 畫面上會退回內部名稱（英文），看起來
 * 像沒翻到。這裡把遊戲裡的每一台、每一種掃一遍。
 */

describe('名稱表', () => {
  it('每一台機種都有全名', () => {
    for (const s of ALL_SPECS) expect(aircraftNameKey(s.id), s.id).toBeDefined()
  })

  it('每一台機種用到的武器（固定武裝與砲塔）都有名稱', () => {
    const missing: string[] = []
    for (const s of ALL_SPECS) {
      for (const m of s.battery.mounts) if (weaponNameKey(m.weapon.id) === undefined) missing.push(m.weapon.id)
      for (const tr of s.turrets) if (weaponNameKey(tr.weapon.id) === undefined) missing.push(tr.weapon.id)
    }
    expect([...new Set(missing)]).toEqual([])
  })

  it('艦級與地面單位在兩種語言都有名稱，而且彼此不同', () => {
    try {
      for (const lang of LANGS) {
        setLang(lang)
        const ships = Object.values(SHIP_CLASSES).map((c) => t(shipNameKey(c.id)))
        expect(new Set(ships).size, lang).toBe(ships.length)
        const ground = GROUND_UNITS.map((u) => groundUnitName(u.id))
        expect(new Set(ground).size, lang).toBe(ground.length)
        for (const u of GROUND_UNITS) expect(t(groundUnitNameKey(u.id)).length, u.id).toBeGreaterThan(0)
      }
    } finally {
      setLang('zh')
    }
  })

  it('日軍機種的英文名稱用盟軍代號', () => {
    try {
      setLang('en')
      expect(t(aircraftNameKey('a6m5')!)).toContain('Zeke')
      expect(t(aircraftNameKey('ki84')!)).toContain('Frank')
      expect(t(aircraftNameKey('g4m')!)).toContain('Betty')
    } finally {
      setLang('zh')
    }
  })
})
