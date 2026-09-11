import { describe, it, expect } from 'vitest'
import { nextScreen, type Screen, type ScreenEvent } from '../../src/ui/screens'

describe('nextScreen（M10 spec §3、§4）', () => {
  it('landing 按開始進主選單', () => {
    expect(nextScreen('landing', 'start')).toBe('menu')
  })

  it('主選單的兩張卡各自進去 —— 任務先到陣營頁', () => {
    expect(nextScreen('menu', 'mission')).toBe('campaign')
    expect(nextScreen('menu', 'skirmish')).toBe('skirmish')
  })

  it('遭遇戰的返回回主選單；任務簡報的返回回陣營頁', () => {
    expect(nextScreen('skirmish', 'back')).toBe('menu')
    expect(nextScreen('mission', 'back')).toBe('campaign')
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
    const all: Screen[] = ['landing', 'menu', 'campaign', 'mission', 'skirmish', 'battle', 'hangar']
    const events: ScreenEvent[] = [
      'start', 'mission', 'skirmish', 'hangar', 'back', 'fight', 'toMenu', 'toSetup', 'toMission',
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
    const all: Screen[] = ['menu', 'campaign', 'mission', 'skirmish', 'battle', 'hangar']
    const events: ScreenEvent[] = [
      'start', 'mission', 'skirmish', 'hangar', 'back', 'fight', 'toMenu', 'toSetup', 'toMission',
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

  it('任務簡報的返回是陣營頁，不是主選單', () => {
    expect(nextScreen('mission', 'back')).toBe('campaign')
  })
})

/**
 * 陣營頁（選單重做 spec §1）。
 *
 * 【為什麼多一頁而不是分頁】「站哪一邊」用三張照片講；
 * 簡報頁**沒有**陣營分頁，換陣營要退回來 —— 一個地方只做一件事。
 */
describe('陣營頁', () => {
  it('點一張陣營卡進簡報', () => {
    expect(nextScreen('campaign', 'mission')).toBe('mission')
  })

  it('返回回主選單', () => {
    expect(nextScreen('campaign', 'back')).toBe('menu')
  })

  it('陣營頁不能直接開打，也不吃結算的兩個出口', () => {
    expect(nextScreen('campaign', 'fight')).toBe('campaign')
    expect(nextScreen('campaign', 'toSetup')).toBe('campaign')
    expect(nextScreen('campaign', 'toMission')).toBe('campaign')
  })

  it('結算回任務列表是回簡報頁（同一條線），不是陣營頁', () => {
    expect(nextScreen('battle', 'toMission')).toBe('mission')
  })
})

/**
 * 機庫。**它是死路** —— 進去看飛機，出來只有回主選單一條。
 *
 * 【為什麼不讓它直接開打】「選這一台出擊」是編組頁的工作。機庫多開一條
 * 進戰鬥的路，就多一個必須先呼叫 `enterBattle()` 的地方（見 `main.ts` 的
 * `battle` 那個不變式），而漏掉的症狀是整頁當掉。
 */
describe('機庫', () => {
  it('主選單進得去，返回回主選單', () => {
    expect(nextScreen('menu', 'hangar')).toBe('hangar')
    expect(nextScreen('hangar', 'back')).toBe('menu')
  })

  it('機庫開不了打，也吃不到結算的三個出口', () => {
    expect(nextScreen('hangar', 'fight')).toBe('hangar')
    expect(nextScreen('hangar', 'toMenu')).toBe('hangar')
    expect(nextScreen('hangar', 'toSetup')).toBe('hangar')
    expect(nextScreen('hangar', 'toMission')).toBe('hangar')
  })

  it('只有主選單去得了機庫', () => {
    const others: Screen[] = ['landing', 'campaign', 'mission', 'skirmish', 'battle']
    for (const s of others) expect(nextScreen(s, 'hangar')).toBe(s)
  })
})
