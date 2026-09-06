import { Vector3 } from 'three'

/** 油門初始值：巡航設定（spec 中的「預設 1 倍速」）。 */
export const CRUISE_THROTTLE = 0.7

/**
 * 上帝視角的六個方向與加速。與 `camera/godCamera.ts` 的 `GodCameraInput`
 * 的前七個欄位**同名**，所以 `main.ts` 抄過去是一對一的，不需要換算。
 */
export interface GodMove {
  /** W */
  forward: boolean
  /** S */
  back: boolean
  /** A */
  left: boolean
  /** D */
  right: boolean
  /** E */
  up: boolean
  /** Q */
  down: boolean
  /** Shift */
  boost: boolean
}

export interface InputState {
  /**
   * 瞄準點，**世界座標**的單位向量。瞄準點是世界固定的。
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
  /**
   * `third` 機外、`first` 座艙、`bomb` 機腹投彈瞄具。
   *
   * 【`bomb` 不在 `V` 的那條軸上】`V` 切的是「座艙／機外」；投彈瞄具是另一
   * 件事，由 `B` 自己切換，而且 `V` 在它之下不作用。
   */
  viewMode: 'third' | 'first' | 'bomb'
  /**
   * 這一台飛機掛得了彈嗎。**由 `main.ts` 在玩家換飛機時寫入。**
   *
   * 【為什麼不是 bindings 自己判斷】`bindings.ts` 是純 DOM 外殼，對飛機
   * 一無所知（見它的檔頭）。寫入點與 `rig.options.firstPersonOffset` 相同
   * —— 那裡本來就是「玩家換了一台飛機」。
   */
  bombCapable: boolean
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
  /**
   * 是否在上帝視角（`G`）。
   *
   * 【它同時開關代飛】進入時 `main.ts` 把 `playerAi` 設為 true，離開時設回
   * false —— 直接對應「取消上帝視角後就回到我自己飛」。副作用是進入前就
   * 開著的 `I` 也會被關掉；刻意不記憶原本的值，那是隱藏狀態，而這個副作用
   * 按一下 `I` 就回來了。
   *
   * 【滑鼠沿用 `aimDeltaX` / `aimDeltaY`】不新增第二組累積器 —— 兩組只會
   * 製造「這一幀該清哪一個」的問題。上帝視角下由 `main.ts` 餵給鏡頭而不是
   * `slewAimWorld`。
   */
  godView: boolean
  /** 上帝視角的移動輸入。`godView` 為 false 時全部為 false */
  godMove: GodMove
  /**
   * 是否顯示指揮官的集合點（`O`）。**觀測工具，不影響任何模擬。**
   *
   * 【為什麼與 `godView` 獨立】要看的正是「跟拍某一架長機時，它與集合點的
   * 相對位置」—— 綁在上帝視角上就看不到那個畫面了。
   *
   * 【為什麼是切換而不是按住】它要觀察的是一個持續數十秒到數分鐘的現象
   * （集合令遲遲不解除），按住式的等於要按著幾分鐘。
   */
  orderMarkers: boolean
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
    bombCapable: false,
    firing: false,
    braking: false,
    playerAi: false,
    godView: false,
    godMove: {
      forward: false, back: false, left: false, right: false,
      up: false, down: false, boost: false,
    },
    orderMarkers: false,
    scoreboardHeld: false,
    pointerLockLost: false,
  }
}
