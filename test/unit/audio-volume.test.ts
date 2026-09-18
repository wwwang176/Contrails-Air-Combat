import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { readVolume, saveVolume, DEFAULT_VOLUME_DB, VOLUME_LEVELS } from '../../src/audio/volume'

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
