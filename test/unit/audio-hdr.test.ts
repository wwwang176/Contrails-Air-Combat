import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ENVELOPE_STEP, HDR_ABS_FLOOR_DB, HDR_EXEMPT, HDR_KNEE_DB, HDR_MAX_DUCK_DB, HDR_RELEASE_DB_PER_SEC,
  HDR_WINDOW_DB, envelopeAt, hdrDuckDb, hdrFloorDb, stepLoudest,
} from '../../src/audio/dynamics'
import { CATEGORY } from '../../src/audio/catalog'

/**
 * # HDR 混音
 *
 * 守三件事：安靜時不動既有的相對音量、爆炸時真的有讓位、玩家必須聽到的東西
 * 不會被壓掉。
 */

describe('最響值', () => {
  it('新的峰值立刻跟上', () => {
    expect(stepLoudest(-30, 6, 1 / 60)).toBe(6)
  })

  it('沒有新的峰值就照釋放速率往下掉', () => {
    expect(stepLoudest(6, -60, 1)).toBeCloseTo(6 - HDR_RELEASE_DB_PER_SEC, 9)
  })

  /** 【夾在絕對地板】不夾的話安靜場景的窗口會一直往下掉，別的東西被算成很響 */
  it('不會低於絕對地板', () => {
    expect(stepLoudest(-30, -90, 10)).toBe(HDR_ABS_FLOOR_DB)
    expect(stepLoudest(-90, -90, 0)).toBe(HDR_ABS_FLOOR_DB)
  })
})

describe('衰減量', () => {
  /** 【安靜時不動】離最響者一個不衰減區以內的一律 0 —— 既有的相對音量原樣留著 */
  it('不衰減區之內是 0', () => {
    expect(hdrDuckDb(6, 6)).toBe(0)
    expect(hdrDuckDb(6 - HDR_KNEE_DB, 6)).toBe(0)
    expect(hdrDuckDb(6 - HDR_KNEE_DB + 0.1, 6)).toBe(0)
  })

  it('之外線性下降，到最大衰減為止', () => {
    const top = 6 - HDR_KNEE_DB
    expect(hdrDuckDb(top - HDR_WINDOW_DB / 2, 6)).toBeCloseTo(HDR_MAX_DUCK_DB / 2, 9)
    expect(hdrDuckDb(top - HDR_WINDOW_DB, 6)).toBeCloseTo(HDR_MAX_DUCK_DB, 9)
    expect(hdrDuckDb(top - HDR_WINDOW_DB * 5, 6)).toBeCloseTo(HDR_MAX_DUCK_DB, 9)
  })

  /**
   * 【安靜場景整場不被動到】場上最響的只有 −35 dB（低於絕對地板）時，
   * 窗口不跟著掉：比它小 15 dB 的東西仍然一點都不壓。
   */
  it('最響者低於絕對地板時，窗口停在地板上', () => {
    expect(hdrDuckDb(-50, -70)).toBe(hdrDuckDb(-50, HDR_ABS_FLOOR_DB))
    expect(hdrDuckDb(HDR_ABS_FLOOR_DB - HDR_KNEE_DB, -70)).toBe(0)
  })

  /** 【爆炸時要真的讓位】爆炸 +6、遠處機槍 −20，差 26 dB */
  it('爆炸與遠處機槍差 26 dB 時，機槍被壓 4 dB 以上', () => {
    expect(hdrDuckDb(-20, 6)).toBeLessThanOrEqual(-4)
  })

  it('地板之下的不發聲', () => {
    expect(hdrFloorDb(6)).toBeCloseTo(6 - HDR_KNEE_DB - HDR_WINDOW_DB, 9)
    expect(hdrDuckDb(hdrFloorDb(6), 6)).toBeCloseTo(HDR_MAX_DUCK_DB, 9)
  })
})

