import { describe, it, expect } from 'vitest'
import { createPhysicsLoadState, resetPhysicsLoadState, stepPhysicsLoad } from '../../bench/physics-load'
import {
  createProjectileLoad, resetProjectileLoad, stepProjectileLoad,
} from '../../bench/projectile-load'
import { createAiLoad, resetAiLoad, stepAiLoad } from '../../bench/ai-load'
import { createMultiLoad, resetMultiLoad, stepMultiLoad } from '../../bench/multi-load'
import {
  createTurretSearchLoad, createTurretTrackLoad, resetTurretLoad, stepTurretLoad,
  type TurretLoadState,
} from '../../bench/turret-load'

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

/**
 * 砲塔的效能守門。
 *
 * 【為什麼需要另外一條】既有的 20v20 門檻用 `bench/multi-load.ts`，
 * 那一份是 P-51D 對 Bf 109 —— **兩者的 `turrets` 都是空陣列**，所以它
 * 完全沒有量到砲塔。`bench/turret-load.ts` 把紅隊換成 B-17G（160 座砲塔），
 * 架數、彈丸池、控制器都不動，兩個數字因此直接可減。
 *
 * ── ⚠ 第一版的追瞄負載沒有量到它宣稱的東西（Codex 2026-08-21）────
 *
 * 第一版直接用 `PURSUIT` 起始，而那把敵機全部放在同一側 —— 暖機之後只有
 * **114 / 160 座**取得目標，`top` 與 `tail` 是 **0 座**。門檻因此完全沒有
 * 涵蓋合法的最壞情形。`bench/turret-load.ts` 現在改成把敵機擺成包圍，
 * 實測 **160/160**（八種砲塔各 20 座）。
 *
 * **真正的最壞情形比舊負載貴 46%**（+204 µs 對 +140 µs）—— 也就是說舊門檻
 * 不只是宣稱錯了，它守的位置也偏低。
 *
 * ── 實測（`npx tsx test/tools/turret-perf.probe.ts`，獨立跑兩次）──────
 *
 * ```
 *   負載                    每步 µs（兩次）      比 20v20 多
 *   20v20（無砲塔）       188.5 / 182.1            ——
 *   搜尋（搜不到目標）    184.5 / 185.2       −4.1 / +3.1
 *   追瞄（160/160 有目標） 392.5 / 402.0      +204.0 / +219.9
 * ```
 *
 * **搜尋那一份落在雜訊之內** —— 160 座砲塔每秒各掃一次 40 個候選，攤到
 * 240 Hz 是每步 27 次 `solveLead`，量不出來是對的。這正是 `SEARCH_INTERVAL`
 * 節流要做到的事；計畫第一版「沒有目標就每步重掃」會是它的 240 倍。
 *
 * ── ⚠ 同一份負載在三個執行環境下是三個數字 ───────────────────
 *
 * ```
 *                        20v20    追瞄    追瞄／20v20
 *   tsx（權威）           185      397        2.1×
 *   vite-node（走 SSR）   258      770        3.0×
 *   vitest（這一檔單獨跑） 227     1774        7.8×
 * ```
 *
 * 【第一版的解釋是錯的，已被實測推翻】原本寫「vite 的 SSR transform 讓跨
 * 模組呼叫難以內聯」。用 `vite-node` 跑同一支探針（同樣走 SSR）可以把這件事
 * 單獨隔離出來：**SSR 只解釋到 1.9×**（770 / 397），而 vitest 是 4.5×
 * （1774 / 397）。
 *
 * SSR 對砲塔路徑的懲罰確實比對 20v20 重（1.9× 對 1.4×），那部分推論沒錯 ——
 * 砲塔的熱路徑跨四個檔（`inArc`／`slew`／`applyWobble`／`wobbleBasis`／
 * `stepCadence`／`solveLead`），20v20 的 `resolveHits` 幾乎都在 `World.ts`
 * 檔內。**但那不是主因。** 剩下的 2.3× 是**同一個 worker 先跑過好幾種不同
 * 形狀的 `World` 負載之後的 JIT 狀態** —— Codex 實測「vitest 只跑追瞄那一條」
 * 是 435 µs（與 vite-node 的 436 幾乎相同），跑完整個 perf 檔之後才變 1107。
 *
 * 【權威數字是獨立那一份】與這一檔既有的立場一致：「權威數字是獨立的
 * `npm run bench`，這個警告只是提醒去複測」。
 *
 * ── 門檻怎麼訂 ──────────────────────────────────────────
 *
 * **預算**取獨立量測上界之上的整百；**門檻**必須擋得住 vitest 的環境因子，
 * 否則會時紅時綠 —— 而會飄的效能門檻比沒有門檻更糟。
 *
 * ```
 *   搜尋  獨立上界 185、vitest 229  → 預算 300、門檻  900
 *   追瞄  獨立上界 402、vitest 1774 → 預算 500、門檻 3500
 * ```
 *
 * 搜尋那一條與 20v20 的 300/900 完全相同 —— 它量到的本來就是同一件事。
 *
 * **⚠ 追瞄那一條的守門能力比這一檔其他幾條弱，這是已知的限制不是疏忽。**
 * 3500 對 vitest 實測只有 2.0 倍餘裕（與彈丸門檻的 2× 同級），也就是說
 * **一個「讓 `stepTurrets` 慢一倍」的迴歸不會被它抓到** —— 1774 會變成
 * 約 3200，仍在門檻之下。要抓那一級的迴歸只能靠獨立探針
 * （`test/tools/turret-perf.probe.ts`，那裡 397 → 794 一眼可見）。
 *
 * 之所以不把門檻壓到 2500：vitest 那個 4.5× 的環境因子來自 JIT 狀態，
 * 而 JIT 狀態會隨 V8 版本、機器、以及這一檔前面幾條測試的內容而變。壓在
 * 觀測值附近的門檻會開始時紅時綠，那比守不住還糟。
 *
 * **修法是讓量測抗干擾，不是放寬斷言** —— 這一檔的既有立場。真正的修法是
 * 讓追瞄那一條在**乾淨的 worker** 裡跑（例如自己一個檔案）。沒有這麼做是
 * 因為那會多一支「必須單獨跑」的測試，而這個專案已經有兩支了。
 * **這一項待專案負責人裁定。**
 *
 * 這幾條要抓的具體迴歸：把 `SEARCH_INTERVAL` 的節流拿掉（每步 27 次
 * `solveLead` 變成 6,400 次，搜尋那一條會直接衝破 900），或把每座砲塔的
 * 逆姿態四元數從「一架算一次」改回「每座各算一次」。
 */
