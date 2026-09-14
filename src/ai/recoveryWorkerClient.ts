import type { Aircraft } from '../aircraft/Aircraft'
import type { AircraftSpec } from '../specs/types'
import type { Command } from '../control/Controller'
import { recoveryClearance } from './safety'
import {
  RECOVERY_SNAPSHOT_SIZE, writeRecoverySnapshot,
} from './recoverySnapshot'
import { RECOVERY_ROLLOUT_HZ } from './recoveryRollout'
import type { RecoveryRequest, RecoveryResponse } from './recoveryProtocol'

export const RECOVERY_REQUEST_HZ = 4
const REQUEST_PERIOD = 1 / RECOVERY_REQUEST_HZ
const RESULT_MAX_AGE = 0.75
const TRIAL_RESULT_MAX_AGE = 0.5
const FIGHTER_HORIZON = 11
const BOMBER_HORIZON = 17
const SPEC_KEYS = new WeakMap<AircraftSpec, string>()

/** 同一份物理 spec 跨控制器、跨場只註冊一次；只在首次看見物件時配置。 */
function keyForSpec(spec: AircraftSpec): string {
  const found = SPEC_KEYS.get(spec)
  if (found !== undefined) return found
  const text = JSON.stringify(spec)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  const key = `${spec.id}:${text.length}:${hash >>> 0}`
  SPEC_KEYS.set(spec, key)
  return key
}

export interface RecoveryWorkerPort {
  onmessage: ((event: MessageEvent<RecoveryResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: RecoveryRequest): void
}

export interface RecoveryWorkerStats {
  enabled: boolean
  available: boolean
  substepHz: number
  requestHz: number
  dispatched: number
  completed: number
  failures: number
  staleResults: number
  takeovers: number
  queued: number
  inFlight: number
  computeTotalMs: number
  computeMaxMs: number
  roundTripTotalMs: number
  roundTripMaxMs: number
}

export interface RecoveryAssistState {
  readonly id: number
  readonly snapshot: Float64Array
  readonly message: RecoveryRequest
  sequence: number
  minimumValidSequence: number
  resultSequence: number
  drop: number
  recovered: boolean
  /** 0 = 改出餘裕充足，1 = 已碰到最低改出高度；僅供觀測。 */
  urgency: number
  resultSentAt: number
  resultTerrainTurn: number
  nextRequestAt: number
  priority: number
  queued: boolean
  pending: boolean
  active: boolean
  inFlightSequence: number
  inFlightSpecKey: string
  inFlightSentAt: number
  inFlightTerrainTurn: number
  dispatchedAt: number
  staleCountedSequence: number
}

export function createRecoveryAssistState(id: number): RecoveryAssistState {
  const snapshot = new Float64Array(RECOVERY_SNAPSHOT_SIZE)
  return {
    id,
    snapshot,
    message: {
      id, sequence: 0, sentAt: 0, terrainTurn: 0, specKey: '', spec: undefined, snapshot,
    },
    sequence: 0,
    minimumValidSequence: 0,
    resultSequence: -1,
    drop: 0,
    recovered: false,
    urgency: 0,
    resultSentAt: 0,
    resultTerrainTurn: 0,
    nextRequestAt: 0,
    priority: Infinity,
    queued: false,
    pending: false,
    active: false,
    inFlightSequence: -1,
    inFlightSpecKey: '',
    inFlightSentAt: 0,
    inFlightTerrainTurn: 0,
    dispatchedAt: 0,
    staleCountedSequence: -1,
  }
}

/** 單一 Worker 的合併佇列；同時只有一筆在途工作。 */
export class RecoveryWorkerCoordinator {
  readonly stats: RecoveryWorkerStats = {
    enabled: true,
    available: true,
    substepHz: RECOVERY_ROLLOUT_HZ,
    requestHz: RECOVERY_REQUEST_HZ,
    dispatched: 0,
    completed: 0,
    failures: 0,
    staleResults: 0,
    takeovers: 0,
    queued: 0,
    inFlight: 0,
    computeTotalMs: 0,
    computeMaxMs: 0,
    roundTripTotalMs: 0,
    roundTripMaxMs: 0,
  }

  private readonly states: RecoveryAssistState[] = []
  private readonly registeredSpecKeys = new Set<string>()
  private inFlight: RecoveryAssistState | null = null

  constructor(private readonly port: RecoveryWorkerPort) {
    port.onmessage = (event): void => { this.complete(event.data) }
    port.onerror = (): void => { this.fail() }
  }

  request(
    state: RecoveryAssistState,
    aircraft: Aircraft,
    _floor: number,
    terrainTurn: number,
    clock: number,
    priority: number,
    trial: Command | null = null,
    trialSeconds = 0,
  ): void {
    if (!this.stats.enabled || !this.stats.available) return
    if (!this.states.includes(state)) this.states.push(state)
    writeRecoverySnapshot(aircraft, state.snapshot)
    state.message.specKey = keyForSpec(aircraft.spec)
    state.message.spec = this.registeredSpecKeys.has(state.message.specKey)
      ? undefined
      : aircraft.spec
    state.sequence++
    state.message.sequence = state.sequence
    state.message.sentAt = clock
    state.message.terrainTurn = terrainTurn
    state.message.trialSeconds = trial === null ? 0 : trialSeconds
    if (trial !== null) {
      state.message.trialAimX = trial.aimWorld.x
      state.message.trialAimY = trial.aimWorld.y
      state.message.trialAimZ = trial.aimWorld.z
      state.message.trialThrottle = trial.throttle
      state.message.trialBrake = trial.brake
      state.message.trialUpright = trial.upright
    }
    state.priority = priority
    if (!state.queued) {
      state.queued = true
      this.stats.queued++
    }
    if (this.inFlight === null) this.dispatchNext()
  }

