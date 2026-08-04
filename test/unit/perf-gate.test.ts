import { describe, it, expect } from 'vitest'
import { createPhysicsLoadState, resetPhysicsLoadState, stepPhysicsLoad } from '../../bench/physics-load'
import {
  createProjectileLoad, resetProjectileLoad, stepProjectileLoad,
} from '../../bench/projectile-load'
import { createAiLoad, resetAiLoad, stepAiLoad } from '../../bench/ai-load'
import { createMultiLoad, resetMultiLoad, stepMultiLoad } from '../../bench/multi-load'

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

    // 【取多批的最小值，而且批次要多而短】vitest 把測試檔分散到多個 worker
    // 並行跑，這一條因此會與其他檔搶 CPU。最小值取的是干擾最少的那一批，
    // 才是「這段程式要花多久」的估計。
    //
    // 批次數從 5 提高到 40：M5 加進來的 20v20 整合矩陣（60 秒模擬）是全套
    // 裡最吃 CPU 的一項，5 批 × 400 次的話每批要跑滿數十毫秒，很難有哪一批
    // 完全沒被打擾——實測讓這一條間歇性紅燈（1,180 µs vs 900 的門檻）。
    // 總工作量不變，只是把它切碎，最小值取到乾淨批次的機會大得多。
    //
    // **門檻沒有動。** 會飄的效能門檻比沒有門檻更糟，但修法是讓量測抗干擾，
    // 不是放寬斷言。
    //
    // 上面的 stepDynamics 門檻用平均值沒事，是因為它有 15 倍餘裕
    // （1.3 µs vs 20 µs）；這一條只有 2 倍，扛不住同樣的雜訊。
    const BATCHES = 40
    const N = 50
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

/**
 * AI 的效能守門（spec §12）。
 *
 * 【為什麼門檻是 900 µs 而設計預算是 250 µs】與 M2 的彈丸門檻同一個理由：
 * vitest 把測試檔分散到多個 worker 並行跑，這一條會與其他檔搶 CPU，同一段
 * 程式獨立跑與整套回歸裡量到的數字差兩倍以上。門檻設在預算線上會**時紅
 * 時綠**，而會飄的效能門檻比沒有門檻更糟——它訓練所有人重跑一次當作沒
 * 看到，真的迴歸時也就沒人信了。
 *
 * 900 µs 抓的是**數量級的迴歸**，例如有人把 10 Hz 的包絡查詢改成每步都跑
 * （`sustainedTurnRate` 是 50 次二分搜尋 × 2 架 × 240 Hz）。設計預算本身由
 * `npm run bench` 獨立驗證。
 */
const AI_BUDGET_US = 250
const AI_GATE_US = 900

describe('ai step perf gate', () => {
  it('兩架 AI 纏鬥的 World.step 沒有數量級的迴歸', () => {
    const state = createAiLoad()

    for (let i = 0; i < 500; i++) stepAiLoad(state)
    resetAiLoad(state)

    // 取多批的最小值，批次多而短——見上面關於並行雜訊的說明
    const BATCHES = 40
    const N = 50
    let best = Infinity
    for (let b = 0; b < BATCHES; b++) {
      const t0 = performance.now()
      for (let i = 0; i < N; i++) stepAiLoad(state)
      best = Math.min(best, ((performance.now() - t0) * 1000) / N)
    }

    expect(best).toBeLessThan(AI_GATE_US)
    if (best >= AI_BUDGET_US) {
      console.warn(
        `AI 步 ${best.toFixed(0)} µs 超過 ${AI_BUDGET_US} µs 的設計預算；`
        + '若非並行雜訊所致，請以 npm run bench 獨立複測。',
      )
    }
  })
})

