import { describe, it, expect } from 'vitest'
import { briefingOf, missionTypeName, type Briefing, type BriefingFact } from '../../src/ui/briefing'
import { formatMonth, setLang, t } from '../../src/i18n'
import { MISSIONS, type MissionCard } from '../../src/battle/missions'
import { cardWith, readyCard, ESCORT_CARD, KILL_CARD } from '../fixtures/mission'

/**
 * 簡報頁右欄的資料（選單重做 spec §2.4）。**純資料，沒有 DOM。**
 *
 * 【為什麼要一支純函數】「出擊前完全不知道我開什麼、對面幾架」是舊任務頁
 * 最大的問題，而這些資料 `missions.ts` 裡全都有。把「卡 → 簡報」寫成純函數，
 * 每一關的欄位就釘得住。
 *
 * 【簡報只寫出擊前知道的事】時限、
 * 增援、中途變更、撤離點四項都拿掉了 ——「這是遊戲內容，且玩家還沒進入戰鬥，
 * 根本不會知道這些資訊」。**這一支現在反過來釘住「不該出現」**：那四個
 * 標籤一個都不能回到 `facts` 裡；戰鬥那一側的資料（`waves`／`withdraw`）
 * 一格都沒動，由 `battle-*.test.ts` 顧。
 */
const fact = (b: Briefing, id: BriefingFact['id']): string | undefined =>
  b.facts?.find((f) => f.id === id)?.value
/**
 * 出擊前不該知道的事（時限、增援、中途變更、撤離點）一個都不上簡報：簡報只有空域與
 * 時期兩列。任何第三列都是回歸
 */
const noSecrets = (b: Briefing): string[] =>
  (b.facts ?? []).map((f) => f.id).filter((id) => id !== 'place' && id !== 'period')

describe('briefingOf —— 護送（盟 M1）', () => {
  const b = briefingOf(readyCard(ESCORT_CARD))

  it('標題、類型、說明照卡', () => {
    expect(b.ready).toBe(true)
    expect(b.title).toBe(t('mission.allies-m1.title'))
    expect(b.kind).toBe(missionTypeName('escort'))
    expect(b.summary).toBe(t('mission.allies-m1.summary'))
  })

  it('目標照卡', () => {
    expect(b.objective).toBe(t('mission.allies-m1.objective'))
  })

  it('我方兩列：P-51D ×4，加上要護送的 B-17G ×16；敵方 Bf 109 K-4 ×10', () => {
    // 【沒有「↑ 要護送的」那一列小字】那一列讀起來很怪，移除了
    // —— 誰是要護送的，目標列已經說了
    expect(b.mine).toEqual([
      { id: 'p51d', name: 'P-51D', role: 'fighter', count: 4 },
      { id: 'b17g', name: 'B-17G', role: 'bomber', count: 16 },
    ])
    expect(b.foe).toEqual([{ id: 'bf109k4', name: 'Bf 109 K-4', role: 'fighter', count: 10 }])
  })

  it('兩列：空域在前、時期第二，而且沒有任何出擊前不該知道的欄位', () => {
    expect(b.facts).toEqual([
      { id: 'place', label: t('brief.place'), value: t('mission.allies-m1.place') },
      { id: 'period', label: t('brief.period'), value: formatMonth(1944, 3) },
    ])
    expect(noSecrets(b)).toEqual([])
  })
})

describe('briefingOf —— 擊落（德 M1）', () => {
  const b = briefingOf(readyCard('germany-m1'))

  it('我方 Bf 109 K-4 ×8，敵方是 B-17G ×8', () => {
    expect(b.mine).toEqual([{ id: 'bf109k4', name: 'Bf 109 K-4', role: 'fighter', count: 8 }])
    expect(b.foe).toEqual([{ id: 'b17g', name: 'B-17G', role: 'bomber', count: 8 }])
  })

  it('這一關有護航機的波次，但簡報一個字都不提', () => {
    expect(readyCard('germany-m1').battle.waves?.length).toBeGreaterThan(0)
    expect(noSecrets(b)).toEqual([])
  })
})

