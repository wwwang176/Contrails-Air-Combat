import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createInputState } from '../../src/input/InputState'
import { releaseTouchGrip, type Grip } from '../../src/input/touchGrip'

function element() {
  return { hidden: false, classList: { remove: vi.fn() } } as unknown as HTMLElement
}

function rings() {
  return { aim: element(), look: element(), stick: element() }
}

const NO_HOLD = () => ({ up: false, down: false, fire: false })

describe('觸控握點放開', () => {
  it('放開環視狀態並把它的圓環藏起來', () => {
    const state = createInputState()
    state.lookActive = true
    state.lookYaw = 1
    state.lookPitch = -1
    const r = rings()
    const grip: Grip = { kind: 'look', x: 0, y: 0, el: element() }
    releaseTouchGrip(grip, state, NO_HOLD(), r, { x: 0, y: 0 })
    expect(state.lookActive).toBe(false)
    expect(state.lookYaw).toBe(0)
    expect(state.lookPitch).toBe(0)
    expect(r.look.hidden).toBe(true)
  })

  /** 【放開立刻回中】觸控的搖桿位置是手指給的，手指離開就沒有桿量 */
  it('放開搖桿握點：位置歸零、方框藏起來', () => {
    const state = createInputState()
    const r = rings()
    const stick = { x: 0.7, y: -0.4 }
    const grip: Grip = { kind: 'stick', x: 0, y: 0, el: null }
    releaseTouchGrip(grip, state, NO_HOLD(), r, stick)
    expect(stick).toEqual({ x: 0, y: 0 })
    expect(r.stick.hidden).toBe(true)
    expect(r.aim.hidden).toBe(false)
  })

  it('放開其他握點不動搖桿位置', () => {
    const state = createInputState()
    const stick = { x: 0.7, y: -0.4 }
    releaseTouchGrip({ kind: 'fire', x: 0, y: 0, el: element() }, state, NO_HOLD(), rings(), stick)
    expect(stick).toEqual({ x: 0.7, y: -0.4 })
  })

  /** 【望遠鈕是按住的】放開就結束，與鍵盤的 V 一樣 */
  it('放開望遠鈕結束望遠；按下望遠鈕開始望遠', () => {
    const state = createInputState()
    state.zoom = true
    const grip: Grip = { kind: 'view', x: 0, y: 0, el: element() }
    releaseTouchGrip(grip, state, NO_HOLD(), rings(), { x: 0, y: 0 })
    expect(state.zoom).toBe(false)
    const touch = readFileSync('src/input/touch.ts', 'utf8')
    expect(touch).toContain("case 'view': if (!state.dead) state.zoom = true; break")
  })

  it('清掉按鈕狀態，不影響無關的按住輸入', () => {
    const state = createInputState()
    state.firing = true
    const hold = { up: true, down: false, fire: true }
    const grip: Grip = { kind: 'fire', x: 0, y: 0, el: element() }
    releaseTouchGrip(grip, state, hold, rings(), { x: 0, y: 0 })
    expect(state.firing).toBe(false)
    expect(hold).toEqual({ up: true, down: false, fire: false })
  })
})