/**
 * 20v20 的效能守門（M5 spec §10、M6 spec §11）。
 *
 * 【兩個數字各有用途】與上面的彈丸門檻、AI 門檻同一個理由：vitest 把測試檔
 * 分散到多個 worker 並行跑，門檻壓在預算線上會**時紅時綠**，而會飄的效能
 * 門檻比沒有門檻更糟 —— 它訓練所有人重跑一次當作沒看到，真的迴歸時也就
 * 沒人信了。
 *
 * 【M5 的預算 500 µs】`npx vitest bench --run bench/multi.bench.ts` 獨立
 * 量三次：313 / 388 / 402 µs（mean，各約 1,300–1,600 樣本）。**單一次量測
 * 會騙人** —— 第一次的 313 是機器最閒的時候。取觀測上界之上的 500。
 * 設計預估是 570 µs（M5 spec §5.5），實測更好，因為同隊跳過又砍掉約一半的
 * 配對。
 *
 * 【M6 重新校準為 300 µs】M5 的數字是在「每隊 X 向跨度 2,280 m、兩隊 Z 向
 * 相距 3,000 m」的佈局下量的。M6 改成 5 個 Schwarm 並排、開局拉到 10 km：
 *
 *   每隊 X 向跨度  2,280 m → 3,850 m
 *   兩隊 Z 向間隔  3,000 m → 10,000 m
 *
 * 而 `CullIndex` 是沿 X 排序的滑動視窗，視窗內的架數直接由 X 向密度決定
 * —— X 攤得更開，每發彈丸掃到的架數就更少。**這個數字因此不可與 M5 的
 * 直接比較。**
 *
 * M6 實測三次：**208.7 / 216.1 / 245.1 µs**。取觀測上界之上的整百 = 300。
 *
 * **變快了就一定要跟著調低**，否則門檻會鬆到再也抓不到迴歸 —— 那正是這次
 * 重新校準存在的理由。
 *
 * 【M7 重測，預算不變】`resolveHits` 被動了兩處：入射面法線（六次 slab
 * 迴圈裡多兩個賦值，加上命中時一次四元數旋轉）與入海判定（每個存活彈丸
 * 多兩次比較）。實測三次 **226.3 / 228.0 / 223.0 µs** —— 上界 228 取整到
 * 百位仍是 300，兩處改動的成本落在既有預算的雜訊之內（M6 是
 * 208.7 / 216.1 / 245.1，三次的散布比 M7 還大）。
 *
 * 【入海回收不影響這個數字】`bench/multi-load.ts` 每步把彈丸池補滿到
 * `PROJECTILE_CAPACITY`，所以負載是合成的 —— 存活彈丸變少不會讓 bench
 * 變輕。那是 M6 已經確認過的一件事。
 *
 * 【彈丸負載沒有變】`bench/multi-load.ts` 每步把池補滿到
 * `PROJECTILE_CAPACITY`，所以「開局在巡航、沒人開火」不會讓負載變空 ——
 * 那是設計時擔心過但實際不成立的一件事。
 *
 * 【本測試量的是另一個統計量】它取多批的最小值，而 bench 報的是平均值
 * （含週期性重置的尖峰，max 到 2.6 ms）。最小值一貫低於平均值。
 *
 * 【M6 起這一條在整套並行回歸裡會印出超支警告，而那是環境不是迴歸】
 * 單獨跑（或只跟 `multi-battle` 一起跑）不會警告；跑滿 53 個測試檔時量到
 * 590–704 µs。已驗證與 M6 的改動無關：把整合測試的模擬長度改回 M5 的
 * 60 秒重跑整套，仍然量到 590 µs —— 也就是說 M5 的 500 µs 預算在這台
 * 機器上同樣會觸發。**權威數字是獨立的 `npm run bench`**，這個警告只是
 * 提醒去複測，`MULTI_GATE_US` 才是斷言。
 *
 * 【門檻取預算的三倍】這一條要抓的是**數量級的迴歸**，具體而言就是「有人
 * 把排序掃描改回全掃描」——實測那會讓粗篩從 202 µs 變成 7,408 µs
 * （spec §5.1），整步遠超 900。並行雜訊最壞約三倍，兩者之間有八倍以上的
 * 間隙。
 */
const MULTI_BUDGET_US = 300
const MULTI_GATE_US = 900

describe('20v20 perf gate', () => {
  it('20v20 × 滿載 4,000 發的 World.step 沒有數量級的迴歸', () => {
    const state = createMultiLoad()
    for (let i = 0; i < 300; i++) stepMultiLoad(state)
    resetMultiLoad(state)

    // 取多批的最小值，批次多而短——見上面關於並行雜訊的說明
    const BATCHES = 40
    const N = 25
    let best = Infinity
    for (let b = 0; b < BATCHES; b++) {
      const t0 = performance.now()
      for (let i = 0; i < N; i++) stepMultiLoad(state)
      best = Math.min(best, ((performance.now() - t0) * 1000) / N)
    }

    expect(best).toBeLessThan(MULTI_GATE_US)
    if (best >= MULTI_BUDGET_US) {
      console.warn(
        `20v20 步 ${best.toFixed(0)} µs 超過 ${MULTI_BUDGET_US} µs 的設計預算；`
        + '若非並行雜訊所致，請以 npm run bench 獨立複測。',
      )
    }
  })
})
