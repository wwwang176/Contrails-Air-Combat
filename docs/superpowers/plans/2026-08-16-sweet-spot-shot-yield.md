# 甜蜜區偏置的射擊讓位 —— 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓甜蜜區俯仰偏置在彈道射擊機會已經到手時按比例收掉,使 AI 不再被自己的打法偏好擋住扳機。

**Architecture:** 在 `src/ai/steer.ts` 新增一個純函數 `sweetYield(interceptTime, cfg)`（回傳 0..1 的係數）與一個設定欄位 `SteerConfig.sweetYieldTime`,並在唯一的消費點 `steerCommand` 把 `sit.sweetPitch` 乘上它。不動 `doctrine.ts` 的 `sweetSpotPitch`、不動 `sweetSpotMaxPitch`、不動 `assess.ts`。

**Tech Stack:** TypeScript + three.js + vitest。跑測試用 `npx vitest run <path>`。

**Spec:** `docs/superpowers/specs/2026-08-16-sweet-spot-shot-yield-design.md`

## Global Constraints

- **護欄重新定值是專案負責人的決定。** 任何既有測試若因本輪改動轉紅,一律回報,不自行放寬門檻。
- 註解與文件一律**繁體中文**,沿用本檔案既有的「【小標】理由」風格。
- 新常數必須錨在既有常數上,不得照著改完的現況畫靶（2026-08-13 spec §7.5 的第三次教訓）。
- 不新增 `steer.ts → doctrine.ts` 的相依邊。
- 每個 Task 結束時 commit,commit message 用繁體中文並說明「為什麼」。

---

### Task 1：`sweetYield` 純函數 + `SteerConfig.sweetYieldTime`

**Files:**
- Modify: `src/ai/steer.ts`（新增 import、`SteerConfig` 欄位、`DEFAULT_STEER` 欄位、`sweetYield` 函數）
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: `NO_INTERCEPT`（`src/world/lead.ts`,`steer.ts` 已 import）、`PROJECTILE_LIFETIME`（`src/world/Projectiles.ts`,**本 Task 新增 import**）
- Produces: `export function sweetYield(interceptTime: number, cfg?: SteerConfig): number`、`SteerConfig.sweetYieldTime: number`、`DEFAULT_STEER.sweetYieldTime === PROJECTILE_LIFETIME`

- [ ] **Step 1: 寫失敗的測試**

加到 `test/unit/ai-steer.test.ts` 尾端。若該檔沒有 `sweetYield` 的 import,把它加進既有的 `from '../../src/ai/steer'` 那一行。`PROJECTILE_LIFETIME` 由 `../../src/world/Projectiles` 匯入。

