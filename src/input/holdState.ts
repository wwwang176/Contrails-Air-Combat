import type { InputState } from './InputState'
import type { ThrottleHold } from './bindings'

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
