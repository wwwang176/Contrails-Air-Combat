import { describe, it, expect } from 'vitest'
import { briefingOf, type Briefing } from '../../src/ui/briefing'
import { MISSIONS } from '../../src/battle/missions'
import { readyCard, ESCORT_CARD, INTERCEPT_CARD, KILL_CARD } from '../fixtures/mission'

/**
 * 簡報頁右欄的資料（2026-09-04 選單重做 spec §2.4）。**純資料，沒有 DOM。**
 *
 * 【為什麼要一支純函數】「出擊前完全不知道我開什麼、對面幾架」是舊任務頁
 * 最大的問題，而這些資料 `missions.ts` 裡全都有。把「卡 → 簡報」寫成純函數，
 * 每一關的欄位就釘得住。
 *
 * 【2026-09-04 第二輪：簡報只寫出擊前知道的事】負責人審過一輪，把時限、
 * 增援、中途變更、撤離點四項都拿掉了 ——「這是遊戲內容，且玩家還沒進入戰鬥，
 * 根本不會知道這些資訊」。**這一支現在反過來釘住「不該出現」**：那四個
 * 標籤一個都不能回到 `facts` 裡；戰鬥那一側的資料（`waves`／`withdraw`）
 * 一格都沒動，由 `battle-*.test.ts` 顧。
 */
const fact = (b: Briefing, label: string): string | undefined =>
  b.facts?.find((f) => f.label === label)?.value
/** 出擊前不該知道的標籤。任何一個回到簡報上都是回歸 */
const SECRET = ['時限', '敵方增援', '我方增援', '中途變更', '撤離點', '戰場', '航程']
const noSecrets = (b: Briefing): string[] =>
  (b.facts ?? []).map((f) => f.label).filter((l) => SECRET.includes(l))

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
    // 【沒有「↑ 要護送的」那一列小字】負責人 2026-09-04：「這也很怪，請移除」
    // —— 誰是要護送的，目標列已經說了
    expect(b.mine).toEqual([
      { name: 'P-51D', role: 'fighter', count: 4 },
      { name: 'B-17G', role: 'bomber', count: 4 },
    ])
    expect(b.foe).toEqual([{ name: 'Bf 109 K-4', role: 'fighter', count: 10 }])
  })

  it('兩列：空域在前、時期第二，而且沒有任何出擊前不該知道的欄位', () => {
    expect(b.facts).toEqual([
      { label: '空域', value: '德國　施韋因富特上空' },
      { label: '時期', value: '1944 年夏' },
    ])
    expect(noSecrets(b)).toEqual([])
  })
})

describe('briefingOf —— 攔截（德 M1）', () => {
  const b = briefingOf(readyCard(INTERCEPT_CARD))

  it('敵方多一列要攔下的 B-17G ×4', () => {
    expect(b.mine).toEqual([{ name: 'Bf 109 K-4', role: 'fighter', count: 10 }])
    expect(b.foe).toEqual([
      { name: 'P-51D', role: 'fighter', count: 4 },
      { name: 'B-17G', role: 'bomber', count: 4 },
    ])
  })

  it('這一關有增援（第 64 秒），但簡報一個字都不提', () => {
    expect(readyCard(INTERCEPT_CARD).battle.waves?.length).toBeGreaterThan(0)
    expect(noSecrets(b)).toEqual([])
  })
})

describe('briefingOf —— 殲滅＋返航（德 M4）', () => {
  const b = briefingOf(readyCard('germany-m4'))

  it('目標帶返航', () => {
    expect(b.objective).toBe('擊落全部敵機 → 返航')
  })

  it('撤退只寫在目標列，不另外列中途變更與撤離點', () => {
    // 資料還在（`withdraw` 驅動戰鬥），只是不上簡報
    expect(readyCard('germany-m4').battle.withdraw).toBeDefined()
    expect(noSecrets(b)).toEqual([])
  })

  it('空域與時期', () => {
    expect(fact(b, '空域')).toBe('德國南部　巴伐利亞上空')
    expect(fact(b, '時期')).toBe('1945 年春')
    expect(b.mine).toEqual([{ name: 'Bf 109 K-4', role: 'fighter', count: 8 }])
  })
})

describe('briefingOf —— 其他', () => {
  it('日 M3 的空域是雷伊泰灣', () => {
    expect(fact(briefingOf(readyCard('japan-m3')), '空域')).toBe('菲律賓　雷伊泰灣')
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

  it('每一張可玩的卡都恰好兩列：空域在前、時期第二，值都不是空的', () => {
    for (const c of Object.values(MISSIONS).flat()) {
      if (c.battle === null) continue
      const b = briefingOf(c)
      expect(b.facts!.map((f) => f.label), c.id).toEqual(['空域', '時期'])
      for (const f of b.facts!) expect(f.value.length, `${c.id} ${f.label}`).toBeGreaterThan(0)
    }
  })

  it('十二張卡的空域各不相同 —— 每一關取材自不同的地方', () => {
    const all = Object.values(MISSIONS).flat()
    expect(new Set(all.map((c) => c.place)).size).toBe(12)
  })
})
