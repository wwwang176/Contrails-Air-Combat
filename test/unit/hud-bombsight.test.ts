import { describe, it, expect } from 'vitest'
import { BOMB, FULL, WIDGET_DRAW, hudWidgets } from '../../src/hud/Hud'
import { bombsightStyle } from '../../src/hud/widgets/bombsight'

describe('投彈模式的 HUD 清單', () => {
  it('不含 reticle —— 瞄準點是凍結的，畫出來是誤導', () => {
    expect(BOMB).not.toContain('reticle')
  })

  it('含 bombsight', () => {
    expect(BOMB).toContain('bombsight')
  })

  it('除了拿掉準星、加一層暗角之外，與一般飛行相同', () => {
    expect([...BOMB].sort()).toEqual(
      [...FULL.filter((w) => w !== 'reticle'), 'bombVignette'].sort(),
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

describe('一般飛行的 HUD 清單', () => {
  it('含 bombsight —— 落點圈不是投彈模式限定', () => {
    expect(FULL).toContain('bombsight')
  })

  it('落點圈排在準星之後 —— 兩個都在時準星壓在下面', () => {
    expect(FULL.indexOf('bombsight')).toBeGreaterThan(FULL.indexOf('reticle'))
  })

  it('含 bombBay —— 彈艙讀數是儀表，不跟著瞄具走', () => {
    expect(FULL).toContain('bombBay')
  })

  it('不含暗角 —— 那是投彈模式限定', () => {
    expect(FULL).not.toContain('bombVignette')
  })
})

describe('bombsightStyle', () => {
  it('不是轟炸機時什麼都不畫', () => {
    expect(bombsightStyle(false, 'off', false)).toBe('hidden')
    expect(bombsightStyle(true, 'off', true)).toBe('hidden')
  })

  it('投彈模式有解且在畫面上：實線圈', () => {
    expect(bombsightStyle(true, 'solved', true)).toBe('ring')
  })

  it('一般模式有解且在畫面上：暗色圈 —— 與機槍準星要分得出來', () => {
    expect(bombsightStyle(false, 'solved', true)).toBe('faint')
  })

  it('投彈模式解不出來或圈滑出畫面：中心留一個點', () => {
    expect(bombsightStyle(true, 'none', false)).toBe('dot')
    expect(bombsightStyle(true, 'solved', false)).toBe('dot')
  })

  it('一般模式解不出來或圈在畫面外：什麼都不畫', () => {
    // 【為什麼不留中心點】畫面中央已經有機槍準星，再疊一個灰點只會讀成
    // 準星的一部分
    expect(bombsightStyle(false, 'none', false)).toBe('hidden')
    expect(bombsightStyle(false, 'solved', false)).toBe('hidden')
  })
})
