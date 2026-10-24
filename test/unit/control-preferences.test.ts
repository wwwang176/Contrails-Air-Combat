import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import {
  CONTROL_MODES, DEFAULT_CONTROL_MODE, DEFAULT_STICK_RECENTER, STICK_RECENTER_LEVELS,
  readControlMode, readStickRecenter, saveControlMode, saveStickRecenter,
} from '../../src/input/controlPreferences'

describe('操控方式與搖桿回中的設定', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    ;(globalThis as Record<string, unknown>)['localStorage'] = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    }
  })
  afterEach(() => { delete (globalThis as Record<string, unknown>)['localStorage'] })

  it('沒設定過：滑鼠瞄準、回中關', () => {
    expect(DEFAULT_CONTROL_MODE).toBe('aim')
    expect(DEFAULT_STICK_RECENTER).toBe('off')
    expect(readControlMode()).toBe('aim')
    expect(readStickRecenter()).toBe('off')
  })

  it('存了讀得回來', () => {
    saveControlMode('stick')
    saveStickRecenter('fast')
    expect(readControlMode()).toBe('stick')
    expect(readStickRecenter()).toBe('fast')
  })

  it('不認得的值當成沒設定', () => {
    store.set('input.controlMode', 'joystick')
    store.set('input.stickRecenter', '')
    expect(readControlMode()).toBe('aim')
    expect(readStickRecenter()).toBe('off')
  })

  it('localStorage 拋例外時照預設，存也不拋', () => {
    ;(globalThis as Record<string, unknown>)['localStorage'] = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(readControlMode()).toBe('aim')
    expect(readStickRecenter()).toBe('off')
    expect(() => saveControlMode('stick')).not.toThrow()
    expect(() => saveStickRecenter('slow')).not.toThrow()
  })

  it('設定頁的選項：兩種操控方式、四檔回中，順序固定', () => {
    expect(CONTROL_MODES.map((m) => m.value)).toEqual(['aim', 'stick'])
    expect(STICK_RECENTER_LEVELS.map((m) => m.value)).toEqual(['off', 'slow', 'fast', 'instant'])
  })

  it('「瞬間」存了讀得回來', () => {
    saveStickRecenter('instant')
    expect(readStickRecenter()).toBe('instant')
  })
})
