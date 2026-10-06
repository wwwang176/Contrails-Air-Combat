import { describe, expect, it } from 'vitest'
import { clearInputHolds } from '../../src/input/holdState'
import { createInputState } from '../../src/input/InputState'

describe('按住類輸入的狀態', () => {
  it('鍵盤油門、煞車與上帝視角移動一起清掉', () => {
    const state = createInputState()
    const hold = { up: true, down: true }
    state.braking = true
    state.godMove = { forward: true, back: true, left: true, right: true, up: true, down: true, boost: true }
    clearInputHolds(state, hold)
    expect(hold).toEqual({ up: false, down: false })
    expect(state.braking).toBe(false)
    expect(state.godMove).toEqual({ forward: false, back: false, left: false, right: false, up: false, down: false, boost: false })
  })
})
