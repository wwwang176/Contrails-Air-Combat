import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMenuSettings } from '../../src/ui/menuSettings'

/** 只有選項列會用到的那一點 DOM 介面；不牽涉遊戲渲染 */
class Element {
  children: Element[] = []
  hidden = true
  className = ''
  disabled = false
  private html = ''
  private clickHandler = () => {}
  set innerHTML(value: string) { this.html = value; this.children = [] }
  get innerHTML() { return this.html }
  appendChild(child: Element) { this.children.push(child) }
  addEventListener(_type: string, handler: () => void) { this.clickHandler = handler }
  click() { if (!this.disabled) this.clickHandler() }
}

function fixture() {
  vi.stubGlobal('document', { createElement: () => new Element() })
  vi.stubGlobal('window', { devicePixelRatio: 1 })
  const rows = {
    lang: new Element(), aimAssist: new Element(), quality: new Element(),
    antialias: new Element(), volume: new Element(),
  }
  const settings = new Element()
  const reload = new Element()
  const events: unknown[][] = []
  const view = createMenuSettings(
    rows as unknown as Parameters<typeof createMenuSettings>[0],
    settings as unknown as HTMLElement, reload as unknown as HTMLElement,
    {
      onQuality: v => { events.push(['quality', v]); view.renderQuality(v) },
      onVolume: v => { events.push(['volume', v]); view.renderVolume(v) },
      onAimAssist: v => { events.push(['assist', v]); view.renderAimAssist(v) },
      onLang: v => { events.push(['lang', v, settings.hidden]); view.renderLang(v) },
      onAntialias: v => { events.push(['reload', v]); view.renderAntialias(v) },
    },
    element => { element.hidden = false }, element => { element.hidden = true },
  )
  return { rows, settings, reload, events, view }
}

afterEach(() => vi.unstubAllGlobals())

describe('設定頁的確定才套用', () => {
  it('草稿不套用；取消後再打開，顯示的是已套用的值', () => {
    const f = fixture()
    f.view.renderQuality(0.75)
    f.view.renderVolume(null)
    f.view.openSettings()
    f.rows.quality.children[4]!.click()
    f.rows.volume.children[3]!.click()
    expect(f.events).toEqual([])
    f.settings.hidden = true
    f.view.openSettings()
    expect(f.rows.quality.children[3]!.className).toBe('on')
    expect(f.rows.volume.children[0]!.className).toBe('on')
    f.view.applySettings()
    expect(f.events).toEqual([])
    expect(f.settings.hidden).toBe(true)
  })

  it('等重載確認之後，先套用其他設定再重載', () => {
    const f = fixture()
    f.view.openSettings()
    f.rows.quality.children[4]!.click()
    f.rows.volume.children[0]!.click()
    f.rows.lang.children.find(e => e.className !== 'on')!.click()
    f.rows.aimAssist.children.find(e => e.className !== 'on')!.click()
    f.rows.antialias.children[1]!.click()
    f.view.applySettings()
    expect(f.events).toEqual([])
    expect(f.reload.hidden).toBe(false)
    expect(f.settings.hidden).toBe(false)
    f.view.commitReload()
    expect(f.events.map(e => e[0])).toEqual(['quality', 'volume', 'assist', 'lang', 'reload'])
    expect(f.events[0]).toEqual(['quality', 0.5])
    expect(f.events[1]).toEqual(['volume', null])
    expect(f.events[4]).toEqual(['reload', false])
    expect(f.reload.hidden).toBe(true)
  })

  it('拒絕重載只退回反鋸齒；語言在設定頁關掉之後才換', () => {
    const f = fixture()
    f.view.openSettings()
    f.rows.quality.children[3]!.click()
    f.rows.lang.children.find(e => e.className !== 'on')!.click()
    f.rows.antialias.children[1]!.click()
    f.view.applySettings()
    f.view.cancelReload()
    expect(f.reload.hidden).toBe(true)
    expect(f.settings.hidden).toBe(false)
    expect(f.rows.antialias.children[0]!.className).toBe('on')
    expect(f.rows.quality.children[3]!.className).toBe('on')
    expect(f.rows.quality.children.slice(0, 2).every(e => e.disabled)).toBe(true)
    f.view.applySettings()
    expect(f.events.map(e => e[0])).toEqual(['quality', 'lang'])
    expect(f.events[1]![2]).toBe(true)
  })
})
