import { describe, it, expect } from 'vitest'
import { BOMB, FULL, WIDGET_DRAW, hudWidgets } from '../../src/hud/Hud'

describe('投彈模式的 HUD 清單', () => {
  it('不含 reticle —— 瞄準點是凍結的，畫出來是誤導', () => {
    expect(BOMB).not.toContain('reticle')
  })

  it('含 bombsight', () => {
    expect(BOMB).toContain('bombsight')
  })

  it('除了準星換掉、加一層暗角之外，與一般飛行相同', () => {
    expect([...BOMB].sort()).toEqual(
      [...FULL.filter((w) => w !== 'reticle'), 'bombsight', 'bombVignette'].sort(),
    )
  })

  it('暗角排在最前面 —— 它壓的是世界，不是儀表', () => {
    expect(BOMB[0]).toBe('bombVignette')
  })

  it('每一項都畫得出來 —— WIDGET_DRAW 不得缺格', () => {
    for (const w of BOMB) expect(typeof WIDGET_DRAW[w]).toBe('function')
  })

  it('hudWidgets 三分支：上帝視角優先於投彈模式', () => {
    expect(hudWidgets(false, false)).toBe(FULL)
    expect(hudWidgets(false, true)).toBe(BOMB)
    // 【上帝視角贏】鏡頭都不在飛機上了，機腹瞄具更沒有意義
    expect(hudWidgets(true, true)).not.toBe(BOMB)
  })

  it('第二個參數有預設值 —— 既有的單參數呼叫點不得被動到', () => {
    expect(hudWidgets(false)).toBe(FULL)
    expect(hudWidgets(true)).toBe(hudWidgets(true, false))
  })
})
