import { clamp } from '../core/math'

export interface PidGains {
  kp: number
  ki: number
  kd: number
  /** 積分項的絕對值上限，防止積分飽和 */
  integralLimit: number
  /** 輸出絕對值上限 */
  outputLimit: number
}

export class Pid {
  /** 可直接修改，供調參面板即時調整。 */
  readonly gains: PidGains
  private integral = 0
  private prevError = 0
  private hasPrev = false

  constructor(gains: PidGains) {
    this.gains = { ...gains }
  }

  reset(): void {
    this.integral = 0
    this.prevError = 0
    this.hasPrev = false
  }

  update(error: number, dt: number): number {
    const g = this.gains
    let out = g.kp * error

    if (dt > 0) {
      this.integral = clamp(this.integral + error * dt, -g.integralLimit, g.integralLimit)
      out += g.ki * this.integral
      if (this.hasPrev) out += (g.kd * (error - this.prevError)) / dt
    }

    this.prevError = error
    this.hasPrev = true
    return clamp(out, -g.outputLimit, g.outputLimit)
  }
}