```ts
describe('sweetYield —— 甜蜜區偏置的射擊讓位係數', () => {
  it('沒有攔截解時完全不讓位', () => {
    expect(sweetYield(NO_INTERCEPT)).toBe(1)
  })

  it('彈丸飛不到時完全不讓位', () => {
    expect(sweetYield(DEFAULT_STEER.sweetYieldTime)).toBe(1)
    expect(sweetYield(DEFAULT_STEER.sweetYieldTime * 2)).toBe(1)
  })

  it('貼著臉時完全讓位', () => {
    expect(sweetYield(0)).toBe(0)
  })

  it('中間是線性的', () => {
    expect(sweetYield(DEFAULT_STEER.sweetYieldTime / 2)).toBeCloseTo(0.5, 12)
    expect(sweetYield(DEFAULT_STEER.sweetYieldTime / 4)).toBeCloseTo(0.25, 12)
  })

  it('時間尺度設為 0 = 這一層關閉', () => {
    const off = { ...DEFAULT_STEER, sweetYieldTime: 0 }
    for (const t of [0, 0.1, 0.5, 1.2, 5]) expect(sweetYield(t, off)).toBe(1)
  })

  it('單調不減，而且值域永遠在 [0, 1]', () => {
    let prev = -Infinity
    for (let t = -1; t <= 3; t += 0.01) {
      const y = sweetYield(t)
      // NO_INTERCEPT（−1）是哨兵值，不參與單調性
      if (t === NO_INTERCEPT) continue
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(1)
      expect(y).toBeGreaterThanOrEqual(prev)
      prev = y
    }
  })

  // 【出貨值錨在哪】與 shouldFire 的第一條共用同一個數字
  it('出貨的時間尺度就是彈丸壽命', () => {
    expect(DEFAULT_STEER.sweetYieldTime).toBe(PROJECTILE_LIFETIME)
  })
})
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: FAIL，`sweetYield is not defined` / `sweetYieldTime` 不存在。

- [ ] **Step 3: 實作**

`src/ai/steer.ts` 檔頭 import 區加一行（放在 `NO_INTERCEPT` 那一行之後,維持既有分組）：

```ts
import { PROJECTILE_LIFETIME } from '../world/Projectiles'
```

`SteerConfig` 介面加欄位（放在最後一個既有欄位之後）：

```ts
  /**
   * 甜蜜區俯仰偏置的**讓位時間尺度**，秒。彈道飛行時間短於它時，偏置按
   * `interceptTime / sweetYieldTime` 的比例收掉。**0 = 這一層關閉**（消融用）。
   *
   * 【為什麼需要讓位】`sit.sweetPitch` 只看機種對、高度、空速 —— 不看距離、
   * 不看瞄準誤差、不看有沒有射擊解。命令的航跡角是
   * `−(下瞄角 × pullCeiling) + sweetPitch`，所以偏置本身就是一個**平衡偏移**：
   * 109 在 4000 m／500 km/h 的偏置是 +10°、`pullCeiling` 是 1.00，機首於是
   * 穩定停在目標線上方 10°。而 `DEFAULT_FIRE.trackingCone` 只有 3° ——
   * **那個態勢下 AI 結構上開不了火**（人工回報，2026-08-16）。
   *
   * 【為什麼閘門不掛在瞄準誤差上】會鎖死。平衡點是 10°，閘門若設在 5°，系統
   * 永遠停在 10°、進不了 5°、閘門永遠不開。閘門必須掛在**偏置控制不到**的量
   * 上，`interceptTime` 由雙方位置與速度決定，沒有回授迴路。
   *
   * 【為什麼是 `PROJECTILE_LIFETIME`】`shouldFire` 的第一條就是
   * `interceptTime > PROJECTILE_LIFETIME → 不開火`。共用同一個數字，不新增第二套
   * 尺度 —— 與 `applyFloor` 和 `extendPitchAngle` 共用 `clearanceScale` 同一個手法。
   *
   * 【實測效果】109 對 P-51、4000 m、500 km/h：150 m 的偏置由 10° 降到 1.8°
   * （低於開火錐），800 m 仍有 9.5° —— 近戰讓位、遠距離維持原樣。
   */
  sweetYieldTime: number
```

`DEFAULT_STEER` 加一筆（放在最後一個既有欄位之後）：

```ts
  sweetYieldTime: PROJECTILE_LIFETIME,
```

`sweetYield` 函數放在 `applyPitchBias` 之後、`clampUnit` 之前：

```ts
/**
 * 甜蜜區偏置的讓位係數，0..1。1 = 照原樣偏、0 = 完全不偏。
 *
 * 【與 `unloadPull` / `energyPull` 同一族】三者都回傳係數、都由呼叫端乘上去。
 * 差別在防的東西：
 *
 *   unloadPull   看 stallMargin    —— 防**失速**
 *   energyPull   看 cornerRatio    —— 防**能量見底**
 *   sweetYield   看 interceptTime  —— 防**打法偏好擋住扳機**
 *
 * 【`NO_INTERCEPT` 回傳 1 而不是 0】沒有攔截解 = 沒有射擊機會 = 沒有東西要讓。
 * 回傳 0 會讓「彈道無解」變成「連打法都不准表態」，方向相反。
 *
 * 【`sweetYieldTime <= 0` 回傳 1】與 `energyPull` 的退化處理同一個理由：設定
 * 寫壞時讓本層失效、退回既有行為，比讓它把 AI 鎖死安全。
 *
 * @param interceptTime `EngageBasis.interceptTime`，s。`NO_INTERCEPT` 表示無解
 */
export function sweetYield(interceptTime: number, cfg: SteerConfig = DEFAULT_STEER): number {
  if (interceptTime === NO_INTERCEPT) return 1
  const span = cfg.sweetYieldTime
  if (!(span > 0)) return 1
  if (interceptTime >= span) return 1
  if (interceptTime <= 0) return 0
  return interceptTime / span
}
```

- [ ] **Step 4: 跑測試確認它通過**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: PASS，全檔綠。

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 沒有輸出。

**注意**：`SteerConfig` 加了必填欄位,所有以物件字面量建構 `SteerConfig` 的地方都會轉紅。
用 `npx tsc --noEmit` 找出來,一律改成 `{ ...DEFAULT_STEER, ... }` 的展開寫法（既有測試多半
已經如此）。若有測試檔手寫完整字面量,補上 `sweetYieldTime: PROJECTILE_LIFETIME`。

- [ ] **Step 6: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
git commit -m "feat: sweetYield —— 甜蜜區偏置的射擊讓位係數

只有純函數與設定欄位，還沒有接上消費點。
閘門掛在 interceptTime 而不是瞄準誤差 —— 後者會回授鎖死。"
```

