/** 準星可移動範圍的半徑，單位為螢幕半高。 */
export const AIM_RADIUS = 0.35

/** 油門初始值：巡航設定（spec 中的「預設 1 倍速」）。 */
export const CRUISE_THROTTLE = 0.7

export interface InputState {
  /** 準星水平位置，單位螢幕半高，夾制於 AIM_RADIUS 圓內 */
  aimX: number
  /** 準星垂直位置，單位螢幕半高 */
  aimY: number
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
    aimX: 0,
    aimY: 0,
    throttle: CRUISE_THROTTLE,
    lookActive: false,
    lookYaw: 0,
    lookPitch: 0,
    viewMode: 'third',
    resetRequested: false,
    swapSpecRequested: false,
  }
}
