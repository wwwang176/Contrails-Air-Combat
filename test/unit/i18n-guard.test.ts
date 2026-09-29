import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { IntlMessageFormat } from 'intl-messageformat'
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser'
import { zh } from '../../src/i18n/zh'
import { en } from '../../src/i18n/en'
import { cjkLiterals } from '../helpers/cjkLiterals'

/**
 * # 顯示文字只從文字表來
 *
 * 1. `src/` 裡沒有寫死的中文字串（註解不算）。除錯用的讀數與內部名稱在豁免清單裡。
 * 2. 中英兩張表的鍵相同、每一句的參數名相同、都解析得了。
 * 3. `index.html` 用到的鍵都在表裡。
 */

/** 除錯用或內部用、不給玩家看的，**永久豁免**。`檔案` 或 `檔案#函數` */
const EXEMPT: readonly string[] = [
  // F4 測距、clipmap 探針、效能、測距探針、音訊錶
  'src/render/terrain.ts',
  'src/render/fieldClipmap.ts',
  'src/core/perf.ts',
  'src/hud/rangeProbe.ts',
  'src/hud/audioMeter.ts',
  // 代飛時 AI 讀數那一行（意圖、階段、介入）與 console 遙測
  'src/ai/rules.ts',
  'src/ai/AiController.ts#emit',
  'src/hud/widgets/hints.ts#aiStateLine',
  'src/main.ts#orderLabel',
  'src/main.ts#leaderLabel',
  'src/main.ts#logTelemetry',
  // 河道的內部名稱（接頭比對用，不顯示）
  'src/world/river.ts',
  // 時段的名稱只有開發工具頁讀
  'src/render/timeOfDay.ts',
  // 語言名稱各用自己的語言寫（LANG_NAME）
  'src/i18n/index.ts',
]


const TABLE_FILE = 'src/i18n/zh.ts'

/** 這些屬性的值只給開發工具頁看（地面單位的 `note`） */
const EXEMPT_PROPS: readonly string[] = ['note']

function allowed(file: string, fn: string, prop: string): boolean {
  if (file === TABLE_FILE) return true
  if (EXEMPT.includes(file)) return true
  if (EXEMPT_PROPS.includes(prop)) return true
  return fn !== '' && EXEMPT.includes(`${file}#${fn}`)
}

describe('src/ 沒有寫死的中文字串', () => {
  const found = cjkLiterals(process.cwd())

  it('豁免清單以外，一個都沒有', () => {
    const bad = found.filter((l) => !allowed(l.file, l.fn, l.prop))
      .map((l) => `${l.file}:${l.line}${l.fn === '' ? '' : ` (${l.fn})`}  ${l.text.slice(0, 60)}`)
    expect(bad).toEqual([])
  })
})

/** 一句裡用到的參數名 */
function argNames(els: readonly MessageFormatElement[], out = new Set<string>()): Set<string> {
  for (const el of els) {
    if (el.type === TYPE.literal || el.type === TYPE.pound) continue
    out.add(el.value)
    if (el.type === TYPE.plural || el.type === TYPE.select) {
      for (const opt of Object.values(el.options)) argNames(opt.value, out)
    }
    if (el.type === TYPE.tag) argNames(el.children, out)
  }
  return out
}

describe('中英兩張表', () => {
  it('鍵相同', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('每一句都解析得了，而且兩邊用到的參數名相同', () => {
    const mismatch: string[] = []
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      expect(() => new IntlMessageFormat(zh[key], 'zh-Hant')).not.toThrow()
      expect(() => new IntlMessageFormat(en[key], 'en')).not.toThrow()
      const a = [...argNames(parse(zh[key]))].sort().join(',')
      const b = [...argNames(parse(en[key]))].sort().join(',')
      if (a !== b) mismatch.push(`${key}: zh {${a}} / en {${b}}`)
    }
    expect(mismatch).toEqual([])
  })
})

/** 【鍵拼錯要到執行時才炸】`applyStaticText` 開場就查表，查不到的鍵讓 `t()` 丟例外，整個選單起不來 */
describe('index.html 的固定文字', () => {
  const html = readFileSync('index.html', 'utf8')

  it('每一個 data-i18n 的鍵都在表裡', () => {
    const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]!)
    expect(keys.length).toBeGreaterThan(20)
    expect(keys.filter((k) => !(k in zh))).toEqual([])
  })

  it('每一個 data-i18n-attr 的鍵都在表裡', () => {
    const keys = [...html.matchAll(/data-i18n-attr="([^"]+)"/g)]
      .flatMap((m) => m[1]!.split(',').map((p) => p.split(':')[1]!.trim()))
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.filter((k) => !(k in zh))).toEqual([])
  })
})
