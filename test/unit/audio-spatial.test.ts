import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { writeParam } from '../../src/audio/spatial'

/**
 * # 音訊執行緒的成本
 *
 * 音訊執行緒算不完時，瀏覽器塞靜音補上 —— 聽起來是一陣劈啪，輸出峰值卻完全
 * 不變，錶上只有「落後」會長。Chrome 看到 panner 或 listener 的位置參數有排程，
 * 就改走逐取樣重算方位的路徑（離線實測 40 條聲道：排漸變 67%、直接設值 19%）。
 */

/** 像真的 AudioParam：存進去的是單精度，寫一次記一次 */
function fakeParam(): { value: number; writes: number } {
  let v = 0
  const p = {
    writes: 0,
    get value() { return v },
    set value(x: number) { v = Math.fround(x); p.writes++ },
  }
  return p
}

describe('位置參數直接設值', () => {
  /** 【比單精度】拿 double 直接比永遠不相等，等於每一幀都照寫 */
  it('值沒變就不寫', () => {
    const p = fakeParam()
    writeParam(p, 123.456)
    writeParam(p, 123.456)
    expect(p.writes).toBe(1)
    writeParam(p, 124)
    expect(p.writes).toBe(2)
  })

  it('聲源與 listener 都不排程', () => {
    const src = new TextDecoder().decode(readFileSync('src/audio/spatial.ts'))
    expect(src).not.toMatch(/\.(linearRampToValueAtTime|exponentialRampToValueAtTime|setValueAtTime|setTargetAtTime)\(/)
  })

  /** 【用自己的子類別】換回 three 原本的，每一幀又是一整排漸變 */
  it('engine 建的是直接設值的 listener 與聲源', () => {
    const src = new TextDecoder().decode(readFileSync('src/audio/engine.ts'))
    expect(src).toContain('new DirectListener()')
    expect(src).toContain('new DirectPositionalAudio(listener)')
    expect(src).not.toMatch(/new (AudioListener|PositionalAudio)\(/)
  })
})

describe('低通不每幀重排', () => {
  /** 【變動夠大才排】距離每幀都在變，照排的話兩級低通一直走逐取樣重算係數 */
  it('截止頻率變動小於門檻就不排', () => {
    const src = new TextDecoder().decode(readFileSync('src/audio/engine.ts')).replace(/\r\n/g, '\n')
    const fn = src.slice(src.indexOf('function setCutoff('), src.indexOf('const voices: Voice[]'))
    expect(fn).toContain('if (ramp > 0 && Math.abs(hz - v.cutoff) <= v.cutoff * CUTOFF_STEP) return')
    expect(fn).toContain('v.cutoff = hz')
  })
})
