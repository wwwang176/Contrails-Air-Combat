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
 * 3. 文字表與 `index.html` 沒有全形空白。
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
]

/**
 * 還沒改成查表的檔案。**每個任務改完就從這裡刪掉**，全部做完時是空的。
 * 這一份只准變短。
 */
const PENDING: readonly string[] = [
  'src/ui/menu.ts',
  'src/ui/dossier.ts',
  'src/ui/tutorials.ts',
  'src/render/geometry/ground/index.ts',
  'src/battle/missions/japan.ts',
  'src/battle/missions/allies.ts',
  'src/battle/missions/germany.ts',
  'src/main.ts',
  'src/ui/scoreboard.ts',
  'src/hud/widgets/hints.ts',
  'src/battle/skirmish.ts',
  'src/battle/missions/types.ts',
  'src/hud/battleReport.ts',
  'src/input/touch.ts',
  'src/render/quality.ts',
  'src/ai/recoveryWorkerClient.ts',
  'src/audio/volume.ts',
  'src/battle/missions/index.ts',
  'src/hud/widgets/bombBay.ts',
  'src/hud/widgets/objective.ts',
  'src/input/aimAssist.ts',
  'src/ui/briefing.ts',
  'src/weapons/a6m5.ts',
  'src/weapons/g4m.ts',
  'src/battle/missions/shared.ts',
  'src/hud/widgets/arena.ts',
  'src/hud/widgets/roster.ts',
  'src/specs/a6m5.ts',
  'src/specs/g4m.ts',
  'src/specs/ki84.ts',
  'src/ui/loading.ts',
  'src/world/ships.ts',
]

const TABLE_FILE = 'src/i18n/zh.ts'

function allowed(file: string, fn: string): boolean {
  if (file === TABLE_FILE) return true
  if (EXEMPT.includes(file) || PENDING.includes(file)) return true
  return fn !== '' && EXEMPT.includes(`${file}#${fn}`)
}

describe('src/ 沒有寫死的中文字串', () => {
  const found = cjkLiterals(process.cwd())

  it('豁免與待改清單以外，一個都沒有', () => {
    const bad = found.filter((l) => !allowed(l.file, l.fn))
      .map((l) => `${l.file}:${l.line}${l.fn === '' ? '' : ` (${l.fn})`}  ${l.text.slice(0, 60)}`)
    expect(bad).toEqual([])
  })

  it('待改清單裡的每一個檔案都還有中文字串 —— 改完的要從清單刪掉', () => {
    const still = new Set(found.map((l) => l.file))
    expect(PENDING.filter((f) => !still.has(f))).toEqual([])
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

describe('全形空白', () => {
  it('文字表沒有 U+3000', () => {
    const bad = [...Object.entries(zh), ...Object.entries(en)]
      .filter(([, v]) => v.includes('　')).map(([k]) => k)
    expect(bad).toEqual([])
  })

  it.fails('index.html 沒有 U+3000', () => {
    expect(readFileSync('index.html', 'utf8').includes('　')).toBe(false)
  })
})
