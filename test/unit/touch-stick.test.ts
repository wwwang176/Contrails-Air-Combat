import { afterEach, describe, it, expect, vi } from 'vitest'
import { TOUCH_STICK_RADIUS, touchStickPosition } from '../../src/input/touchStick'
import { attachTouch } from '../../src/input/touch'
import { createInputState } from '../../src/input/InputState'

const R = 50

/** 比值不分 +0 與 −0：畫面 y 反號時位移 0 會得到 −0，對桿量沒有差別 */
function at(out: { x: number; y: number }): [number, number] {
  return [out.x + 0, out.y + 0]
}

describe('touchStickPosition：手指相對按下點的位移 → 搖桿位置', () => {
  const out = { x: 9, y: 9 }

  it('按下點是 0', () => {
    expect(at(touchStickPosition(0, 0, R, out))).toEqual([0, 0])
  })

  it('位移 R 是滿桿；畫面往上拖（y 變小）是正', () => {
    touchStickPosition(R, -R, R, out)
    expect(at(out)).toEqual([1, 1])
    touchStickPosition(-R, R, R, out)
    expect(at(out)).toEqual([-1, -1])
    touchStickPosition(R / 2, 0, R, out)
    expect(at(out)).toEqual([0.5, 0])
  })

  /** 【夾的是方不是圓】與滑鼠搖桿一樣，斜拖到底是滿舵加滿桿 */
  it('超過 R 每軸各自夾在 ±1：斜拖到底是 (1, 1)', () => {
    touchStickPosition(3 * R, -3 * R, R, out)
    expect([out.x, out.y]).toEqual([1, 1])
    touchStickPosition(3 * R, -0.2 * R, R, out)
    expect(out.x).toBe(1)
    expect(out.y).toBeCloseTo(0.2, 12)
  })

  it('寫進傳進來的物件', () => {
    expect(touchStickPosition(1, 1, R, out)).toBe(out)
  })
})

/** 1000×500 的橫放視窗：左半邊 x < 500，滿桿位移 R = 0.12 × 500 = 60 px */
const W = 1000
const H = 500
const RPX = TOUCH_STICK_RADIUS * H

function layer(mode: 'stick' | 'aim' = 'stick') {
  vi.stubGlobal('window', {
    innerWidth: W, innerHeight: H,
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    addEventListener() {},
  })
  vi.stubGlobal('document', { body: { classList: { toggle() {} } }, addEventListener() {} })
  const elements = new Map<string, { hidden: boolean; style: Record<string, string>; textContent: string }>()
  const listeners = new Map<string, (e: unknown) => void>()
  const root = {
    hidden: true,
    querySelector(s: string) {
      if (!elements.has(s)) elements.set(s, { hidden: true, style: {}, textContent: '' })
      return elements.get(s)
    },
    addEventListener(k: string, fn: (e: unknown) => void) { listeners.set(k, fn) },
    setPointerCapture() {},
  }
  const state = createInputState()
  state.controlMode = mode
  const touch = attachTouch(root as unknown as HTMLElement, state)
  touch.sync(true)
  const fire = (k: string, id: number, x: number, y: number) => listeners.get(k)!({
    pointerId: id, pointerType: 'touch', clientX: x, clientY: y,
    target: { closest: () => null }, preventDefault() {},
  })
  return {
    state, touch, box: elements.get('.t-ring.stick')!,
    down: (id: number, x: number, y: number) => fire('pointerdown', id, x, y),
    move: (id: number, x: number, y: number) => fire('pointermove', id, x, y),
    up: (id: number, x: number, y: number) => fire('pointerup', id, x, y),
  }
}

