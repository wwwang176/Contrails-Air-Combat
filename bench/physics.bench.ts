import { bench, describe } from 'vitest'
import { createPlaceholderPhysicsState, stepPlaceholderPhysics } from './placeholder-load'

/**
 * 物理步微基準。
 *
 * 驗收門檻（spec §3.10）：單步耗時必須 < 20 µs。
 * 超標代表熱路徑存在配置行為造成 GC 壓力，必須先修正。
 *
 * 佔位負載定義於 ./placeholder-load.ts，與 test/unit/perf-gate.test.ts
 * 共用同一份實作。Task 12 完成 dynamics.step 後，只需替換該檔案，
 * 本基準與守門測試會自動套用真實負載。
 */
describe('physics step', () => {
  const state = createPlaceholderPhysicsState()

  bench('佔位負載：向量與四元數運算', () => {
    stepPlaceholderPhysics(state)
  })
})
