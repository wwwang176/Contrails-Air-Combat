import { describe, expect, it, vi } from 'vitest'
import { createInputState } from '../../src/input/InputState'
import { releaseTouchGrip, type Grip } from '../../src/input/touchGrip'

function element() {
  return { hidden: false, classList: { remove: vi.fn() } } as unknown as HTMLElement
}

describe('touch grip release', () => {
  it('releases look state and hides its ring', () => {
    const state = createInputState()
    state.lookActive = true
    state.lookYaw = 1
    state.lookPitch = -1
    const ring = element()
    const grip: Grip = { kind: 'look', x: 0, y: 0, el: element() }
    releaseTouchGrip(grip, state, { up: false, down: false, fire: false }, element(), ring)
    expect(state.lookActive).toBe(false)
    expect(state.lookYaw).toBe(0)
    expect(state.lookPitch).toBe(0)
    expect(ring.hidden).toBe(true)
  })

  it('clears button state without affecting unrelated holds', () => {
    const state = createInputState()
    state.firing = true
    const hold = { up: true, down: false, fire: true }
    const grip: Grip = { kind: 'fire', x: 0, y: 0, el: element() }
    releaseTouchGrip(grip, state, hold, element(), element())
    expect(state.firing).toBe(false)
    expect(hold).toEqual({ up: true, down: false, fire: false })
  })
})
