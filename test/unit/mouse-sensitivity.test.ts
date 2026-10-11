import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import {
  DEFAULT_MOUSE_SENSITIVITY, MOUSE_SENSITIVITY_MAX, MOUSE_SENSITIVITY_MIN, MOUSE_SENSITIVITY_STEP,
  readMouseSensitivity, saveMouseSensitivity, snapMouseSensitivity,
} from '../../src/input/mouseSensitivity'

describe('滑鼠靈敏度設定', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    ;(globalThis as Record<string, unknown>)['localStorage'] = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    }
  })
  afterEach(() => { delete (globalThis as Record<string, unknown>)['localStorage'] })

  it('範圍 0.5～4 倍、每步 0.1，預設 1 倍', () => {
    expect([MOUSE_SENSITIVITY_MIN, MOUSE_SENSITIVITY_MAX, MOUSE_SENSITIVITY_STEP]).toEqual([0.5, 4, 0.1])
    expect(DEFAULT_MOUSE_SENSITIVITY).toBe(1)
    expect(readMouseSensitivity()).toBe(1)
  })

  it('存了讀得回來', () => {
    saveMouseSensitivity(2.3)
    expect(readMouseSensitivity()).toBe(2.3)
    saveMouseSensitivity(0.5)
    expect(readMouseSensitivity()).toBe(0.5)
  })

  it('壞掉、空字串、超出範圍的值當成沒設定', () => {
    for (const v of ['abc', '', '  ', '0', '0.4', '4.1', 'NaN', 'Infinity']) {
      store.set('input.mouseSensitivity', v)
      expect(readMouseSensitivity(), JSON.stringify(v)).toBe(DEFAULT_MOUSE_SENSITIVITY)
    }
  })

  it('對齊到 0.1 的格子、夾在範圍內', () => {
    expect(snapMouseSensitivity(1.2345)).toBe(1.2)
    expect(snapMouseSensitivity(0.30000000000000004 * 10)).toBe(3)
    expect(snapMouseSensitivity(0.1)).toBe(0.5)
    expect(snapMouseSensitivity(9)).toBe(4)
    store.set('input.mouseSensitivity', '1.26')
    expect(readMouseSensitivity()).toBe(1.3)
  })

  it('localStorage 拋例外照樣能跑', () => {
    ;(globalThis as Record<string, unknown>)['localStorage'] = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(readMouseSensitivity()).toBe(DEFAULT_MOUSE_SENSITIVITY)
    expect(() => saveMouseSensitivity(2)).not.toThrow()
  })
})
