import type { InputState } from './InputState'
import { endLook } from './actions'
import type { TouchHold } from './holdState'

/** 一根手指按下時抓到的東西。整段拖曳都算它，拖出範圍也不換 */
export type GripKind = 'aim' | 'stick' | 'look' | 'fire' | 'up' | 'down' | 'score' | 'bomb' | 'view' | 'pause'

export interface Grip {
  readonly kind: GripKind
  /** 手指上一次的位置；`stick` 握點是搖桿中心（按下點，歸零時換成手指當時的位置） */
  x: number
  y: number
  /** 按鈕本身；拖曳區是 null。 */
  readonly el: HTMLElement | null
}

/** 拖曳區按下時出現的指示：瞄準與視角是圓圈，搖桿是方框 */
export interface TouchRings {
  readonly aim: HTMLElement
  readonly look: HTMLElement
  readonly stick: HTMLElement
}

/**
 * 回收單根手指的視覺與輸入狀態；pointerup 與 pointercancel 共用。
 *
 * 搖桿握點只藏方框，觸控的搖桿位置留著：`playerControl` 在放開那一幀從那裡抄，再照回中設定走
 */
export function releaseTouchGrip(
  grip: Grip,
  state: InputState,
  hold: TouchHold,
  rings: TouchRings,
): void {
  grip.el?.classList.remove('down')
  switch (grip.kind) {
    case 'aim': rings.aim.hidden = true; break
    case 'stick': rings.stick.hidden = true; break
    case 'look': rings.look.hidden = true; endLook(state); break
    case 'fire': hold.fire = false; state.firing = false; break
    case 'up': hold.up = false; break
    case 'down': hold.down = false; state.braking = false; break
    case 'score': state.scoreboardHeld = false; break
    case 'view': state.zoom = false; break
    default: break
  }
}
