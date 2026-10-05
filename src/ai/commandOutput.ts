import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import { THROTTLE_RATE } from '../input/throttle'
import { CommandDelay } from './delay'
import type { DifficultyProfile } from './profile'
import type { createBandState } from './bandState'
import type { SurfaceAttackState } from './surfaceAttack'
import { applySafety, type SafetyAction } from './safety'
import {
  captureLevel, captureGroundBuffer, stepGroundReleaseCapture, GROUND_RELEASE_TRIAL_SECONDS,
  type GroundCaptureState, type GroundReleaseGate,
} from './recoveryCapture'
import {
  createRecoveryAssist, resetRecoveryAssist, updateRecoveryAssist, updateRecoveryTrialAssist,
  type RecoveryTrialStatus,
} from './recoveryWorkerClient'
import { createSense, senseTerrain, SENSE_INTERVAL, type TerrainSense, type TerrainSource } from './terrainSense'

export interface CommandOutputContext {
  readonly seaHeight: number
  readonly terrain: TerrainSource | null
  readonly profile: DifficultyProfile
  readonly selfIndex: number
  readonly band: Pick<ReturnType<typeof createBandState>, 'kind'>
  safetyAction: SafetyAction
  safetyActive: boolean
}

/** 每架 AI 的輸出狀態；只在建立控制器時配置，物理步重用。 */
export interface CommandOutputState {
  readonly recoveryAssist: ReturnType<typeof createRecoveryAssist>
  readonly recoveryTrialAssist: ReturnType<typeof createRecoveryAssist>
  recoveryTrialActive: boolean
  readonly groundReleaseGate: GroundReleaseGate
  recoveryClock: number
  tacticalPhase: string
  controlOverride: string
  readonly sense: TerrainSense
  senseTick: number
  readonly groundCapture: GroundCaptureState
  lastThrottle: number
  throttleRamp: boolean
  readonly delay: CommandDelay
}

export function createCommandOutputState(): CommandOutputState {
  return {
    recoveryAssist: createRecoveryAssist(),
    recoveryTrialAssist: createRecoveryAssist(),
    recoveryTrialActive: false,
    groundReleaseGate: { safeSince: -1, sequence: -1 },
    recoveryClock: 0,
    tacticalPhase: 'off',
    controlOverride: 'off',
    sense: createSense(),
    senseTick: 0,
    groundCapture: { active: false, armed: false },
    lastThrottle: NaN,
    throttleRamp: false,
    delay: new CommandDelay(),
  }
}

/**
 * 把 `raw` 送出去：先過反應延遲，再過安全層。
 *
 * 【安全層為什麼排在延遲之後】延遲模擬的是**判讀與決策**的耗時；「快撞地
 * 了」是反射，不是判讀。把安全層一起延遲會讓 AI 撞地率上升，而那是一個
 * 與難度無關的退步 —— 玩家不會覺得「敵人比較弱」，只會覺得「敵人會自殺」。
 * 安全層讀的是飛機**當下**的狀態，所以它必須拿當下的狀態算（spec §4.2）。
 *
 * 【為什麼只有一個呼叫點】`update` 有三條輸出路徑（站位、平飛、交戰），
 * 以前各自呼叫 `applySafety`。收斂成一個之後，「延遲在安全層之前」這件事
 * 不可能被新增的分支繞過。
 *
 * `profile.reactionDelay = 0`（`ACE`）時 `CommandDelay` 走位元等價的捷徑，
 * 所以這一層對既有的全部測試是無作用的。
 *
 * 【延遲會讓 AI 飛得更低，但那不是這個順序的錯】五個低空受控場景、120 秒、
 * 取全場最低高度：
 *
 * ```
 * 延遲     對頭@600  對頭@400  追擊@500  側舷@700  俯衝@2000   最低  觸海
 * 0.00        387      400      121      115       228      115   無
 * 0.30        600      170      499       63       568       63   無
 * 0.50        386      348      257       −0       547       −0   有
 * 0.80        549      389      488      275       524      275   無
 * ```
 *
 * 0.5 s 那一場的軌跡查到根因，**在 `applySafety` 不在這裡**：它的閉式解
 * 假設俯衝角不再變陡。t=113.0 時高度 367 m、γ=−40°，需要 279 m，通過；
 * 0.75 秒後 γ 已經 −60°，需要 459 m，而高度只剩 292 m —— 需求的成長比
 * 飛機拉得起來的還快。零延遲的同一場也只剩 115 m，是同一個病，延遲只是
 * 讓 AI 更常撞上它。修它要動 `DEFAULT_SAFETY.factor`，那會移動全部既有
 * 基準，另案處理。
 */
