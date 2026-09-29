import { afterEach, describe, it, expect } from 'vitest'
import { dossierOf, strengthOf, SIDE_OF, type Bar, type Dossier, type Fact } from '../../src/ui/dossier'
import { ALL_SPECS, specOf, topSpeedKmh } from '../../src/battle/skirmish'
import { setLang, t } from '../../src/i18n'
import { weaponName } from '../../src/i18n/names'

/**
 * 機庫左欄的資料。**純資料，沒有 DOM。**
 *
 * 【這裡守什麼】九台的欄位完整（少一台的症狀是那一頁有一塊空白，不是錯誤），
 * 以及數值條的換算方向 —— 條的長度算反了不會有任何錯誤，只會讓 B-17 看起來
 * 比零戰還靈活。
 */
afterEach(() => setLang('zh'))

const bar = (d: Dossier, id: Bar['id']): number =>
  d.bars.find((b) => b.id === id)?.fill ?? -1
const fact = (d: Dossier, id: Fact['id']): string | undefined =>
  d.facts.find((f) => f.id === id)?.value

describe('dossierOf —— 九台都要有檔案', () => {
  it('每一台都有陣營、故事與六條數值，兩種語言都有', () => {
    for (const lang of ['zh', 'en'] as const) {
      setLang(lang)
      for (const spec of ALL_SPECS) {
        const d = dossierOf(spec)
        expect(SIDE_OF[spec.id], spec.id).toBeDefined()
        expect(d.story.length, `${lang} ${spec.id}`).toBeGreaterThan(20)
        expect(d.bars.map((b) => b.id), spec.id)
          .toEqual(['speed', 'climb', 'turn', 'roll', 'attack', 'guard'])
        for (const b of d.bars) expect(b.label.length, `${lang} ${b.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('每一條都落在 0…1 之內，而且沒有一條是空的', () => {
    for (const spec of ALL_SPECS) {
      for (const b of dossierOf(spec).bars) {
        expect(b.fill, `${spec.id} ${b.id}`).toBeGreaterThan(0)
        expect(b.fill, `${spec.id} ${b.id}`).toBeLessThanOrEqual(1)
        expect(b.text, `${spec.id} ${b.id}`).not.toBe('')
      }
    }
  })

  it('每一台都有一句長處', () => {
    for (const spec of ALL_SPECS) expect(strengthOf(spec.id), spec.id).not.toBe('')
  })

  it('極速印的數字與編組頁同一個來源', () => {
    for (const spec of ALL_SPECS) {
      const d = dossierOf(spec)
      expect(d.bars[0]!.text, spec.id).toBe(`${topSpeedKmh(spec.id)} km/h`)
    }
  })
})

describe('dossierOf —— 數值條的方向', () => {
  /**
   * 【為什麼拿轟炸機與戰鬥機對比而不是斷言某個定值】定值會把刻度也一起釘死，
   * 而刻度是可調的。這一條只問「換算有沒有寫反」，那件事不該隨刻度改變。
   */
  it('三台轟炸機的迴旋與滾轉一定短於每一台戰鬥機', () => {
    const fighters = ALL_SPECS.filter((s) => s.role === 'fighter').map(dossierOf)
    const bombers = ALL_SPECS.filter((s) => s.role === 'bomber').map(dossierOf)
    for (const b of bombers) {
      for (const f of fighters) {
        expect(bar(b, 'turn')).toBeLessThan(bar(f, 'turn'))
        expect(bar(b, 'roll')).toBeLessThan(bar(f, 'roll'))
      }
    }
  })

  it('A6M5 的迴旋最長、Bf 109 K-4 的爬升最長', () => {
    const turns = ALL_SPECS.map((s) => ({ id: s.id, v: bar(dossierOf(s), 'turn') }))
    const climbs = ALL_SPECS.map((s) => ({ id: s.id, v: bar(dossierOf(s), 'climb') }))
    expect(turns.sort((a, b) => b.v - a.v)[0]!.id).toBe('a6m5')
    expect(climbs.sort((a, b) => b.v - a.v)[0]!.id).toBe('bf109k4')
  })
})

describe('dossierOf —— 事實列', () => {
  it('轟炸機的固定武裝是空的，武裝那一列因此要講砲塔', () => {
    const b17 = specOf('b17g')
    expect(b17.battery.mounts.length).toBe(0)
    expect(fact(dossierOf(b17), 'armament')).toBe(t('dossier.armament.turrets', { n: 8 }))
  })

  it('戰鬥機的武裝把同型併成一列', () => {
    const p51 = specOf('p51d')
    const w = p51.battery.mounts[0]!.weapon
    expect(fact(dossierOf(p51), 'armament'))
      .toBe(t('dossier.armament.item', { n: 6, name: weaponName(w) }))
  })

  /** 名稱跟著語言換，分組不能跟著換 —— 兩種語言都是同樣的列數 */
  it('武裝以武器 id 分組：兩種語言的列數相同', () => {
    for (const spec of ALL_SPECS) {
      const sep = (lang: 'zh' | 'en'): number => {
        setLang(lang)
        const v = fact(dossierOf(spec), 'armament') ?? ''
        return v === '' ? 0 : v.split(t('dossier.armament.separator')).length
      }
      expect(sep('en'), spec.id).toBe(sep('zh'))
    }
  })

  it('掛不了東西的機種沒有掛載那一列', () => {
    expect(fact(dossierOf(specOf('p51d')), 'loadout')).toBeUndefined()
    expect(fact(dossierOf(specOf('b17g')), 'loadout')).toBe(t('dossier.loadout', { kind: 'bomb', n: 10 }))
    expect(fact(dossierOf(specOf('g4m')), 'loadout')).toBe(t('dossier.loadout', { kind: 'torpedo', n: 1 }))
  })

  it('英文的掛載與砲塔數照單複數', () => {
    setLang('en')
    expect(fact(dossierOf(specOf('g4m')), 'loadout')).toBe('1 torpedo')
    expect(fact(dossierOf(specOf('b17g')), 'loadout')).toBe('10 bombs')
    expect(fact(dossierOf(specOf('b17g')), 'armament')).toBe('8 defensive turrets')
  })
})