  reset(state: RecoveryAssistState): void {
    state.minimumValidSequence = state.sequence + 1
    state.resultSequence = -1
    state.drop = 0
    state.recovered = false
    state.urgency = 0
    state.active = false
    state.nextRequestAt = 0
    state.staleCountedSequence = -1
    if (state.queued) {
      state.queued = false
      this.stats.queued--
    }
    if (state !== this.inFlight) this.removeState(state)
  }

  setEnabled(enabled: boolean): void {
    this.stats.enabled = enabled
    if (enabled) return
    for (const state of this.states) {
      if (state.queued) {
        state.queued = false
        this.stats.queued--
      }
      state.active = false
      state.urgency = 0
      state.resultSequence = -1
      state.minimumValidSequence = state.sequence + 1
    }
    this.states.length = 0
    this.stats.queued = 0
  }

  private dispatchNext(): void {
    let best: RecoveryAssistState | null = null
    for (const state of this.states) {
      if (!state.queued) continue
      if (best === null || state.priority < best.priority
        || (state.priority === best.priority && state.id < best.id)) best = state
    }
    if (best === null) return

    best.queued = false
    this.stats.queued--
    best.pending = true
    best.inFlightSequence = best.message.sequence
    best.inFlightSpecKey = best.message.specKey
    best.inFlightSentAt = best.message.sentAt
    best.inFlightTerrainTurn = best.message.terrainTurn
    best.dispatchedAt = performance.now()
    if (best.message.spec !== undefined) this.registeredSpecKeys.add(best.message.specKey)
    this.inFlight = best
    this.stats.inFlight = 1
    this.stats.dispatched++
    this.port.postMessage(best.message)
    best.message.spec = undefined
  }

  private complete(response: RecoveryResponse): void {
    const state = this.inFlight
    if (state === null) return
    this.inFlight = null
    this.stats.inFlight = 0
    state.pending = false
    this.stats.completed++
    this.stats.computeTotalMs += response.computeMs
    if (response.computeMs > this.stats.computeMaxMs) this.stats.computeMaxMs = response.computeMs
    const roundTrip = performance.now() - state.dispatchedAt
    this.stats.roundTripTotalMs += roundTrip
    if (roundTrip > this.stats.roundTripMaxMs) this.stats.roundTripMaxMs = roundTrip

    if (response.error !== undefined) {
      this.stats.failures++
      state.resultSequence = -1
      state.urgency = 0
      this.registeredSpecKeys.delete(state.inFlightSpecKey)
      // 預演錯誤代表安全承諾已經不存在。正式遊戲會在下一幀讀到 unavailable
      // 並整體停止；不要悄悄重試後讓玩家在空窗內繼續飛。
      this.disableAfterFailure()
      return
    } else if (
      response.id === state.id
      && response.sequence === state.inFlightSequence
      && response.sequence >= state.minimumValidSequence
    ) {
      state.resultSequence = response.sequence
      state.drop = response.drop
      state.recovered = response.recovered
      state.resultSentAt = state.inFlightSentAt
      state.resultTerrainTurn = state.inFlightTerrainTurn
    }
    if (!state.queued) this.removeState(state)
    this.dispatchNext()
  }

  /** 佇列只保留正在等工作的控制器，避免換場後累積已淘汰的快照。 */
  private removeState(state: RecoveryAssistState): void {
    const index = this.states.indexOf(state)
    if (index >= 0) this.states.splice(index, 1)
  }

  private fail(): void {
    this.stats.failures++
    this.disableAfterFailure()
  }

  private disableAfterFailure(): void {
    this.stats.available = false
    if (this.inFlight !== null) this.inFlight.pending = false
    this.inFlight = null
    this.stats.inFlight = 0
    for (const state of this.states) {
      if (state.queued) state.queued = false
      state.resultSequence = -1
      state.active = false
      state.urgency = 0
    }
    this.stats.queued = 0
    this.states.length = 0
  }
}

let nextId = 1
let coordinator: RecoveryWorkerCoordinator | null = null
let startupFailure = ''

if (typeof Worker !== 'undefined') {
  try {
    const worker = new Worker(new URL('./recovery.worker.ts', import.meta.url), {
      type: 'module',
      name: 'ai-recovery',
    })
    coordinator = new RecoveryWorkerCoordinator(worker)
  } catch (error) {
    coordinator = null
    startupFailure = error instanceof Error ? error.message : String(error)
  }
} else if (typeof window !== 'undefined') {
  startupFailure = '這個瀏覽器不支援 Web Worker。'
}

/**
 * 正式瀏覽器是否失去必要的防墜 Worker。Node 測試不被當成可玩的瀏覽器，
 * 必須自行注入測試 Worker；遊戲主迴圈則以這個狀態決定是否阻擋。
 */
export function recoveryWorkerFailure(): string | null {
  if (typeof window === 'undefined') return null
  if (coordinator === null) {
    return startupFailure || '防墜 Worker 無法建立。'
  }
  if (!coordinator.stats.enabled) return '防墜 Worker 已停用。'
  if (!coordinator.stats.available) return '防墜 Worker 執行失敗。'
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
