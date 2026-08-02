import { describe, it, expect } from 'vitest'
import { createPhysicsLoadState, resetPhysicsLoadState, stepPhysicsLoad } from '../../bench/physics-load'

/**
 * 效能守門測試（spec §3.10 驗收要求）。
 *
 * 單一物理步耗時必須 < 20 µs。若超標，代表熱路徑存在配置行為造成 GC 壓力，
 * 必須先修正才能繼續後續任務 —— 本測試失敗即為該信號，不得放寬門檻或略過。
 *
 * `npm run bench`（bench/physics.bench.ts）只負責「輸出」數字，vitest 的
 * benchmark 模式不會讓門檻失敗；本測試才是實際會讓 `npx vitest run` /
 * `npm test` 紅燈的斷言。本測試與 bench/physics.bench.ts 各自量測，但都是
 * 呼叫同一顆 src/physics/dynamics.ts 的 stepDynamics（本檔案透過
 * bench/physics-load.ts 這個 Task 6 設計的單一替換點取得負載定義，
 * Task 12 起已經是真實物理步，不再是佔位負載）。
 *
 * 狀態每 RESET_INTERVAL 步重置回初始配平條件：若讓同一個狀態連續步進
 * 五萬步不重置，飛機會持續掉高度、迎角持續發散，量到的其實是「地底下、
 * 密度遠超海平面、大攻角失速」這種不具代表性的物理狀態（見任務報告的
 * 重置前量測）。240 步＝1 模擬秒，是自然的重置週期。
 */
const GATE_US = 20
const RESET_INTERVAL = 240

describe('physics step perf gate', () => {
  it('single physics step stays under the 20 µs spec §3.10 gate', () => {
    const state = createPhysicsLoadState()

    // 暖機：讓 JIT 完成內聯/最佳化，避免冷啟動成本污染量測結果。
    const WARMUP = 2000
    for (let i = 0; i < WARMUP; i++) {
      stepPhysicsLoad(state)
      if ((i + 1) % RESET_INTERVAL === 0) resetPhysicsLoadState(state)
    }
    resetPhysicsLoadState(state)

    // 計時區段取平均而非單次樣本，避免單一離群值造成偽陽性/偽陰性。
    // N 選在讓計時區段落在數毫秒等級（讓 performance.now() 的解析度有意義），
    // 同時整體測試時間遠低於 1 秒。
    const N = 50_000
    const start = performance.now()
    for (let i = 0; i < N; i++) {
      stepPhysicsLoad(state)
      if ((i + 1) % RESET_INTERVAL === 0) resetPhysicsLoadState(state)
    }
    const elapsedMs = performance.now() - start
    const perStepUs = (elapsedMs / N) * 1000

    expect(perStepUs).toBeLessThan(GATE_US)
  })
})
