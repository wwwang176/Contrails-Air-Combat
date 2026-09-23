import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  readVolume, saveVolume, DEFAULT_VOLUME_DB, MIX_HEADROOM_DB, VOLUME_LEVELS,
} from '../../src/audio/volume'

describe('音量設定', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    ;(globalThis as Record<string, unknown>)['localStorage'] = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    }
  })
  afterEach(() => { delete (globalThis as Record<string, unknown>)['localStorage'] })

  it('沒設定過是「中」', () => {
    expect(readVolume()).toBe(DEFAULT_VOLUME_DB)
  })

  it('存了讀得回來，包括「關閉」', () => {
    saveVolume(-12)
    expect(readVolume()).toBe(-12)
    saveVolume(null)
    expect(readVolume()).toBeNull()
  })

  it('壞掉或不在檔位裡的值當成沒設定', () => {
    store.set('audio.volume', 'abc')
    expect(readVolume()).toBe(DEFAULT_VOLUME_DB)
    store.set('audio.volume', '-3')
    expect(readVolume()).toBe(DEFAULT_VOLUME_DB)
  })

  /** 【空字串不是 0】Number('') 是 0，會被當成「高」 —— 最大聲開場 */
  it('空字串、空白、十六進位都當成沒設定', () => {
    for (const v of ['', '  ', '0x0']) {
      store.set('audio.volume', v)
      expect(readVolume(), JSON.stringify(v)).toBe(DEFAULT_VOLUME_DB)
    }
  })

  it('localStorage 拋例外照樣能跑', () => {
    ;(globalThis as Record<string, unknown>)['localStorage'] = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(readVolume()).toBe(DEFAULT_VOLUME_DB)
    expect(() => saveVolume(0)).not.toThrow()
  })

  it('四個檔位：關閉、低、中、高', () => {
    expect(VOLUME_LEVELS.map((l) => l.label)).toEqual(['關閉', '低', '中', '高'])
  })
})

describe('設定頁的音量一列', () => {
  it('index.html 的設定裡有音量那一列', () => {
    const html = readFileSync('index.html', 'utf8')
    const from = html.indexOf('<section id="settings"')
    expect(from).toBeGreaterThanOrEqual(0)
    expect(html.slice(from, html.indexOf('</section>', from))).toContain('id="set-volume"')
  })

  /** 【按確定才套用】與畫質同一套：挑了沒按確定不算數 */
  it('按確定才送出音量', () => {
    const menu = readFileSync('src/ui/menu.ts', 'utf8').replace(/\r\n/g, '\n')
    const at = menu.indexOf('function applySettings(): void {')
    const body = menu.slice(at, menu.indexOf('\n  }\n', at))
    expect(body).toContain('hooks.onVolume(draftVolume)')
  })
})

/**
 * 【混音要留餘裕】設定頁的「高」是**使用者看到的滿音量**，不是 0 dBFS。
 * 沒有餘裕的話大場面一頂到上限就只能靠限幅器硬壓，長時間貼著滿刻度本身就吵。
 */
describe('混音餘裕', () => {
  it('高是餘裕本身，不是 0 dBFS', () => {
    expect(MIX_HEADROOM_DB).toBeLessThanOrEqual(-6)
    expect(MIX_HEADROOM_DB).toBeGreaterThanOrEqual(-15)
  })

  it('三檔之間仍然是等距的 6 dB', () => {
    const db = VOLUME_LEVELS.filter((l) => l.db !== null).map((l) => l.db!)
    expect(db).toEqual([-12, -6, 0])
    for (let i = 1; i < db.length; i++) expect(db[i]! - db[i - 1]!).toBe(6)
  })

  /** 【套用時要加上餘裕】漏掉的話「高」又回到滿檔，而且不會有任何測試變紅 */
  it('engine 的 setVolume 把餘裕加進去', () => {
    const src = new TextDecoder().decode(readFileSync('src/audio/engine.ts')).replace(/\r\n/g, '\n')
    expect(src).toContain('listener.setMasterVolume(dbToGain(db + MIX_HEADROOM_DB))')
    expect(src).toContain('uiGain.gain.value = db === null ? 0 : dbToGain(db + MIX_HEADROOM_DB)')
  })
})
