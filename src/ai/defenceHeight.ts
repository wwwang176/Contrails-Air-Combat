/** 防禦期間的保高紀律；只改操縱意圖，不修改物理狀態。 */
import { Vector3 } from 'three'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import { stallSpeed } from '../analysis/envelope'

const RAD = Math.PI / 180
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
/** 試玩值：同段防禦共用預算，換招不重置；正式控制器在威脅解除後清除。 */
// 放寬高度與下沉門檻 30%；低速預警距離救速底線的餘裕縮小 30%。
// 輕微低頭也保留一點空間，避免每次向下修正都被立即改成平飛。
export const HEIGHT_POLICY = { budget: 195, recovered: 50, lookAhead: 2,
  sinkEnter: -15.6, turnSinkEnter: -3.9, turnPitch: -2.4 * RAD,
  recoverPitch: 8 * RAD, attackPitch: -8 * RAD,
  emergencySpeed: 1.18, recoverySpeed: 1.369 } as const

export class HeightDiscipline {
  anchor = NaN
  debt = 0
  recovering = false
  label = ''
  private stable = 0
  private heading = new Vector3()
  private los = new Vector3()
  private nose = new Vector3()

  reset(): void {
    this.anchor = NaN; this.debt = 0; this.recovering = false; this.stable = 0; this.label = ''
  }

  observe(altitude: number, verticalSpeed: number, dt: number): void {
    if (!Number.isFinite(this.anchor)) this.anchor = altitude
    this.debt = Math.max(0, this.anchor - altitude)
    const projectedDebt = this.debt - Math.min(0, verticalSpeed) * HEIGHT_POLICY.lookAhead
    if (projectedDebt > HEIGHT_POLICY.budget || verticalSpeed < HEIGHT_POLICY.sinkEnter) this.recovering = true
    this.stable = this.debt < HEIGHT_POLICY.recovered && verticalSpeed > -2 ? this.stable + dt : 0
    if (this.stable > 1) this.recovering = false
    this.label = ''
  }

  apply(self: Aircraft, enemy: Aircraft, out: Command, urgent: boolean, plannedReturnFloor?: number): boolean {
    const speed = self.state.velocity.length()
    const stall = stallSpeed(self.spec, self.state.position.y, 1)
    // 失速改出優先，保高不可把安全層需要的低頭救速蓋掉。
    if (speed < stall * HEIGHT_POLICY.emergencySpeed) {
      this.label = '空速危急：讓位給救速／安全層'
      return false
    }
    // 射擊窗口已形成時，不用保高修正抵銷避彈；仍共用同一份高度預算。
    if (urgent && this.debt < HEIGHT_POLICY.budget) {
      this.label = '緊急閃避優先：暫用剩餘高度預算'
      return false
    }
    // 分段機動的回程只能兌換本次爬升所得；預留兩秒下降慣性，接近底線即交還止沉。
    if (plannedReturnFloor !== undefined && this.debt < HEIGHT_POLICY.budget
      && self.state.position.y + Math.min(0, self.state.velocity.y) * 2 > Math.max(this.anchor - HEIGHT_POLICY.budget, plannedReturnFloor) + 20
      && out.aimWorld.y >= Math.sin(-10 * RAD)) {
      this.label = '計畫回程：只使用本次爬升取得的高度'
      return false
    }
    this.heading.copy(self.state.velocity); this.heading.y = 0
    if (this.heading.lengthSq() < 1e-6) return false
    this.heading.normalize()
    this.los.copy(enemy.state.position).sub(self.state.position)
    const range = this.los.length()
    this.nose.set(0, 0, -1).applyQuaternion(self.state.orientation)
    const forwardAttack = range < 900 && this.nose.dot(this.los) > range * Math.cos(35 * RAD)
    const slow = speed < stall * HEIGHT_POLICY.recoverySpeed
    const recover = this.recovering || slow
    const originalPitch = Math.asin(clamp(out.aimWorld.y, -1, 1))
    let pitch = originalPitch
    let turn = Math.atan2(this.heading.x * out.aimWorld.z - this.heading.z * out.aimWorld.x,
      this.heading.x * out.aimWorld.x + this.heading.z * out.aimWorld.z)
    const originalTurn = turn
    if (recover) {
      // 速度充足才補高度；先收小水平轉向，以正過載止沉，避免一邊急轉一邊硬拉。
      const speedRoom = clamp((speed / stall - HEIGHT_POLICY.emergencySpeed) / 0.5, 0, 1)
      pitch = clamp(this.debt / 1800 - self.state.velocity.y / 240, 0, HEIGHT_POLICY.recoverPitch) * speedRoom
      const turnCap = (urgent ? 45 : 4) * RAD
      turn = clamp(turn, -turnCap, turnCap)
      this.label = urgent ? '受攻擊：保留閃避，限制持續下沉' : slow ? '放鬆轉彎，以推力補速' : '高度預算不足／持續下沉：收彎止沉'
    } else {
      // 一般轉向容許輕微低頭；前方近距離攻擊與短促避彈可使用較大的下降角。
      const canDescend = (forwardAttack || urgent) && this.debt < HEIGHT_POLICY.budget
      const minPitch = canDescend ? HEIGHT_POLICY.attackPitch : HEIGHT_POLICY.turnPitch
      pitch = Math.max(pitch, minPitch)
      if (self.state.velocity.y < HEIGHT_POLICY.turnSinkEnter && !canDescend) {
        pitch = Math.max(pitch, Math.min(HEIGHT_POLICY.recoverPitch, -self.state.velocity.y / 200))
        turn = clamp(turn, -20 * RAD, 20 * RAD)
      }
      if (Math.abs(pitch - originalPitch) < 1e-6 && Math.abs(turn - originalTurn) < 1e-6) return false
      this.label = canDescend ? '受限下降：使用整段交戰的高度餘裕' : '先保高轉向，暫不向下追瞄'
    }
    const x = this.heading.x, z = this.heading.z
    out.aimWorld.set((x * Math.cos(turn) - z * Math.sin(turn)) * Math.cos(pitch), Math.sin(pitch),
      (x * Math.sin(turn) + z * Math.cos(turn)) * Math.cos(pitch))
    out.throttle = 1; out.brake = 0; out.trackTurn = false
    return true
  }
}
