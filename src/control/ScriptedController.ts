import { Vector3 } from 'three'
import { DEG } from '../core/math'
import { CRUISE_THROTTLE } from '../input/InputState'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command, Controller } from './Controller'

export type Manoeuvre = 'straight' | 'turn' | 'weave' | 'climb'

export const MANOEUVRES: readonly Manoeuvre[] = ['straight', 'turn', 'weave', 'climb']

/** 定盤旋的標稱轉率，rad/s。10°/s ≈ 250 m/s 下 2.5 G，是持續得住的轉彎。 */
const TURN_RATE = 10 * DEG
/** 蛇行的航向擺幅與週期。 */
const WEAVE_AMPLITUDE = 30 * DEG
const WEAVE_PERIOD = 8
/** 爬升的目標俯仰角。 */
const CLIMB_PITCH = 15 * DEG

const FWD = new Vector3()

/**
 * 靶機：預錄機動 → 與玩家同一組指令輸出。
 *
 * 不開火、不迴避。它的存在是為了驗證 M2，不是為了對戰——那是 M4 的事
 * （spec §11）。
 *
 * 【為什麼是「給指揮儀一個瞄準方向」而不是直接寫舵面】靶機必須跟玩家走
 * 同一套物理與同一顆指揮儀（spec §4.1 的裁決），否則預瞄解是對著一個
 * 不存在的運動模型驗證的。給方向就是唯一的介面。
 */
export class ScriptedController implements Controller {
  manoeuvre: Manoeuvre = 'straight'
  throttle = CRUISE_THROTTLE

  /**
   * 基準航向，rad。切換機動時才重新錨定。
   *
   * 【為什麼要 latch 而不是每步讀當下航向】每步都讀的話「直線」會變成
   * 積分漂移——指揮儀的殘餘誤差每步被當成新的基準，航向會慢慢走掉。
   */
  private baseHeading = 0
  private latched = false
  private elapsed = 0

  setManoeuvre(m: Manoeuvre, self: Aircraft): void {
    this.manoeuvre = m
    this.baseHeading = ScriptedController.headingOf(self)
    this.latched = true
    this.elapsed = 0
  }

  update(self: Aircraft, dt: number, out: Command): void {
    // 【用旗標而不是「baseHeading === 0」判斷有沒有 latch 過】預設姿態的
    // 航向**恰好就是 0**，用值判斷等於每一步都重新錨定，「直線」會變成
    // 積分漂移——指揮儀的殘餘誤差每步被當成新基準，航向慢慢走掉。
    if (!this.latched) {
      this.baseHeading = ScriptedController.headingOf(self)
      this.latched = true
    }
    this.elapsed += dt

    let h = this.baseHeading
    let pitch = 0
    switch (this.manoeuvre) {
      case 'straight':
        break
      case 'turn':
        h += TURN_RATE * this.elapsed
        break
      case 'weave':
        h += WEAVE_AMPLITUDE * Math.sin((2 * Math.PI / WEAVE_PERIOD) * this.elapsed)
        break
      case 'climb':
        pitch = CLIMB_PITCH
        break
    }

    const cp = Math.cos(pitch)
    out.aimWorld.set(-Math.sin(h) * cp, Math.sin(pitch), -Math.cos(h) * cp)
    out.throttle = this.throttle
    out.brake = 0
    out.firing = false
  }

  /** 機首方向的水平航向，rad。0 = −Z，順時針為正（與 HUD 同一套約定）。 */
  private static headingOf(a: Aircraft): number {
    FWD.set(0, 0, -1).applyQuaternion(a.state.orientation)
    return Math.atan2(-FWD.x, -FWD.z)
  }
}
