import { Vector3 } from 'three'
import {
  createSituation, evaluateEnergy, evaluateGeometry, evaluateThreat, trackingFactor,
} from './assess'
import { createRuleState, stepRules, type Intent } from './rules'
import {
  buildEngageBasis, createEngageBasis, engageKnobs, geometryGate, steerCommand, type Knobs,
} from './steer'
import { shouldFire } from './fire'
import {
  createTargetState, selectTarget, DEFAULT_TARGET, type TargetBoard, type TargetConfig,
} from './target'
import { applySafety } from './safety'
import {
  DEFAULT_STATION, STATION_OFFSETS, stationCommand, stationPoint,
  type StationConfig, type StationOffset,
} from './station'
import {
  DEFAULT_WINGMAN, createWingmanState, selectWingmanTarget, type WingmanConfig,
} from './wingman'
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
  /**
   * 交戰對象。`board` 為 null 時由 `main.ts` 或測試設定；否則由
   * `selectTarget` 在每個決策節拍改寫。
   */
  target: Aircraft | null = null
  /** 該點的海面（未來為地表）高度，m */
  seaHeight = 0
  profile: DifficultyProfile = ACE

  /**
   * 目標選擇的共享指派板。
   *
   * 【null 時完全是 M4 的行為】`target` 由外部指派、不做選擇。M4 的全部
   * 測試與 `bench/ai-load.ts` 因此一個字都不用改（M5 spec §6.6）。
   */
  board: TargetBoard | null = null
  /** 自己在 `board.candidates` 裡的索引。`board` 為 null 時不使用 */
  selfIndex = -1
  targetConfig: TargetConfig = DEFAULT_TARGET

  /**
   * 站位參考機，同時也是**掩護對象**（M6 spec §5.1）。
   *
   * 【null 時完全是 M5 的行為】自由選目標、沒有目標就平飛。Schwarm 長機、
   * 落單者、以及還沒接線的實例都走這一條，所以 M4 的全部測試與
   * `bench/ai-load.ts` 一個字都不用改。
   */
  stationReference: Aircraft | null = null
  /** 站位參考機在 `board.candidates` 裡的索引；−1 = 無 */
  stationReferenceIndex = -1
  /** 這一架的站位偏置。`stationReference` 為 null 時不使用 */
  stationOffset: StationOffset = STATION_OFFSETS[0]!
  stationConfig: StationConfig = DEFAULT_STATION
  wingmanConfig: WingmanConfig = DEFAULT_WINGMAN
  /**
   * 上一個決策節拍算出的站位誤差，m。供 HUD、telemetry 與測試讀取。
   *
   * 【為什麼是 10 Hz 而不是每步】只有僚機的目標選擇讀它，而那本來就是
   * 決策節拍。整合測試的抽樣頻率遠低於 10 Hz，讀得到的精度綽綽有餘。
   */
  stationError = 0

  /** 供 HUD、telemetry 與測試讀取 */
  intent: Intent = 'approach'
  safetyActive = false
  trackingSeconds = 0
  /**
   * 累計做過幾次意圖仲裁。
   *
   * 【為什麼公開】相位錯開（M5 spec §6.4）唯一可自動化的觀測量。人工驗收
   * 看的是「幀率沒有週期性頓挫」，那不可能寫成斷言；「40 架的決策沒有擠在
   * 同一步」則可以。
   */
  decisionsMade = 0

  private readonly sit = createSituation()
  private readonly targetState = createTargetState()
  private readonly basis = createEngageBasis()
  private readonly rules = createRuleState()
  private readonly knobs: Knobs = { leadLag: 1, vertical: 0 }
  private readonly wingmanState = createWingmanState()
  private readonly station = new Vector3()
  /** 距離下一次意圖仲裁還有多久，s */
  private decisionTimer = 0

  update(self: Aircraft, dt: number, out: Command): void {
    const period = 1 / AI_DECISION_HZ
    const reference = this.stationReference

    // 【節拍先算，分支後用】決策這一步要不要跑，必須在「有沒有目標」之前
    // 決定 —— 否則沒有目標時計時器不會前進，board 一設上去就會變成每個
    // 物理步都在選目標。
    this.decisionTimer -= dt
    const decide = this.decisionTimer <= 0
    if (decide) {
      this.decisionTimer += period
      this.decisionsMade++
      if (reference) {
        stationPoint(reference, this.stationOffset, this.seaHeight, this.station)
        this.stationError = this.station.distanceTo(self.state.position)
      } else {
        this.stationError = 0
      }
      if (this.board) {
        // 【角色分派】有站位參考機 = 僚機，走四級準則；否則是自由獵手
        this.target = reference
          ? selectWingmanTarget(
            this.wingmanState, this.board, this.selfIndex,
            this.stationReferenceIndex, this.stationError, period, this.wingmanConfig,
          )
          : selectTarget(
            this.targetState, this.board, this.selfIndex, period, this.targetConfig,
          )
      }
    }

    const target = this.target
    if (!target) {
      if (reference) {
        // 【隊形保持就在這一格】沒有值得打的敵人時飛回站位。
        //
        // 它**不進** `arbitrate` 的優先序：engage / merge / approach 全都
        // 要求有目標，所以「沒有目標」這一格本來就是它的位置。代價是這條
        // 分支跳過整條態勢評估，`defend` 因此結構上不可能觸發 —— 補法是
        // 僚機目標優先序最上面的那一級「自衛」，而不是在 rules.ts 開特例
        // （M6 spec §3.2）。
        stationCommand(
          self, reference, this.stationOffset, this.seaHeight, out, this.stationConfig,
        )
      } else {
        // 沒有目標也沒有站位時維持機首方向平飛。這比「保持上一格的指令」
        // 安全——上一格可能是一個俯衝中的脫離向量。
        out.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
        out.throttle = 0.7
        out.brake = 0
        out.firing = false
      }
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
    if (decide) {
      evaluateEnergy(self, target, this.sit)
      this.intent = stepRules(this.rules, this.sit, threat, period)
    }

    // ── 240 Hz：轉向、開火 ────────────────────────────────
    engageKnobs(this.sit, this.knobs)
    const mode = geometryGate(this.sit, this.basis)
    steerCommand(this.intent, mode, this.sit, this.basis, self, this.seaHeight, this.knobs, out)
    out.firing = shouldFire(this.sit, this.basis, self)

    // ── 240 Hz：安全層，可覆寫上面全部 ─────────────────────
    this.safetyActive = applySafety(self, this.seaHeight, out)
  }

  /**
   * 錯開決策相位（M5 spec §6.4）。
   *
   * 【為什麼需要】40 架的 `decisionTimer` 都從 0 起算，會在**同一個物理步**
   * 一起做昂貴的包絡查詢，變成每 100 ms 一次的週期性尖峰。
   *
   * 【它不解決分攤的順序相依】那件事無法消除，只能換一種形式 —— 見
   * M5 spec §6.4。這裡要保證的是決定性，不是順序無關。
   *
   * @param fraction 0..1，在一個決策週期裡的位置
   */
  setDecisionPhase(fraction: number): void {
    let f = fraction % 1
    if (f < 0) f += 1
    this.decisionTimer = f * (1 / AI_DECISION_HZ)
  }
}
