import {
  RECOVERY_REQUEST_HZ, createRecoveryAssistState, RecoveryWorkerCoordinator,
  type RecoveryAssistState, type RecoveryWorkerPort, type RecoveryWorkerStats,
} from './recoveryWorkerCoordinator'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import { recoveryClearance } from './safety'
import type { MessageKey } from '../i18n'

export {
  RECOVERY_REQUEST_HZ, createRecoveryAssistState, RecoveryWorkerCoordinator,
  type RecoveryAssistState, type RecoveryWorkerPort, type RecoveryWorkerStats,
} from './recoveryWorkerCoordinator'

const REQUEST_PERIOD = 1 / RECOVERY_REQUEST_HZ
const RESULT_MAX_AGE = 0.75
const TRIAL_RESULT_MAX_AGE = 0.5
const FIGHTER_HORIZON = 11
const BOMBER_HORIZON = 17

let nextId = 1
let coordinator: RecoveryWorkerCoordinator | null = null
let startupFailure: RecoveryFailure = 'recovery.createFailed'

if (typeof Worker !== 'undefined') {
  try {
    const worker = new Worker(new URL('./recovery.worker.ts', import.meta.url), {
      type: 'module',
      name: 'ai-recovery',
    })
    coordinator = new RecoveryWorkerCoordinator(worker)
  } catch (error) {
    coordinator = null
    console.error('防墜 Worker 無法建立', error)
  }
} else if (typeof window !== 'undefined') {
  startupFailure = 'recovery.unsupported'
}

/** 防墜 Worker 失效的原因，同時是阻擋畫面上那句話的鍵（`src/i18n`） */
export type RecoveryFailure = Extract<MessageKey,
  'recovery.unsupported' | 'recovery.createFailed' | 'recovery.disabled' | 'recovery.failed'>

/**
 * 正式瀏覽器是否失去必要的防墜 Worker。Node 測試不被當成可玩的瀏覽器，
 * 必須自行注入測試 Worker；遊戲主迴圈則以這個狀態決定是否阻擋。
 */
export function recoveryWorkerFailure(): RecoveryFailure | null {
  if (typeof window === 'undefined') return null
  if (coordinator === null) return startupFailure
  if (!coordinator.stats.enabled) return 'recovery.disabled'
  if (!coordinator.stats.available) return 'recovery.failed'
  return null
}

/** 僅供 Node 物理測試安裝同步 Worker；正式瀏覽器永遠使用上面的單一 Worker。 */
export function installRecoveryWorkerPortForTest(port: RecoveryWorkerPort | null): void {
  if (typeof window !== 'undefined') {
    throw new Error('瀏覽器不可替換正式防墜 Worker')
  }
  coordinator = port === null ? null : new RecoveryWorkerCoordinator(port)
}

export function createRecoveryAssist(): RecoveryAssistState {
  return createRecoveryAssistState(nextId++)
}

export function resetRecoveryAssist(state: RecoveryAssistState): void {
  if (coordinator !== null) coordinator.reset(state)
  else {
    state.resultSequence = -1
    state.drop = 0
    state.active = false
    state.urgency = 0
    state.nextRequestAt = 0
  }
}

/**
 * 把「現有離地高度」相對於「Worker 算出的最低改出高度」轉成連續風險。
 *
 * `margin >= 2 × needed` 時完全不干擾瞄準；由那裡線性增加，到
 * `margin <= needed` 時為 1、交給硬安全層接管。斜坡寬度跟著每架飛機實際
 * 的改出需求走，所以戰鬥機與轟炸機不需要機種或任務特判。
 */
export function recoveryUrgency(margin: number, needed: number): number {
  if (needed === Infinity) return 1
  if (!(needed > 0) || !Number.isFinite(needed) || Number.isNaN(margin)) return 0
  if (margin <= needed) return 1
  if (margin >= 2 * needed) return 0
  return 2 - margin / needed
}

/**
 * 回傳可餵給 `applySafety` 的額外門檻。無有效結果時為 0；正式遊戲會在
 * Worker 不可用時整體停止，不允許以這條解析式單獨降級繼續遊玩。
 */