const TURRET_SEARCH_BUDGET_US = 300
const TURRET_SEARCH_GATE_US = 900
const TURRET_TRACK_BUDGET_US = 500
const TURRET_TRACK_GATE_US = 3500

function measureTurretLoad(make: () => TurretLoadState): number {
  const state = make()
  for (let i = 0; i < 300; i++) stepTurretLoad(state)
  resetTurretLoad(state)

  // 取多批的最小值，批次多而短 —— 見上面關於並行雜訊的說明
  const BATCHES = 40
  const N = 25
  let best = Infinity
  for (let b = 0; b < BATCHES; b++) {
    const t0 = performance.now()
    for (let i = 0; i < N; i++) stepTurretLoad(state)
    best = Math.min(best, ((performance.now() - t0) * 1000) / N)
  }
  return best
}

describe('turret perf gate', () => {
  it('160 座砲塔搜不到目標時，成本仍在 20v20 的雜訊之內', () => {
    const best = measureTurretLoad(createTurretSearchLoad)
    expect(best).toBeLessThan(TURRET_SEARCH_GATE_US)
    if (best >= TURRET_SEARCH_BUDGET_US) {
      console.warn(
        `砲塔搜尋步 ${best.toFixed(0)} µs 超過 ${TURRET_SEARCH_BUDGET_US} µs 的設計預算；`
        + '若非並行雜訊所致，先確認 SEARCH_INTERVAL 的節流還在。',
      )
    }
  })

  it('160 座砲塔**全部**有目標時沒有數量級的迴歸', () => {
    const best = measureTurretLoad(createTurretTrackLoad)
    expect(best).toBeLessThan(TURRET_TRACK_GATE_US)
    if (best >= TURRET_TRACK_BUDGET_US) {
      console.warn(
        `砲塔追瞄步 ${best.toFixed(0)} µs 超過 ${TURRET_TRACK_BUDGET_US} µs 的設計預算；`
        + '若非並行雜訊所致，請以 test/tools/turret-perf.probe.ts 獨立複測。',
      )
    }
  })
})
