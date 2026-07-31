import { bench, describe } from 'vitest'
import { createDiagnostics, createFlightState, stepDynamics } from '../src/physics/dynamics'
import { P51D } from '../src/specs/p51d'
import { BF109G6 } from '../src/specs/bf109g6'
import type { Controls } from '../src/physics/types'

/**
 * 物理步微基準。
 *
 * 驗收門檻（spec §3.10）：單步耗時必須 < 20 µs。
 * 超標代表熱路徑存在配置行為造成 GC 壓力，必須先修正。
 */
describe('stepDynamics', () => {
  const controls: Controls = { aileron: 0.3, elevator: 0.2, rudder: -0.1, throttle: 1.1 }
  const dt = 1 / 240

  const p51State = createFlightState(6000, 180)
  const p51Diag = createDiagnostics()
  bench('P-51D 單步', () => {
    stepDynamics(P51D, p51State, controls, dt, p51Diag)
  })

  const bfState = createFlightState(6000, 180)
  const bfDiag = createDiagnostics()
  bench('Bf 109 G-6 單步（含縫翼判定）', () => {
    stepDynamics(BF109G6, bfState, controls, dt, bfDiag)
  })
})
