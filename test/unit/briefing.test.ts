import { describe, it, expect } from 'vitest'
import { briefingOf, type Briefing } from '../../src/ui/briefing'
import { MISSIONS } from '../../src/battle/missions'
import { readyCard, ESCORT_CARD, INTERCEPT_CARD, KILL_CARD } from '../fixtures/mission'

/**
 * 簡報頁右欄的資料（2026-09-04 選單重做 spec §2.4）。**純資料，沒有 DOM。**
 *
 * 【為什麼要一支純函數】「出擊前完全不知道我開什麼、對面幾架」是舊任務頁
 * 最大的問題，而這些資料 `missions.ts` 裡全都有。把「卡 → 簡報」寫成純函數，
 * 每一關的欄位就釘得住 —— 特別是增援時刻：**進場是 `at + warnLead` 秒**，
 * 不是 `at`（Codex 審查 2026-09-04 抓到的）。
 */
const fact = (b: Briefing, label: string): string | undefined =>
  b.facts?.find((f) => f.label === label)?.value
const facts = (b: Briefing, label: string): string[] =>
  (b.facts ?? []).filter((f) => f.label === label).map((f) => f.value)

describe('briefingOf —— 護送（盟 M1）', () => {
  const b = briefingOf(readyCard(ESCORT_CARD))

  it('標題、類型、說明照卡', () => {
    expect(b.ready).toBe(true)
    expect(b.title).toBe('護送堡壘')
    expect(b.kind).toBe('護航')
    expect(b.summary).toContain('施韋因富特')
  })

  it('目標照卡', () => {
    expect(b.objective).toBe('護送轟炸機抵達投彈點')
  })

  it('我方兩列：P-51D ×4，加上要護送的 B-17G ×4；敵方 Bf 109 K-4 ×10', () => {
    expect(b.mine).toEqual([
      { name: 'P-51D', role: 'fighter', count: 4 },
      { name: 'B-17G', role: 'bomber', count: 4, note: '要護送的' },
    ])
    expect(b.foe).toEqual([{ name: 'Bf 109 K-4', role: 'fighter', count: 10 }])
  })

  it('戰場群島、時限無、沒有增援、沒有中途變更、沒有航程', () => {
    expect(fact(b, '戰場')).toBe('群島')
    expect(fact(b, '時限')).toBe('無')
    expect(facts(b, '敵方增援')).toEqual([])
    expect(fact(b, '中途變更')).toBeUndefined()
    // 【沒有航程列】`targetDistance` 12,000 不是實際航程（出生點在反方向 5,000，
    // 實飛 17 km）—— 不顯示一個會騙人的數字
    expect(fact(b, '航程')).toBeUndefined()
  })
})

describe('briefingOf —— 攔截（德 M1）', () => {
  const b = briefingOf(readyCard(INTERCEPT_CARD))

  it('敵方多一列要攔下的 B-17G ×4', () => {
    expect(b.mine).toEqual([{ name: 'Bf 109 K-4', role: 'fighter', count: 10 }])
    expect(b.foe).toEqual([
      { name: 'P-51D', role: 'fighter', count: 4 },
      { name: 'B-17G', role: 'bomber', count: 4, note: '要攔下的' },
    ])
  })

  it('增援在第 64 秒（60 秒預警 ＋ 4 秒），不是第 60 秒', () => {
    expect(facts(b, '敵方增援')).toEqual(['第 64 秒　P-51D ×4'])
  })
})

describe('briefingOf —— 殲滅＋返航（德 M4）', () => {
  const b = briefingOf(readyCard('germany-m4'))

  it('目標帶返航', () => {
    expect(b.objective).toBe('擊落全部敵機 → 返航')
  })

  it('兩批增援：第 4 秒與第 49 秒', () => {
    expect(facts(b, '敵方增援')).toEqual(['第 4 秒　P-51D ×4', '第 49 秒　P-51D ×4'])
  })

  it('中途變更寫成白話：我方剩 ≤ 4 架時（最晚第 40 秒）→ 返航', () => {
    expect(fact(b, '中途變更')).toBe('我方剩 ≤ 4 架時（最晚第 40 秒）→ 返航')
  })

  it('撤離點：後方 12 km，無倒數', () => {
    expect(fact(b, '撤離點')).toBe('後方 12 km，無倒數')
  })

  it('戰場內陸農地，沒有被護送的', () => {
    expect(fact(b, '戰場')).toBe('內陸農地')
    expect(b.mine).toEqual([{ name: 'Bf 109 K-4', role: 'fighter', count: 8 }])
  })
})

describe('briefingOf —— 其他', () => {
  it('日 M3 的戰場是純海面', () => {
    expect(fact(briefingOf(readyCard('japan-m3')), '戰場')).toBe('純海面')
  })

  it('殲滅卡（日 M1）沒有護送列', () => {
    const b = briefingOf(readyCard(KILL_CARD))
    expect(b.mine).toEqual([{ name: 'A6M5', role: 'fighter', count: 8 }])
    expect(b.foe).toEqual([{ name: 'F6F-5', role: 'fighter', count: 6 }])
  })

  it('準備中的卡只帶標題、類型、說明', () => {
    const card = MISSIONS.allies.find((m) => m.battle === null)!
    const b = briefingOf(card)
    expect(b.ready).toBe(false)
    expect(b.title).toBe(card.title)
    expect(b.kind).toBe(card.type)
    expect(b.summary).toBe(card.summary)
    expect(b.objective).toBeUndefined()
    expect(b.mine).toBeUndefined()
    expect(b.facts).toBeUndefined()
  })

  it('每一張可玩的卡都建得出簡報，而且欄位順序固定：戰場在前、時限第二', () => {
    for (const c of Object.values(MISSIONS).flat()) {
      if (c.battle === null) continue
      const b = briefingOf(c)
      expect(b.facts![0]!.label).toBe('戰場')
      expect(b.facts![1]!.label).toBe('時限')
    }
  })
})
