import { createDiagnostics, createFlightState, stepDynamics, type StepDiagnostics } from '../src/physics/dynamics'
import { P51D } from '../src/specs/p51d'
import type { Controls, FlightState } from '../src/physics/types'

/**
 * 效能守門測試與微基準共用的真實物理步負載定義（單一替換點，Task 6 設計）。
 *
 * 前身為 Task 6 設計的佔位向量運算（placeholder-load.ts），Task 12 完成
 * stepDynamics 後已改為呼叫真正的物理步，並更名為 physics-load.ts。
 *
 * `bench/physics.bench.ts` 的 P-51D 案例與 `test/unit/perf-gate.test.ts`
 * 都直接使用這裡的 `createPhysicsLoadState`/`stepPhysicsLoad`，或至少讀取
 * 這裡匯出的常數（`LOAD_ALTITUDE`/`LOAD_TAS`/`LOAD_CONTROLS`/`LOAD_DT`），
 * 確保改一處、兩邊量測的是同一份負載，不會因為各自硬編了一份初始條件而
 * 悄悄量到不同的工作量。
 */
export const LOAD_ALTITUDE = 6000
export const LOAD_TAS = 180
export const LOAD_CONTROLS: Controls = { aileron: 0.3, elevator: 0.2, rudder: -0.1, throttle: 1.1 }
export const LOAD_DT = 1 / 240

export interface PhysicsLoadState {
  readonly state: FlightState
  readonly diag: StepDiagnostics
  readonly controls: Controls
  readonly dt: number
}

export function createPhysicsLoadState(): PhysicsLoadState {
  return {
    state: createFlightState(LOAD_ALTITUDE, LOAD_TAS),
    diag: createDiagnostics(),
    controls: LOAD_CONTROLS,
    dt: LOAD_DT,
  }
}

/**
 * 把負載狀態重置回初始配平條件，原地修改（不配置新物件，可安全放進計時迴圈）。
 *
 * 高度/速度/姿態/角速度會隨著連續步進單調偏離初始配平點（見任務報告：
 * 未重置時 50,000 步後會掉到海平面以下、空氣密度遠超海平面值），使量測落在
 * 不具代表性的物理狀態。呼叫端應每隔固定步數（例如 240 步＝1 模擬秒）呼叫一次。
 */
export function resetPhysicsLoadState(state: PhysicsLoadState): void {
  state.state.position.set(0, LOAD_ALTITUDE, 0)
  state.state.velocity.set(0, 0, -LOAD_TAS)
  state.state.orientation.identity()
  state.state.angularVelocity.set(0, 0, 0)
  state.diag.slatsDeployed = false
}

/** 真實負載本體：完整 6DOF 物理步。熱路徑安全，無配置行為。 */
export function stepPhysicsLoad(state: PhysicsLoadState): void {
  stepDynamics(P51D, state.state, state.controls, state.dt, state.diag)
}
