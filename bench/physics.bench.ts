import { bench, describe } from 'vitest'
import { createDiagnostics, createFlightState, stepDynamics } from '../src/physics/dynamics'
import { BF109G6 } from '../src/specs/bf109g6'
import {
  createPhysicsLoadState, LOAD_ALTITUDE, LOAD_CONTROLS, LOAD_DT, LOAD_TAS,
  resetPhysicsLoadState, stepPhysicsLoad, type PhysicsLoadState,
} from './physics-load'

/**
 * 物理步微基準。
 *
 * 驗收門檻（spec §3.10）：單步耗時必須 < 20 µs。
 * 超標代表熱路徑存在配置行為造成 GC 壓力，必須先修正。
 *
 * P-51D 案例直接使用 bench/physics-load.ts 匯出的 createPhysicsLoadState／
 * stepPhysicsLoad——與 test/unit/perf-gate.test.ts 呼叫的是同一份負載定義，
 * 改一處、兩邊量到同一份工作量，不會各自維護一份初始條件而悄悄量到不同的
 * 東西（Task 6 的單一替換點設計）。Bf 109 案例額外量測含縫翼判定分支的成本，
 * 沿用同一組共用常數（LOAD_ALTITUDE/LOAD_TAS/LOAD_CONTROLS/LOAD_DT）建構自己
 * 的狀態，只有機種 spec 不同。
 *
 * 兩個案例都每 RESET_INTERVAL 步把狀態重置回初始配平條件：不重置的話，
 * 基準會在數十萬到數百萬步內持續掉高度、迎角持續發散，量到的其實是
 * 「地底下、密度遠超海平面」這種不具代表性的物理狀態（見任務報告）。
 */
const RESET_INTERVAL = 240

describe('stepDynamics', () => {
  const p51Load = createPhysicsLoadState()
  let p51Steps = 0
  bench('P-51D 單步', () => {
    stepPhysicsLoad(p51Load)
    if (++p51Steps >= RESET_INTERVAL) {
      resetPhysicsLoadState(p51Load)
      p51Steps = 0
    }
  })

  const bfLoad: PhysicsLoadState = {
    state: createFlightState(LOAD_ALTITUDE, LOAD_TAS),
    diag: createDiagnostics(),
    controls: LOAD_CONTROLS,
    dt: LOAD_DT,
  }
  let bfSteps = 0
  bench('Bf 109 G-6 單步（含縫翼判定）', () => {
    stepDynamics(BF109G6, bfLoad.state, bfLoad.controls, bfLoad.dt, bfLoad.diag)
    if (++bfSteps >= RESET_INTERVAL) {
      resetPhysicsLoadState(bfLoad)
      bfSteps = 0
    }
  })
})
