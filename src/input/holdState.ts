import type { InputState } from './InputState'

/** 油門的兩個按住方向。鍵盤與觸控各有一份，`tick` 取聯集 */
export interface ThrottleHold {
  up: boolean
  down: boolean
}

/** 觸控層交給 `tick` 的按住狀態 */
export interface TouchHold extends ThrottleHold {
  /** 開火鈕按著。沒有指標鎖時 `tick` 會清扳機，觸控按著的不清 */
  fire: boolean
}

/** 清除鍵盤與上帝視角共用的按住狀態；切換模式或失去指標鎖時共用。 */
export function clearInputHolds(state: InputState, hold: ThrottleHold): void {
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
