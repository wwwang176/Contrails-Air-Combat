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

/**
 * 【防積分飽和的不變量】本實作是單純的積分項夾制（clamp `integral` 到
 * `±integralLimit`），不是感知輸出飽和的 anti-windup（例如 back-calculation
 * 或 conditional integration）。它「有界」但不是「立刻解開」：若
 * `ki·integralLimit > outputLimit`，輸出可能在誤差已經反向之後仍被積分項
 * 鎖在飽和邊界一段時間才轉向——保證只來自 gains 的比例關係，不是演算法
 * 本身消除的。實測（見 task-17-report.md）：`ki=1, integralLimit=2,
 * outputLimit=0.5`、誤差 ±1 時，正向飽和後誤差反轉，輸出仍鎖在 +0.5
 * 長達 1.500 秒才開始反應（`integralLimit − outputLimit/ki = 1.5`，
 * 除以誤差反轉後積分變化率 = 秒數，此處誤差量值為 1 故兩者數值相同）。
 * 使用本類別的呼叫端（Task 18 的角速率迴路、Task 24 若有其他控制迴路）
 * 必須自行維持 `ki·integralLimit ≤ outputLimit`，否則會重現這個延遲。
 */
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