---

### Task 2：接上唯一的消費點

**Files:**
- Modify: `src/ai/steer.ts:1457` 附近（`steerCommand` 裡的 `applyPitchBias` 那一行）
- Test: `test/unit/ai-steer.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `sweetYield`、`basis.interceptTime`（`EngageBasis` 既有欄位）
- Produces: 行為改變。`steerCommand` 簽名不變（`basis` 已經是參數）。

- [ ] **Step 1: 寫失敗的測試**

加到 `test/unit/ai-steer.test.ts`。要一條**直接比較兩個設定**的測試,不依賴整場模擬。

```ts
describe('steerCommand 的甜蜜區偏置會讓位給射擊解', () => {
  /**
   * 【為什麼比較兩個 cfg 而不是斷言一個絕對角度】絕對角度會把
   * `sweetSpotPitch` 的值、`pullCeiling`、機種對全部綁進判準，那些都不是這一
   * 條要驗的東西。比較「讓位開」與「讓位關」隔離出這一層自己的貢獻。
   */
  function pitchOf(interceptTime: number, cfg: SteerConfig): number {
    const sit = createSituation()
    const basis = createEngageBasis()
    // ...擺一個目標在正前方下方、sweetPitch 設成 +10° 的態勢
    // （實作時照本檔既有 steerCommand 測試的建構方式）
    basis.interceptTime = interceptTime
    sit.sweetPitch = 10 * (Math.PI / 180)
    const out = createCommand()
    steerCommand('engage', 'normal', sit, basis, self, 0, k, defend, null, out, cfg)
    return Math.asin(Math.max(-1, Math.min(1, out.aimWorld.y)))
  }

  it('射擊解已經到手時，偏置幾乎不生效', () => {
    const near = pitchOf(0.2, DEFAULT_STEER)
    const off = pitchOf(0.2, { ...DEFAULT_STEER, sweetYieldTime: 0 })
    // 讓位開啟時抬頭量必須明顯小於關閉時
    expect(near).toBeLessThan(off - 5 * (Math.PI / 180))
  })

  it('彈丸飛不到時，偏置維持原樣', () => {
    const far = pitchOf(DEFAULT_STEER.sweetYieldTime * 2, DEFAULT_STEER)
    const off = pitchOf(DEFAULT_STEER.sweetYieldTime * 2, { ...DEFAULT_STEER, sweetYieldTime: 0 })
    expect(far).toBeCloseTo(off, 9)
  })

  it('rally 仍然完全不吃這一層', () => {
    // 既有行為，本輪不得改動
    const a = pitchOf(0.2, DEFAULT_STEER)  // intent 改成 'rally' 重跑
    const b = pitchOf(0.2, { ...DEFAULT_STEER, sweetYieldTime: 0 })
    expect(a).toBeCloseTo(b, 12)
  })
})
```

**實作時**：照 `test/unit/ai-steer.test.ts` 既有 `steerCommand` 測試的建構方式補齊
`self`／`k`／`defend` 與態勢擺位,把上面的 `// ...` 換成真的程式碼。第三條要把 `intent`
換成 `'rally'` 才有意義 —— 依既有測試的寫法把 `intent` 也做成 `pitchOf` 的參數。

- [ ] **Step 2: 跑測試確認它失敗**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: 第一條 FAIL（讓位還沒接上,兩者相等）；第二、三條應該已經 PASS。

- [ ] **Step 3: 實作**

```ts
  // ── 甜蜜區：把航跡角偏向自己佔優的高度／速度，方位不動 ──
  // 【為什麼排在撞地底限之前】底限的優先序最高，必須有最後決定權 ——
  // 「想低頭換速度」不能贏過「快撞海了」。
  //
  // 【為什麼 rally 排除】指揮層的位階比戰術偏好高。「我想飛高一點」不該
  // 蓋過「去那個點集合」。拉桿紀律則相反，連早退路徑都涵蓋 —— 沒有任何
  // 命令的內容是「把自己拉爆」。見 spec §4.4。
  //
  // 【2026-08-16：讓位給射擊解】同一個位階問題的第三個對象。「我想把仗帶到
  // 我的甜蜜區」不該蓋過「射擊解已經到手了」。人工回報：109 在 500 km/h 的
  // 偏置是 +10°，機首因此穩定停在目標線上方 10°，而開火錐只有 3° ——
  // 結構上開不了火。見 `sweetYield`。
  if (intent !== 'rally') {
    applyPitchBias(sit.sweetPitch * sweetYield(basis.interceptTime, cfg), out.aimWorld)
  }
```