export function emitAiCommand(
  state: CommandOutputState, ctx: CommandOutputContext, self: Aircraft, dt: number,
  out: Command, raw: Command, surface: Pick<SurfaceAttackState, 'groundStrafeActive' | 'groundStrafe'>,
): void {
  state.tacticalPhase = 'off'
  state.controlOverride = 'off'
  state.delay.push(raw, ctx.profile.reactionDelay, dt, out,
    ctx.profile.trimTau ?? 0, ctx.profile.fireDelay ?? ctx.profile.reactionDelay)
  // 【地板是局部值，不寫回 ctx.seaHeight】見那個欄位的說明
  let floor = ctx.seaHeight
  let sense: TerrainSense | undefined
  if (ctx.terrain !== null) {
    if ((state.senseTick++ + (ctx.selfIndex % SENSE_INTERVAL)) % SENSE_INTERVAL === 0) {
      senseTerrain(self, ctx.terrain, state.sense)
    }
    if (state.sense.floor > floor) floor = state.sense.floor
    sense = state.sense
  }
  state.recoveryClock += dt
  const rolloutNeeded = updateRecoveryAssist(
    state.recoveryAssist, self, floor, sense?.turn ?? 0, state.recoveryClock,
  )
  const desiredDownward = out.aimWorld.y < 0
  let trialStatus: RecoveryTrialStatus = 'pending'
  if (surface.groundStrafeActive && state.groundCapture.active && desiredDownward) {
    state.recoveryTrialActive = true
    trialStatus = updateRecoveryTrialAssist(
      state.recoveryTrialAssist, self, floor, sense?.turn ?? 0, state.recoveryClock,
      out, GROUND_RELEASE_TRIAL_SECONDS,
    )
  } else if (state.recoveryTrialActive) {
    resetRecoveryAssist(state.recoveryTrialAssist)
    state.recoveryTrialActive = false
    state.groundReleaseGate.safeSince = -1
    state.groundReleaseGate.sequence = -1
  }
  ctx.safetyAction = applySafety(self, floor, out, undefined, sense, rolloutNeeded)
  const hardGround = ctx.safetyAction === 'ground'
  // 解除閘門只屬於對地掃射。空戰、對艦與轟炸航路若繼承這個狀態，會在
  // 沒有地面射擊解的情況下被水平捕獲，污染既有任務的飛行軌跡。
  if (!surface.groundStrafeActive && state.groundCapture.active) {
    state.groundCapture.active = false
    state.groundCapture.armed = false
    state.groundReleaseGate.safeSince = -1
    state.groundReleaseGate.sequence = -1
  }
  const capture = surface.groundStrafeActive
    && stepGroundReleaseCapture(
      state.groundCapture, state.groundReleaseGate, hardGround,
      desiredDownward, self.state.velocity.y, state.recoveryTrialAssist.resultSequence,
      state.recoveryTrialAssist.resultSentAt, trialStatus,
    )
  if (!state.groundCapture.active && state.recoveryTrialActive) {
    resetRecoveryAssist(state.recoveryTrialAssist)
    state.recoveryTrialActive = false
    state.groundReleaseGate.safeSince = -1
    state.groundReleaseGate.sequence = -1
  }
  if (ctx.safetyAction === 'none' && capture) {
    // Worker 判定目前還不能安全交還低頭命令時，以 6° 把改出所需的空間補足；
    // 等候新結果或已安全時維持水平，避免把一次接管擴成大幅豚跳。
    if (surface.groundStrafeActive && trialStatus === 'unsafe') {
      captureGroundBuffer(self, out)
    } else {
      captureLevel(self, out)
    }
    ctx.safetyAction = 'ground'
  }
  if (ctx.band.kind === 'regain') state.tacticalPhase = '回升'
  if (surface.groundStrafeActive) {
    if (surface.groundStrafe.phase === 'egress') state.tacticalPhase = '對地離場'
    else if (out.firing) state.tacticalPhase = '對地射擊'
    else state.tacticalPhase = '對地進場'
  }
  if (hardGround) {
    state.controlOverride = '防墜拉起'
  } else if (capture) {
    if (trialStatus === 'unsafe') state.controlOverride = '防墜補高'
    else if (trialStatus === 'safe') state.controlOverride = '防墜確認'
    else state.controlOverride = '防墜驗證'
  } else if (ctx.safetyAction === 'terrain') {
    state.controlOverride = '地形迴避'
  } else if (ctx.safetyAction === 'overspeed') {
    state.controlOverride = '超速保護'
  }
  ctx.safetyActive = ctx.safetyAction !== 'none'
  // 【守線的油門走與玩家同一個速率】玩家的油門是按住鍵以 THROTTLE_RATE
  // 推的，AI 直接寫值等於瞬間收滿 —— 守線那一格看起來像引擎被關掉。
  // 守線介入時開始以那個速率走，放開後也以同樣速率推回，追上命令值就
  // 回到直接寫值。
  //
  // 【為什麼不是所有 AI 全程都走速率】那會改掉每一架的時機：實測 P-51 對
  // Bf109 的側翼品質由「比對照低 0.05」掉到 0.04，紅掉一條門檻定死的
  // 護欄。守線之外的 AI 一個字不變。
  if (ctx.safetyAction === 'overspeed') state.throttleRamp = true
  if (state.throttleRamp) {
    if (Number.isNaN(state.lastThrottle)) state.lastThrottle = out.throttle
    const step = THROTTLE_RATE * dt
    const d = out.throttle - state.lastThrottle
    if (d > step) out.throttle = state.lastThrottle + step
    else if (d < -step) out.throttle = state.lastThrottle - step
    else if (ctx.safetyAction !== 'overspeed') state.throttleRamp = false
  }
  state.lastThrottle = out.throttle
}
