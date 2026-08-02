import { clamp } from '../core/math'
import type { InputState } from './InputState'
import { applyThrottleRate } from './throttle'

const MOUSE_SENSITIVITY = 1.6
/**
 * 自由視角的靈敏度：每移動「一個螢幕半高」轉多少弧度。
 *
 * 比瞄準靈敏度高一截是刻意的——瞄準要能穩穩壓在目標上，看四周則是要能
 * 一把甩過去。5.5 之下掃滿 ±160° 偏航約需 180 px 的滑鼠位移。
 *
 * 手感的另一半在 CameraRig.lookFollowTime——靈敏度決定「移多少轉多少」，
 * 時間常數決定「多久才轉到」。兩個都要短，轉頭才跟手。
 */
const LOOK_SENSITIVITY = 5.5
const LOOK_YAW_LIMIT = 160 * (Math.PI / 180)
const LOOK_PITCH_LIMIT = 80 * (Math.PI / 180)

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
    // 世界固定瞄準點：這裡只累積「本幀的螢幕相對位移」，真正的旋轉由飛行
    // 迴圈以 slewAimWorld 執行——旋轉軸取自相機，而相機不歸輸入層管
    // （bindings 是純 DOM 外殼，對 render/ 沒有依賴）。
    state.aimDeltaX += (e.movementX / half) * MOUSE_SENSITIVITY
    state.aimDeltaY -= (e.movementY / half) * MOUSE_SENSITIVITY
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
      state.throttle = applyThrottleRate(state.throttle, hold.up, hold.down, dt)
    },
  }
}
