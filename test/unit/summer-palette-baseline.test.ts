import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { FIELD_GLSL } from '../../src/render/fieldShaders'
import { fieldSurfaceColor } from '../../src/render/fields'
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
    expect(hash(FIELD_GLSL)).toBe('f1009bcc')
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
    expect(hash(rows.join(','))).toBe('b453a2d4')
  })

  /**
   * 【凍結的是原本那十個池】GLB 在這支測試裡沒有載入，近距離兩級是程序幾何的
   * 退路，所以這十個池的頂點色逐位元等於凍結時的那一份。新加的池（高模、灌木的
   * 八面體級）用同一份樹冠色，由下一條對照。
   *
   * 【比的是逐三角形展開的頂點色】池幾何共用頂點、有索引；展開回每個三角形三個
   * 頂點，才是凍結時的那種排列
   */
  it('樹與房子的頂點色相同', () => {
    const g = createFloraGeometries()
    const rows: string[] = []
    const frozen = [
      'barn', 'barnTar', 'broadMid', 'broadNear', 'bushNear',
      'church', 'coneMid', 'coneNear', 'house', 'houseSlate',
    ] as const
    for (const k of frozen) {
      const flat = g[k].toNonIndexed()
      const col = flat.getAttribute('color').array as Float32Array
      flat.dispose()
      rows.push(k + ':' + Array.from(col, (v) => String(v)).join(','))
    }
    disposeFloraGeometries(g)
    expect(hash(rows.join('\n'))).toBe('95f97cca')
  })

  it('新加的池與它同樹種的池頂點色相同', () => {
    const g = createFloraGeometries()
    const colours = (k: keyof typeof g): number[] => Array.from(g[k].getAttribute('color').array as Float32Array)
    expect(colours('broadHigh')).toEqual(colours('broadNear'))
    expect(colours('coneHigh')).toEqual(colours('coneNear'))
    expect(colours('bushHigh')).toEqual(colours('bushNear'))
    expect(colours('bushMid')).toEqual(colours('bushNear'))
    disposeFloraGeometries(g)
  })
})