export function updateRecoveryAssist(
  state: RecoveryAssistState,
  aircraft: Aircraft,
  floor: number,
  terrainTurn: number,
  clock: number,
): number {
  const velocity = aircraft.state.velocity
  if (state.active) {
    state.urgency = 1
    if (velocity.y < 0) return Infinity
    state.active = false
    state.resultSequence = -1
    state.urgency = 0
  }

  let needed = 0
  state.urgency = 0
  if (state.resultSequence >= 0 && state.resultTerrainTurn !== terrainTurn) {
    state.resultSequence = -1
  }
  if (state.resultSequence >= 0) {
    const age = clock - state.resultSentAt
    if (age >= 0 && age <= RESULT_MAX_AGE) {
      needed = state.recovered
        ? state.drop + recoveryClearance(aircraft.spec) + velocity.length() * age
        : Infinity
      const margin = aircraft.state.position.y - floor
      state.urgency = recoveryUrgency(margin, needed)
      if (margin <= needed) {
        state.active = true
        if (coordinator !== null) coordinator.stats.takeovers++
        return Infinity
      }
    } else if (state.staleCountedSequence !== state.resultSequence) {
      state.staleCountedSequence = state.resultSequence
      if (coordinator !== null) coordinator.stats.staleResults++
    }
  }

  const sink = -velocity.y
  if (coordinator !== null && sink > 0 && clock >= state.nextRequestAt) {
    const margin = aircraft.state.position.y - floor
    const impactSeconds = margin / sink
    const horizon = aircraft.spec.role === 'fighter' ? FIGHTER_HORIZON : BOMBER_HORIZON
    if (impactSeconds <= horizon) {
      coordinator.request(state, aircraft, floor, terrainTurn, clock, impactSeconds)
      state.nextRequestAt = clock + REQUEST_PERIOD
    }
  }
  return needed
}

export type RecoveryTrialStatus = 'pending' | 'safe' | 'unsafe'

/**
 * 在接管解除前，請同一個 Worker 先執行候選命令，再立刻做完整改出。
 * `safe` 代表「現在交還 trialSeconds，之後仍來得及以機種餘裕改出」。
 */
export function updateRecoveryTrialAssist(
  state: RecoveryAssistState,
  aircraft: Aircraft,
  floor: number,
  terrainTurn: number,
  clock: number,
  trial: Command,
  trialSeconds: number,
): RecoveryTrialStatus {
  let status: RecoveryTrialStatus = 'pending'
  if (state.resultSequence >= 0 && state.resultTerrainTurn !== terrainTurn) {
    state.resultSequence = -1
  }
  if (state.resultSequence >= 0) {
    const age = clock - state.resultSentAt
    if (age >= 0 && age <= TRIAL_RESULT_MAX_AGE) {
      const needed = state.recovered
        ? state.drop + recoveryClearance(aircraft.spec) + aircraft.state.velocity.length() * age
        : Infinity
      status = aircraft.state.position.y - floor > needed ? 'safe' : 'unsafe'
    }
  }

  if (coordinator !== null && clock >= state.nextRequestAt) {
    const speed = aircraft.state.velocity.length()
    const proposedSink = Math.max(1, -trial.aimWorld.y * speed)
    const priority = (aircraft.state.position.y - floor) / proposedSink
    coordinator.request(state, aircraft, floor, terrainTurn, clock, priority, trial, trialSeconds)
    state.nextRequestAt = clock + REQUEST_PERIOD
  }
  return status
}

export interface RecoveryWorkerDebug {
  readonly stats: RecoveryWorkerStats
  setEnabled(enabled: boolean): void
}

export const recoveryWorkerDebug: RecoveryWorkerDebug | null = coordinator === null ? null : {
  stats: coordinator.stats,
  setEnabled(enabled: boolean): void { coordinator?.setEnabled(enabled) },
}

if (recoveryWorkerDebug !== null) {
  ;(globalThis as typeof globalThis & { __recoveryWorker?: RecoveryWorkerDebug })
    .__recoveryWorker = recoveryWorkerDebug
}
