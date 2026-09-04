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
): { detach(): void; clearHolds(): void; tick(dt: number): void } {
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
    // 【上帝視角下右鍵不接管滑鼠】自由視角是「相機繞著飛機轉」，而上帝
    // 視角的相機根本不在飛機上，那個概念不存在。照舊接管的話這一段會提早
    // return，`aimDelta` 不再累積 —— 而上帝視角餵給鏡頭的就是那兩個值，
    // 症狀是「按住右鍵鏡頭就不動了」，而按鍵提示裡根本沒有右鍵。
    if (state.lookActive && !state.godView) {
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

  /**
   * 清掉所有會「卡住」的按鍵狀態。
   *
   * 【為什麼進出上帝視角一定要呼叫】與 `tick()` 裡「切出視窗扳機卡住」
   * 同一類 bug：按著 W 按 G，飛行側的 `hold.up` 會留在 true；反過來按著
   * W 離開上帝視角，`godMove.forward` 會留著，下次進來第一幀鏡頭就自己
   * 往前衝。
   *
   * 【也匯出給 `main.ts`】重開一場與換場是直接改 `state.godView` 的，
   * 繞過了 `G` 的處理器。
   */
  const clearHolds = () => {
    hold.up = false
    hold.down = false
    state.braking = false
    const g = state.godMove
    g.forward = false
    g.back = false
    g.left = false
    g.right = false
    g.up = false
    g.down = false
    g.boost = false
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'KeyG') {
      state.godView = !state.godView
      clearHolds()
      e.preventDefault()
      return
    }
    // 【排在上帝視角的改道之前】它兩種視角下都要能按 —— 要看的正是
    // 「跟拍長機時它與集合點的相對位置」，而下面那段會把上帝視角下的
    // 未知按鍵直接吃掉
    if (e.code === 'KeyO') {
      state.orderMarkers = !state.orderMarkers
      e.preventDefault()
      return
    }
    // 【上帝視角把 WASD 整組改道】W/S 是唯一與飛行共用的按鍵；照舊送進
    // 油門的話，你切回來時油門已經飄到 0.7 或 1.1 了
    if (state.godView) {
      switch (e.code) {
        case 'KeyW': state.godMove.forward = true; break
        case 'KeyS': state.godMove.back = true; break
        case 'KeyA': state.godMove.left = true; break
        case 'KeyD': state.godMove.right = true; break
        case 'KeyE': state.godMove.up = true; break
        case 'KeyQ': state.godMove.down = true; break
        case 'ShiftLeft': case 'ShiftRight': state.godMove.boost = true; break
        case 'Tab': state.scoreboardHeld = true; break
        default: return
      }
      e.preventDefault()
      return
    }
    switch (e.code) {
      case 'KeyW': hold.up = true; break
      case 'KeyS': hold.down = true; state.braking = true; break
      // 【只有掛得了彈的飛機能按】`bombCapable` 由 `main.ts` 在換飛機時寫入
      // —— 這一層對飛機一無所知（見檔頭）
      case 'KeyB':
        if (state.bombCapable) state.viewMode = state.viewMode === 'bomb' ? 'third' : 'bomb'
        break
      // 【投彈模式下不作用】`V` 的軸是「座艙／機外」，投彈瞄具不是那條軸上
      // 的一個點。照舊寫成三元式的話 `=== 'third'` 為 false 會把它彈回
      // `third`，等於多了一個沒有人記得的離開鍵
      case 'KeyV':
        if (state.viewMode !== 'bomb') {
          state.viewMode = state.viewMode === 'third' ? 'first' : 'third'
        }
        break
      case 'KeyI': state.playerAi = !state.playerAi; break
      case 'Tab': state.scoreboardHeld = true; break
      default: return
    }
    e.preventDefault()
  }

  const onKeyUp = (e: KeyboardEvent) => {
    // 【放開一律兩邊都清】按下時在飛行、放開時已經在上帝視角（中間按了 G）
    // 是做得到的順序。只清當下那一側會留下一個按不掉的鍵
    switch (e.code) {
      case 'KeyW': hold.up = false; state.godMove.forward = false; break
      case 'KeyS': hold.down = false; state.braking = false; state.godMove.back = false; break
      case 'KeyA': state.godMove.left = false; break
      case 'KeyD': state.godMove.right = false; break
      case 'KeyE': state.godMove.up = false; break
      case 'KeyQ': state.godMove.down = false; break
      case 'ShiftLeft': case 'ShiftRight': state.godMove.boost = false; break
      case 'Tab': state.scoreboardHeld = false; break
      default: break
    }
  }

  const onContextMenu = (e: Event) => e.preventDefault()

  canvas.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  canvas.addEventListener('contextmenu', onContextMenu)

  return {
    clearHolds,
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
      //
      // 【卡住的按鍵也在這裡清】切出視窗時瀏覽器不送 keyup。扳機上面已經
      // 清了，但 `godMove` 更嚴重 —— 油門有 1.1 的上界，鏡頭速度沒有：
      // 上帝視角按著 W 時 Alt-Tab，回來按「繼續」鏡頭就以 300 m/s（按著
      // Shift 是 1200）一路飛走，而且要再按一次 W 並放開才停得下來。
      //
      // 【一定要用邊緣而不是「只要沒鎖定就清」】上帝視角在取得指標鎖之前
      // 也該能用（它全部走鍵盤）；每幀清的話 WASD 永遠不會動。
      if (wasLocked && !locked) {
        state.pointerLockLost = true
        clearHolds()
      }
      wasLocked = locked
      // 【上帝視角不套用油門變化率】W/S 在那個模式下是鏡頭前後，而
      // `applyThrottleRate` 是**彈簧回中**的 —— 照跑的話你切回來時油門
      // 已經被拉回巡航了，等於這個模式偷改了你的飛機設定
      if (!state.godView) {
        state.throttle = applyThrottleRate(state.throttle, hold.up, hold.down, dt)
      }
    },
  }
}
