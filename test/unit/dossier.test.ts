import { describe, it, expect } from 'vitest'
import { dossierOf, SIDE_OF, type Dossier } from '../../src/ui/dossier'
import { ALL_SPECS, specOf, topSpeedKmh } from '../../src/battle/skirmish'

/**
 * 機庫左欄的資料。**純資料，沒有 DOM。**
 *
 * 【這裡守什麼】九台的欄位完整（少一台的症狀是那一頁有一塊空白，不是錯誤），
 * 以及數值條的換算方向 —— 條的長度算反了不會有任何錯誤，只會讓 B-17 看起來
 * 比零戰還靈活。
 */
const bar = (d: Dossier, label: string): number =>
  d.bars.find((b) => b.label === label)?.fill ?? -1
const fact = (d: Dossier, label: string): string | undefined =>
  d.facts.find((f) => f.label === label)?.value

describe('dossierOf —— 九台都要有檔案', () => {
  it('每一台都有陣營、故事與四條數值', () => {
    for (const spec of ALL_SPECS) {
      const d = dossierOf(spec)
      expect(SIDE_OF[spec.id], spec.id).toBeDefined()
      expect(d.story.length, spec.id).toBeGreaterThan(20)
      expect(d.bars.map((b) => b.label), spec.id).toEqual(['極速', '爬升', '迴旋', '滾轉'])
    }
  })

  it('每一條都落在 0…1 之內，而且沒有一條是空的', () => {
    for (const spec of ALL_SPECS) {
      for (const b of dossierOf(spec).bars) {
        expect(b.fill, `${spec.id} ${b.label}`).toBeGreaterThan(0)
        expect(b.fill, `${spec.id} ${b.label}`).toBeLessThanOrEqual(1)
        expect(b.text, `${spec.id} ${b.label}`).not.toBe('')
      }
    }
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
        expect(bar(b, '迴旋')).toBeLessThan(bar(f, '迴旋'))
        expect(bar(b, '滾轉')).toBeLessThan(bar(f, '滾轉'))
      }
    }
  })

  it('A6M5 的迴旋最長、Bf 109 K-4 的爬升最長', () => {
    const turns = ALL_SPECS.map((s) => ({ id: s.id, v: bar(dossierOf(s), '迴旋') }))
    const climbs = ALL_SPECS.map((s) => ({ id: s.id, v: bar(dossierOf(s), '爬升') }))
    expect(turns.sort((a, b) => b.v - a.v)[0]!.id).toBe('a6m5')
    expect(climbs.sort((a, b) => b.v - a.v)[0]!.id).toBe('bf109k4')
  })
})

describe('dossierOf —— 事實列', () => {
  it('轟炸機的固定武裝是空的，武裝那一列因此要講砲塔', () => {
    const b17 = specOf('b17g')
    expect(b17.battery.mounts.length).toBe(0)
    expect(fact(dossierOf(b17), '武裝')).toBe('自衛砲塔 8 座')
  })

  it('戰鬥機的武裝把同型併成一列', () => {
    expect(fact(dossierOf(specOf('p51d')), '武裝')).toBe('6 × M2 Browning .50 cal')
  })

  it('掛不了東西的機種沒有掛載那一列', () => {
    expect(fact(dossierOf(specOf('p51d')), '掛載')).toBeUndefined()
    expect(fact(dossierOf(specOf('b17g')), '掛載')).toBe('炸彈 × 10')
    expect(fact(dossierOf(specOf('g4m')), '掛載')).toBe('魚雷 × 1')
  })
})
