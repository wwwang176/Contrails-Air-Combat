import { describe, expect, it } from 'vitest'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { P51D } from '../../src/specs/p51d'
import {
  RECOVERY_SNAPSHOT_SIZE, readRecoverySnapshot, writeRecoverySnapshot,
} from '../../src/ai/recoverySnapshot'
import {
  RecoveryWorkerCoordinator, createRecoveryAssistState,
  updateRecoveryAssist,
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
})

describe('單一 Worker 排程', () => {
  it('預演掉高加 120 m 餘裕會接管，並鎖存到不再下降', () => {
    const a = new Aircraft(P51D, 300, 100)
    a.state.position.y = 300
    a.state.velocity.set(0, -50, -86.6)
    const state = createRecoveryAssistState(9)
    state.resultSequence = 1
    state.resultSentAt = 2
    state.resultTerrainTurn = 0
    state.drop = 200
    state.recovered = true

    expect(updateRecoveryAssist(state, a, 0, 0, 2)).toBe(Infinity)
    a.state.position.y = 1000
    expect(updateRecoveryAssist(state, a, 0, 0, 2.1)).toBe(Infinity)
    a.state.velocity.y = 0
    expect(updateRecoveryAssist(state, a, 0, 0, 2.2)).toBe(0)
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
})