describe('素材包絡', () => {
  const table = [0, -6, -18, -40]

  it('照格距查表，不插值', () => {
    expect(envelopeAt(table, 0)).toBe(0)
    expect(envelopeAt(table, ENVELOPE_STEP * 0.9)).toBe(0)
    expect(envelopeAt(table, ENVELOPE_STEP)).toBe(-6)
    expect(envelopeAt(table, ENVELOPE_STEP * 2.5)).toBe(-18)
  })

  it('超過表尾用最後一格，負的年齡當 0', () => {
    expect(envelopeAt(table, 99)).toBe(-40)
    expect(envelopeAt(table, -5)).toBe(0)
  })

  /** 【沒有表就回 0】等於「整段一樣響」，加這一層之前的行為 */
  it('沒有表回 0', () => {
    expect(envelopeAt(undefined, 1)).toBe(0)
    expect(envelopeAt([], 1)).toBe(0)
  })
})

describe('保底類別', () => {
  /** 【玩家必須聽到的不受窗口影響】場面再吵也要穿得出去 */
  it('警告、無線電、自己的引擎與槍、選單、受創與風聲都在保底名單', () => {
    for (const cat of ['warn', 'radio', 'engineSelf', 'fireSelf', 'ui', 'damage', 'rattle', 'wind']) {
      expect(HDR_EXEMPT.has(cat), cat).toBe(true)
    }
  })

  /** 【名單裡的每一個都要是真的類別】打錯字的話那一類靜靜地不再保底 */
  it('名單裡沒有不存在的類別', () => {
    for (const cat of HDR_EXEMPT) expect(cat in CATEGORY, cat).toBe(true)
  })

  /** 爆炸與武器不能保底 —— 它們正是要互相讓位的那些 */
  it('爆炸、艦砲、別人的槍不在名單裡', () => {
    for (const cat of ['explosion', 'blast', 'cannon', 'fire', 'turret', 'impact']) {
      expect(HDR_EXEMPT.has(cat), cat).toBe(false)
    }
  })
})

/**
 * 包絡表由素材處理腳本寫進 `manifest.json`。**每個檔案都要有** —— 少一個的
 * 症狀是那個音效永遠被當成「整段一樣響」，讓位的時機不對而且不會報錯。
 */
describe('清單裡的包絡表', () => {
  const MAN = JSON.parse(new TextDecoder().decode(readFileSync('public/audio/manifest.json'))) as
    Record<string, { loop: boolean; makeupDb: number; envelopeDb?: number[] }>

  it('每個檔案都有，而且第一格是 0（相對自己最響的那一格）', () => {
    for (const [name, e] of Object.entries(MAN)) {
      expect(e.envelopeDb, name).toBeDefined()
      expect(e.envelopeDb!.length, name).toBeGreaterThan(0)
      expect(Math.max(...e.envelopeDb!), name).toBe(0)
    }
  })

  it('每一格都在 −60…0 之間', () => {
    for (const [name, e] of Object.entries(MAN)) {
      for (const v of e.envelopeDb!) {
        expect(v, name).toBeLessThanOrEqual(0)
        expect(v, name).toBeGreaterThanOrEqual(-60)
      }
    }
  })

  /** 【爆炸要衰減得出來】不然 HDR 會被一顆爆炸頂住好幾秒 */
  it('爆炸庫尾端比開頭小 20 dB 以上', () => {
    for (const name of ['explosion-1', 'explosion-2', 'explosion-3', 'explosion-4', 'explosion-5']) {
      const e = MAN[name]!.envelopeDb!
      expect(e.at(-1), name).toBeLessThanOrEqual(-20)
    }
  })

  /** 【循環音幾乎是平的】引擎的包絡不該像爆炸那樣掉下去 */
  it('引擎的包絡起伏在 12 dB 以內', () => {
    const e = MAN['engine-p51d']!.envelopeDb!
    expect(Math.min(...e)).toBeGreaterThan(-12)
  })
})
