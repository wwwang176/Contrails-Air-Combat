import type { Aircraft } from '../aircraft/Aircraft'
import type { InputState } from '../input/InputState'
import type { Command, Controller } from './Controller'

/**
 * 玩家：把 InputState 搬進 Command。
 *
 * 【為什麼要有這一層，而不是讓 World 直接讀 InputState】World 只認得
 * Controller；輸入層是瀏覽器的東西，讓它滲進 World 會讓 L4 矩陣與 World
 * 的單元測試被迫去偽造 DOM 狀態。這一層薄到只有三行，換來的是 World 可以
 * 在 node 裡跑。
 */
export class PlayerController implements Controller {
  constructor(private readonly input: InputState) {}

  update(_self: Aircraft, _dt: number, out: Command): void {
    // copy 而不是換參考：Command 是 World 持有的緩衝，指向 InputState
    // 的話會讓下游任何一次寫入都改到玩家的瞄準點。
    out.aimWorld.copy(this.input.aimWorld)
    out.throttle = this.input.throttle
    out.brake = this.input.braking ? 1 : 0
    // 【投彈模式下左鍵是投彈，不是扳機】機砲朝前、鏡頭朝下 —— 開出去的
    // 子彈玩家根本看不到，而彈藥是真的在消耗。投彈由 `main.ts` 自己接
    out.firing = this.input.firing && this.input.viewMode !== 'bomb'
    // 【AI 專用的兩格每步清掉】接手僚機時 `Command` 物件沿用那一席的，上一步
    // 還是 AI 寫的：不清的話正在攻艦的僚機交到玩家手上會帶著「保持正飛」
    // 與投彈指令
    out.bombing = false
    out.upright = false
  }
}
