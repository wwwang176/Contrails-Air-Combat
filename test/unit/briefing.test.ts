import { describe, it, expect } from 'vitest'
import {
  briefingOf, missionTypeName, shortName, type Briefing, type BriefingFact, type BriefingUnit,
} from '../../src/ui/briefing'
import { formatMonth, setLang, t } from '../../src/i18n'
import { MISSIONS, missionConfigFrom, type MissionCard, type ReadyMissionCard } from '../../src/battle/missions'
import type { AircraftSpec } from '../../src/specs/types'
import { A6M5 } from '../../src/specs/a6m5'
import { B17G } from '../../src/specs/b17g'
import { BF109K4 } from '../../src/specs/bf109k4'
import { G4M } from '../../src/specs/g4m'
import { P51D } from '../../src/specs/p51d'
import { cardWith, readyCard, ESCORT_CARD, INTERCEPT_CARD, KILL_CARD } from '../fixtures/mission'

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
})

describe('briefingOf —— 打擊（德 M3）', () => {
  const b = briefingOf(readyCard('germany-m3'))

  it('目標照卡，沒有出擊前不該知道的欄位', () => {
    expect(b.objective).toBe(t(readyCard('germany-m3').battle.objectiveKey))
    expect(noSecrets(b)).toEqual([])
  })
})

/**
 * 陣容兩欄怎麼排。每一條用合成卡，期望值從卡片的欄位推。
 *
 * 【沒有「↑ 要護送的」那一列小字】誰是要護送的，目標列已經說了；被護送者就是一般的一列
 */
describe('briefingOf —— 陣容兩欄', () => {
  const row = (spec: AircraftSpec, count: number): BriefingUnit =>
    ({ id: spec.id, name: shortName(spec), role: spec.role, count })
  const convoyRow = (c: ReadyMissionCard): BriefingUnit => row(c.battle.convoySpec!, c.battle.convoyCount)

  /** 【依規則的 owner 與職務排】與 `missionConfigFrom` 把轟炸機排進哪一隊同一條判準 */
  it('被護送者：護送列在我方、攔截列在敵方；攻擊隊在我方、轟炸機流在敵方', () => {
    const escort = readyCard(ESCORT_CARD)
    expect(briefingOf(escort).mine).toContainEqual(convoyRow(escort))
    expect(briefingOf(escort).foe).not.toContainEqual(convoyRow(escort))
    const intercept = readyCard(INTERCEPT_CARD)
    expect(briefingOf(intercept).foe).toContainEqual(convoyRow(intercept))
    expect(briefingOf(intercept).mine).not.toContainEqual(convoyRow(intercept))
    const strike = cardWith(KILL_CARD, { convoySpec: G4M, convoyCount: 2, convoyDuty: 'strike', sinkCount: 1 })
    expect(briefingOf(strike).mine).toContainEqual(convoyRow(strike))
    const stream = cardWith(KILL_CARD, { convoySpec: B17G, convoyCount: 2, convoyDuty: 'stream', huntCount: 2 })
    expect(briefingOf(stream).foe).toContainEqual(convoyRow(stream))
  })

  /** 【玩家那一隊的架數讀編組表】小隊大小由排法決定，卡片上沒有 */
  it('blueOthers：玩家那一隊一列、其餘藍隊一列，兩列加起來是 blueCount', () => {
    const c = cardWith(KILL_CARD, { blueOthers: A6M5 })
    const own = missionConfigFrom(c).units.find((f) => f.player === true)!.members.length
    expect(briefingOf(c).mine).toEqual([
      row(c.battle.blueSpec, own), row(A6M5, c.battle.blueCount - own),
    ])
  })

  /**
   * 【開場就在場上的都要列】`briefsOpening` 的卡把第 0 秒的波次與從地上起飛的每一批
   * （不論幾秒出發）列進敵方，同機種併成一列；之後才來的與我方的波次不列。
   * 護航編隊列進我方
   */
  it('briefsOpening：開場的敵方波次併進同機種那一列，起飛的每一批都算；護航列進我方', () => {
    const wave = (at: number, side: 'mine' | 'theirs', spec: AircraftSpec, count: number) => ({
      when: { kind: 'clock' as const, at }, warnKey: 'mission.allies-m1.wave.more' as const, warnLead: 0,
      side, spec, count,
    })
    const waves = [
      wave(0, 'theirs', P51D, 2), wave(0, 'theirs', P51D, 3), wave(0, 'theirs', BF109K4, 4),
      { ...wave(60, 'theirs', P51D, 4), departs: 'parkedP51' as const },
      wave(30, 'theirs', P51D, 4), wave(0, 'mine', P51D, 4),
    ]
    const escort = { spec: BF109K4, count: 4, depth: 590, speed: 0.5 }
    const c = cardWith(KILL_CARD, { briefsOpening: true, waves, blueWaves: { size: 4, depth: 2000, escort } })
    const b = briefingOf(c)
    expect(c.battle.redSpec).toBe(P51D)
    expect(b.foe).toEqual([row(P51D, c.battle.redCount + 2 + 3 + 4), row(BF109K4, 4)])
    expect(b.mine).toEqual([row(c.battle.blueSpec, c.battle.blueCount), row(BF109K4, escort.count)])
    // 對照：不開 briefsOpening 只列卡片上的開場架數
    const plain = briefingOf(cardWith(KILL_CARD, { waves }))
    expect(plain.foe).toEqual([row(P51D, c.battle.redCount)])
  })
})

describe('briefingOf —— 其他', () => {
  it('有返航的卡，目標寫出兩段：先是任務目標、再是返航', () => {
    const withdraw = {
      when: { kind: 'clock' as const, at: 60 }, messageKey: 'mission.type.withdraw' as const,
      distance: 3000, radius: 600, seconds: 120,
    }
    const c = cardWith(KILL_CARD, { withdraw })
    expect(briefingOf(c).objective).toBe(`${t(c.battle.objectiveKey)} → ${t(withdraw.messageKey)}`)
    expect(briefingOf(readyCard(KILL_CARD)).objective).toBe(t(c.battle.objectiveKey))
  })

  it('換成英文，簡報跟著換', () => {
    const { year, month } = readyCard(ESCORT_CARD).period
    try {
      setLang('en')
      const b = briefingOf(readyCard(ESCORT_CARD))
      expect(b.title).toBe(t('mission.allies-m1.title'))
      expect(b.facts!.map((f) => f.label)).toEqual([t('brief.place'), t('brief.period')])
      expect(fact(b, 'period')).toBe(formatMonth(year, month))
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
})
