import type { InputState } from './InputState'
import { endLook } from './actions'
import type { TouchHold } from './holdState'

/** 一根手指按下時抓到的東西。整段拖曳都算它，拖出範圍也不換 */
export type GripKind = 'aim' | 'look' | 'fire' | 'up' | 'down' | 'score' | 'bomb' | 'view' | 'pause'

export interface Grip {
  readonly kind: GripKind
  x: number
  y: number
  /** 按鈕本身；拖曳區是 null。 */
  readonly el: HTMLElement | null
}

/** 回收單根手指的視覺與輸入狀態；pointerup 與 pointercancel 共用。 */
export function releaseTouchGrip(
  grip: Grip,
  state: InputState,
  hold: TouchHold,
  aimRing: HTMLElement,
  lookRing: HTMLElement,
): void {
  grip.el?.classList.remove('down')
  switch (grip.kind) {
    case 'aim': aimRing.hidden = true; break
    case 'look': lookRing.hidden = true; endLook(state); break
    case 'fire': hold.fire = false; state.firing = false; break
    case 'up': hold.up = false; break
    case 'down': hold.down = false; state.braking = false; break
    case 'score': state.scoreboardHeld = false; break
    default: break
  }
}
