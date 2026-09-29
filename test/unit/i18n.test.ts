import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatMonth, formatNumber, getLang, onLangChange, readLang, saveLang, setLang, t, LANG_STORAGE_KEY,
} from '../../src/i18n'

/**
 * # 文字表與語言切換
 *
 * 守的是查表本身：參數、單複數、切換的通知、設定的存讀。各畫面接得對不對由各自的測試與
 * Playwright 驗。
 */

afterEach(() => {
  setLang('zh')
  vi.unstubAllGlobals()
})

describe('t()', () => {
  it('查目前語言的句子；切換之後查另一張表', () => {
    expect(t('common.ok')).toBe('確定')
    setLang('en')
    expect(t('common.ok')).toBe('OK')
  })

  it('參數照各語言的語序放', () => {
    expect(t('menu.stage', { n: 3 })).toBe('第 3 關')
    setLang('en')
    expect(t('menu.stage', { n: 3 })).toBe('Mission 3')
  })

  it('英文的單複數由句型決定，中文不變', () => {
    expect(t('unit.planes', { n: 1 })).toBe('1 架')
    expect(t('unit.planes', { n: 4 })).toBe('4 架')
    setLang('en')
    expect(t('unit.planes', { n: 1 })).toBe('1 plane')
    expect(t('unit.planes', { n: 4 })).toBe('4 planes')
  })
})

describe('切換', () => {
  it('換語言時通知訂閱者；同一個語言不通知；取消訂閱之後不再通知', () => {
    const seen: string[] = []
    const off = onLangChange((lang) => seen.push(lang))
    setLang('en')
    setLang('en')
    setLang('zh')
    off()
    setLang('en')
    expect(seen).toEqual(['en', 'zh'])
    expect(getLang()).toBe('en')
  })
})

describe('設定的存讀', () => {
  function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
    const m = new Map(Object.entries(initial))
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { m.set(k, v) },
    })
    return m
  }

  it('沒有設定過、或值不合法時是中文', () => {
    stubStorage()
    expect(readLang()).toBe('zh')
    stubStorage({ [LANG_STORAGE_KEY]: 'fr' })
    expect(readLang()).toBe('zh')
  })

  it('存了什麼就讀回什麼', () => {
    const m = stubStorage()
    saveLang('en')
    expect(m.get(LANG_STORAGE_KEY)).toBe('en')
    expect(readLang()).toBe('en')
  })

  it('瀏覽器擋掉儲存時不拋、讀回中文', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    expect(() => saveLang('en')).not.toThrow()
    expect(readLang()).toBe('zh')
  })
})

describe('數字與年月', () => {
  it('千分位跟著語言', () => {
    expect(formatNumber(12000)).toBe('12,000')
    setLang('en')
    expect(formatNumber(12000)).toBe('12,000')
  })

  it('年月：中文「1944 年 3 月」、英文「March 1944」', () => {
    expect(formatMonth(1944, 3)).toBe('1944 年 3 月')
    setLang('en')
    expect(formatMonth(1944, 3)).toBe('March 1944')
  })
})
