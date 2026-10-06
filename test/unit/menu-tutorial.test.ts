import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMenuTutorial } from '../../src/ui/menuTutorial'
import { BOMB_TUTORIAL, FIGHTER_TUTORIAL, readSeenTutorials } from '../../src/ui/tutorials'
import { setLang, t } from '../../src/i18n'

function fixture() {
  const title = { textContent: '' }
  const panels = { innerHTML: '' }
  const overlay = { hidden: true }
  const root = { querySelector: (selector: string) => selector === '#tut-title' ? title : panels }
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
  })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  const view = createMenuTutorial(
    root as unknown as HTMLElement, overlay as HTMLElement,
    element => { element.hidden = false }, element => { element.hidden = true },
  )
  return { view, title, panels, overlay }
}

afterEach(() => { setLang('zh'); vi.unstubAllGlobals() })

describe('教學畫面佇列', () => {
  it('逐張記錄已讀，最後關閉並只通知完成一次', () => {
    const f = fixture()
    const done = vi.fn(() => { expect(f.overlay.hidden).toBe(true) })
    f.view.showTutorials([FIGHTER_TUTORIAL, BOMB_TUTORIAL], done)
    expect(f.overlay.hidden).toBe(false)
    expect(f.title.textContent).toBe(t(FIGHTER_TUTORIAL.titleKey))
    expect(readSeenTutorials().size).toBe(0)
    f.view.nextTutorial()
    expect(readSeenTutorials()).toEqual(new Set(['fighter']))
    expect(f.title.textContent).toBe(t(BOMB_TUTORIAL.titleKey))
    expect(done).not.toHaveBeenCalled()
    f.view.nextTutorial()
    f.view.nextTutorial()
    expect(done).toHaveBeenCalledTimes(1)
    expect(readSeenTutorials()).toEqual(new Set(['fighter', 'bomb']))
  })

  it('重繪語言與觸控說明不推進佇列或標記已讀', () => {
    const f = fixture()
    f.view.showTutorials([FIGHTER_TUTORIAL], vi.fn())
    setLang('en')
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    f.view.drawTutorial()
    expect(f.title.textContent).toBe(t(FIGHTER_TUTORIAL.titleKey))
    expect(f.panels.innerHTML).toContain(t('tutorial.fighter.1.touch'))
    expect(readSeenTutorials().size).toBe(0)
  })

  it('空佇列立即完成，完成回呼可開啟另一串教學', () => {
    const f = fixture()
    const emptyDone = vi.fn()
    f.view.showTutorials([], emptyDone)
    expect(emptyDone).toHaveBeenCalledTimes(1)
    expect(f.overlay.hidden).toBe(true)
    const secondDone = vi.fn()
    f.view.showTutorials([FIGHTER_TUTORIAL], () => {
      f.view.showTutorials([BOMB_TUTORIAL], secondDone)
    })
    f.view.nextTutorial()
    expect(f.overlay.hidden).toBe(false)
    expect(f.title.textContent).toBe(t(BOMB_TUTORIAL.titleKey))
    f.view.nextTutorial()
    expect(secondDone).toHaveBeenCalledTimes(1)
  })
})
