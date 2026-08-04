import { describe, it, expect } from 'vitest'
import { nextScreen, type Screen, type ScreenEvent } from '../../src/ui/screens'

describe('nextScreen（M10 spec §3、§4）', () => {
  it('landing 按開始進主選單', () => {
    expect(nextScreen('landing', 'start')).toBe('menu')
  })

  it('主選單的兩張卡各自進去', () => {
    expect(nextScreen('menu', 'mission')).toBe('mission')
    expect(nextScreen('menu', 'skirmish')).toBe('skirmish')
  })

  it('兩個子畫面的返回都回主選單', () => {
    expect(nextScreen('mission', 'back')).toBe('menu')
    expect(nextScreen('skirmish', 'back')).toBe('menu')
  })

  it('設定頁開始戰鬥', () => {
    expect(nextScreen('skirmish', 'fight')).toBe('battle')
  })

  it('結算按「再打一場」留在戰鬥', () => {
    // 【為什麼是 battle → battle】重建戰鬥與換畫面是兩件事。分開之後
    // 狀態機不必知道有「重打」這回事（M10 spec §4）。
    expect(nextScreen('battle', 'fight')).toBe('battle')
  })

  it('結算按「回設定頁」', () => {
    expect(nextScreen('battle', 'toSetup')).toBe('skirmish')
  })

  it('ESC 回主選單', () => {
    expect(nextScreen('battle', 'toMenu')).toBe('menu')
  })

  it('不合法的組合維持原狀，不丟例外', () => {
    // 【為什麼不丟例外】選單上一個按不到的按鈕不該讓整個遊戲當掉。
    const all: Screen[] = ['landing', 'menu', 'mission', 'skirmish', 'battle']
    const events: ScreenEvent[] = [
      'start', 'mission', 'skirmish', 'back', 'fight', 'toMenu', 'toSetup',
    ]
    for (const s of all) {
      for (const e of events) {
        expect(() => nextScreen(s, e)).not.toThrow()
      }
    }
    expect(nextScreen('landing', 'fight')).toBe('landing')
    expect(nextScreen('menu', 'back')).toBe('menu')
    expect(nextScreen('battle', 'start')).toBe('battle')
  })

  it('回不去 landing —— 那是一次性的開場', () => {
    const all: Screen[] = ['menu', 'mission', 'skirmish', 'battle']
    const events: ScreenEvent[] = [
      'start', 'mission', 'skirmish', 'back', 'fight', 'toMenu', 'toSetup',
    ]
    for (const s of all) {
      for (const e of events) expect(nextScreen(s, e)).not.toBe('landing')
    }
  })
})
