import { Vector3 } from 'three'
import {
  createSituation, evaluateEnergy, evaluateGeometry, evaluateThreat, trackingFactor,
} from './assess'
import { createRuleState, stepRules, type Intent } from './rules'
import {
  buildEngageBasis, createEngageBasis, engageKnobs, geometryGate, steerCommand, type Knobs,
} from './steer'
import { shouldFire } from './fire'
import { applySafety } from './safety'
import { ACE, type DifficultyProfile } from './profile'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command, Controller } from '../control/Controller'

/** 意圖仲裁與包絡查詢的頻率，Hz。 */
export const AI_DECISION_HZ = 10

const FWD = new Vector3(0, 0, -1)

/**
 * 敵機 AI。實作 `control/Controller`，所以 `World` 一個字都不用改。
 *
 * 【全部的狀態都住在這裡】`assess` / `rules` / `steer` / `fire` / `safety`
 * 都是純函數（spec §4.3）——這是 L4 的對戰矩陣能在 node 裡跑幾百場的前提。
 */
export class AiController implements Controller {
  /** 交戰對象。由 `main.ts` 或測試設定 */
  target: Aircraft | null = null
  /** 該點的海面（未來為地表）高度，m */
  seaHeight = 0
  profile: DifficultyProfile = ACE

  /** 供 HUD、telemetry 與測試讀取 */
  intent: Intent = 'approach'
  safetyActive = false
  trackingSeconds = 0

  private readonly sit = createSituation()
  private readonly basis = createEngageBasis()
  private readonly rules = createRuleState()
  private readonly knobs: Knobs = { leadLag: 1, vertical: 0 }
  /** 距離下一次意圖仲裁還有多久，s */
  private decisionTimer = 0

  update(self: Aircraft, dt: number, out: Command): void {
    const target = this.target
    if (!target) {
      // 沒有目標時維持機首方向平飛。這比「保持上一格的指令」安全——
      // 上一格可能是一個俯衝中的脫離向量。
      out.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
      out.throttle = 0.7
      out.brake = 0
      out.firing = false
      this.safetyActive = applySafety(self, this.seaHeight, out)
      return
    }

    // ── 240 Hz：便宜的運動學 ──────────────────────────────
    // 【意圖是 10 Hz，但它引用的幾何不能是 10 Hz 的舊值】高速近距離時
    // 100 ms 足以讓「超前」的態勢完全改變。
    evaluateGeometry(self, target, this.sit)
    evaluateThreat(self, target, this.sit)
    buildEngageBasis(self, target, this.basis)

    // 跟蹤計時器：在他的射擊錐內才累積，離開立刻歸零
    this.trackingSeconds = this.sit.threatInstant > 0 ? this.trackingSeconds + dt : 0
    const threat = this.sit.threatInstant * trackingFactor(this.trackingSeconds)

    // ── 10 Hz：昂貴的包絡查詢與意圖仲裁 ────────────────────
    this.decisionTimer -= dt
    if (this.decisionTimer <= 0) {
      const period = 1 / AI_DECISION_HZ
      evaluateEnergy(self, target, this.sit)
      this.intent = stepRules(this.rules, this.sit, threat, period)
      this.decisionTimer += period
    }

    // ── 240 Hz：轉向、開火 ────────────────────────────────
    engageKnobs(this.sit, this.knobs)
    const mode = geometryGate(this.sit, this.basis)
    steerCommand(this.intent, mode, this.sit, this.basis, self, this.knobs, out)
    out.firing = shouldFire(this.sit, this.basis, self)

    // ── 240 Hz：安全層，可覆寫上面全部 ─────────────────────
    this.safetyActive = applySafety(self, this.seaHeight, out)
  }
}
