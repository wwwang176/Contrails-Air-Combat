import { describe, it, expect } from 'vitest'

/** 【用 import.meta.glob 而不是 fs】`menu.ts` 抓 DOM，載進 vitest 會直接爆；讀原始碼 */
const SOURCES = import.meta.glob(['../../index.html', '../../src/ui/menu.ts'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>
// 【換行統一成 LF】工作區在 Windows 上是 CRLF
const srcOf = (name: string): string =>
  Object.entries(SOURCES).find(([k]) => k.endsWith(name))![1].replace(/\r\n/g, '\n')

/**
 * 暫停選單的「回主選單」要先問過（遭遇戰的出口）。
 *
 * 【它在防什麼】按下去這一場就結束了，誤按回不去。
 */
describe('暫停選單：回主選單要先確認', () => {
  it('index.html 有回主選單的確認框，兩顆按鈕', () => {
    const html = srcOf('index.html')
    const from = html.indexOf('<section id="menu-confirm"')
    expect(from).toBeGreaterThanOrEqual(0)
    const section = html.slice(from, html.indexOf('</section>', from))
    expect(section).toContain('hidden')
    expect(section).toContain('data-act="toMenuNo"')
    expect(section).toContain('data-act="toMenuYes"')
  })

  it('按回主選單只打開確認框；確認之後才換畫面', () => {
    const menu = srcOf('menu.ts')
    const line = (act: string): string => {
      const at = menu.indexOf(`if (act === '${act}')`)
      expect(at, act).toBeGreaterThanOrEqual(0)
      return menu.slice(at, menu.indexOf('\n', at))
    }
    expect(line('toMenu')).toContain('openOverlay(')
    expect(line('toMenu')).not.toContain('onEvent')
    expect(line('toMenuNo')).toContain('closeOverlay(')
    expect(line('toMenuNo')).not.toContain('onEvent')
    expect(line('toMenuYes')).toContain('closeOverlay(')
    expect(line('toMenuYes')).toContain("onEvent('toMenu')")
  })

  it('關掉暫停時一併關掉回主選單的確認框', () => {
    const menu = srcOf('menu.ts')
    const from = menu.indexOf('setPaused(v) {')
    const body = menu.slice(from, menu.indexOf('\n    },', from))
    expect(body).toContain('closeOverlay(menuAsk)')
  })
})

/**
 * 暫停選單的「重新開始」要先問過，與「放棄任務」一樣。
 *
 * 【它在防什麼】重新開始會把這一場整個重來，誤按就回不去了。
 */
describe('暫停選單：重新開始要先確認', () => {
  it('index.html 有重新開始的確認框，兩顆按鈕', () => {
    const html = srcOf('index.html')
    const from = html.indexOf('<section id="restart-confirm"')
    expect(from).toBeGreaterThanOrEqual(0)
    const section = html.slice(from, html.indexOf('</section>', from))
    expect(section).toContain('hidden')
    expect(section).toContain('data-act="restartNo"')
    expect(section).toContain('data-act="restartYes"')
  })

  it('按重新開始只打開確認框；確認之後才真的重開', () => {
    const menu = srcOf('menu.ts')
    const line = (act: string): string => {
      const at = menu.indexOf(`if (act === '${act}')`)
      expect(at, act).toBeGreaterThanOrEqual(0)
      return menu.slice(at, menu.indexOf('\n', at))
    }
    expect(line('restart')).toContain('openOverlay(')
    expect(line('restart')).not.toContain('onRestart')
    expect(line('restartNo')).toContain('closeOverlay(')
    expect(line('restartNo')).not.toContain('onRestart')
    expect(line('restartYes')).toContain('closeOverlay(')
    expect(line('restartYes')).toContain('hooks.onRestart()')
  })

  /** 【關掉暫停要一併收掉】繼續或換畫面時不能留一層確認框蓋在戰場上 */
  it('關掉暫停時一併關掉確認框', () => {
    const menu = srcOf('menu.ts')
    const from = menu.indexOf('setPaused(v) {')
    const body = menu.slice(from, menu.indexOf('\n    },', from))
    expect(body).toContain('closeOverlay(restartAsk)')
  })
})
