import { threatFactor } from './assess'
import { createTargetState, selectTarget, type TargetBoard, type TargetConfig } from './target'

/** 接近時守隊形，進場後容許拉開再攻擊；兩道距離避免在邊界反覆切換。 */
const ATTACK_ENTER = 1800
const ATTACK_EXIT = 2600

export interface ConvoyInterceptState {
  phase: 'none' | 'formation' | 'intercept' | 'defend'
  targetIndex: number
  readonly selection: ReturnType<typeof createTargetState>
}

export function createConvoyInterceptState(): ConvoyInterceptState {
  return { phase: 'none', targetIndex: -1, selection: createTargetState() }
}

export function resetConvoyIntercept(state: ConvoyInterceptState): void {
  state.phase = 'none'
  state.targetIndex = -1
  state.selection.current = -1
  state.selection.dwell = 0
}

/**
 * 任務只限制候選名單；距離、轉向、分工與換目標遲滯仍沿用共用選敵。
 * 自衛只暫時覆寫輸出，保留攔截目標，威脅解除後下一個決策拍便回到任務。
 * 回傳 false 表示沒有敵方護送編隊，呼叫端應回到一般空戰。
 */
export function selectConvoyIntercept(
  state: ConvoyInterceptState, board: TargetBoard, selfIndex: number,
  referenceIndex: number, dt: number, cfg: TargetConfig,
): boolean {
  const wasAttacking = state.phase === 'intercept' || state.phase === 'defend'
  const target = selectTarget(state.selection, board, selfIndex, dt, cfg, board.protectedMask)
  if (target === null) {
    resetConvoyIntercept(state)
    return false
  }
  const self = board.candidates[selfIndex]!
  state.targetIndex = state.selection.current
  state.phase = 'intercept'

  // 只因實際射擊威脅而自衛；附近有戰鬥機、或長機正在纏鬥都不夠。
  let threat = 0
  for (const c of board.candidates) {
    if (!c.alive || c.team === self.team) continue
    const score = threatFactor(c.aircraft, self.aircraft)
    if (score > threat) {
      threat = score
      state.targetIndex = c.index
      state.phase = 'defend'
    }
  }
  if (state.phase !== 'defend') {
    const reference = board.candidates[referenceIndex]
    if (reference !== undefined && reference.alive && reference.team === self.team) {
      const leadIndex = board.assignments[referenceIndex]!
      const leadTarget = board.candidates[leadIndex]
      const approachTarget = leadTarget !== undefined && leadTarget.alive
        && leadTarget.team !== self.team && board.protectedMask[leadIndex] !== 0
        ? leadTarget.aircraft : target
      const distance = Math.min(
        self.aircraft.state.position.distanceTo(target.state.position),
        reference.aircraft.state.position.distanceTo(approachTarget.state.position),
      )
      if (distance > (wasAttacking ? ATTACK_EXIT : ATTACK_ENTER)) {
        state.phase = 'formation'
        state.targetIndex = -1
      }
    }
  }
  // 指派板記實際行為，讓其他 AI 的分工不會被暫存的任務目標誤導。
  board.assignments[selfIndex] = state.targetIndex
  return true
}
