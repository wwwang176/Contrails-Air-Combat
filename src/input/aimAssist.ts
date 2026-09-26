import { Quaternion, Vector3 } from 'three'
import { DEG } from '../core/math'
import { NO_INTERCEPT, solveLead } from '../world/lead'
import { PROJECTILE_LIFETIME } from '../world/Projectiles'
import type { Combatant } from '../world/World'

/** 吸附範圍：敵機的預瞄方向離瞄準點在這個夾角之內才拉，rad */
export const ASSIST_CONE = 4 * DEG
/**
 * 跟隨上限，rad/s。預瞄點跑得比這快，瞄準點追不上、被甩出範圍，吸附就自己放開。
 * 所有機種同一個值 —— 拉的是瞄準點，不是機首。
 */
export const ASSIST_MAX_RATE = 30 * DEG
/** 吸進去之後把剩下的偏差收掉的時間常數，s */
export const ASSIST_TIME = 0.1
/** 玩家自己轉瞄準點快過這個角速度，吸附暫停，rad/s */
export const ASSIST_SWIPE_RATE = 60 * DEG
/** 暫停多久，s */
export const ASSIST_SWIPE_HOLD = 0.3

const P = new Vector3()
const V = new Vector3()
const LEAD = new Vector3()
const BEST = new Vector3()
const AXIS = new Vector3()
const Q = new Quaternion()
const ID = new Quaternion()

/**
 * 瞄準輔助：把玩家的瞄準點（`InputState.aimWorld`）往附近敵機的預瞄點拉。
 *
 * **只動瞄準點。** 飛機照樣由指揮儀飛過去、照樣受 G 限制；子彈不轉彎。
 * 預瞄點與 HUD 的預瞄小圈是同一個解（`solveLead`、射程 `PROJECTILE_LIFETIME`）。
 *
 * ```
 *   範圍內有預瞄點   跟著它這一幀的移動轉，再以 ASSIST_TIME 收掉偏差；
 *                    兩者合計每秒最多 ASSIST_MAX_RATE
 *   預瞄點跑太快     跟不上 → 夾角超過 ASSIST_CONE → 放開
 *   玩家快速轉動     暫停 ASSIST_SWIPE_HOLD，讓甩動乾淨
 * ```
 *
 * 【先跟移動、再收偏差】只靠收偏差的話，跟著等速移動的預瞄點會落後「角速度 ×
 * ASSIST_TIME」，放開的門檻變成 ASSIST_CONE / ASSIST_TIME，而不是 ASSIST_MAX_RATE。
 *
 * 【優先黏著同一架】目前吸著的那一架還在範圍內就不換，範圍內有兩架時不會來回跳。
 *
 * 熱路徑：每幀一次、不配置。
 */
export class AimAssist {
  /** 設定頁的開關 */
  enabled = false
  /** 正在吸的那一架在 `combatants` 裡的索引；−1 = 沒有 */
  target = -1
  private hold = 0
  /** 上一幀那一架的預瞄方向；`target` 為 −1 時無意義 */
  private readonly prevLead = new Vector3()

  /** 換場、重生、離開一般飛行時呼叫 */
  reset(): void {
    this.target = -1
    this.hold = 0
  }

  /**
   * @param aim        瞄準點，世界座標單位向量（in/out）
   * @param playerTurn 玩家這一幀自己把瞄準點轉了多少，rad
   * @param dt         這一幀世界前進的時間，s
   */
  step(
    aim: Vector3, playerTurn: number, dt: number,
    shooter: Combatant, cs: readonly Combatant[],
  ): void {
    if (!this.enabled || dt <= 0) { this.target = -1; return }
    if (playerTurn > ASSIST_SWIPE_RATE * dt) {
      this.hold = ASSIST_SWIPE_HOLD
      this.target = -1
      return
    }
    if (this.hold > 0) {
      this.hold -= dt
      return
    }
    // 【沒有前射機槍就沒有預瞄點】轟炸機
    if (shooter.aircraft.spec.battery.mounts.length === 0) { this.target = -1; return }

    const muzzle = shooter.aircraft.spec.battery.sight.muzzleVelocity
    const me = shooter.aircraft.state
    let best = -1
    let bestAngle = ASSIST_CONE
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      if (!c.alive || c.team === shooter.team) continue
      P.copy(c.aircraft.state.position).sub(me.position)
      V.copy(c.aircraft.state.velocity).sub(me.velocity)
      const t = solveLead(P, V, muzzle, LEAD)
      if (t === NO_INTERCEPT || t > PROJECTILE_LIFETIME) continue
      const angle = aim.angleTo(LEAD)
      if (angle > ASSIST_CONE) continue
      if (i === this.target) {
        best = i
        bestAngle = angle
        BEST.copy(LEAD)
        break
      }
      if (angle < bestAngle || best < 0) {
        best = i
        bestAngle = angle
        BEST.copy(LEAD)
      }
    }
    const same = best >= 0 && best === this.target
    this.target = best
    if (best < 0) return

    let budget = ASSIST_MAX_RATE * dt
    // 跟著預瞄點這一幀的移動轉。第一幀沒有上一幀可比，只收偏差
    if (same) {
      const moved = this.prevLead.angleTo(BEST)
      Q.setFromUnitVectors(this.prevLead, BEST)
      if (moved > budget) Q.slerpQuaternions(ID, Q, budget / moved)
      aim.applyQuaternion(Q).normalize()
      budget -= Math.min(moved, budget)
    }
    this.prevLead.copy(BEST)

    const off = aim.angleTo(BEST)
    const turn = Math.min(off * (1 - Math.exp(-dt / ASSIST_TIME)), budget)
    AXIS.crossVectors(aim, BEST)
    if (turn <= 0 || AXIS.lengthSq() < 1e-12) return
    aim.applyAxisAngle(AXIS.normalize(), turn).normalize()
  }
}

/** 設定頁的兩個選項 */
export const AIM_ASSIST_LEVELS: readonly { label: string; value: boolean }[] = [
  { label: '開啟', value: true },
  { label: '關閉', value: false },
]

const AIM_ASSIST_KEY = 'input.aimAssist'

/**
 * 沒有設定過時：**觸控裝置開、滑鼠關。** 滑鼠本來就瞄得準，被拉住反而干擾；
 * 玩家改過一次就以玩家的為準。
 */
export function defaultAimAssist(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

/** 讀寫都包 try，理由同 `render/quality.ts` 的 `readQuality` */
export function readAimAssist(): boolean {
  try {
    const v = localStorage.getItem(AIM_ASSIST_KEY)
    return v === null ? defaultAimAssist() : v === '1'
  } catch {
    return defaultAimAssist()
  }
}

export function saveAimAssist(on: boolean): void {
  try {
    localStorage.setItem(AIM_ASSIST_KEY, on ? '1' : '0')
  } catch { /* 存不了就算了 */ }
}
