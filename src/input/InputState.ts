import { Vector3 } from 'three'

/** 油門初始值：巡航設定（spec 中的「預設 1 倍速」）。 */
export const CRUISE_THROTTLE = 0.7

export interface InputState {
  /**
   * 瞄準點，**世界座標**的單位向量（專案負責人裁決：世界固定瞄準點）。
   *
   * 玩家的滑鼠位移繞相機的右／上軸旋轉它（`slewAimWorld`），飛機再飛到
   * 它身上並停住。存世界向量而不是螢幕偏移，是「十字追得到圓圈」的前提：
   * 機體固定的偏移在純橫向時誤差角恆定、永遠不收斂。
   * 初始值為姿態單位四元數下的機首方向 −Z。
   */
  aimWorld: Vector3
  /** 本幀累積的滑鼠水平位移，單位螢幕半高，右為正。消費後由呼叫端歸零 */
  aimDeltaX: number
  /** 本幀累積的滑鼠垂直位移，單位螢幕半高，上為正。消費後由呼叫端歸零 */
  aimDeltaY: number
  /** 0 ~ 1.1，1.1 為 WEP */
  throttle: number
  /** 右鍵是否按住 */
  lookActive: boolean
  /** 自由視角偏移，rad */
  lookYaw: number
  lookPitch: number
  viewMode: 'third' | 'first'
  /**
   * 扳機是否按住（滑鼠左鍵）。
   *
   * 【為什麼不是單幀旗標】射速時鐘吃的是「這一個物理步扳機在不在」，
   * 240 Hz 下一幀會走好幾步；單幀旗標會讓同一次點擊在多個步裡各觸發一次。
   */
  firing: boolean
  /**
   * 是否按住減速（S）。
   *
   * 與油門是**同一個鍵**：按住 S 同時收油門到下限並套用額外阻力。一鍵一概念，
   * 玩家不需要知道它在物理上做了什麼（M4 spec §2.1）。
   */
  braking: boolean
  /**
   * **自機**是否交給 AI 駕駛。純觀測用：讓同一顆 AI 同時開兩台，
   * 從外面看它到底怎麼打。
   *
   * 【為什麼是切換】接管之後必須拿得回操縱權，所以 `I` 是雙向的。M5 之前
   * 還有 `1`–`5` 可以切換靶機的駕駛者，20v20 裡沒有「靶機」這個角色了，
   * 那組按鍵連同 `droneAi` / `droneManoeuvre` 一起移除。
   *
   * 接管期間右鍵自由視角照常，左鍵失效（開火由 AI 的開火紀律決定）。
   */
  playerAi: boolean
  /** 單幀旗標，消費後由呼叫端清除 */
  resetRequested: boolean
  /** 單幀旗標，切換機種 */
  swapSpecRequested: boolean
  /**
   * 記分板是否按住（Tab）。
   *
   * 【為什麼是按住而不是切換】看戰績是一個「瞄一眼」的動作。切換式的話，
   * 忘了關就會擋著半個畫面繼續打。
   */
  scoreboardHeld: boolean
  /**
   * 這一幀剛失去指標鎖定。**單幀旗標，呼叫端消費後自行清除。**
   *
   * 【為什麼暫停要靠它而不是 Escape 的 keydown】指標鎖定期間按 ESC，
   * 瀏覽器會解除鎖定並吃掉那個鍵盤事件 —— 那是安全行為，繞不過去
   * （M10 spec §8.2）。
   */
  pointerLockLost: boolean
}

export function createInputState(): InputState {
  return {
    aimWorld: new Vector3(0, 0, -1),
    aimDeltaX: 0,
    aimDeltaY: 0,
    throttle: CRUISE_THROTTLE,
    lookActive: false,
    lookYaw: 0,
    lookPitch: 0,
    viewMode: 'third',
    firing: false,
    braking: false,
    playerAi: false,
    resetRequested: false,
    swapSpecRequested: false,
    scoreboardHeld: false,
    pointerLockLost: false,
  }
}