describe('觸控層：左半邊拖曳推搖桿', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('相對按下點換算；方框出現在按下點、邊長 2R；不累加瞄準位移', () => {
    const t = layer()
    t.down(1, 200, 300)
    expect(t.box.hidden).toBe(false)
    expect(t.box.style['width']).toBe(`${2 * RPX}px`)
    expect(t.box.style['transform']).toBe(`translate(${200 - RPX}px, ${300 - RPX}px)`)
    t.move(1, 200 + RPX, 300 - RPX / 2)
    expect(at(t.touch.stick)).toEqual([1, 0.5])
    expect([t.state.aimDeltaX, t.state.aimDeltaY]).toEqual([0, 0])
  })

  it('放開：方框藏起來、不再有手指在推', () => {
    const t = layer()
    expect(t.touch.held).toBe(false)
    t.down(1, 200, 300)
    expect(t.touch.held).toBe(true)
    t.move(1, 260, 300)
    t.up(1, 260, 300)
    expect(t.touch.held).toBe(false)
    expect(t.box.hidden).toBe(true)
  })

  /**
   * 【從留著的桿量接著推】回中「關」或「慢」時放開後桿量還在；再按下去不能先跳回 0。
   * 搖桿中心放在「手指減掉留著的桿量」那裡，方框跟著中心
   */
  it('按下時從留著的桿量接著推，方框以搖桿中心為準', () => {
    const t = layer()
    t.state.stickX = 0.5
    t.state.stickY = -0.25
    t.down(1, 200, 300)
    expect(at(t.touch.stick)).toEqual([0.5, -0.25])
    // 桿量往右、往下推：手指在中心的右下，中心在手指的左上
    const cx = 200 - 0.5 * RPX
    const cy = 300 - 0.25 * RPX
    expect(t.box.style['transform']).toBe(`translate(${cx - RPX}px, ${cy - RPX}px)`)
    t.move(1, 200 + RPX / 4, 300)
    expect(at(t.touch.stick)).toEqual([0.75, -0.25])
  })

  it('設定是滑鼠瞄準：照舊累加瞄準位移，不推搖桿', () => {
    const t = layer('aim')
    t.down(1, 200, 300)
    t.move(1, 260, 300)
    expect(t.state.aimDeltaX).toBeGreaterThan(0)
    expect(at(t.touch.stick)).toEqual([0, 0])
  })

  /** 【上帝視角吃的是瞄準位移】左半邊照舊是瞄準，否則上帝鏡頭轉不動 */
  it('上帝視角下左半邊是瞄準', () => {
    const t = layer()
    t.state.godView = true
    t.down(1, 200, 300)
    t.move(1, 260, 300)
    expect(t.state.aimDeltaX).toBeGreaterThan(0)
    expect(at(t.touch.stick)).toEqual([0, 0])
  })

  /** 【只認一根手指】第二根左半邊的手指整段不算數，放開它不清掉第一根的桿量 */
  it('第二根手指不搶搖桿，放開它不影響第一根', () => {
    const t = layer()
    t.down(1, 200, 300)
    t.move(1, 260, 300)
    t.down(2, 100, 200)
    t.move(2, 40, 200)
    expect(at(t.touch.stick)).toEqual([1, 0])
    t.up(2, 40, 200)
    expect(at(t.touch.stick)).toEqual([1, 0])
    expect(t.box.hidden).toBe(false)
  })

  /** 【歸零後從手指現在的位置重新算】再往右一點只是一點，不是接著上一段的滿桿 */
  it('recentre：位置歸零，手指現在的位置是新的中心', () => {
    const t = layer()
    t.down(1, 200, 300)
    t.move(1, 260, 300)
    t.touch.recentre()
    expect(at(t.touch.stick)).toEqual([0, 0])
    expect(t.box.style['transform']).toBe(`translate(${260 - RPX}px, ${300 - RPX}px)`)
    t.move(1, 260 + RPX / 2, 300)
    expect(at(t.touch.stick)).toEqual([0.5, 0])
  })

  /** 【每幀歸零不寫 DOM】死亡鏡頭期間每幀呼叫；手指不動時中心沒變，不重寫方框位置 */
  it('recentre：中心沒變就不寫方框', () => {
    const t = layer()
    t.down(1, 200, 300)
    t.box.style['transform'] = 'untouched'
    t.touch.recentre()
    t.touch.recentre()
    expect(t.box.style['transform']).toBe('untouched')
  })
})
