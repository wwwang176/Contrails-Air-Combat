import { describe, it, expect } from 'vitest'
import { createPlaceholderPhysicsState, stepPlaceholderPhysics } from '../../bench/placeholder-load'

/**
 * 效能守門測試（spec §3.10 驗收要求）。
 *
 * 單一物理步耗時必須 < 20 µs。若超標，代表熱路徑存在配置行為造成 GC 壓力，
 * 必須先修正才能繼續後續任務 —— 本測試失敗即為該信號，不得放寬門檻或略過。
 *
 * `npm run bench`（bench/physics.bench.ts）只負責「輸出」數字，vitest 的
 * benchmark 模式不會讓門檻失敗；本測試才是實際會讓 `npx vitest run` /
 * `npm test` 紅燈的斷言。兩者共用 bench/placeholder-load.ts 的同一份負載定義，
 * 避免複製貼上；Task 12 完成 dynamics.step 後，只需替換該檔案即可同時套用到
 * 基準與本守門測試。
 */
const GATE_US = 20

describe('physics step perf gate', () => {
  it('single physics step stays under the 20 µs spec §3.10 gate', () => {
    const state = createPlaceholderPhysicsState()

    // 暖機：讓 JIT 完成內聯/最佳化，避免冷啟動成本污染量測結果。
    const WARMUP = 2000
    for (let i = 0; i < WARMUP; i++) {
      stepPlaceholderPhysics(state)
    }

    // 計時區段取平均而非單次樣本，避免單一離群值造成偽陽性/偽陰性。
    // N 選在讓計時區段落在數毫秒等級（讓 performance.now() 的解析度有意義），
    // 同時整體測試時間遠低於 1 秒。
    const N = 50_000
    const start = performance.now()
    for (let i = 0; i < N; i++) {
      stepPlaceholderPhysics(state)
    }
    const elapsedMs = performance.now() - start
    const perStepUs = (elapsedMs / N) * 1000

    expect(perStepUs).toBeLessThan(GATE_US)
  })
})
