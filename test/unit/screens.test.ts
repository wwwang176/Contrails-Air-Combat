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

describe('任務模式的兩條轉移（任務框架 spec §7.8）', () => {
  it('任務列表可以開打', () => {
    expect(nextScreen('mission', 'fight')).toBe('battle')
  })

  it('結算可以回任務列表', () => {
    expect(nextScreen('battle', 'toMission')).toBe('mission')
  })

  /**
   * 【為什麼是兩個事件而不是一個「回上一頁」】狀態機不該記得歷史 ——
   * 那會讓同一個轉移在不同的來路下有不同的結果，也就不再是一張表。
   */
  it('遭遇戰頁送 toMission 不動 —— 不合法的組合回傳 current', () => {
    expect(nextScreen('skirmish', 'toMission')).toBe('skirmish')
  })

  it('任務列表送 toSetup 也不動', () => {
    expect(nextScreen('mission', 'toSetup')).toBe('mission')
  })

  it('任務列表仍然回得了主選單', () => {
    expect(nextScreen('mission', 'back')).toBe('menu')
  })
})