- [ ] **Step 4: 跑測試確認它通過**

Run: `npx vitest run test/unit/ai-steer.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts
git commit -m "feat: 甜蜜區偏置接上射擊讓位

唯一的消費點乘上 sweetYield(basis.interceptTime)。
簽名不變 —— basis 本來就是 steerCommand 的參數。"
```

---

### Task 3：主判準 —— 把人工回報的場景收斂成護欄

**Files:**
- Create: `test/integration/ai-shot-yield.test.ts`
- 參考（不修改）: `test/tools/nose-bias.probe.ts`

**Interfaces:**
- Consumes: Task 2 的行為、`DEFAULT_FIRE.trackingCone`、`DEFAULT_STEER.sweetYieldTime`
- Produces: 無（純測試檔）

- [ ] **Step 1: 寫失敗的測試**

把 `test/tools/nose-bias.probe.ts` 的場景搬過來（**照抄它的 `Climber`、擺位、
`harmless`、`applyFeel` 用法**,那支探針已經驗證過場景成立）,改成量測 + 斷言。

```ts
/**
 * 主判準：**AI 必須能把機首帶到扣得下扳機的位置。**
 *
 * 【場景來自人工回報，2026-08-16】109 交 AI 代飛，敵機正前方 150 m、預瞄點在
 * 下方 15°、我機 500 km/h、敵機爬升 10°。實測 AI 的機首穩定停在目標線上方
 * 10°，永遠開不了火。根因見 spec 2026-08-16-sweet-spot-shot-yield-design。
 *
 * 【門檻錨在哪】`DEFAULT_FIRE.trackingCone` —— `shouldFire` 的第四條，「機首
 * 真的對著預瞄方向」。它在本輪之前就存在、為別的用途而定。不從改完的現況
 * 推導（2026-08-13 spec §7.5 的第三次教訓）。
 *
 * 【為什麼要有關閉對照】若把這一層關掉、判準卻沒有變差，代表判準沒有量到
 * 這一層 —— 那條讓「這個缺陷是真的」可證偽。
 */
const DROP_DEG = 15
const TAS_KMH = 500
const FOE_CLIMB_DEG = 10
const RANGE = 150
const SECONDS = 6
/** 只看最後一秒 —— 前面是暫態，收斂之後才是這個態勢的結論 */
const TAIL_SECONDS = 1

function noseOffMedian(cfg: SteerConfig): number { /* 跑模擬，回傳最後一秒
  「預瞄方向與機首夾角」的中位數，rad */ }

describe('甜蜜區偏置不得擋住扳機（開局 150 m、預瞄點在下方 15°）', () => {
  it('讓位開啟時，機首進得了開火錐', () => {
    expect(noseOffMedian(DEFAULT_STEER)).toBeLessThan(DEFAULT_FIRE.trackingCone)
  })

  it('讓位關閉時，機首進不了開火錐 —— 這條讓缺陷可證偽', () => {
    const off = { ...DEFAULT_STEER, sweetYieldTime: 0 }
    expect(noseOffMedian(off)).toBeGreaterThan(DEFAULT_FIRE.trackingCone)
  })

  it('遠距離維持原樣：800 m 的讓位係數 > 0.9', () => {
    // 直接用純函數，不必再跑一場模擬
    expect(sweetYield(1.135)).toBeGreaterThan(0.9)
  })
})
```

**實作要點**：
- `AiController` 沒有吃 `SteerConfig` 的入口。查 `AiController` 怎麼取得 `SteerConfig`
  （`steerCommand` 的預設參數）。**若它寫死用 `DEFAULT_STEER`,把「讓位關閉」的對照
  改成直接呼叫 `steerCommand` 的單元層對照,或替 `AiController` 加一個
  `steerConfig` 欄位**（後者較乾淨,但屬於本 Task 的實作決定,做之前先確認既有
  測試怎麼做同類消融 —— `test/integration/ai-defence.test.ts` 有前例）。
- 兩架都要用無傷害彈藥（`harmless`）,避免有人被打下來。
- 斷言兩架全程存活。

- [ ] **Step 2: 跑測試確認第一條失敗**

