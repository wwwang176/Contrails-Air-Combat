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

/** 拉桿：只有 value 與 input 事件 */
class Range {
  value = ''
  private inputHandler = () => {}
  addEventListener(type: string, handler: () => void) { if (type === 'input') this.inputHandler = handler }
  drag(value: string) { this.value = value; this.inputHandler() }
}

function fixture() {
  vi.stubGlobal('document', { createElement: () => new Element() })
  vi.stubGlobal('window', { devicePixelRatio: 1 })
  const rows = {
    lang: new Element(), aimAssist: new Element(), quality: new Element(),
    antialias: new Element(), volume: new Element(),
    mouse: new Range(), mouseValue: { textContent: '' },
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
      onMouseSensitivity: v => { events.push(['mouse', v]); view.renderMouseSensitivity(v) },
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
    f.rows.mouse.drag('3.2')
    f.rows.antialias.children[1]!.click()
    f.view.applySettings()
    expect(f.events).toEqual([])
    expect(f.reload.hidden).toBe(false)
    expect(f.settings.hidden).toBe(false)
    f.view.commitReload()
    expect(f.events.map(e => e[0])).toEqual(['quality', 'volume', 'assist', 'mouse', 'lang', 'reload'])
    expect(f.events[3]).toEqual(['mouse', 3.2])
    expect(f.events[0]).toEqual(['quality', 0.5])
    expect(f.events[1]).toEqual(['volume', null])
    expect(f.events[5]).toEqual(['reload', false])
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

describe('設定頁的滑鼠靈敏度拉桿', () => {
  it('拉動只改草稿與讀數；取消再打開回到已套用的值', () => {
    const f = fixture()
    f.view.renderMouseSensitivity(1.5)
    expect(f.rows.mouse.value).toBe('1.5')
    expect(f.rows.mouseValue.textContent).toBe('1.5x')
    f.view.openSettings()
    f.rows.mouse.drag('2.3')
    expect(f.rows.mouseValue.textContent).toBe('2.3x')
    expect(f.events).toEqual([])
    f.settings.hidden = true
    f.view.openSettings()
    expect(f.rows.mouse.value).toBe('1.5')
    expect(f.rows.mouseValue.textContent).toBe('1.5x')
  })

  it('按確定才送出，值對齊到 0.1', () => {
    const f = fixture()
    f.view.renderMouseSensitivity(1)
    f.view.openSettings()
    f.rows.mouse.drag('2.3000000000000003')
    f.view.applySettings()
    expect(f.events).toEqual([['mouse', 2.3]])
    expect(f.settings.hidden).toBe(true)
  })

  it('沒拉動就按確定不送事件', () => {
    const f = fixture()
    f.view.renderMouseSensitivity(1)
    f.view.openSettings()
    f.view.applySettings()
    expect(f.events).toEqual([])
  })
})

describe('設定頁的恢復預設值', () => {
  it('草稿回到預設值（語言不動），按確定才送出', () => {
    const f = fixture()
    f.view.renderLang('en')
    f.view.renderQuality(0.5)
    f.view.renderVolume(-12)
    f.view.renderAimAssist(false)
    f.view.renderMouseSensitivity(3)
    f.view.openSettings()
    f.view.resetSettings()
    expect(f.events).toEqual([])
    expect(f.rows.quality.children.find(e => e.className === 'on')).toBe(f.rows.quality.children[2])
    expect(f.rows.volume.children[3]!.className).toBe('on')
    expect(f.rows.aimAssist.children[0]!.className).toBe('on')
    expect(f.rows.mouse.value).toBe('1')
    expect(f.rows.mouseValue.textContent).toBe('1.0x')
    expect(f.rows.lang.children[1]!.className).toBe('on')
    f.view.applySettings()
    expect(f.events).toEqual([['quality', 1], ['volume', 0], ['assist', true], ['mouse', 1]])
  })

  it('抗鋸齒回到預設時照樣先問重新載入', () => {
    const f = fixture()
    f.view.renderAntialias(false)
    f.view.openSettings()
    f.view.resetSettings()
    f.view.applySettings()
    expect(f.reload.hidden).toBe(false)
    expect(f.events).toEqual([])
  })

  it('恢復之後按取消，再打開還是原本已套用的值', () => {
    const f = fixture()
    f.view.renderVolume(-12)
    f.view.openSettings()
    f.view.resetSettings()
    f.settings.hidden = true
    f.view.openSettings()
    expect(f.rows.volume.children[1]!.className).toBe('on')
  })
})
