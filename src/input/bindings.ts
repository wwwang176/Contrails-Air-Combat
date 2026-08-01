import { clamp } from '../core/math'
import { AIM_RADIUS, type InputState } from './InputState'

const MOUSE_SENSITIVITY = 1.6
const LOOK_SENSITIVITY = 2.4
const LOOK_YAW_LIMIT = 160 * (Math.PI / 180)
const LOOK_PITCH_LIMIT = 80 * (Math.PI / 180)
const THROTTLE_RATE = 0.6 // 每秒變化量

interface KeyHold {
  up: boolean
  down: boolean
}

/**
 * 綁定鍵鼠事件。回傳解除綁定的函數。
 * 呼叫端需每幀呼叫回傳物件的 tick(dt) 以套用油門的持續變化。
 */
export function attachInput(
  canvas: HTMLCanvasElement,
  state: InputState,
): { detach(): void; tick(dt: number): void } {
  const hold: KeyHold = { up: false, down: false }

  const requestLock = () => {
    if (document.pointerLockElement !== canvas) void canvas.requestPointerLock()
  }

  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) requestLock()
    if (e.button === 2) state.lookActive = true
  }

  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 2) {
      state.lookActive = false
      state.lookYaw = 0
      state.lookPitch = 0
    }
  }

  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return
    const half = window.innerHeight / 2
    if (state.lookActive) {
      state.lookYaw = clamp(
        state.lookYaw - (e.movementX / half) * LOOK_SENSITIVITY,
        -LOOK_YAW_LIMIT, LOOK_YAW_LIMIT,
      )
      state.lookPitch = clamp(
        state.lookPitch - (e.movementY / half) * LOOK_SENSITIVITY,
        -LOOK_PITCH_LIMIT, LOOK_PITCH_LIMIT,
      )
      return
    }
    state.aimX += (e.movementX / half) * MOUSE_SENSITIVITY
    state.aimY -= (e.movementY / half) * MOUSE_SENSITIVITY
    // 夾制於圓內，不是方形——否則對角線方向的操縱量會偏大
    const r = Math.hypot(state.aimX, state.aimY)
    if (r > AIM_RADIUS) {
      state.aimX = (state.aimX / r) * AIM_RADIUS
      state.aimY = (state.aimY / r) * AIM_RADIUS
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.code) {
      case 'KeyW': hold.up = true; break
      case 'KeyS': hold.down = true; break
      case 'KeyV': state.viewMode = state.viewMode === 'third' ? 'first' : 'third'; break
      case 'KeyR': state.resetRequested = true; break
      case 'KeyC': state.swapSpecRequested = true; break
      default: return
    }
    e.preventDefault()
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyW') hold.up = false
    if (e.code === 'KeyS') hold.down = false
  }

  const onContextMenu = (e: Event) => e.preventDefault()

  canvas.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  canvas.addEventListener('contextmenu', onContextMenu)

  return {
    detach() {
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('contextmenu', onContextMenu)
    },
    tick(dt: number) {
      if (hold.up) state.throttle = clamp(state.throttle + THROTTLE_RATE * dt, 0, 1.1)
      if (hold.down) state.throttle = clamp(state.throttle - THROTTLE_RATE * dt, 0, 1.1)
    },
  }
}
