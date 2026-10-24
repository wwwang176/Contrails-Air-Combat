import { describe, it, expect } from 'vitest'
import {
  STICK_DEADZONE, STICK_GAIN, STICK_RECENTER_GAIN, STICK_RECENTER_SECONDS, shapeStick, stepStick,
} from '../../src/input/mouseStick'
import { createInputState } from '../../src/input/InputState'

const DT = 1 / 60

function state(recenter: 'off' | 'slow' | 'fast' | 'instant' = 'off') {
  const s = createInputState()
  s.stickRecenter = recenter
  return s
}

describe('stepStick：搖桿位置', () => {
  it('滑鼠位移乘 STICK_GAIN 累積；右、上為正', () => {
    const s = state()
    stepStick(s, 0.1, 0, DT)
    expect(s.stickX).toBeCloseTo(0.1 * STICK_GAIN, 12)
    stepStick(s, 0, 0.05, DT)
    expect(s.stickY).toBeCloseTo(0.05 * STICK_GAIN, 12)
    expect(s.stickX).toBeCloseTo(0.1 * STICK_GAIN, 12)
  })

  /** 【夾的是方不是圓】兩軸各自獨立，跟實體搖桿一樣：斜推到底是滿舵加滿桿 */
  it('每軸各自夾在 ±1：斜推到底是 (1, 1)', () => {
    const s = state()
    stepStick(s, 10, 10, DT)
    expect([s.stickX, s.stickY]).toEqual([1, 1])
    stepStick(s, -30, -30, DT)
    expect([s.stickX, s.stickY]).toEqual([-1, -1])
  })

  it('一軸頂到邊，另一軸不被拉回', () => {
    const s = state()
    stepStick(s, 10, 0.1, DT)
    expect(s.stickX).toBe(1)
    expect(s.stickY).toBeCloseTo(0.1 * STICK_GAIN, 12)
  })

  it('回中「關」：放著不動就停在原地', () => {
    const s = state('off')
    stepStick(s, 0.2, 0, DT)
    const x = s.stickX
    for (let i = 0; i < 600; i++) stepStick(s, 0, 0, DT)
    expect(s.stickX).toBe(x)
  })

  it('回中「慢」「快」「瞬間」：照時間常數衰減，越後面越快', () => {
    for (const lv of ['slow', 'fast', 'instant'] as const) {
      const s = state(lv)
      stepStick(s, 0.2, 0, 0)
      const x0 = s.stickX
      const tau = STICK_RECENTER_SECONDS[lv]
      const steps = Math.round(tau / DT)
      for (let i = 0; i < steps; i++) stepStick(s, 0, 0, DT)
      // 一個時間常數之後剩 1/e
      expect(s.stickX / x0).toBeCloseTo(Math.exp(-steps * DT / tau), 9)
    }
    expect(STICK_RECENTER_SECONDS.fast).toBeLessThan(STICK_RECENTER_SECONDS.slow)
    expect(STICK_RECENTER_SECONDS.instant).toBeLessThan(STICK_RECENTER_SECONDS.fast)
    expect(STICK_RECENTER_SECONDS.off).toBe(Infinity)
  })

  /** 等速移動 `seconds` 秒之後的桿量；`fps` 是每秒幾幀 */
  function steady(lv: 'slow' | 'fast' | 'instant', speed: number, fps: number, seconds = 1) {
    const s = state(lv)
    const dt = 1 / fps
    for (let i = 0; i < seconds * fps; i++) stepStick(s, speed * dt, 0, dt)
    return s
  }

  /**
   * 【穩態桿量與幀率無關】等速移動時桿量 = 滑鼠速度 × STICK_GAIN × 倍率 × 時間常數。
   * 60 與 240 FPS 推出來要一樣，否則換一台螢幕手感就變
   */
  it('等速移動：穩態桿量與幀率無關', () => {
    for (const lv of ['slow', 'fast', 'instant'] as const) {
      const speed = 0.1
      const want = speed * STICK_GAIN * STICK_RECENTER_GAIN[lv] * STICK_RECENTER_SECONDS[lv]
      expect(steady(lv, speed, 60, 16).stickX, lv).toBeCloseTo(want, 6)
      expect(steady(lv, speed, 240, 16).stickX, lv).toBeCloseTo(want, 6)
    }
  })

  /** 【瞬間的靈敏度與快一樣】時間常數短，位移的倍率乘回來；只縮短回中，不改推桿要多快 */
  it('瞬間：同一個滑鼠速度推出的桿量與「快」一樣，停手之後 0.1 s 內回中', () => {
    const fast = steady('fast', 0.2, 60, 3)
    const instant = steady('instant', 0.2, 60, 3)
    expect(instant.stickX).toBeCloseTo(fast.stickX, 6)
    const x0 = instant.stickX
    for (let i = 0; i < 6; i++) stepStick(instant, 0, 0, DT)
    expect(instant.stickX / x0).toBeLessThan(0.05)
    for (let i = 0; i < 6; i++) stepStick(fast, 0, 0, DT)
    expect(fast.stickX / x0).toBeGreaterThan(0.3)
  })

  it('暫停（dt = 0）不回中', () => {
    const s = state('fast')
    stepStick(s, 0.2, 0, 0)
    const x = s.stickX
    for (let i = 0; i < 100; i++) stepStick(s, 0, 0, 0)
    expect(s.stickX).toBe(x)
  })
})

describe('shapeStick：死區與指數曲線', () => {
  const out = { roll: 0, pitch: 0 }

  it('置中是 0；死區內是 0', () => {
    expect(shapeStick(0, 0, out)).toEqual({ roll: 0, pitch: 0 })
    shapeStick(STICK_DEADZONE * 0.9, 0, out)
    expect(out.roll).toBe(0)
  })

  it('滿桿是 1：四個方向', () => {
    shapeStick(1, 0, out)
    expect(out.roll).toBeCloseTo(1, 12)
    shapeStick(-1, 0, out)
    expect(out.roll).toBeCloseTo(-1, 12)
    shapeStick(0, 1, out)
    expect(out.pitch).toBeCloseTo(1, 12)
    shapeStick(0, -1, out)
    expect(out.pitch).toBeCloseTo(-1, 12)
  })

  it('斜推到底：兩軸都是 1', () => {
    shapeStick(1, 1, out)
    expect(out.roll).toBeCloseTo(1, 12)
    expect(out.pitch).toBeCloseTo(1, 12)
  })

  /** 【死區每軸各自算】另一軸推滿時，這一軸的微小抖動照樣是 0 */
  it('一軸推滿、另一軸在死區內：那一軸是 0', () => {
    shapeStick(1, STICK_DEADZONE * 0.9, out)
    expect(out.roll).toBeCloseTo(1, 12)
    expect(out.pitch).toBe(0)
  })

  it('單調遞增，中段比線性細', () => {
    let prev = -1
    for (let i = 0; i <= 100; i++) {
      shapeStick(i / 100, 0, out)
      expect(out.roll).toBeGreaterThanOrEqual(prev)
      prev = out.roll
    }
    shapeStick(0.5, 0, out)
    expect(out.roll).toBeLessThan(0.5)
    expect(out.roll).toBeGreaterThan(0.2)
  })

  it('寫進傳進來的物件', () => {
    expect(shapeStick(0.3, 0.3, out)).toBe(out)
  })
})
