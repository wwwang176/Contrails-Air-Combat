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
   * 靶機的機動索引，對應 `MANOEUVRES`（0 直線／1 盤旋／2 蛇行／3 爬升）。
   *
   * 【為什麼放在 InputState 而不是直接呼叫 ScriptedController】輸入層是
   * 純 DOM 外殼，對 control/ 沒有依賴（見 bindings.ts 檔頭的同一條理由）。
   */
  droneManoeuvre: number
  /**
   * 靶機是否交給 AI 駕駛。`false` 時走 `droneManoeuvre` 的預錄機動。
   *
   * 【為什麼保留預錄機動】除錯時很有用：AI 出問題時可以先換成已知的
   * 直線或盤旋，確認是 AI 的問題還是別的地方。
   */
  droneAi: boolean
  /**
   * **自機**是否交給 AI 駕駛。純觀測用：讓同一顆 AI 同時開兩台，
   * 從外面看它到底怎麼打。
   *
   * 【為什麼是切換而 `droneAi` 是單向】`5` 有 `1`–`4` 當回頭路，`I` 沒有，
   * 所以它自己必須能收回來——不然接管之後就再也拿不回操縱權了。
   *
   * 接管期間右鍵自由視角照常，左鍵失效（開火由 AI 的開火紀律決定）。
   */
  playerAi: boolean
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
    firing: false,
    braking: false,
    droneManoeuvre: 0,
    droneAi: false,
    playerAi: false,
    resetRequested: false,
    swapSpecRequested: false,
  }
}
