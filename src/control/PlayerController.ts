import type { Aircraft } from '../aircraft/Aircraft'
import type { InputState } from '../input/InputState'
import type { Command, Controller } from './Controller'
import { GUN_HEAT_SECONDS, createGunHeat, overheatSeconds, resetGunHeat, stepGunHeat } from './gunHeat'

type PlayerInput = Pick<InputState, 'aimWorld' | 'throttle' | 'braking' | 'firing' | 'viewMode' | 'bombTaps'>

/**
 * 玩家：把 InputState 搬進 Command。
 *
 * 【為什麼要有這一層，而不是讓 World 直接讀 InputState】World 只認得
 * Controller；輸入層是瀏覽器的東西，讓它滲進 World 會讓 L4 矩陣與 World
 * 的單元測試被迫去偽造 DOM 狀態。這一層薄到只有三行，換來的是 World 可以
 * 在 node 裡跑。
 */
export class PlayerController implements Controller {
  /**
   * 上一步投彈視角下左鍵按著沒有。彈艙吃的是「剛按下」—— 直接餵持續按著的
   * `firing` 的話，按著不放會在每一次回補完成時自動再倒一整艙。
   */
  private bombHeld = false
  /** 上次看到的 `InputState.bombTaps`。多出來就投一次 */
  private bombTapsSeen = 0
  /** 前機槍的熱度（`gunHeat.ts`）。HUD 的十字讀它 */
  readonly gunHeat = createGunHeat()
  /** 過熱而且扳機按著：打不出去，只有空響。音效讀它 */
  dryFiring = false
  /** 快過熱（黃色）而且還在開火：槍機聲疊在槍聲上，越熱越大聲。音效讀它 */
  warmFiring = false
  /** 熱度是哪一架的。換了（接手僚機、新的一場）就歸零 */
  private heatOwner: Aircraft | null = null

  constructor(private readonly input: PlayerInput) {}

  /** 熱度歸零。重開一場、接手僚機時呼叫 */
  resetGunHeatState(): void {
    resetGunHeat(this.gunHeat)
    this.dryFiring = false
    this.warmFiring = false
  }

  /**
   * 不在座位上的這段時間照實際時間冷卻（代飛、上帝視角時控制器被換掉，`update` 不會被呼叫）。
   * 每幀由換控制器的那一層呼叫；空響停掉。
   */
  coolWhileAway(seconds: number): void {
    stepGunHeat(this.gunHeat, false, GUN_HEAT_SECONDS, seconds)
    this.dryFiring = false
    this.warmFiring = false
  }

  update(self: Aircraft, dt: number, out: Command): void {
    if (self !== this.heatOwner) {
      this.resetGunHeatState()
      this.heatOwner = self
    }
    // copy 而不是換參考：Command 是 World 持有的緩衝，指向 InputState
    // 的話會讓下游任何一次寫入都改到玩家的瞄準點。
    out.aimWorld.copy(this.input.aimWorld)
    out.throttle = this.input.throttle
    out.brake = this.input.braking ? 1 : 0
    // 【投彈模式下左鍵是投彈，不是扳機】機砲朝前、鏡頭朝下 —— 開出去的
    // 子彈玩家根本看不到，而彈藥是真的在消耗
    const trigger = this.input.firing && this.input.viewMode !== 'bomb'
    // 【過熱打不出去】只管前射武器；沒有前射武器的機種（機首槍屬於砲塔）不加熱
    const battery = self.spec.battery
    const hasGuns = battery.mounts.length > 0
    // 【先推進熱度再定扳機】開火、鎖住、空響用同一步的狀態：鎖住的那一步就不開火
    stepGunHeat(this.gunHeat, trigger && hasGuns, overheatSeconds(battery), dt)
    out.firing = trigger && !this.gunHeat.locked
    this.dryFiring = trigger && hasGuns && this.gunHeat.locked
    this.warmFiring = out.firing && hasGuns && this.gunHeat.warn
    // 【投彈與 AI 同一格】`World.releaseBombs` 讀它，彈艙的推進與投放全在物理步。
    // 兩個來源：有瞄具的轟炸機在投彈視角下按左鍵、直接投彈的機種按 B（`InputState.bombTaps`）
    const held = this.input.firing && this.input.viewMode === 'bomb'
    const tapped = this.input.bombTaps !== this.bombTapsSeen
    this.bombTapsSeen = this.input.bombTaps
    out.bombing = (held && !this.bombHeld) || tapped
    this.bombHeld = held
    // 【AI 專用的這一格每步清掉】接手僚機時 `Command` 物件沿用那一席的，上一步
    // 還是 AI 寫的：不清的話正在攻艦的僚機交到玩家手上會帶著「保持正飛」
    out.upright = false
    out.pull = false
    // 玩家任何高度都投得出去（AI 代飛時寫的下限要清掉）
    out.releaseFloor = 0
    // 【跟瞄恆開】滑鼠準星是世界固定的，不是由自己的速度導出的 —— 瞄準方向在
    // 轉就是玩家在跟一個轉彎。見 `Command.trackTurn`
    out.trackTurn = true
  }
}
