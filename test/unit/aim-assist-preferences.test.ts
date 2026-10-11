import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { readAimAssist, saveAimAssist } from '../../src/input/aimAssistPreferences'

describe('瞄準輔助設定', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    ;(globalThis as Record<string, unknown>)['localStorage'] = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    }
  })
  afterEach(() => { delete (globalThis as Record<string, unknown>)['localStorage'] })

  it('沒設定過是開', () => {
    expect(readAimAssist()).toBe(true)
  })

  it('關掉之後讀得回來', () => {
    saveAimAssist(false)
    expect(readAimAssist()).toBe(false)
    saveAimAssist(true)
    expect(readAimAssist()).toBe(true)
  })

  it('localStorage 拋例外時照預設開', () => {
    ;(globalThis as Record<string, unknown>)['localStorage'] = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(readAimAssist()).toBe(true)
    expect(() => saveAimAssist(false)).not.toThrow()
  })
})
