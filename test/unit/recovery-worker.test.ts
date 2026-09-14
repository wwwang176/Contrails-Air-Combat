import { describe, expect, it } from 'vitest'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import {
  RECOVERY_SNAPSHOT_SIZE, readRecoverySnapshot, writeRecoverySnapshot,
} from '../../src/ai/recoverySnapshot'
import {
  RecoveryWorkerCoordinator, createRecoveryAssistState,
  recoveryUrgency, updateRecoveryAssist, updateRecoveryTrialAssist,
  type RecoveryWorkerPort,
} from '../../src/ai/recoveryWorkerClient'
import type { RecoveryResponse } from '../../src/ai/recoveryProtocol'
import { RecoveryWorkerEngine } from '../../src/ai/recoveryWorkerEngine'

class FakeWorker implements RecoveryWorkerPort {
  onmessage: ((event: MessageEvent<RecoveryResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly sent: { id: number, sequence: number, snapshot: Float64Array }[] = []

  postMessage(message: {
    id: number, sequence: number, snapshot: Float64Array,
  }): void {
    this.sent.push({
      id: message.id,
      sequence: message.sequence,
      snapshot: new Float64Array(message.snapshot),
    })
  }

  reply(index: number, drop = 200): void {
    const request = this.sent[index]!
    this.onmessage?.({ data: {
      id: request.id,
      sequence: request.sequence,
      drop,
      seconds: 3,
      recovered: true,
      computeMs: 4,
    } } as MessageEvent<RecoveryResponse>)
  }

  replyError(index: number): void {
    const request = this.sent[index]!
    this.onmessage?.({ data: {
      id: request.id,
      sequence: request.sequence,
      drop: 0,
      seconds: 0,
      recovered: false,
      computeMs: 1,
      error: 'test failure',
    } } as MessageEvent<RecoveryResponse>)
  }
}

describe('防墜 Worker 快照', () => {
  it('往返保留動力與控制器狀態', () => {
    const source = new Aircraft(P51D, 1800, 170)
    source.state.position.set(10, 1800, -30)
    source.state.velocity.set(12, -90, -140)
    source.state.orientation.set(0.1, -0.2, 0.3, 0.9).normalize()
    source.state.angularVelocity.set(0.2, -0.3, 0.4)
    source.controls.aileron = 0.7
    source.controls.elevator = -0.4
    source.controls.rudder = 0.2
    source.controls.throttle = 1.1
    source.controls.brake = 1
    source.surfaces.aileron = 0.5
    source.surfaces.elevator = -0.25
    source.surfaces.rudder = 0.1
    source.surfaces.throttle = 0.8
    source.surfaces.brake = 0
    source.diag.loadFactor = 2.3
    source.diag.slatsDeployed = true
    source.diag.controlAuthority = 0.72
    const aim = createCommand().aimWorld.set(0.2, 0.4, -1).normalize()
    source.update(aim, 0.9, 1 / 240)

    const snapshot = new Float64Array(RECOVERY_SNAPSHOT_SIZE)
    writeRecoverySnapshot(source, snapshot)
    const restored = new Aircraft(P51D)
    readRecoverySnapshot(restored, snapshot)

    expect(restored.state.position.toArray()).toEqual(source.state.position.toArray())
    expect(restored.state.velocity.toArray()).toEqual(source.state.velocity.toArray())
    expect(restored.state.orientation.toArray()).toEqual(source.state.orientation.toArray())
    expect(restored.state.angularVelocity.toArray()).toEqual(source.state.angularVelocity.toArray())
    expect(restored.controls).toEqual(source.controls)
    expect(restored.surfaces).toEqual(source.surfaces)
    expect(restored.diag.loadFactor).toBe(source.diag.loadFactor)
    expect(restored.diag.slatsDeployed).toBe(source.diag.slatsDeployed)
    expect(restored.diag.controlAuthority).toBe(source.diag.controlAuthority)

    const sourceState = new Float64Array(14)
    const restoredState = new Float64Array(14)
    expect(source.director.writeState(sourceState, 0)).toBe(14)
    expect(restored.director.writeState(restoredState, 0)).toBe(14)
    expect(restoredState).toEqual(sourceState)
  })

  it('Worker 可重用已註冊的實際機種做後續預演', () => {
    const source = new Aircraft(P51D, 1200, 180)
    source.state.velocity.set(0, -140, -110)
    const snapshot = new Float64Array(RECOVERY_SNAPSHOT_SIZE)
    writeRecoverySnapshot(source, snapshot)
    const engine = new RecoveryWorkerEngine()
    const first = engine.run({
      id: 1, sequence: 1, sentAt: 0, terrainTurn: 0,
      specKey: 'p51-test', spec: P51D, snapshot,
    })
    const second = engine.run({
      id: 2, sequence: 2, sentAt: 0.25, terrainTurn: 0,
      specKey: 'p51-test', spec: undefined, snapshot,
    })

    expect(first.error).toBeUndefined()
    expect(first.recovered).toBe(true)
    expect(first.drop).toBeGreaterThan(0)
    expect(second.error).toBeUndefined()
    expect(second.drop).toBeCloseTo(first.drop, 9)
  })

  it('影子預演先執行候選低頭命令，再把總掉高量回原始快照', () => {
    const source = new Aircraft(P51D, 300, 120)
    source.state.position.y = 300
    source.state.velocity.set(0, 0, -120)
    const snapshot = new Float64Array(RECOVERY_SNAPSHOT_SIZE)
    writeRecoverySnapshot(source, snapshot)
    const engine = new RecoveryWorkerEngine()
    const baseline = engine.run({
      id: 1, sequence: 1, sentAt: 0, terrainTurn: 0,
      specKey: 'p51-trial', spec: P51D, snapshot,
    })
    const trial = engine.run({
      id: 1, sequence: 2, sentAt: 0.25, terrainTurn: 0,
      specKey: 'p51-trial', spec: undefined, snapshot,
      trialSeconds: 1,
      trialAimX: 0, trialAimY: -0.5, trialAimZ: -0.866,
      trialThrottle: 1.1, trialBrake: 0, trialUpright: false,
    })
    expect(baseline.drop).toBe(0)
    expect(trial.recovered).toBe(true)
    expect(trial.drop).toBeGreaterThan(0)
  })
})

describe('單一 Worker 排程', () => {
  it('影子結果以總掉高加機種餘裕判斷候選命令是否安全', () => {
    const a = new Aircraft(P51D, 100, 100)
    a.state.position.y = 100
    a.state.velocity.set(0, 0, -100)
    const state = createRecoveryAssistState(11)
    state.resultSequence = 1
    state.resultSentAt = 2
    state.resultTerrainTurn = 0
    state.drop = 20
    state.recovered = true
    const command = createCommand()
    command.aimWorld.set(0, -0.1, -1).normalize()
    expect(updateRecoveryTrialAssist(state, a, 0, 0, 2, command, 0.5)).toBe('safe')
    a.state.position.y = 50
    expect(updateRecoveryTrialAssist(state, a, 0, 0, 2, command, 0.5)).toBe('unsafe')
  })

  it('改出餘裕充足時不介入，逼近所需高度才連續升到 1', () => {
    expect(recoveryUrgency(640, 320)).toBe(0)
    expect(recoveryUrgency(480, 320)).toBeCloseTo(0.5, 12)
    expect(recoveryUrgency(320, 320)).toBe(1)
    expect(recoveryUrgency(200, 320)).toBe(1)
  })

  it('無有效預演時不干擾瞄準；預演無法改出時立刻視為最高風險', () => {
    expect(recoveryUrgency(100, 0)).toBe(0)
    expect(recoveryUrgency(100, Number.NaN)).toBe(0)
    expect(recoveryUrgency(1000, Infinity)).toBe(1)
  })

  it('硬接管前先把有效 Worker 結果發布成柔性風險', () => {
    const a = new Aircraft(P51D, 345, 100)
    a.state.position.y = 345
    a.state.velocity.set(0, -50, -86.6)
    const state = createRecoveryAssistState(8)
    state.resultSequence = 1
    state.resultSentAt = 2
    state.resultTerrainTurn = 0
    state.drop = 200
    state.recovered = true

    expect(updateRecoveryAssist(state, a, 0, 0, 2)).toBe(230)
    expect(state.active).toBe(false)
    expect(state.urgency).toBeCloseTo(0.5, 12)
  })

  it('預演掉高加戰鬥機 30 m 餘裕會接管，並鎖存到不再下降', () => {
    const a = new Aircraft(P51D, 220, 100)
    a.state.position.y = 220
    a.state.velocity.set(0, -50, -86.6)
    const state = createRecoveryAssistState(9)
    state.resultSequence = 1
    state.resultSentAt = 2
    state.resultTerrainTurn = 0
    state.drop = 200
    state.recovered = true

    expect(updateRecoveryAssist(state, a, 0, 0, 2)).toBe(Infinity)
    expect(state.urgency).toBe(1)
    a.state.position.y = 1000
    expect(updateRecoveryAssist(state, a, 0, 0, 2.1)).toBe(Infinity)
    expect(state.urgency).toBe(1)
    a.state.velocity.y = 0
    expect(updateRecoveryAssist(state, a, 0, 0, 2.2)).toBe(0)
    expect(state.urgency).toBe(0)
  })

  it('預演結果由 Worker 元件套用戰鬥機 30 m、轟炸機 100 m 餘裕', () => {
    const fighter = new Aircraft(P51D, 31, 120)
    fighter.state.position.y = 31
    fighter.state.velocity.set(0, 0, -120)
    const fighterState = createRecoveryAssistState(10)
    fighterState.resultSequence = 1
    fighterState.resultSentAt = 2
    fighterState.resultTerrainTurn = 0
    fighterState.recovered = true
    expect(updateRecoveryAssist(fighterState, fighter, 0, 0, 2)).toBe(30)
    fighter.state.position.y = 30
    expect(updateRecoveryAssist(fighterState, fighter, 0, 0, 2)).toBe(Infinity)

    const bomber = new Aircraft(B17G, 101, 120)
    bomber.state.position.y = 101
    bomber.state.velocity.set(0, 0, -120)
    const bomberState = createRecoveryAssistState(11)
    bomberState.resultSequence = 1
    bomberState.resultSentAt = 2
    bomberState.resultTerrainTurn = 0
    bomberState.recovered = true
    expect(updateRecoveryAssist(bomberState, bomber, 0, 0, 2)).toBe(100)
    bomber.state.position.y = 100
    expect(updateRecoveryAssist(bomberState, bomber, 0, 0, 2)).toBe(Infinity)
  })

  it('同時只送一筆，完成後先送預估撞地時間較短者', () => {
    const port = new FakeWorker()
    const coordinator = new RecoveryWorkerCoordinator(port)
    const a = new Aircraft(P51D, 1000, 150)
    const first = createRecoveryAssistState(1)
    const urgent = createRecoveryAssistState(2)
    const later = createRecoveryAssistState(3)

    coordinator.request(first, a, 0, 0, 1, 4)
    coordinator.request(later, a, 0, 0, 1, 8)
    coordinator.request(urgent, a, 0, 0, 1, 2)
    expect(port.sent.map((x) => x.id)).toEqual([1])

    port.reply(0)
    expect(port.sent.map((x) => x.id)).toEqual([1, 2])
    port.reply(1)
    expect(port.sent.map((x) => x.id)).toEqual([1, 2, 3])
  })

  it('重設後丟棄舊回覆，不讓上一場結果滲入', () => {
    const port = new FakeWorker()
    const coordinator = new RecoveryWorkerCoordinator(port)
    const a = new Aircraft(P51D, 1000, 150)
    const state = createRecoveryAssistState(7)

    coordinator.request(state, a, 0, 0, 1, 4)
    coordinator.reset(state)
    port.reply(0, 999)

    expect(state.resultSequence).toBe(-1)
    expect(state.drop).toBe(0)
  })

  it('任何 Worker 計算錯誤都標成不可用，不允許靜默降級', () => {
    const port = new FakeWorker()
    const coordinator = new RecoveryWorkerCoordinator(port)
    const a = new Aircraft(P51D, 1000, 150)
    const state = createRecoveryAssistState(10)

    coordinator.request(state, a, 0, 0, 1, 4)
    port.replyError(0)

    expect(coordinator.stats.available).toBe(false)
    expect(coordinator.stats.failures).toBe(1)
    expect(coordinator.stats.inFlight).toBe(0)
  })
})
