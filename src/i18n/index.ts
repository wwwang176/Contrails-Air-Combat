import { IntlMessageFormat } from 'intl-messageformat'
import { zh, type MessageKey } from './zh'
import { en } from './en'

export type { MessageKey } from './zh'

/**
 * # 介面文字
 *
 * 玩家看得到的文字**只從這裡取**（`t(鍵)`），程式碼與測試不寫、不比對顯示文字。
 *
 * 【即時切換】`setLang` 換掉目前的語言並通知訂閱者。每幀重畫的東西（HUD、觸控按鈕）直接
 * 查表就會跟上；只在打開時畫的畫面要訂閱 `onLangChange` 自己重畫。
 */
export type Lang = 'zh' | 'en'

export const LANGS: readonly Lang[] = ['zh', 'en']

/** 語言設定在 `localStorage` 的鍵 */
export const LANG_STORAGE_KEY = 'ui.lang'

/** 這一句的參數。數字會套千分位；不要逗號的（年份）傳字串 */
export type MessageParams = Readonly<Record<string, string | number>>

const TABLES: Readonly<Record<Lang, Readonly<Record<MessageKey, string>>>> = { zh, en }

/** 給 `Intl` 用的地區碼，也是 `<html lang>` 的值 */
const LOCALE: Readonly<Record<Lang, string>> = { zh: 'zh-Hant', en: 'en' }

let current: Lang = 'zh'
const listeners = new Set<(lang: Lang) => void>()

/**
 * 編好的句型，依語言各一份。HUD 每幀查很多句，第一次用到才編、之後重用。
 * 沒有參數語法的句子不進來 —— 直接回傳原字串。
 */
const compiled: Readonly<Record<Lang, Map<MessageKey, IntlMessageFormat>>> = {
  zh: new Map(), en: new Map(),
}
const numberFormat: Partial<Record<Lang, Intl.NumberFormat>> = {}
const monthName: Partial<Record<Lang, Intl.DateTimeFormat>> = {}

export function getLang(): Lang {
  return current
}

/** 這一句在目前語言的文字 */
export function t(key: MessageKey, params?: MessageParams): string {
  const src = TABLES[current][key]
  if (!src.includes('{')) return src
  const cache = compiled[current]
  let fmt = cache.get(key)
  if (fmt === undefined) {
    fmt = new IntlMessageFormat(src, LOCALE[current])
    cache.set(key, fmt)
  }
  return String(fmt.format(params))
}

/**
 * 換語言：改目前的語言、`<html lang>`，並通知訂閱者。同一個語言不通知。
 * **不存設定** —— 設定頁按確定時由呼叫端另外 `saveLang`。
 */
export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  if (typeof document !== 'undefined') document.documentElement.lang = LOCALE[lang]
  for (const fn of [...listeners]) fn(lang)
}

/** 訂閱語言切換。回傳取消訂閱的函數 */
export function onLangChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 讀存下來的語言。沒有、讀不到或值不合法時是中文 */
export function readLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY)
    return v === 'en' || v === 'zh' ? v : 'zh'
  } catch {
    return 'zh'
  }
}

/** 存語言設定。瀏覽器擋掉儲存時靜靜放棄 —— 這一次照樣換，只是下次開啟回到中文 */
export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    // 私密視窗或封鎖了網站資料
  }
}

/** 依目前語言加千分位 */
export function formatNumber(n: number): string {
  let f = numberFormat[current]
  if (f === undefined) {
    f = new Intl.NumberFormat(LOCALE[current])
    numberFormat[current] = f
  }
  return f.format(n)
}

/** 年月：中文「1944 年 3 月」、英文「March 1944」。`month` 從 1 起算 */
export function formatMonth(year: number, month: number): string {
  if (current === 'zh') return t('format.month', { year: String(year), month: String(month) })
  let f = monthName[current]
  if (f === undefined) {
    f = new Intl.DateTimeFormat(LOCALE[current], { month: 'long', timeZone: 'UTC' })
    monthName[current] = f
  }
  return t('format.month', { year: String(year), month: f.format(Date.UTC(2000, month - 1, 1)) })
}
