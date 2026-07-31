import { createDiagnostics, createFlightState, stepDynamics, type StepDiagnostics } from '../src/physics/dynamics'
import { P51D } from '../src/specs/p51d'
import type { Controls, FlightState } from '../src/physics/types'

/**
 * 效能守門測試用的真實物理步負載。
 *
 * 前身為 Task 6 設計的佔位向量運算（單一替換點：placeholder-load.ts），
 * Task 12 完成 stepDynamics 後已改為呼叫真正的物理步，並更名為
 * physics-load.ts 以反映內容不再是佔位負載。目前唯一的引用者是
 * test/unit/perf-gate.test.ts；bench/physics.bench.ts 已改為直接呼叫
 * src/physics/dynamics.ts（見該檔案，另外量測 P-51D 與 Bf109 兩種機種）。
 */
export interface PhysicsLoadState {
  readonly state: FlightState
  readonly diag: StepDiagnostics
  readonly controls: Controls
  readonly dt: number
}

export function createPhysicsLoadState(): PhysicsLoadState {
  return {
    state: createFlightState(6000, 180),
    diag: createDiagnostics(),
    controls: { aileron: 0.3, elevator: 0.2, rudder: -0.1, throttle: 1.1 },
    dt: 1 / 240,
  }
}

/** 真實負載本體：完整 6DOF 物理步。熱路徑安全，無配置行為。 */
export function stepPhysicsLoad(state: PhysicsLoadState): void {
  stepDynamics(P51D, state.state, state.controls, state.dt, state.diag)
}