describe('briefingOf —— 打擊（德 M3）', () => {
  const b = briefingOf(readyCard('germany-m3'))

  it('目標照卡，起飛的波次不上簡報', () => {
    expect(b.objective).toBe(t(readyCard('germany-m3').battle.objectiveKey))
    expect(noSecrets(b)).toEqual([])
  })

  it('空域與時期', () => {
    expect(fact(b, 'place')).toBe(t('mission.germany-m3.place'))
    expect(fact(b, 'period')).toBe(formatMonth(1945, 1))
    expect(b.mine).toEqual([{ id: 'bf109k4', name: 'Bf 109 K-4', role: 'fighter', count: 10 }])
  })
})

describe('briefingOf —— 其他', () => {
  it('日 M2 的空域是雷伊泰島', () => {
    expect(fact(briefingOf(readyCard('japan-m2')), 'place')).toBe(t('mission.japan-m2.place'))
  })

  it('日 M2 的目標寫出兩段：先炸卡車、再撤離', () => {
    const b = briefingOf(readyCard('japan-m2'))
    if (!b.ready) throw new Error('日 M2 應該打得起來')
    expect(b.objective).toBe(`${t('mission.japan-m2.objective')} → ${t('mission.japan-m2.withdraw')}`)
  })

  it('換成英文，簡報跟著換', () => {
    try {
      setLang('en')
      const b = briefingOf(readyCard(ESCORT_CARD))
      expect(b.title).toBe(t('mission.allies-m1.title'))
      expect(b.facts!.map((f) => f.label)).toEqual([t('brief.place'), t('brief.period')])
      expect(fact(b, 'period')).toBe(formatMonth(1944, 3))
    } finally {
      setLang('zh')
    }
    // 對照：切回中文之後不是英文那一句
    setLang('en')
    const en = t('mission.allies-m1.title')
    setLang('zh')
    expect(briefingOf(readyCard(ESCORT_CARD)).title).not.toBe(en)
  })

  it('殲滅卡沒有護送列', () => {
    const b = briefingOf(readyCard(KILL_CARD))
    expect(b.mine).toEqual([{ id: 'ki84', name: 'Ki-84', role: 'fighter', count: 8 }])
    expect(b.foe).toEqual([{ id: 'p51d', name: 'P-51D', role: 'fighter', count: 10 }])
  })

  it('攻擊隊（日 M1）列在我方：零戰之後是要掩護的陸攻', () => {
    const b = briefingOf(readyCard('japan-m1'))
    expect(b.mine).toEqual([
      { id: 'a6m5', name: 'A6M5', role: 'fighter', count: 12 },
      { id: 'g4m', name: 'G4M', role: 'bomber', count: 8 },
    ])
    expect(b.foe).toEqual([{ id: 'f4f4', name: 'F4F-4', role: 'fighter', count: 8 }])
  })

  it('沒有敵機的卡，簡報不列敵軍那一列', () => {
    const b = briefingOf(cardWith(KILL_CARD, { redCount: 0 }))
    expect(b.foe).toEqual([])
    expect(b.mine).toHaveLength(1)
  })

  it('準備中的卡只帶標題、類型、說明', () => {
    // 【自己組，不從 MISSIONS 找】卡表裡的目錄卡會隨著關卡做完而消失
    const card: MissionCard = {
      id: 'test-m0', titleKey: 'mission.japan-m3.title', type: 'strike',
      summaryKey: 'mission.japan-m3.summary', placeKey: 'mission.japan-m3.place',
      period: { year: 1943, month: 1 }, battle: null,
    }
    const b = briefingOf(card)
    expect(b.ready).toBe(false)
    expect(b.title).toBe(t(card.titleKey))
    expect(b.kind).toBe(missionTypeName(card.type))
    expect(b.summary).toBe(t(card.summaryKey))
    expect(b.objective).toBeUndefined()
    expect(b.mine).toBeUndefined()
    expect(b.facts).toBeUndefined()
  })

  it('每一張可玩的卡都恰好兩列：空域在前、時期第二，值都不是空的', () => {
    for (const c of Object.values(MISSIONS).flat()) {
      if (c.battle === null) continue
      const b = briefingOf(c)
      expect(b.facts!.map((f) => f.id), c.id).toEqual(['place', 'period'])
      for (const f of b.facts!) expect(f.value.length, `${c.id} ${f.id}`).toBeGreaterThan(0)
    }
  })

  it('九張卡的空域各不相同 —— 每一關取材自不同的地方', () => {
    const all = Object.values(MISSIONS).flat()
    expect(new Set(all.map((c) => c.placeKey)).size).toBe(9)
    expect(new Set(all.map((c) => t(c.placeKey))).size).toBe(9)
  })
})
