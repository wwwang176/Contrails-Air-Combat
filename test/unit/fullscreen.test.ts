import { describe, expect, it, vi } from 'vitest'
import { enterFullscreen } from '../../src/input/fullscreen'

const SOURCES = import.meta.glob(['../../src/main.ts'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>
const MAIN = Object.values(SOURCES)[0]!.replace(/\r\n/g, '\n')

describe('enterFullscreen：手機出擊時進全螢幕', () => {
  it('還不是全螢幕時呼叫標準的 requestFullscreen', () => {
    const requestFullscreen = vi.fn(() => Promise.resolve())
    enterFullscreen({ requestFullscreen }, { fullscreenElement: null })
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })

  it('已經是全螢幕就不再要求', () => {
    const requestFullscreen = vi.fn(() => Promise.resolve())
    const webkitRequestFullscreen = vi.fn()
    const el = { requestFullscreen, webkitRequestFullscreen }
    enterFullscreen(el, { fullscreenElement: {} as Element })
    enterFullscreen(el, { webkitFullscreenElement: {} as Element })
    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(webkitRequestFullscreen).not.toHaveBeenCalled()
  })

  /** iPad Safari 只有加前綴的版本 */
  it('沒有標準版時改用 webkitRequestFullscreen', () => {
    const webkitRequestFullscreen = vi.fn()
    enterFullscreen({ webkitRequestFullscreen }, {})
    expect(webkitRequestFullscreen).toHaveBeenCalledTimes(1)
  })

  /** iPhone Safari 兩個都沒有；被拒絕（不在手勢裡、使用者關掉權限）也不能讓出擊那一下拋錯 */
  it('都不支援、被拒絕或同步拋錯時什麼都不做，不拋錯', async () => {
    expect(() => enterFullscreen({}, {})).not.toThrow()
    const rejected = vi.fn(() => Promise.reject(new Error('denied')))
    expect(() => enterFullscreen({ requestFullscreen: rejected }, {})).not.toThrow()
    const throws = vi.fn(() => { throw new Error('sync') })
    expect(() => enterFullscreen({ requestFullscreen: throws }, {})).not.toThrow()
    await Promise.resolve()
  })
})

describe('grabPointer 的接線', () => {
  const fn = (() => {
    const at = MAIN.indexOf('function grabPointer(')
    return MAIN.slice(at, MAIN.indexOf('\n}\n', at))
  })()

  /** 【只有手機】觸控筆電的主要指標是滑鼠（`pointer: fine`），不進全螢幕 */
  it('觸控而且主要指標是手指時進全螢幕，電腦版照舊鎖指標', () => {
    expect(fn).toContain('if (PHONE_POINTER.matches) enterFullscreen(document.documentElement, document)')
    expect(fn.indexOf('enterFullscreen(')).toBeGreaterThan(fn.indexOf('if (touch.active) {'))
    expect(fn.indexOf('enterFullscreen(')).toBeLessThan(fn.indexOf('canvas.requestPointerLock()'))
    expect(MAIN).toContain("const PHONE_POINTER = window.matchMedia('(pointer: coarse)')")
  })
})