先把 Task 2 的改動 `git stash`,或把 `sweetYieldTime` 暫時設 0 跑一次,確認第一條會紅。
確認完恢復。

Run: `npx vitest run test/integration/ai-shot-yield.test.ts`

- [ ] **Step 3: 跑測試確認全綠**

Run: `npx vitest run test/integration/ai-shot-yield.test.ts`
Expected: 3 條全 PASS。

- [ ] **Step 4: Commit**

```bash
git add test/integration/ai-shot-yield.test.ts
git commit -m "test: 主判準 —— AI 必須能把機首帶到扣得下扳機的位置

門檻錨在既有的 DEFAULT_FIRE.trackingCone，不是照現況畫靶。
關閉對照那一條讓「這個缺陷是真的」可證偽。"
```

---

### Task 4：掃描 `sweetYieldTime`，全套回歸，回填

**Files:**
- Create: `test/tools/shot-yield.probe.ts`
- Modify: `docs/superpowers/specs/2026-08-16-sweet-spot-shot-yield-design.md`（新增 §8 實作結果）
- Modify: `src/ai/steer.ts`（若掃描結果要改預設值 —— **需專案負責人裁定**）

- [ ] **Step 1: 寫掃描探針**

`test/tools/shot-yield.probe.ts`,掃 `sweetYieldTime` = 0（關閉）／1×／1.5×／2× `PROJECTILE_LIFETIME`。
每個值印：

- 主判準場景的「機首離預瞄方向」中位數
- 100 / 150 / 300 / 600 / 800 m 各自的讓位係數與實際偏置
- 一場 1v1（109 vs P-51）的 `fireShare` 與擊落結果,兩邊各跑一次

Run: `npx vite-node test/tools/shot-yield.probe.ts`

- [ ] **Step 2: 全套回歸**

Run: `npx vitest run`

**逐條與改動前比較。** 改動前的基準：本分支 `HEAD` 在 Task 1 之前的那一次
`npx vitest run`（若沒有,先 `git stash` 跑一次存下來）。

已知的既有紅燈（**與本輪無關,不得因此放寬**）：4 個檔案 / 5 條。
`perf-gate` 在並行負載下是假紅,單獨跑會過。

**任何新增的紅燈都要回報,不自行放寬門檻。**

- [ ] **Step 3: 回填 spec §8**

寫進 spec：掃描表、全套回歸的逐條比較、`sweetYieldTime` 的定值與理由、
§7.1（300 m 平衡偏移）掃完之後的結論、以及任何被推翻的假設。

- [ ] **Step 4: Commit**

```bash
git add test/tools/shot-yield.probe.ts docs/superpowers/specs/2026-08-16-sweet-spot-shot-yield-design.md
git commit -m "test: sweetYieldTime 掃描 + 全套回歸 + spec §8 回填"
```

- [ ] **Step 5: 交專案負責人試飛**

回報：改了什麼、掃描表、回歸結果、`sweetYieldTime` 的建議值與待裁定項。
**不自行合併到 main。**

---

## 自我檢查

**Spec 覆蓋**

| Spec 節 | 對應 Task |
|---|---|
| §4.4 斜坡形狀、`NO_INTERCEPT`、關閉語意 | Task 1 |
| §5.1 純函數位置與理由 | Task 1 |
| §5.2 設定欄位 | Task 1 |
| §5.3 消費點 | Task 2 |
| §6.1 純函數單元測試 | Task 1 Step 1 |
| §6.2 主判準 + 可證偽對照 | Task 3 |
| §6.3 遠距離不得被改壞 | Task 3 第三條 |
| §6.4 全套回歸 | Task 4 Step 2 |
| §6.5 Playwright（本輪不新增） | 無 Task —— spec 明文說明理由 |
| §7.1 `sweetYieldTime` 掃 1×/1.5×/2× | Task 4 Step 1 |

**型別一致性**：`sweetYield(interceptTime: number, cfg?: SteerConfig): number` 在
Task 1 定義、Task 2 與 Task 3 消費,名稱與簽名一致。`SteerConfig.sweetYieldTime` 同。

**已知的未填細節**：Task 2 Step 1 與 Task 3 Step 1 的測試骨架留了 `// ...`,因為它們
必須照 `test/unit/ai-steer.test.ts` 與 `test/integration/ai-defence.test.ts` 既有的建構
方式寫,而那兩個檔案的既有寫法要在動手時讀。**每一處都標明了要去讀哪一個檔案的哪一種
既有寫法**,不是留給實作者自由發揮。
