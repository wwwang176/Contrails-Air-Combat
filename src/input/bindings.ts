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
  /**
   * 上一次觀察到有沒有鎖定。用來做邊緣偵測 —— 見 `InputState.pointerLockLost`。
   *
   * 【為什麼初值讀當下而不是寫死 false】掛上來的那一刻就是第一次觀察。
   * 寫死 false 的話，「掛上時已鎖定、下一幀就掉了」這個順序偵測不到 ——
   * 而那正是玩家在戰鬥中按 ESC 的情形。
   */
  let wasLocked = document.pointerLockElement === canvas

  const requestLock = () => {
    if (document.pointerLockElement !== canvas) void canvas.requestPointerLock()
  }

  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      // 【左鍵一鍵兩用】未鎖定指標時它是「進入遊戲」，已鎖定時才是扳機。
      // 這與 spec §8 的裁決一致，也避免玩家第一次點畫面就打出一串子彈。
      if (document.pointerLockElement === canvas) state.firing = true
      else requestLock()
    }
    if (e.button === 2) state.lookActive = true
  }

  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) state.firing = false
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
      case 'KeyS': hold.down = true; state.braking = true; break
      case 'KeyV': state.viewMode = state.viewMode === 'third' ? 'first' : 'third'; break
      case 'KeyR': state.resetRequested = true; break
      case 'KeyI': state.playerAi = !state.playerAi; break
      case 'Tab': state.scoreboardHeld = true; break
      default: return
    }
    e.preventDefault()
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyW') hold.up = false
    if (e.code === 'KeyS') { hold.down = false; state.braking = false }
    if (e.code === 'Tab') state.scoreboardHeld = false
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
      // 切出視窗會失去指標鎖，但 mouseup 不見得送得到——不清的話扳機會卡住，
      // 玩家切回來時發現自己一直在開火。
      //
      // 【為什麼在 tick 檢查而不是監聽 pointerlockchange】既有測試的 document
      // 替身只有 pointerLockElement 一個欄位，沒有 addEventListener——加監聽器
      // 會讓 bindings.test.ts 整檔在 attachInput 就拋錯。tick 每幀本來就會被
      // 呼叫，順手比對一次是零成本的。M10 的暫停也靠這個輪詢。
      const locked = document.pointerLockElement === canvas
      if (!locked) state.firing = false
      // 【邊緣偵測】沒有它的話，鎖定沒回來的每一幀都會再送一次暫停，
      // 玩家按「繼續」會立刻被彈回暫停選單
      if (wasLocked && !locked) state.pointerLockLost = true
      wasLocked = locked
      state.throttle = applyThrottleRate(state.throttle, hold.up, hold.down, dt)
    },
  }
}
