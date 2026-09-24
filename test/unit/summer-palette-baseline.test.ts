import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { FIELD_GLSL, fieldSurfaceColor } from '../../src/render/fields'
import { createFloraGeometries, disposeFloraGeometries } from '../../src/render/floraShapes'

/**
 * 夏季色盤的凍結基準。
 *
 * 【為什麼要凍結】田區的地色與樹冠色之後會加季節參數。農地與群島恆為
 * 夏季，而「夏季不變」這件事沒有錯誤訊息 —— 色值漂一點點畫面還是綠的。
 * 三個雜湊是加參數之前跑出來的，加完必須相同。
 */
function hash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h.toString(16)
}

describe('夏季色盤的凍結基準', () => {
  it('FIELD_GLSL 逐字相同', () => {
    expect(hash(FIELD_GLSL)).toBe('54e0b0ba')
  })

  it('fieldSurfaceColor 的取樣表相同', () => {
    const out = new Color()
    const rows: string[] = []
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        fieldSurfaceColor(i * 137.3 - 2700, j * 91.7 - 1800, out)
        rows.push(`${String(out.r)} ${String(out.g)} ${String(out.b)}`)
      }
    }
    expect(hash(rows.join(','))).toBe('341c7404')
  })

  it('樹與房子的頂點色相同', () => {
    const g = createFloraGeometries()
    const rows: string[] = []
    for (const k of Object.keys(g).sort()) {
      const col = g[k as keyof typeof g].getAttribute('color').array as Float32Array
      rows.push(k + ':' + Array.from(col, (v) => String(v)).join(','))
    }
    disposeFloraGeometries(g)
    expect(hash(rows.join('\n'))).toBe('b0e4f0cc')
  })
})
