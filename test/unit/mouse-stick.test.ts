import { describe, it, expect } from 'vitest'
import {
  STICK_DEADZONE, STICK_GAIN, STICK_RECENTER_SECONDS, shapeStick, stepStick,
} from '../../src/input/mouseStick'
import { createInputState } from '../../src/input/InputState'

const DT = 1 / 60

function state(recenter: 'off' | 'slow' | 'fast' = 'off') {
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

  /** 【夾的是圓不是方】斜推到底與直推到底一樣長 —— 方形的角落會比邊多 41% 的桿量 */
  it('夾進單位圓：超出時沿徑向縮回圓上', () => {
    const s = state()
    stepStick(s, 10, 10, DT)
    expect(Math.hypot(s.stickX, s.stickY)).toBeCloseTo(1, 12)
    expect(s.stickX).toBeCloseTo(s.stickY, 12)
  })

  it('回中「關」：放著不動就停在原地', () => {
    const s = state('off')
    stepStick(s, 0.2, 0, DT)
    const x = s.stickX
    for (let i = 0; i < 600; i++) stepStick(s, 0, 0, DT)
    expect(s.stickX).toBe(x)
  })

  it('回中「慢」「快」：照時間常數衰減，快的比慢的快', () => {
    for (const lv of ['slow', 'fast'] as const) {
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
    expect(STICK_RECENTER_SECONDS.off).toBe(Infinity)
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
