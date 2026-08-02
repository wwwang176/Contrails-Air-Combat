import { describe, it, expect } from 'vitest'
import { createPhysicsLoadState, resetPhysicsLoadState, stepPhysicsLoad } from '../../bench/physics-load'
import {
  createProjectileLoad, resetProjectileLoad, stepProjectileLoad,
} from '../../bench/projectile-load'

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

/**
 * 彈丸池的效能守門（spec §3.2 驗收要求 6）。
 *
 * 【設計預算是 400 µs，這裡的斷言是 900 µs —— 兩個數字各有用途】
 *
 * 預算：60 FPS = 16.7 ms/幀，240 Hz 物理一幀最多 4 步，400 µs × 4 = 1.6 ms，
 * 只佔一幀的 10%，其餘留給渲染。**這個預算由 `npm run bench` 驗證**——
 * benchmark 是獨立跑的，量到的是程式真正的成本（實測 175 µs）。
 *
 * 斷言：vitest 把測試檔分散到多個 worker 並行跑，這一條會與其他檔搶 CPU。
 * 同一段程式獨立跑 175 µs，在整套回歸裡會被推到 400–450 µs，剛好壓在預算
 * 線上——門檻設 400 的話會**時紅時綠**，而會飄的效能門檻比沒有門檻更糟：
 * 它訓練所有人重跑一次當作沒看到，真的迴歸時也就沒人信了。
 *
 * 所以斷言取 900 µs：它要抓的是**數量級的迴歸**，而那正是這一層唯一會發生的
 * 事故類型。實例：拿掉 World.resolveHits 的包圍球粗篩，獨立跑就從 175 µs
 * 變成 1,895 µs（並行下更高）——遠遠超過 900。相對地，並行雜訊最壞只到 450。
 * 兩者之間有兩倍以上的間隙，不會誤報也不會漏報。
 *
 * 【為什麼用滿載而不是 M2 實際的兩架】池容量是按 **M5 的 40 架**抓的
 * （spec §10）。M2 就用滿載跑驗收，不等到 M5 才發現彈丸是熱點。
 */
const PROJECTILE_BUDGET_US = 400
const PROJECTILE_GATE_US = 900

describe('projectile step perf gate', () => {
  it('滿載 4,000 發的 World.step 沒有數量級的迴歸', () => {
    const state = createProjectileLoad()

    // 暖機：讓 JIT 完成內聯/最佳化
    for (let i = 0; i < 200; i++) stepProjectileLoad(state)
    resetProjectileLoad(state)

    // 【取多批的最小值，不是單批的平均】vitest 把測試檔分散到多個 worker
    // 並行跑，這一條因此會與其他檔搶 CPU：單獨跑量到 209 µs 的同一段程式，
    // 在整套回歸裡會被推到 570 µs。平均值把那段搶佔算進成本，量到的就不是
    // 程式的成本而是當下的機器負載。最小值取的是干擾最少的那一批，才是
    // 「這段程式要花多久」的估計。
    //
    // 上面的 stepDynamics 門檻用平均值沒事，是因為它有 15 倍餘裕
    // （1.3 µs vs 20 µs）；這一條只有 2 倍，扛不住同樣的雜訊。
    const BATCHES = 5
    const N = 400
    let best = Infinity
    for (let b = 0; b < BATCHES; b++) {
      const t0 = performance.now()
      for (let i = 0; i < N; i++) stepProjectileLoad(state)
      best = Math.min(best, ((performance.now() - t0) * 1000) / N)
    }

    expect(best).toBeLessThan(PROJECTILE_GATE_US)
    // 預算本身不在這裡斷言（並行雜訊會讓它時紅時綠），但把它留在報告裡，
    // 讓「現在離預算多遠」在測試輸出中一眼可見。
    if (best >= PROJECTILE_BUDGET_US) {
      console.warn(
        `彈丸步 ${best.toFixed(0)} µs 超過 ${PROJECTILE_BUDGET_US} µs 的設計預算；`
        + '若非並行雜訊所致，請以 npm run bench 獨立複測。',
      )
    }
  })
})
