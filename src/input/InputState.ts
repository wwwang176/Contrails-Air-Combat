import { Vector3 } from 'three'

/**
 * 準星可移動範圍的半徑，單位為螢幕半高。
 * 世界固定瞄準點模型下，它的角度等價物是 `maxAimAngle`（見 input/aim.ts）。
 */
export const AIM_RADIUS = 0.35

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
  /** 單幀旗標，消費後由呼叫端清除 */
  resetRequested: boolean
  /** 單幀旗標，切換機種 */
  swapSpecRequested: boolean
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
    resetRequested: false,
    swapSpecRequested: false,
  }
}
