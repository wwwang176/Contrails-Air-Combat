# AI 主動能量經營 —— 戰術層 實作計畫

> **給實作者**：逐個 Task 做完，每個 Task 自己的驗收沒過就不要往下走。
> 步驟用 `- [ ]` 追蹤。

**Spec**：`docs/superpowers/specs/2026-08-22-energy-tactics-design.md`（925 行，
每一節的編號在下面被引用）

**目標**：修掉 `extend` 的方向錯誤，並加上一層六狀態的單機戰術層，讓 AI 會
主動經營能量（boom and zoom）。

**架構**：純函數放 `src/ai/tactics.ts`，狀態集中在 `AiController`。戰術層是
**外部覆寫**，不動 `rules.ts` 的 `arbitrate`，與現行命令層完全同型。

**技術**：TypeScript + three.js + vitest。測試指令 `npx vitest run <path>`，
型別檢查 `npx tsc --noEmit`，探針 `npx tsx <path>`。

## 全域約束

每個 Task 的要求都隱含包含這一節。

- **熱路徑零配置**。240 Hz 的物理步裡不得 `new` 任何物件。要暫存向量就用
  模組私有的 scratch（`makeScratch`）。
- **不得使用 `Math.random`**。要錯開就用低差異序列（黃金比 / √2 / √3 的
  小數部分）。
- **`src/ai/` 不得 `import` `src/battle/`**。跨層資料靠 TypedArray。
- **分頻**：意圖仲裁與能量評估 10 Hz（`decide` 節拍），轉向與開火 240 Hz。
- **`assess` / `rules` / `steer` / `fire` / `doctrine` / `tactics` 全部是純
  函數**，狀態集中在 `AiController`。
- **護欄重新定值是專案負責人的決定**。任何既有測試紅了：先量、先報告、
  先問，**不得**為了讓它變綠而放寬門檻。
- **不得引入 `@types/node`**。
- **所有註解與 commit message 用繁體中文。註解寫現狀，不寫沿革。**
- **`test/unit/perf-gate.test.ts` 與 `test/integration/rematch.test.ts` 必須
  單獨跑**（`npx vitest run <path>`），不能混在全套裡。
- **既有的三條紅測試**（`ai-command-channel` ×2、`ai-withdraw-anchor` ×1）
  是既有的，不要修它們。
- **絕不 `git add -A`** —— `bash.exe.stackdump` 是被追蹤且長期被修改的檔案。
  一律列明確路徑。

---

## 檔案結構

| 檔案 | 責任 | Task |
|---|---|---|
| `src/ai/assess.ts` | `Situation` 加兩個無因次欄位，`evaluateEnergy` 算它們 | 1 |
| `src/ai/steer.ts` | `extendPitchAngle` 換簽名與算式 | 2 |
| `test/unit/ai-steer.test.ts` | 17 處呼叫更新簽名 | 2 |
| `test/unit/extend-direction.test.ts` | **新建**。方向修正的護欄與三類反例 | 2 |
| `src/ai/tactics.ts` | **新建**。型別、設定、名額、狀態機、瞄準解 | 4–6 |
| `test/unit/ai-tactics.test.ts` | **新建**。純函數的護欄 | 4–6 |
| `src/ai/AiController.ts` | 戰術狀態欄位、10 Hz 推進、覆寫、`resetTactics` | 7 |
| `test/integration/tactics-off.test.ts` | **新建**。`quota = 0` 的整合級等價 | 8 |
| `test/integration/replay-determinism.test.ts` | **新建**。同設定雙跑 | 8 |
| `src/ai/target.ts` | `TargetBoard` 加 `protectedMask` | 9 |
| `src/battle/setup.ts` | 填 `protectedMask`、`resetBattle` 呼叫 `resetTactics` | 7、9 |
| `test/tools/energy-cycle.probe.ts` | **新建**。單輪能量帳與 `psSelf − psTarget` | 11 |
| `test/tools/tactics-ablation.probe.ts` | **新建**。七卡 × 三檔 × 五種子 | 12 |

---

# 階段一：方向修正

**這一階段對所有 AI 生效，不受 `quota` 控制。** 它不是戰術層的一部分，是一個
錯誤的修正。做完要單獨驗收（Task 3），因為它與戰術層的影響必須分得開。

## Task 1：`Situation` 加兩個無因次欄位

**檔案**
- Modify：`src/ai/assess.ts`（`Situation` 介面、`createSituation`、
  `evaluateEnergy`）
- Test：`test/unit/ai-assess.test.ts`

**介面**
- 產出：`Situation.speedAdvantage: number`、`Situation.energyRatio: number`

**這個 Task 不改任何行為**——只是把兩個量算出來放著。

- [ ] **Step 1：寫失敗的測試**

加到 `test/unit/ai-assess.test.ts`（找 `evaluateEnergy` 那個 `describe`
區塊，加在最後）：

```ts
  it('speedAdvantage 是雙方 TAS 差除以我的角落速度', () => {
    // 【為什麼分母只有自己的】這個量要餵給 `extendPitchAngle`，而那個函數
    // 是在替**我**產生俯仰命令 —— 以自己的操縱速度尺度正規化才有意義。
    const self = new Aircraft(BF109G6, 5000, 200)
    const target = new Aircraft(P51D, 5000, 240)
    self.update(new Vector3(0, 0, -1), 0.8, 1 / 240)
    target.update(new Vector3(0, 0, -1), 0.8, 1 / 240)
    const sit = createSituation()
    evaluateEnergy(self, target, sit)

    const vc = manoeuvreSpeed(self.spec, self.state.position.y)
    const want = (self.diag.aero.tas - target.diag.aero.tas) / vc
    expect(sit.speedAdvantage).toBeCloseTo(want, 9)
    // 慢的那一方是負的
    expect(sit.speedAdvantage).toBeLessThan(0)
  })

  it('speedAdvantage 的分母與 cornerRatio 是同一個', () => {
    // 【為什麼要釘住這件事】兩個量若用不同的尺標，`extendPitchAngle` 裡
    // 取 max 的那一步就是在比兩個不同單位的數字。
    const self = new Aircraft(P51D, 6000, 220)
    const target = new Aircraft(BF109G6, 6000, 180)
    self.update(new Vector3(0, 0, -1), 0.8, 1 / 240)
    target.update(new Vector3(0, 0, -1), 0.8, 1 / 240)
    const sit = createSituation()
    evaluateEnergy(self, target, sit)

    // cornerRatio = Vs / vc、speedAdvantage = (Vs − Vt) / vc
    // ⇒ Vt / vc = cornerRatio − speedAdvantage
    const vc = self.diag.aero.tas / sit.cornerRatio
    expect((self.diag.aero.tas - target.diag.aero.tas) / vc)
      .toBeCloseTo(sit.speedAdvantage, 9)
  })

  it('energyRatio 是比能量差除以角落速度的動能高度', () => {
    // 【為什麼用 vc² / 2g】它是「把角落速度的動能全部換成高度會有多高」，
    // 是這架飛機在這個高度的天然能量尺標。除以它之後，同一個數字對任何
    // 機種都代表同一件事 —— 這是「一組參數對所有機型成立」的根據。
    const self = new Aircraft(BF109G6, 6000, 200)
    const target = new Aircraft(P51D, 5500, 200)
    self.update(new Vector3(0, 0, -1), 0.8, 1 / 240)
    target.update(new Vector3(0, 0, -1), 0.8, 1 / 240)
    const sit = createSituation()
    evaluateEnergy(self, target, sit)

    const vc = manoeuvreSpeed(self.spec, self.state.position.y)
    const scale = (vc * vc) / (2 * 9.80665)
    expect(sit.energyRatio).toBeCloseTo(sit.energyAdvantage / scale, 9)
    // 高 500 m、同速 ⇒ 我能量多
    expect(sit.energyRatio).toBeGreaterThan(0)
  })

  it('createSituation 的兩個新欄位起始為 0', () => {
    const sit = createSituation()
    expect(sit.speedAdvantage).toBe(0)
    expect(sit.energyRatio).toBe(0)
  })
```

檔案頂端若還沒有 `manoeuvreSpeed`，加：

```ts
import { manoeuvreSpeed } from '../../src/ai/doctrine'
```

- [ ] **Step 2：跑測試確認它紅**

```
npx vitest run test/unit/ai-assess.test.ts
```

預期：四條紅，訊息是 `expected undefined to be close to ...`。

- [ ] **Step 3：加欄位**

`src/ai/assess.ts` 的 `Situation` 介面，加在 `cornerRatio` 之後：

```ts
  /**
   * （我的 TAS − 他的 TAS）÷ **我的**角落速度。正 = 我比較快。
   *
   * 【與 `cornerRatio` 的分工】那一個是自我參照的（只看得到自己），這一個
   * 看的是兩者的關係。`extendPitchAngle` 兩個都要 —— 「我轉不轉得動」與
   * 「我追不追得上」是不同的問題，而它們的答案可以相反。
   *
   * 【分母為什麼是自己的】這個量要餵給替**我**產生俯仰命令的函數，以自己
   * 的操縱速度尺度正規化才有意義；敵人的角落速度不決定我需要多少控制量。
   *
   * 【它不含方向】迎面、橫越、同向逃跑可能得到相同的值。解讀成「追不上」
   * 只在大致同向時可靠。
   */
  speedAdvantage: number
  /**
   * `energyAdvantage` ÷ 我的角落速度**動能高度**（vc² / 2g）。正 = 我能量多。
   *
   * `energyRatio = 0.5` 的意思是「我比他多半個角落速度動能高度」——**不是**
   * 「半個角落速度的能量」，動能與速度平方成正比。
   */
  energyRatio: number
```

`createSituation()` 的回傳物件加：

```ts
    speedAdvantage: 0,
    energyRatio: 0,
```

- [ ] **Step 4：在 `evaluateEnergy` 裡算**

找到 `out.cornerRatio = selfTas / manoeuvreSpeed(self.spec, selfAlt)` 那一行，
改成：

```ts
  const vc = manoeuvreSpeed(self.spec, selfAlt)
  out.cornerRatio = selfTas / vc
  out.speedAdvantage = (selfTas - targetTas) / vc
  // 【尺標是動能高度】vc² / 2g = 「角落速度的動能全部換成高度會有多高」。
  // 恆為正，不必防除以 0
  out.energyRatio = out.energyAdvantage / ((vc * vc) / (2 * G))
```

檔案頂端加 import（**不要開第二個重力常數**）：

```ts
import { G0 } from '../core/math'
```

然後把上面那段的 `G` 換成 `G0`。

【為什麼一定要用同一個】`Aircraft.specificEnergy` 是
`position.y + v² / (2 * G0)`（`Aircraft.ts:68`），而 `energyRatio` 的分子
`energyAdvantage` 就是兩個 `specificEnergy` 的差。分母用一個不同的重力常數
會讓這個比值有一個**固定的偏差**，而它不會讓任何測試變紅 —— 只會讓
`perchEnter` 這個門檻的實際意義偏離它的推導。

- [ ] **Step 5：跑測試確認它綠**

```
npx vitest run test/unit/ai-assess.test.ts
npx tsc --noEmit
```

- [ ] **Step 6：確認沒有行為改變**

```
npx vitest run test/unit/ai-steer.test.ts test/integration/ai-targeting.test.ts
npx vitest run test/integration/order-of-battle-replay.test.ts
```

預期：**全綠**。這個 Task 只是把兩個數字算出來放著，沒有任何消費端。
`order-of-battle-replay` 的 digest 必須**不變**——變了表示不小心改到了行為。

- [ ] **Step 7：commit**

```bash
git add src/ai/assess.ts test/unit/ai-assess.test.ts
git commit -m "feat: Situation 加 speedAdvantage 與 energyRatio 兩個無因次量

分母與 cornerRatio 是同一個（自己的角落速度），這樣同一組參數對任何機型
都代表同一件事。這一步沒有消費端，行為逐位元不變。"
```

---

## Task 2：`extendPitchAngle` 的方向修正

**檔案**
- Modify：`src/ai/steer.ts`（`extendPitchAngle` 與它的唯一呼叫端）
- Modify：`test/unit/ai-steer.test.ts`（17 處呼叫）
- Modify：`test/tools/extend-pitch.probe.ts`
- Create：`test/unit/extend-direction.test.ts`

**介面**
- 消費：`Situation.speedAdvantage`（Task 1）
- 產出：`extendPitchAngle(cornerRatio, speedAdvantage, groundClearance, cfg?)`

- [ ] **Step 1：寫新的護欄測試**

新建 `test/unit/extend-direction.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { extendPitchAngle, DEFAULT_STEER } from '../../src/ai/steer'

/**
 * `extend` 的俯仰方向。
 *
 * 【它修的是什麼】舊版的速度赤字只跟**自己**比（`1 − cornerRatio`）。遠距離
 * 時沒有人在拉桿，TAS 自然貼近極速，於是每一架都判定「我速度過剩」而爬升
 * —— 包括那架其實比對手慢 28 m/s 的 Bf 109。實測它因此滿舵爬升 25°，累積
 * 445 m 高度卻永遠花不掉（spec §1.1）。
 *
 * 【新規則】速度赤字取「相對自己」與「相對敵人」的**較大值**，等價於
 * 「只有我的 TAS 同時高過自己的角落速度與敵人的 TAS 才爬升」（spec §4.3）。
 */
describe('extend 的俯仰方向', () => {
  /** 高空，讓離地餘裕那一項恆為 0，才量得到純粹的速度項 */
  const HIGH = 4000
  /** 相對敵人完全沒有赤字 —— 只測自我赤字那一半 */
  const NO_FOE = Infinity

  it('化簡等價：max 等於 (max(Vc, Vt) − Vs) / Vc', () => {
    // 【為什麼要測一條代數恆等式】spec §4.3 整個推論建立在這個化簡上。
    // 它若不成立，「新規則在說什麼」那一節就是錯的。
    for (const [vs, vc, vt] of [[176, 160, 208], [200, 180, 150], [120, 160, 130]]) {
      const cornerRatio = vs! / vc!
      const speedAdvantage = (vs! - vt!) / vc!
      const got = extendPitchAngle(cornerRatio, speedAdvantage, HIGH)
      const deficit = (Math.max(vc!, vt!) - vs!) / vc!
      const want = Math.max(
        -DEFAULT_STEER.extendPitch,
        Math.min(DEFAULT_STEER.extendPitch, -DEFAULT_STEER.pitchSpeedGain * deficit),
      )
      expect(got).toBeCloseTo(want, 9)
    }
  })

  it('比敵人慢很多時恆為低頭 —— 不管自己的 cornerRatio 多高', () => {
    // 這就是護航 Bf 109 的局面：cornerRatio 1.59（相對自己過剩），
    // 但比敵人慢 28.6 m/s。舊版在這裡是滿舵爬升 +25°。
    for (const ratio of [1.0, 1.2, 1.59, 2.0, 3.0]) {
      expect(extendPitchAngle(ratio, -0.19, HIGH)).toBeLessThan(0)
    }
  })

  it('沒有相對赤字時退回舊行為', () => {
    // cornerRatio < 1 → 低頭；> 1 → 爬升。這是改動前的語意。
    expect(extendPitchAngle(0.6, NO_FOE, HIGH)).toBeLessThan(0)
    expect(extendPitchAngle(1.3, NO_FOE, HIGH)).toBeGreaterThan(0)
    expect(extendPitchAngle(1.0, NO_FOE, HIGH)).toBeCloseTo(0, 9)
  })

  it('兩者都是盈餘時才爬升', () => {
    // 我比自己的角落速度快（1.3），也比敵人快（+0.2）
    expect(extendPitchAngle(1.3, 0.2, HIGH)).toBeGreaterThan(0)
    // 同樣快過角落速度，但比敵人慢 → 低頭
    expect(extendPitchAngle(1.3, -0.2, HIGH)).toBeLessThan(0)
  })

  it('離地餘裕那一項一個字都沒動', () => {
    // 【為什麼要釘住】那一項是安全關切（低空不能用高度換速度），與能量
    // 判斷在不同的軸上。這次改的只有速度項。
    const high = extendPitchAngle(0.6, NO_FOE, HIGH)
    const low = extendPitchAngle(0.6, NO_FOE, DEFAULT_STEER.clearanceScale * 0.4)
    expect(low).toBeGreaterThan(high)
    // 貼地時高度項主導，即使缺速度也要爬
    expect(extendPitchAngle(0.6, NO_FOE, 0)).toBeGreaterThan(0)
  })

  it('兩端都夾在 extendPitch', () => {
    expect(extendPitchAngle(-5, NO_FOE, HIGH))
      .toBeCloseTo(-DEFAULT_STEER.extendPitch, 9)
    expect(extendPitchAngle(5, NO_FOE, HIGH))
      .toBeCloseTo(DEFAULT_STEER.extendPitch, 9)
  })

  it('對 speedAdvantage 單調不遞增', () => {
    // 相對敵人越快 → 越傾向爬升（俯仰角越大）。反過來會是災難。
    let prev = -Infinity
    for (let sa = -0.6; sa <= 0.6; sa += 0.05) {
      const got = extendPitchAngle(1.1, sa, HIGH)
      expect(got).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = got
    }
  })
})

/**
 * 三類**已知的取捨**。
 *
 * 【這幾條記錄行為，不斷言好壞】它們的作用是讓下一個人看到這個修正的代價，
 * 而不是把某個數字焊死。若量測顯示第一類真的讓超前變糟，下一步是把相對
 * 赤字乘上一個由 `angleOffTail` 導出的連續權重（追擊 → 1、橫越 → 0、
 * 迎面 → 0），而不是加距離門檻 —— 那會引入新的翻號點（spec §4.4）。
 */
describe('方向修正的三類已知取捨', () => {
  const HIGH = 4000

  it('近距離但敵機很快：由爬升翻成低頭', () => {
    // Vc = 160、Vs = 176、Vt = 208
    const cornerRatio = 176 / 160          // 1.10
    const speedAdvantage = (176 - 208) / 160 // −0.20
    // 只看自己：速度過剩 → 舊版爬升
    expect(extendPitchAngle(cornerRatio, Infinity, HIGH)).toBeGreaterThan(0)
    // 加上相對敵人：新版低頭。這會增加接近率，可能讓超前更糟
    expect(extendPitchAngle(cornerRatio, speedAdvantage, HIGH)).toBeLessThan(0)
  })

  it('TAS 差沒有方向資訊：迎面與同向逃跑得到相同的命令', () => {
    // 兩個局面的 speedAdvantage 相同，命令因此也相同。
    // 「追不上」的解讀只在大致同向時可靠。
    const chasing = extendPitchAngle(1.1, -0.2, HIGH)
    const headOn = extendPitchAngle(1.1, -0.2, HIGH)
    expect(chasing).toBe(headOn)
  })

  it('戰鬥機對轟炸機：分母是自己的，所以量的是「差佔我多少」', () => {
    // 戰鬥機 Vc = 160、Vs = 200；轟炸機 Vt = 110
    // 相對赤字是負的（我比較快），所以退回自我判準 —— 這是對的，
    // 追一台比自己慢的東西不需要靠俯衝換速度。
    const cornerRatio = 200 / 160
    const speedAdvantage = (200 - 110) / 160
    expect(extendPitchAngle(cornerRatio, speedAdvantage, HIGH))
      .toBeCloseTo(extendPitchAngle(cornerRatio, Infinity, HIGH), 9)
  })
})
```

- [ ] **Step 2：跑測試確認它紅**

```
npx vitest run test/unit/extend-direction.test.ts
```

預期：全紅，訊息是參數數量不符或 `groundClearance` 收到 `Infinity`。

- [ ] **Step 3：改函數**

`src/ai/steer.ts`，把 `extendPitchAngle` 整個換掉（連同它上方的註解）：

```ts
/**
 * `extend` 的俯仰角，rad。正 = 爬升。
 *
 * 【速度赤字取兩者的較大值】「相對自己」（`1 − cornerRatio`）回答「我轉不
 * 轉得動」，「相對敵人」（`−speedAdvantage`）回答「我追不追得上」。兩者的
 * 答案可以相反：遠距離時沒有人在拉桿，TAS 貼近極速，於是每一架都判定
 * 「我速度過剩」—— 包括那架其實比對手慢 28 m/s 的護航機。
 *
 * 等價的說法：**只有我的 TAS 同時高過自己的角落速度與敵人的 TAS 才爬升**。
 *
 * ```
 *   max(...) = (max(Vc, Vt) − Vs) / Vc
 * ```
 *
 * 【`max` 而不是 if-else】兩個分支在交界處數值相等，所以不會像裸門檻那樣
 * 瞬間翻號。舊版用兩個裸門檻決定爬或衝，跨線時指令瞬間翻號，加上俯仰慣性
 * 形成極限環，實測在 1000 m 線上震盪 40 秒。
 *
 * **但這只保證交界處不跳變，保證不了整個閉迴路不振盪** —— 輸出仍會在
 * `Vs = max(Vc, Vt)` 穿過零，而迴路含 10 Hz 取樣、飽和與俯仰慣性。
 *
 * 【高度分量的來源是離地餘裕，不是能量判準】「我還打得動嗎」只問速度；
 * 高度出現在這裡是因為**低空不能用高度換速度**，那是安全關切，與能量判斷
 * 在不同的軸上。三種情況自然長出來：
 *
 *   高空缺速度 → 高度赤字 0，純俯衝換速度
 *   低空缺速度 → 兩項抵消，平飛加速
 *   極低空     → 高度項主導，爬升
 *
 * @param cornerRatio TAS ÷ 自己的角落速度
 * @param speedAdvantage （我的 TAS − 他的）÷ 我的角落速度。
 *                       `Infinity` = 相對敵人完全沒有赤字
 * @param groundClearance 離地（海面）高度，m
 */
export function extendPitchAngle(
  cornerRatio: number,
  speedAdvantage: number,
  groundClearance: number,
  cfg: SteerConfig = DEFAULT_STEER,
): number {
  const selfDeficit = 1 - cornerRatio
  const foeDeficit = -speedAdvantage
  const speedDeficit = selfDeficit > foeDeficit ? selfDeficit : foeDeficit

  let altitudeDeficit = 1 - groundClearance / cfg.clearanceScale
  if (altitudeDeficit < 0) altitudeDeficit = 0
  else if (altitudeDeficit > 1) altitudeDeficit = 1

  const raw = -cfg.pitchSpeedGain * speedDeficit + cfg.pitchAltitudeGain * altitudeDeficit
  if (raw < -cfg.extendPitch) return -cfg.extendPitch
  if (raw > cfg.extendPitch) return cfg.extendPitch
  return raw
}
```

**注意 `speedAdvantage = Infinity` 時 `foeDeficit = −Infinity`**，`max` 取
`selfDeficit`，`raw` 是有限值，夾限正常。不需要特例。

- [ ] **Step 4：改唯一的呼叫端**

`src/ai/steer.ts` 的 `steerCommand`，`case 'extend'` 那一段：

```ts
        const clearance = self.state.position.y - seaHeight
        unloadAim(
          self, extendPitchAngle(sit.cornerRatio, sit.speedAdvantage, clearance, cfg),
          out.aimWorld,
        )
```

- [ ] **Step 5：改既有的 17 處測試呼叫**

`test/unit/ai-steer.test.ts`。在檔案頂端的 import 之後加：

```ts
/** 相對敵人完全沒有赤字 —— 這幾條只測自我赤字那一半 */
const NO_FOE_DEFICIT = Infinity
```

然後逐處把 `extendPitchAngle(X, Y)` 改成
`extendPitchAngle(X, NO_FOE_DEFICIT, Y)`。**共 17 處**，用這個指令列出來：

```
npx vitest run test/unit/ai-steer.test.ts 2>&1 | head -40
```

**四處對照測試要連 fixture 一起改，而且其中一條的前提變了。**

那四處拿 `steerCommand` 的輸出與 `extendPitchAngle(...)` 對照（第 880、
1044、1074、1076 行附近）。期望值要傳**該測試自己的 `sit.speedAdvantage`**：

```ts
    const expected = extendPitchAngle(sit.cornerRatio, sit.speedAdvantage, 4000)
```

**但光這樣還不夠。** `followLoop` 的 fixture 沒有設 `speedAdvantage`，所以它
是 `createSituation()` 的 0。於是「速度過剩時每一輪都是同一個爬升角」
（`ai-steer.test.ts:879`）會算出 `max(1 − 1.4, −0) = 0`，而它斷言 `> 0`。

**這條測試的前提真的變了**，不是實作寫錯：新規則下「速度過剩」需要**兩個**
維度都過剩（比自己的角落速度快，也比敵人快）。fixture 只指定了一半。

修法是在 `followLoop` 裡把場景補完整：

```ts
    sit.cornerRatio = ratio
    // 【新增】速度過剩的場景要兩個維度都過剩：比自己的角落速度快（ratio），
    // 也比敵人快。只指定一半的話新規則會取相對赤字那一邊
    sit.speedAdvantage = ratio - 1
```

`followLoop(1.4)` → `speedAdvantage = 0.4`（我也比敵人快）→ 爬升，斷言成立。
`followLoop(0.6)` → `speedAdvantage = −0.4`（我比敵人慢）→ 俯衝，斷言也成立。

**這是一次要向專案負責人報備的既有測試改動**，因為它動到了一條測試的前提。
它**不是**放寬門檻——兩條斷言的方向與嚴格度一個字都沒改，改的是場景的完整
性。做完 Task 2 的報告要列出這一條。

- [ ] **Step 6：改探針**

`test/tools/extend-pitch.probe.ts`：呼叫處加第二個參數。它有一份 AI 態勢的
話就傳 `sit.speedAdvantage`；沒有的話傳 `Infinity` 並在註解說明那一列量的是
自我赤字那一半。

**`test/tools/climb-blame.probe.ts` 不必改** —— 它只有註解提到這個函數，
沒有實際呼叫。

- [ ] **Step 7：跑測試**

```
npx vitest run test/unit/extend-direction.test.ts test/unit/ai-steer.test.ts
npx tsc --noEmit
```

預期：**全綠**。

- [ ] **Step 8：commit**

```bash
git add src/ai/steer.ts test/unit/ai-steer.test.ts \
  test/unit/extend-direction.test.ts test/tools/extend-pitch.probe.ts
git commit -m "fix: extend 的速度赤字改取「相對自己」與「相對敵人」的較大值

等價於「只有我的 TAS 同時高過自己的角落速度與敵人的 TAS 才爬升」。
遠距離時沒有人在拉桿、TAS 貼近極速，舊版因此判定「速度過剩」而滿舵爬升
25° —— 包括那架其實比對手慢 28 m/s 的護航機。

三類已知的取捨（近距離高速交叉、TAS 差沒有方向、戰鬥機對轟炸機）各有一條
記錄行為的測試。"
```

---

## Task 3：方向修正的量測與第一次基準裁定

**檔案**
- Modify：`docs/superpowers/specs/2026-08-22-energy-tactics-design.md`（回填）

**這個 Task 不寫程式，只跑量測並向專案負責人報告。**

- [ ] **Step 1：跑 `extend-payoff` 探針**

```
npx tsx test/tools/extend-payoff.probe.ts
```

改動前的基準（2026-08-22，20v20、420 秒、VETERAN）：

```
開局        段數   越撤越糟   補到門檻才走   收益中位   高度變化中位
4000/200    662     38.7%       48.9%        +0.012      +5 m
5500/150    481     33.9%       47.8%        +0.036     -21 m
```

**只有「越撤越糟」是這一步的判準**（spec §10.3）。「補到門檻才走」低是因為
被 `defend` 插隊，那是明確不做的那一項。

- [ ] **Step 2：跑七種局面的量測**

寫一支一次性的探針量七張卡（遭遇戰、掃蕩、攔截、護送、撤離、軸心攔截、
軸心護送），每張卡逐隊逐機型列出：`extend` 佔時、`extend` 期間航跡角中位、
`cornerRatio` 中位、高度差、速度差、比能量差、與最近敵機距離。

改動前的基準在 spec §1.3。**期望的方向**：攔截卡 red/bf109 的航跡角由
`+6.5°` 下降或翻負。

跑完把探針刪掉（`rm -f`），工作區要乾淨。

- [ ] **Step 3：跑既有護欄**

```
npx vitest run test/integration/ai-targeting.test.ts
npx vitest run test/integration/order-of-battle-replay.test.ts
npx vitest run test/unit/perf-gate.test.ts
npx vitest run test/integration/rematch.test.ts
```

`order-of-battle-replay` 的 digest **預期會紅**——這次改的就是 AI 的行為。

- [ ] **Step 4：向專案負責人報告，等裁定**

報告要包含：

1. `extend-payoff` 的前後對照（重點是「越撤越糟」的百分比）
2. 七張卡的前後對照表
3. `ai-targeting` 三個指標（`rearShare` / `fireShare` / `onNose`）有沒有紅
4. `order-of-battle-replay` 紅了，**請求裁定是否重跑基準**

**不得自己重跑基準。** 這是 spec §10.4 的第一次裁定。

- [ ] **Step 5：裁定通過後重跑基準並 commit**

基準檔在 `test/fixtures/`（跑 `order-of-battle-replay.test.ts` 看它讀哪一
個）。重跑的指令通常在該測試的註解裡。

```bash
git add test/fixtures/<基準檔> docs/superpowers/specs/2026-08-22-energy-tactics-design.md
git commit -m "test: 重跑 order-of-battle-replay 基準 —— 方向修正

專案負責人 <日期> 裁定。diff 全部歸因於 extend 速度赤字的算式改變；
戰術層尚未上線，quota 這個旋鈕還不存在。"
```

---

# 階段二：戰術層骨架

## Task 4：`tactics.ts` 的型別、設定與名額

**檔案**
- Create：`src/ai/tactics.ts`
- Create：`test/unit/ai-tactics.test.ts`

**介面**
- 產出：`TacticalPhase`、`TacticalState`、`TacticalConfig`、`DEFAULT_TACTICS`、
  `createTacticalState()`、`resetTacticalState(s)`、`teamIndexOf(board, i)`、
  `hasSlot(teamIndex, quota)`

- [ ] **Step 1：寫失敗的測試**

新建 `test/unit/ai-tactics.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  createTacticalState, resetTacticalState, teamIndexOf, hasSlot, DEFAULT_TACTICS,
} from '../../src/ai/tactics'
import { createTargetBoard } from '../../src/ai/target'
import type { TargetCandidate } from '../../src/ai/target'
import type { Team } from '../../src/world/World'

/** 造一組只有 `index` 與 `team` 有意義的候選 —— 名額只看這兩個欄位 */
function board(blue: number, red: number) {
  const cs: TargetCandidate[] = []
  for (let i = 0; i < blue + red; i++) {
    cs.push({
      index: i,
      team: (i < blue ? 'blue' : 'red') as Team,
      alive: true,
    } as unknown as TargetCandidate)
  }
  return createTargetBoard(cs)
}

describe('戰術層的名額', () => {
  it('隊內序號是「我是我方第幾架」', () => {
    const b = board(4, 4)
    expect(teamIndexOf(b, 0)).toBe(0)
    expect(teamIndexOf(b, 3)).toBe(3)
    // 紅隊的第一架全域索引是 4，隊內序號回到 0
    expect(teamIndexOf(b, 4)).toBe(0)
    expect(teamIndexOf(b, 7)).toBe(3)
  })

  it('索引越界回 −1', () => {
    const b = board(2, 2)
    expect(teamIndexOf(b, -1)).toBe(-1)
    expect(teamIndexOf(b, 4)).toBe(-1)
  })

  it('兩隊拿到相同的名額數 —— 這是隊內序號存在的唯一理由', () => {
    // 【為什麼不能用全域 selfIndex】編組表是一隊一個連續區塊，低差異序列
    // 在兩個區塊上會取到不同的比例。實算：6v6 是藍 4 紅 2（33% 的偏差），
    // 14v14 是藍 8 紅 6。那會直接變成平衡偏差，而且沒有任何測試會紅。
    for (const n of [3, 4, 6, 7, 10, 14, 16, 20]) {
      const b = board(n, n)
      let blue = 0
      let red = 0
      for (let i = 0; i < n; i++) if (hasSlot(teamIndexOf(b, i), 0.5)) blue++
      for (let i = n; i < 2 * n; i++) if (hasSlot(teamIndexOf(b, i), 0.5)) red++
      expect(blue).toBe(red)
    }
  })

  it('quota = 0 一律沒有名額，quota = 1 一律有', () => {
    for (let k = 0; k < 40; k++) {
      expect(hasSlot(k, 0)).toBe(false)
      expect(hasSlot(k, 1)).toBe(true)
    }
  })

  it('隊內序號為負時沒有名額 —— 負數取模的陷阱', () => {
    // 【為什麼要專門釘住】JavaScript 的 (-1 * 0.618) % 1 = −0.618，而
    // −0.618 < 0.5 為真。沒有接指派板的單元測試會意外啟用戰術層。
    expect(hasSlot(-1, 0.5)).toBe(false)
    expect(hasSlot(-1, 0.999)).toBe(false)
  })

  it('名額的比例大致等於 quota', () => {
    let n = 0
    for (let k = 0; k < 200; k++) if (hasSlot(k, 0.5)) n++
    expect(n / 200).toBeGreaterThan(0.45)
    expect(n / 200).toBeLessThan(0.55)
  })

  it('createTacticalState 起始是 off，resetTacticalState 回到同一個形狀', () => {
    const s = createTacticalState()
    expect(s.phase).toBe('off')
    s.phase = 'perch'
    s.dwell = 12
    s.perchLatch = true
    s.dryRounds = 3
    resetTacticalState(s)
    expect(s).toEqual(createTacticalState())
  })

  it('起始設定的內部一致性', () => {
    const c = DEFAULT_TACTICS
    // 遲滯：離開門檻必須比進入門檻鬆
    expect(c.perchExit).toBeLessThan(c.perchEnter)
    // 等待不該比建能久
    expect(c.perchMax).toBeLessThan(c.buildMax)
    // 距離：進入的門檻比離開遠
    expect(c.exitRange).toBeLessThan(c.enterRange)
    // 盤旋半徑落在兩個距離門檻之間
    expect(c.perchRange).toBeGreaterThan(c.exitRange)
    expect(c.perchRange).toBeLessThan(c.enterRange)
    // 長冷卻比短冷卻長
    expect(c.cooldownSeconds).toBeLessThan(c.longCooldownSeconds)
    // zoom 的下限比上限短
    expect(c.zoomMin).toBeLessThan(c.zoomMax)
  })
})
```

- [ ] **Step 2：跑測試確認它紅**

```
npx vitest run test/unit/ai-tactics.test.ts
```

預期：`Cannot find module '../../src/ai/tactics'`。

- [ ] **Step 3：建檔**

新建 `src/ai/tactics.ts`：

```ts
import type { TargetBoard } from './target'

/**
 * 單機的戰術相位。
 *
 * 【為什麼在意圖之上另開一層】六種意圖（approach / merge / engage / extend /
 * defend / rally）沒有一種是**主動占位**：`extend` 是被動止損，觸發條件全是
 * 劣勢。史實的 boom and zoom 需要「已經有優勢了但刻意不動，等對方進入攻擊
 * 姿態」，那是一個意圖層表達不了的狀態。
 *
 * 【為什麼不插進 `rules.ts` 的 arbitrate】那張表的優先序是逐條實測談定的
 * （相對理由 vs 絕對理由、defend 的絕對優先權）。插一列會重談整組關係；
 * 走 `AiController` 的外部覆寫則一條都不受影響 —— 與命令層同一個手法。
 */
export type TacticalPhase = 'off' | 'build' | 'perch' | 'dive' | 'zoom' | 'cooldown'

/**
 * 一架飛機的戰術狀態。**熱路徑就地改寫，不配置。**
 */
export interface TacticalState {
  phase: TacticalPhase
  /** 這個相位已經待多久，s */
  dwell: number
  /**
   * 能量盈餘的閂鎖。**獨立於 `phase`，而且全程更新。**
   *
   * 【為什麼不能用 `phase === 'perch'` 代替】`latch` 的語意是一段獨立的
   * 記憶，`rules.ts` 的 `stepRules` 每個決策節拍更新**所有**閂鎖，即使那
   * 一拍沒有選到那個意圖。少了這個性質，離開再回來時遲滯就沒有記憶。
   */
  perchLatch: boolean
  /** 距離的閂鎖。true = 「遠」，也就是可以進戰術層 */
  farLatch: boolean
  /** `psTarget < 0` 已經連續多久，s */
  commit: number
  /** `dive` 期間接近率曾經為正 */
  closed: boolean
  /** 接近率轉負之後持續多久，s */
  passing: number
  /** `cooldown` 剩餘，s */
  cooldown: number
  /** 本輪進入 `build` 時的 `energyRatio` */
  cycleBase: number
  /** 本輪是否有效。換過目標就無效，不參與能量帳止損 */
  cycleValid: boolean
  /** 本輪是否形成過射擊窗 */
  cycleShot: boolean
  /** 連續幾輪沒有射擊窗 */
  dryRounds: number
  /**
   * 進入上一次 `cooldown` 時的 `energyRatio`。`NaN` = 沒有上一次。
   *
   * 【它擋的是一個永久迴圈】只靠距離閘門的話，目標一直很遠時會變成
   * `build → cooldown → off → 立刻 build → …` 永遠繞下去 —— 那正好把原
   * 問題換成另一種永久循環。再進入要求「換過目標」或「能量比那時候高」。
   */
  lastCooldownRatio: number
  /** 上一個目標的識別。−2 = 尚未設定 */
  lastTarget: number
}

export interface TacticalConfig {
  /** 有多少比例的飛機參與戰術層。**0 = 完全關掉**（消融的對照組） */
  quota: number
  /** 進入戰術層的距離門檻，m */
  enterRange: number
  /** 離開的距離門檻，m。與 `enterRange` 不同就是遲滯 */
  exitRange: number
  /** 進 `perch` 的能量盈餘門檻（`energyRatio`） */
  perchEnter: number
  /** 掉回 `build` 的門檻。遲滯 */
  perchExit: number
  /** 每個相位的最短停留，s */
  minDwell: number
  /** 目標要維持承諾姿態多久才俯衝，s */
  commitSeconds: number
  /** `build` 的上限，s */
  buildMax: number
  /** `perch` 的上限，s。到期強制 `dive` */
  perchMax: number
  /** 接近率轉負後多久算通過，s */
  passSeconds: number
  /** `dive` 的上限，s。沒打到也要拉起 */
  diveMax: number
  /** `zoom` 的下限，s */
  zoomMin: number
  /** `zoom` 的上限，s */
  zoomMax: number
  /** 一般冷卻，s */
  cooldownSeconds: number
  /** 長冷卻，s。連續幾輪打不到時用 */
  longCooldownSeconds: number
  /** 單輪 `energyRatio` 淨損失的上限 */
  cycleLossMax: number
  /** 連續幾輪沒有射擊窗就長冷卻 */
  dryRounds: number
  /** `perch` 盤旋時保持的距離，m */
  perchRange: number
}

/**
 * 【`pressureRange` 為什麼不在這裡】任務壓力由 `battle` 層算一次寫進
 * `TargetBoard.pressure`（見 Task 9），而那一層拿不到每架自己的
 * `TacticalConfig`。把它放在 `target.ts` 當一個常數，兩邊讀的就是同一個值。
 */

/**
 * **全部是起始值，待掃描**（spec §11）。掃描的優先序：
 *
 *   1. `quota`（0 / 0.5 / 1）—— 它同時是消融
 *   2. `buildMax` 與 `perchEnter` —— 一起決定「循環跑不跑得完一輪」
 *   3. `commitSeconds` 與 `perchMax` —— 「等太久」與「出手太早」的平衡
 *
 * `enterRange` / `exitRange` **不掃** —— 沿用指揮層的 `FLANK_RANGE` 與
 * `focusRange`，動它等於發明第二套幾何。
 */
export const DEFAULT_TACTICS: TacticalConfig = {
  // 【開發期間先出 0】戰術層一開就會改變 `order-of-battle-replay` 的
  // digest，而那個基準每重跑一次都要專案負責人裁定。出 0 的話整個開發期間
  // 那條測試都是綠的，**最後一個 Task 才翻成 0.5 並一次重跑**。
  //
  // 消融與整合測試自己注入 `quota`，不受這個預設影響。
  quota: 0,
  // 【與指揮層共用同一對】側翼命令的 FLANK_RANGE 與集火的 focusRange
  enterRange: 2500,
  exitRange: 1500,
  // 【0.50 的來源】要俯衝到比 P-51 快一成，109 需要約 630 m 的高度盈餘；
  // 109 在 6000 m 的角落速度取 160 m/s，能量尺標 160² / 19.61 ≈ 1305 m，
  // 630 / 1305 ≈ 0.48。**只用了一種配對與一個高度**，不能自動外推
  perchEnter: 0.5,
  perchExit: 0.35,
  minDwell: 0.5,
  commitSeconds: 1.5,
  // 【待 Task 11 由 psSelf − psTarget 的實測分布回填】用自己的爬升率推相對
  // 建能時間會系統性低估 —— 敵人同時也在累積能量
  buildMax: 60,
  perchMax: 20,
  passSeconds: 1,
  diveMax: 12,
  zoomMin: 4,
  zoomMax: 15,
  cooldownSeconds: 12,
  longCooldownSeconds: 30,
  cycleLossMax: 0.3,
  dryRounds: 2,
  perchRange: 2000,
}

export function createTacticalState(): TacticalState {
  return {
    phase: 'off',
    dwell: 0,
    perchLatch: false,
    farLatch: false,
    commit: 0,
    closed: false,
    passing: 0,
    cooldown: 0,
    cycleBase: 0,
    cycleValid: false,
    cycleShot: false,
    dryRounds: 0,
    lastCooldownRatio: NaN,
    lastTarget: -2,
  }
}

/**
 * 就地重置。**`resetBattle` 每一顆 `AiController` 呼叫一次。**
 *
 * 【為什麼需要它】`resetBattle` 保留絕大多數既有的 `AiController` 實體，
 * 只重建曾被玩家接手過的那幾顆。少了這一段，相位、計時、輪次、冷卻與上一個
 * 目標會跨場殘留 —— 第二場的第一秒就會有幾架飛機從別人的 `perch` 中途開始。
 */
export function resetTacticalState(s: TacticalState): void {
  s.phase = 'off'
  s.dwell = 0
  s.perchLatch = false
  s.farLatch = false
  s.commit = 0
  s.closed = false
  s.passing = 0
  s.cooldown = 0
  s.cycleBase = 0
  s.cycleValid = false
  s.cycleShot = false
  s.dryRounds = 0
  s.lastCooldownRatio = NaN
  s.lastTarget = -2
}

/**
 * 我是我方第幾架。**−1 = 索引無效。**
 *
 * 【為什麼不用全域的 `selfIndex`】編組表是一隊一個連續區塊，低差異序列在
 * 兩個區塊上會取到不同的比例：`quota = 0.5` 時 6v6 是藍 4 紅 2、14v14 是
 * 藍 8 紅 6。那會直接變成平衡偏差，而且沒有任何測試會紅。改用隊內序號之後
 * 兩隊拿到**完全相同的序列**。
 *
 * 【成本】`selfIndex` 在一場之內不變，所以呼叫端算一次快取起來就夠。
 */
export function teamIndexOf(board: TargetBoard, selfIndex: number): number {
  if (selfIndex < 0 || selfIndex >= board.candidates.length) return -1
  const team = board.candidates[selfIndex]!.team
  let n = 0
  for (let i = 0; i < selfIndex; i++) {
    if (board.candidates[i]!.team === team) n++
  }
  return n
}

/** 低差異序列的乘子。與砲塔點放的 √3、√2 互為無理數比 */
const GOLDEN = 0.6180339887498949

/**
 * 這架飛機有沒有戰術層的名額。
 *
 * 固定分配、零協調、逐位元重播友善。副作用是史實的：一場裡有些人打
 * boom and zoom、有些人纏鬥。
 *
 * 【為什麼不做動態名額】「同時最多 N 架在 build」需要跨機協調，而協調要嘛
 * 走指揮層，要嘛在戰機端維護一個必須每步同步的全域計數 —— 後者會產生一個
 * 永遠不消失的幽靈狀態。
 *
 * 【`teamIndex < 0` 必須擋掉】JavaScript 的負數取模仍是負數，
 * `(-1 × 0.618) % 1 = −0.618`，而 `−0.618 < 0.5` 為真。
 */
export function hasSlot(teamIndex: number, quota: number): boolean {
  if (teamIndex < 0 || quota <= 0) return false
  if (quota >= 1) return true
  return ((teamIndex * GOLDEN) % 1) < quota
}
```

- [ ] **Step 4：跑測試確認它綠**

```
npx vitest run test/unit/ai-tactics.test.ts
npx tsc --noEmit
```

- [ ] **Step 5：commit**

```bash
git add src/ai/tactics.ts test/unit/ai-tactics.test.ts
git commit -m "feat: tactics.ts 的型別、起始設定與名額分配

名額用隊內序號而不是全域 selfIndex —— 編組表是一隊一個連續區塊，全域索引
在 quota 0.5 時 6v6 會給到藍 4 紅 2。隊內序號讓兩隊拿到完全相同的序列。

quota = 0 是完全關掉，也是消融表的對照組。"
```

---

## Task 5：`stepTactics` 狀態機

**檔案**
- Modify：`src/ai/tactics.ts`
- Modify：`test/unit/ai-tactics.test.ts`

**介面**
- 消費：Task 4 的 `TacticalState` / `TacticalConfig`
- 產出：`TacticalInput`、`stepTactics(s, input, dt, cfg)`

- [ ] **Step 1：寫失敗的測試**

加到 `test/unit/ai-tactics.test.ts`：

```ts
import { stepTactics } from '../../src/ai/tactics'
import type { TacticalInput } from '../../src/ai/tactics'

const DT = 1 / 240

/** 一個「有名額、有目標、很遠、能量持平」的預設輸入 */
function input(over: Partial<TacticalInput> = {}): TacticalInput {
  return {
    slot: true,
    suspended: false,
    targetIndex: 7,
    range: 3000,
    energyRatio: 0,
    psTarget: 5,
    closureRate: 0,
    shotInstant: 0,
    pressure: false,
    ...over,
  }
}

/** 跑 `seconds` 秒，每一步用同一組輸入 */
function run(s: ReturnType<typeof createTacticalState>, inp: TacticalInput, seconds: number) {
  for (let k = 0; k < Math.round(seconds / DT); k++) stepTactics(s, inp, DT, DEFAULT_TACTICS)
}

describe('戰術層的狀態機', () => {
  it('沒有名額時恆為 off', () => {
    const s = createTacticalState()
    run(s, input({ slot: false }), 120)
    expect(s.phase).toBe('off')
  })

  it('有命令或 transit 時恆為 off', () => {
    const s = createTacticalState()
    run(s, input({ suspended: true }), 120)
    expect(s.phase).toBe('off')
  })

  it('太近時不進戰術層', () => {
    const s = createTacticalState()
    run(s, input({ range: 800 }), 120)
    expect(s.phase).toBe('off')
  })

  it('夠遠、有目標、有名額 → 進 build', () => {
    const s = createTacticalState()
    run(s, input(), 1)
    expect(s.phase).toBe('build')
  })

  it('距離的進出是遲滯的', () => {
    const s = createTacticalState()
    // 2000 m 落在 exitRange(1500) 與 enterRange(2500) 之間 —— 進不去
    run(s, input({ range: 2000 }), 5)
    expect(s.phase).toBe('off')
    // 拉到 2600 進得去
    run(s, input({ range: 2600 }), 1)
    expect(s.phase).toBe('build')
    // 回到 2000 不會馬上掉出來（閂鎖記著「遠」）
    run(s, input({ range: 2000 }), 1)
    expect(s.phase).not.toBe('off')
  })

  it('能量達標 → 進 perch', () => {
    const s = createTacticalState()
    run(s, input(), 1)
    run(s, input({ energyRatio: 0.6 }), 1)
    expect(s.phase).toBe('perch')
  })

  it('perchLatch 是獨立記憶，dive 與 zoom 期間也更新', () => {
    // 【為什麼重要】少了這個性質，離開 perch 再回來時遲滯就沒有記憶，
    // 而遲滯正是擋震盪的東西。
    const s = createTacticalState()
    run(s, input(), 1)
    run(s, input({ energyRatio: 0.6 }), 1)
    expect(s.phase).toBe('perch')
    // 目標承諾 → dive
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), 2)
    expect(s.phase).toBe('dive')
    // dive 期間能量掉破 perchExit，閂鎖要跟著掉
    run(s, input({ energyRatio: 0.1, psTarget: -5 }), 1)
    expect(s.perchLatch).toBe(false)
  })

  it('能量在遲滯帶裡來回 100 次，相位不得翻超過一次', () => {
    // 【這一條守的是極限環】專案在 1000 m 線上震盪 40 秒那次，根因就是
    // 裸門檻。閂鎖 + 最短停留是既有的解藥。
    const s = createTacticalState()
    run(s, input(), 1)
    run(s, input({ energyRatio: 0.6 }), 1)
    const from = s.phase
    let flips = 0
    let prev = s.phase
    for (let k = 0; k < 100; k++) {
      // 0.42 落在 perchExit(0.35) 與 perchEnter(0.5) 之間
      run(s, input({ energyRatio: k % 2 === 0 ? 0.42 : 0.44 }), 0.1)
      if (s.phase !== prev) { flips++; prev = s.phase }
    }
    expect(from).toBe('perch')
    expect(flips).toBeLessThanOrEqual(1)
  })

  it('minDwell 生效 —— 任何相位不得停留短於它', () => {
    // 【前置只能跑不到 minDwell】跑滿一秒的話 build 的停留早就過了 0.5 s，
    // 下一格立刻進 perch，這條測試就什麼都沒驗到。
    const s = createTacticalState()
    run(s, input(), DEFAULT_TACTICS.minDwell * 0.4)
    expect(s.phase).toBe('build')
    // 立刻給滿能量，但還沒過 minDwell
    stepTactics(s, input({ energyRatio: 0.9 }), DT, DEFAULT_TACTICS)
    expect(s.phase).toBe('build')
    run(s, input({ energyRatio: 0.9 }), DEFAULT_TACTICS.minDwell)
    expect(s.phase).toBe('perch')
  })

  it('建能期限到 → cooldown，而且贏過同拍成立的 perch', () => {
    // 【優先序】期限到了表示這一輪的建能不健康，帶著它進 perch 只是把問題
    // 延後。第 2 級（絕對止損）高於第 5 級（條件轉移）。
    const s = createTacticalState()
    run(s, input(), DEFAULT_TACTICS.buildMax + 1)
    expect(s.phase).toBe('cooldown')
  })

  it('待機期限到 → 強制 dive，不是 cooldown', () => {
    // 已經有能量了就該用掉。
    const s = createTacticalState()
    run(s, input(), 1)
    run(s, input({ energyRatio: 0.6 }), DEFAULT_TACTICS.perchMax + 1)
    expect(s.phase).toBe('dive')
  })

  it('dive 期限到也要拉起 —— 否則退化成一路追擊', () => {
    const s = createTacticalState()
    run(s, input(), 1)
    run(s, input({ energyRatio: 0.6 }), 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), 2)
    expect(s.phase).toBe('dive')
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), DEFAULT_TACTICS.diveMax + 1)
    expect(s.phase).toBe('zoom')
  })

  it('通過目標 → zoom', () => {
    const s = createTacticalState()
    run(s, input(), 1)
    run(s, input({ energyRatio: 0.6 }), 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), 2)
    expect(s.phase).toBe('dive')
    // 先接近
    run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: 120 }), 2)
    expect(s.phase).toBe('dive')
    // 再拉開，持續超過 passSeconds
    run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: -120 }),
      DEFAULT_TACTICS.passSeconds + 0.5)
    expect(s.phase).toBe('zoom')
  })

  it('zoom 完回 build，形成一個完整的循環', () => {
    const s = createTacticalState()
    run(s, input(), 1)
    run(s, input({ energyRatio: 0.6 }), 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), 2)
    run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: 120 }), 1)
    run(s, input({ energyRatio: 0.1, psTarget: -5, closureRate: -120 }), 2)
    expect(s.phase).toBe('zoom')
    run(s, input({ energyRatio: 0.1 }), DEFAULT_TACTICS.zoomMax + 1)
    expect(s.phase).toBe('build')
  })

  it('cooldown 之後先回 off，不會同拍重進 build', () => {
    const s = createTacticalState()
    run(s, input(), DEFAULT_TACTICS.buildMax + 1)
    expect(s.phase).toBe('cooldown')
    run(s, input(), DEFAULT_TACTICS.cooldownSeconds + 0.1)
    expect(s.phase).toBe('off')
  })

  it('同一個目標、同樣的能量，cooldown 之後不會一直重試', () => {
    // 【它擋的是一個永久迴圈】build 60s → cooldown 12s → off → 立刻 build
    // → … 目標一直很遠的話會永遠繞下去，正好把原問題換成另一種永久循環。
    const s = createTacticalState()
    run(s, input(), DEFAULT_TACTICS.buildMax + 1)
    run(s, input(), DEFAULT_TACTICS.cooldownSeconds + 1)
    expect(s.phase).toBe('off')
    run(s, input(), 30)
    expect(s.phase).toBe('off')
  })

  it('換了目標就可以重進', () => {
    const s = createTacticalState()
    run(s, input(), DEFAULT_TACTICS.buildMax + 1)
    run(s, input(), DEFAULT_TACTICS.cooldownSeconds + 1)
    expect(s.phase).toBe('off')
    run(s, input({ targetIndex: 99 }), 1)
    expect(s.phase).toBe('build')
  })

  it('能量比上次冷卻時高也可以重進', () => {
    const s = createTacticalState()
    run(s, input(), DEFAULT_TACTICS.buildMax + 1)
    run(s, input(), DEFAULT_TACTICS.cooldownSeconds + 1)
    expect(s.phase).toBe('off')
    run(s, input({ energyRatio: 0.3 }), 1)
    expect(s.phase).toBe('build')
  })

  it('換目標時承諾計時歸零 —— 否則會誤判新目標已經承諾很久', () => {
    // 【具體的誤判】換目標前累積 1.4 秒的 psTarget < 0，新目標第一拍也是
    // 負值，於是 0.1 秒後就誤判「已持續承諾 1.5 秒」而俯衝。
    const s = createTacticalState()
    run(s, input(), 1)
    run(s, input({ energyRatio: 0.6 }), 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), 1.4)
    expect(s.phase).toBe('perch')
    expect(s.commit).toBeGreaterThan(1.3)
    stepTactics(s, input({ energyRatio: 0.6, psTarget: -5, targetIndex: 99 }),
      DT, DEFAULT_TACTICS)
    expect(s.commit).toBeLessThan(0.1)
  })

  it('換目標時 perchLatch 與通過計時歸零，但相位不變', () => {
    // 【為什麼相位不重置】換目標是常態（實測持有中位只有幾秒），跟著重置
    // 等於這個戰術層永遠跑不完一輪。跳掉的是計量，不是決定。
    const s = createTacticalState()
    run(s, input(), 1)
    run(s, input({ energyRatio: 0.6 }), 1)
    expect(s.phase).toBe('perch')
    expect(s.perchLatch).toBe(true)
    stepTactics(s, input({ energyRatio: 0.6, targetIndex: 99 }), DT, DEFAULT_TACTICS)
    expect(s.phase).toBe('perch')
    expect(s.perchLatch).toBe(false)
    expect(s.passing).toBe(0)
    expect(s.closed).toBe(false)
    expect(s.cycleValid).toBe(false)
  })

  it('換目標時相位的計時不歸零 —— 它問的是「這個相位待多久」', () => {
    const s = createTacticalState()
    run(s, input(), 10)
    const before = s.dwell
    stepTactics(s, input({ targetIndex: 99 }), DT, DEFAULT_TACTICS)
    expect(s.dwell).toBeGreaterThan(before)
  })

  it('目標消失 → 立刻 off', () => {
    const s = createTacticalState()
    run(s, input(), 1)
    run(s, input({ energyRatio: 0.6 }), 1)
    expect(s.phase).toBe('perch')
    stepTactics(s, input({ targetIndex: -1 }), DT, DEFAULT_TACTICS)
    expect(s.phase).toBe('off')
  })

  it('一輪淨損超標 → cooldown', () => {
    const s = createTacticalState()
    run(s, input({ energyRatio: 0.2 }), 1)
    expect(s.phase).toBe('build')
    // 這一輪的基準是 0.2，掉到 0.2 − cycleLossMax − 餘裕
    run(s, input({ energyRatio: 0.2 - DEFAULT_TACTICS.cycleLossMax - 0.05 }), 0.5)
    expect(s.phase).toBe('cooldown')
  })

  it('換目標那一輪不參與能量帳止損', () => {
    // 【為什麼】energyRatio 是相對當前目標的。換目標時它不連續地跳，硬算
    // 那個差會得到一個沒有意義的數字。
    const s = createTacticalState()
    run(s, input({ energyRatio: 0.2 }), 1)
    // 換目標，同時能量「暴跌」—— 那只是換了比較對象
    run(s, input({ energyRatio: -0.5, targetIndex: 99 }), 1)
    expect(s.phase).not.toBe('cooldown')
  })

  it('連續兩輪沒有射擊窗 → 長冷卻', () => {
    const s = createTacticalState()
    const C = DEFAULT_TACTICS
    // 跑兩整圈，全程 shotInstant = 0
    for (let round = 0; round < 2; round++) {
      run(s, input({ energyRatio: 0 }), 1)
      run(s, input({ energyRatio: 0.6 }), 1)
      run(s, input({ energyRatio: 0.6, psTarget: -5 }), C.commitSeconds + 1)
      run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: 120 }), 1)
      run(s, input({ energyRatio: 0.1, psTarget: -5, closureRate: -120 }),
        C.passSeconds + 0.5)
      run(s, input({ energyRatio: 0.1 }), C.zoomMax + 1)
    }
    expect(s.phase).toBe('cooldown')
    expect(s.cooldown).toBeGreaterThan(C.cooldownSeconds)
  })

  it('有射擊窗就把連續計數歸零', () => {
    const s = createTacticalState()
    const C = DEFAULT_TACTICS
    run(s, input({ energyRatio: 0 }), 1)
    run(s, input({ energyRatio: 0.6 }), 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), C.commitSeconds + 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: 120, shotInstant: 0.4 }), 1)
    run(s, input({ energyRatio: 0.1, psTarget: -5, closureRate: -120 }), C.passSeconds + 0.5)
    run(s, input({ energyRatio: 0.1 }), C.zoomMax + 1)
    expect(s.dryRounds).toBe(0)
  })

  it('zoom 只回 build，不直接跳 perch', () => {
    // 【它擋的是輪次永不結算】直接跳 perch 的話會形成
    // build → perch → dive → zoom → perch → … 永遠不回 build。
    const s = createTacticalState()
    const C = DEFAULT_TACTICS
    run(s, input({ energyRatio: 0 }), 1)
    run(s, input({ energyRatio: 0.6 }), 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), C.commitSeconds + 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: 120 }), 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: -120 }), C.passSeconds + 0.5)
    expect(s.phase).toBe('zoom')
    // 能量還在（perchLatch 仍為真），但過了 zoomMin 之後要先回 build
    run(s, input({ energyRatio: 0.6 }), C.zoomMin + 0.1)
    expect(s.phase).toBe('build')
  })

  it('接近率恰好為 0 不算「正在拉開」', () => {
    // 切向飛行時接近率是 0。那不是通過目標。
    const s = createTacticalState()
    const C = DEFAULT_TACTICS
    run(s, input({ energyRatio: 0 }), 1)
    run(s, input({ energyRatio: 0.6 }), 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5 }), C.commitSeconds + 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: 120 }), 1)
    run(s, input({ energyRatio: 0.6, psTarget: -5, closureRate: 0 }), C.passSeconds + 2)
    expect(s.phase).toBe('dive')
  })

  it('quota = 0 時 stepTactics 恆回 off', () => {
    // 【這一條守著整張消融表的對照組】若關不乾淨，「上線前的行為」那一列
    // 量到的就不是基準。
    const s = createTacticalState()
    const cfg = { ...DEFAULT_TACTICS, quota: 0 }
    for (let k = 0; k < Math.round(300 / DT); k++) {
      stepTactics(s, input({ slot: false, energyRatio: 0.9, psTarget: -5 }), DT, cfg)
      expect(s.phase).toBe('off')
    }
  })
})
```

- [ ] **Step 2：跑測試確認它紅**

```
npx vitest run test/unit/ai-tactics.test.ts
```

- [ ] **Step 3：實作**

加到 `src/ai/tactics.ts`：

```ts
import { latch } from './rules'

/**
 * `stepTactics` 的輸入。**呼叫端每步就地重填，不配置。**
 *
 * 【為什麼是一個結構而不是十個參數】十個參數的呼叫端沒有人看得懂順序，
 * 而且加一個量就要改所有測試的呼叫。與 `command.ts` 的 `CommandUnit`
 * 是同一個手法。
 */
export interface TacticalInput {
  /** 有名額（`hasSlot` 的結果）。`selfIndex < 0` 時呼叫端給 `false` */
  slot: boolean
  /** 有命令（rally / flank / focus）或 `transit` */
  suspended: boolean
  /** 目標的識別。−1 = 沒有目標 */
  targetIndex: number
  /** 兩機距離，m */
  range: number
  energyRatio: number
  /** 他的比超量功率。負 = 他在耗能量 */
  psTarget: number
  /** 接近率，m/s。正 = 正在接近 */
  closureRate: number
  /** 我打得到他的瞬時程度，0..1 */
  shotInstant: number
  /** 任務壓力成立（Task 9 之前恆為 `false`） */
  pressure: boolean
}

/** 換相位：重設計時，其餘不動 */
function enter(s: TacticalState, phase: TacticalPhase): void {
  s.phase = phase
  s.dwell = 0
}

/** 開一輪新的能量帳 */
function openCycle(s: TacticalState, energyRatio: number): void {
  s.cycleBase = energyRatio
  s.cycleValid = true
  s.cycleShot = false
}

/**
 * 推進一架飛機的戰術狀態。**純函數（就地改寫 `s`），熱路徑不配置。**
 *
 * 【轉移的優先序】同一拍可能有多條成立，順序不同會產生不同的戰術：
 *
 * ```
 *   1. 強制離場   沒名額／有命令／目標消失            → off
 *   2. 絕對止損   建能期限、能量帳                    → cooldown
 *   3. 任務壓力                                       → dive
 *   4. 期限出口   perchMax → dive、diveMax → zoom …
 *   5. 條件轉移   perchLatch、承諾姿態、通過判定
 * ```
 *
 * 【為什麼在 10 Hz 之外也能跑】它只做加減與比較，成本與 `stepBurst` 同級。
 * 呼叫端每個物理步呼叫一次，計時才不會在早退路徑上停住。
 */
export function stepTactics(
  s: TacticalState, inp: TacticalInput, dt: number, cfg: TacticalConfig,
): void {
  // ── 目標切換：逐欄重置計量，相位不動 ──────────────────
  //
  // 【為什麼必須做】energyRatio、psTarget、closureRate 全部是**相對當前
  // 目標**的。目標一換它們不連續地跳，而下面每一個都是差分或計時。
  const switched = inp.targetIndex !== s.lastTarget
  if (switched) {
    s.lastTarget = inp.targetIndex
    s.perchLatch = false
    s.commit = 0
    s.closed = false
    s.passing = 0
    // 【基準重設成當下，而且該輪標記為無效】只設 cycleValid 的話，基準還
    // 停在舊目標的尺度上，下一輪開帳前的每一格都在跟一個沒有意義的數字比
    s.cycleBase = inp.energyRatio
    s.cycleValid = false
    s.cycleShot = false
    s.lastCooldownRatio = NaN
  }

  s.dwell += dt
  if (s.cooldown > 0) s.cooldown -= dt

  // ── 第 1 級：強制離場 ────────────────────────────────
  if (!inp.slot || inp.suspended || inp.targetIndex < 0) {
    if (s.phase !== 'off') enter(s, 'off')
    s.farLatch = false
    return
  }

  // ── 全程維護的閂鎖與計時（不論在哪一個相位）──────────
  //
  // 【為什麼全程】`latch` 的語意是一段獨立的記憶。`rules.ts` 的
  // `stepRules` 每拍更新所有閂鎖，即使那一拍沒有選到那個意圖。
  //
  // 【換目標的那一拍全部跳過】否則清成 false 的閂鎖會在同一拍被新目標的
  // 數字重新算成 true —— 「切換拍重置」就只是一句沒有效果的話。下一拍才
  // 開始用新目標的數字重新累積。
  if (!switched) {
    s.perchLatch = latch(s.perchLatch, inp.energyRatio, cfg.perchEnter, cfg.perchExit)
    s.commit = inp.psTarget < 0 ? s.commit + dt : 0
    if (inp.shotInstant > 0) s.cycleShot = true
    // 【通過的判定要「轉負」不是「非正」】接近率恰好為 0 是切向飛行，
    // 那不是「正在拉開」
    if (inp.closureRate > 0) { s.closed = true; s.passing = 0 }
    else if (s.closed && inp.closureRate < 0) s.passing += dt
  }
  // 【距離閂鎖與目標無關】它問的是「我離**這個**目標多遠」，換目標時距離
  // 本來就該重算，而閂鎖的記憶對新目標仍然有意義（都是同一片天空）
  s.farLatch = latch(s.farLatch, inp.range, cfg.enterRange, cfg.exitRange)

  const dwellDone = s.dwell >= cfg.minDwell

  // ── cooldown 自己的出口 ───────────────────────────────
  if (s.phase === 'cooldown') {
    if (s.cooldown <= 0) enter(s, 'off')
    return
  }

  // ── off → build ──────────────────────────────────────
  if (s.phase === 'off') {
    if (!s.farLatch) return
    // 【再進入條件】同一個目標、同樣打不動的能量，不會一直重試
    const fresh = Number.isNaN(s.lastCooldownRatio)
      || inp.energyRatio > s.lastCooldownRatio
    if (!fresh) return
    enter(s, 'build')
    openCycle(s, inp.energyRatio)
    return
  }

  // ── 第 2 級：絕對止損 ────────────────────────────────
  if (s.phase === 'build' && s.dwell >= cfg.buildMax) {
    s.lastCooldownRatio = inp.energyRatio
    s.cooldown = cfg.cooldownSeconds
    enter(s, 'cooldown')
    return
  }
  if (s.cycleValid && inp.energyRatio - s.cycleBase < -cfg.cycleLossMax) {
    s.lastCooldownRatio = inp.energyRatio
    s.cooldown = cfg.cooldownSeconds
    enter(s, 'cooldown')
    return
  }

  // ── 第 3、4 級：任務壓力與期限出口 ────────────────────
  if (s.phase === 'perch' && (inp.pressure || s.dwell >= cfg.perchMax)) {
    enter(s, 'dive')
    return
  }
  if (s.phase === 'dive' && s.dwell >= cfg.diveMax) {
    enter(s, 'zoom')
    return
  }

  if (!dwellDone) return

  // ── 第 5 級：條件轉移 ────────────────────────────────
  switch (s.phase) {
    case 'build':
      if (s.perchLatch) enter(s, 'perch')
      break
    case 'perch':
      if (s.commit >= cfg.commitSeconds) enter(s, 'dive')
      else if (!s.perchLatch) {
        // 【回 build 也要開新帳】一輪的定義是「進入 build 到下一次進入
        // build」。少了這一行，cycleBase 會跨過好幾次 perch → build，
        // 能量帳比的就不是本輪
        enter(s, 'build')
        openCycle(s, inp.energyRatio)
      }
      break
    case 'dive':
      if (s.passing >= cfg.passSeconds) enter(s, 'zoom')
      break
    case 'zoom': {
      if (s.dwell < cfg.zoomMin) break
      // 【zoom 的唯一出口是 build，不能直接跳 perch】直接跳的話會形成
      //     build → perch → dive → zoom → perch → dive → zoom → …
      // 永遠不回 build，於是輪次永遠不結算、dryRounds 永遠不累積，整條
      // 能量帳止損等於不存在。回 build 之後若能量還在，下一格的 perchLatch
      // 會自然把它帶回 perch —— 那才是 spec 描述的兩步路徑。
      if (!s.perchLatch && s.dwell < cfg.zoomMax) break
      // 一輪結束：結算能量帳
      if (s.cycleValid && !s.cycleShot) s.dryRounds++
      else if (s.cycleShot) s.dryRounds = 0
      if (s.dryRounds >= cfg.dryRounds) {
        s.lastCooldownRatio = inp.energyRatio
        s.cooldown = cfg.longCooldownSeconds
        s.dryRounds = 0
        enter(s, 'cooldown')
        break
      }
      enter(s, 'build')
      openCycle(s, inp.energyRatio)
      break
    }
    default:
      break
  }
}
```

- [ ] **Step 4：跑測試確認它綠**

```
npx vitest run test/unit/ai-tactics.test.ts
npx tsc --noEmit
```

**若「能量在遲滯帶裡來回」那一條紅了**：不要放寬 `expect(flips)`。先在測試裡
印出 `s.phase` 的序列，找出是哪兩個相位在翻，那是一個真的震盪。

- [ ] **Step 5：commit**

```bash
git add src/ai/tactics.ts test/unit/ai-tactics.test.ts
git commit -m "feat: stepTactics 六狀態的戰術循環

轉移有明確的五級優先序（強制離場 > 絕對止損 > 任務壓力 > 期限出口 >
條件轉移），閂鎖全程維護、每個相位有最短停留。

目標切換逐欄重置計量但不重置相位 —— 換目標是常態，跟著重置的話這個戰術層
永遠跑不完一輪。

cooldown 之後的再進入要求換過目標或能量變高，否則
build → cooldown → off → build 會永遠繞下去。"
```

---

## Task 6：`tacticalCommand` 三個相位的瞄準解

**檔案**
- Modify：`src/ai/tactics.ts`
- Modify：`test/unit/ai-tactics.test.ts`

**介面**
- 消費：`TacticalPhase`、`Situation`、`EngageBasis`、`Aircraft`、`Command`
- 產出：`tacticalCommand(phase, sit, basis, self, seaHeight, cfg, out)`

- [ ] **Step 1：寫失敗的測試**

加到 `test/unit/ai-tactics.test.ts`：

```ts
import { Vector3 } from 'three'
import { tacticalCommand } from '../../src/ai/tactics'
import { createCommand } from '../../src/control/Controller'
import { createSituation, evaluateGeometry, evaluateEnergy } from '../../src/ai/assess'
import { buildEngageBasis, createEngageBasis } from '../../src/ai/steer'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { BF109G6 } from '../../src/specs/bf109g6'
import { P51D } from '../../src/specs/p51d'

/** 造一組「我在下面、他在前上方 3 km」的態勢 */
function scene() {
  const self = new Aircraft(BF109G6, 5000, 200)
  const target = new Aircraft(P51D, 5300, 240)
  target.state.position.set(0, 5300, -3000)
  self.update(new Vector3(0, 0, -1), 0.8, DT)
  target.update(new Vector3(0, 0, -1), 0.8, DT)
  const sit = createSituation()
  evaluateGeometry(self, target, sit)
  evaluateEnergy(self, target, sit)
  const basis = createEngageBasis()
  buildEngageBasis(self, target, basis)
  return { self, target, sit, basis }
}

describe('戰術層的瞄準解', () => {
  it('build 命令爬升', () => {
    const { self, sit, basis } = scene()
    const out = createCommand()
    tacticalCommand('build', sit, basis, self, 0, DEFAULT_TACTICS, out)
    expect(out.aimWorld.y).toBeGreaterThan(0)
  })

  it('zoom 命令的爬升比 build 陡', () => {
    const { self, sit, basis } = scene()
    const a = createCommand()
    const b = createCommand()
    tacticalCommand('build', sit, basis, self, 0, DEFAULT_TACTICS, a)
    tacticalCommand('zoom', sit, basis, self, 0, DEFAULT_TACTICS, b)
    expect(b.aimWorld.y).toBeGreaterThan(a.aimWorld.y)
  })

  it('perch 大致平飛 —— 保持能量而不是繼續存', () => {
    const { self, sit, basis } = scene()
    const out = createCommand()
    tacticalCommand('perch', sit, basis, self, 0, DEFAULT_TACTICS, out)
    expect(Math.abs(out.aimWorld.y)).toBeLessThan(0.2)
  })

  it('perch 的徑向修正是連續的 —— 在 perchRange 上不得翻號', () => {
    // 【它擋的是一個極限環】寫成「距離小於 perchRange 就轉開」會在門檻上
    // 翻號：飛離 → 距離變大 → 翻號 → 飛近 → 距離變小 → 翻號。振幅由飛機
    // 的響應決定，不由任何設計參數決定。
    const { self, sit, basis } = scene()
    const out = createCommand()
    const R = DEFAULT_TACTICS.perchRange
    let prev: number | null = null
    let jumps = 0
    for (const range of [R * 0.9, R * 0.97, R, R * 1.03, R * 1.1, R * 1.03, R, R * 0.97]) {
      sit.range = range
      tacticalCommand('perch', sit, basis, self, 0, DEFAULT_TACTICS, out)
      const radial = out.aimWorld.dot(basis.losAxis)
      if (prev !== null && Math.abs(radial - prev) > 0.5) jumps++
      prev = radial
    }
    // 連續的話相鄰兩格的徑向分量不會跳
    expect(jumps).toBe(0)
  })

  it('perch 太遠時靠近、太近時遠離', () => {
    const { self, sit, basis } = scene()
    const out = createCommand()
    sit.range = DEFAULT_TACTICS.perchRange * 3
    tacticalCommand('perch', sit, basis, self, 0, DEFAULT_TACTICS, out)
    expect(out.aimWorld.dot(basis.losAxis)).toBeGreaterThan(0)
    sit.range = DEFAULT_TACTICS.perchRange * 0.2
    tacticalCommand('perch', sit, basis, self, 0, DEFAULT_TACTICS, out)
    expect(out.aimWorld.dot(basis.losAxis)).toBeLessThan(0)
  })

  it('三個相位都不開火', () => {
    // 【為什麼】build / perch / zoom 都在遠距離經營能量。這一層扣扳機只會
    // 把彈藥丟在一個打不到的方向上，而且 `fireShare` 是護欄指標。
    const { self, sit, basis } = scene()
    const out = createCommand()
    out.firing = true
    for (const phase of ['build', 'perch', 'zoom'] as const) {
      tacticalCommand(phase, sit, basis, self, 0, DEFAULT_TACTICS, out)
      expect(out.firing).toBe(false)
    }
  })

  it('四個欄位每次都完整寫入 —— out 是重用的物件', () => {
    // 【為什麼要釘住】AiController 的 raw 是重用的。不寫的欄位會保留上一
    // 格的值，而上一格可能是一個俯衝中的脫離向量或一個扣著的扳機。
    const { self, sit, basis } = scene()
    const out = createCommand()
    out.aimWorld.set(1, 0, 0)
    out.throttle = 0
    out.brake = 1
    out.firing = true
    tacticalCommand('build', sit, basis, self, 0, DEFAULT_TACTICS, out)
    expect(out.aimWorld.x).not.toBe(1)
    expect(out.throttle).toBeGreaterThan(0)
    expect(out.brake).toBe(0)
    expect(out.firing).toBe(false)
  })

  it('瞄準方向恆為單位向量', () => {
    const { self, sit, basis } = scene()
    const out = createCommand()
    for (const phase of ['build', 'perch', 'zoom'] as const) {
      tacticalCommand(phase, sit, basis, self, 0, DEFAULT_TACTICS, out)
      expect(out.aimWorld.length()).toBeCloseTo(1, 6)
    }
  })

  it('拉桿紀律取兩層的較小值', () => {
    // 【為什麼不能只套 pullCeiling】正常轉向取的是
    // min(unloadPull(stallMargin), pullCeiling)。只套一層會失去「拉太猛」
    // 那一半的軟限制，而這條路徑繞過了 steerCommand。
    const { self, sit, basis } = scene()
    const out = createCommand()
    sit.pullCeiling = 0.2
    sit.stallMargin = 1.02      // 已經逼近 CLmax
    tacticalCommand('build', sit, basis, self, 0, DEFAULT_TACTICS, out)
    const nose = new Vector3(0, 0, -1).applyQuaternion(self.state.orientation)
    // 收得比純 pullCeiling 更緊 —— 也就是更靠近機首
    expect(out.aimWorld.dot(nose)).toBeGreaterThan(0.9)
  })
})
```

- [ ] **Step 2：跑測試確認它紅**

```
npx vitest run test/unit/ai-tactics.test.ts
```

- [ ] **Step 3：實作**

加到 `src/ai/tactics.ts`。`shrinkTowardNose`（`steer.ts:1260`）與 `unloadPull`
（`steer.ts:1233`）**已經是 export**，直接 import，不要複製一份實作。

```ts
import { makeScratch } from '../core/pool'
import { shrinkTowardNose, unloadPull, DEFAULT_STEER } from './steer'
import type { Situation } from './assess'
import type { EngageBasis } from './steer'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import { Vector3 } from 'three'

const T = makeScratch(3)
const FWD = new Vector3(0, 0, -1)

/** `build` 的最大爬升角，rad。與 `EXTEND_PITCH` 同級 */
const BUILD_PITCH = 20 * (Math.PI / 180)
/** `zoom` 的爬升角，rad。比 `build` 陡 —— 它在花掉剛換到的速度 */
const ZOOM_PITCH = 35 * (Math.PI / 180)

/**
 * `build` / `perch` / `zoom` 的瞄準解。**`dive` 與 `cooldown` 不走這裡**
 * ——它們覆寫既有的意圖（`engage` 與 `extend`），不需要新的轉向邏輯。
 *
 * 【為什麼不做成 `steerCommand` 尾端的偏置】那個位階已經有一個
 * `sweetPitch`，它會繞過 `pullCeiling`、抵消 `speedRecover`、疊在破防軸上。
 * 再加一個同位階的後處理器會讓那個問題更嚴重。戰術相位要成為**主要**的
 * 瞄準解。
 *
 * 【四個欄位每次都要寫】`out` 是呼叫端重用的物件。
 *
 * 熱路徑：不配置。
 */
export function tacticalCommand(
  phase: TacticalPhase,
  sit: Situation,
  basis: EngageBasis,
  self: Aircraft,
  seaHeight: number,
  cfg: TacticalConfig,
  out: Command,
): void {
  const aim = T.v[0]!
  const flat = T.v[1]!

  // 水平方向：由視線導出，各相位取不同的號
  flat.copy(basis.losAxis)
  flat.y = 0
  if (flat.lengthSq() < 1e-6) {
    flat.copy(FWD).applyQuaternion(self.state.orientation)
    flat.y = 0
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1)
  }
  flat.normalize()

  let pitch = 0
  switch (phase) {
    case 'build': {
      // 【爬升角隨赤字連續變化】與 `extendPitchAngle` 同構 —— 差得越多爬
      // 得越陡，接近門檻時自然收斂，不會在門檻上翻號
      const deficit = cfg.perchEnter - sit.energyRatio
      const k = deficit <= 0 ? 0 : deficit >= cfg.perchEnter ? 1 : deficit / cfg.perchEnter
      pitch = BUILD_PITCH * k
      // 遠離目標：水平分量取反
      flat.negate()
      break
    }
    case 'perch': {
      // 保持能量（平飛）與距離。
      //
      // 【徑向分量是連續的，不是一個門檻】寫成「距離小於 perchRange 就
      // 轉開」會在門檻上翻號：飛離 → 距離變大 → 翻號 → 飛近 → 距離變小
      // → 翻號。那是專案在 1000 m 線上震盪 40 秒那次的同型錯誤，見
      // extendPitchAngle 的註解。
      //
      // 誤差夾在 ±1：+1 = 太遠，全力靠近；−1 = 太近，全力遠離；
      // 0 = 剛好，純切向繞行。三者之間連續過渡。
      pitch = 0
      const err = (sit.range - cfg.perchRange) / cfg.perchRange
      const radial = err < -1 ? -1 : err > 1 ? 1 : err

      // 切向：自己當前的水平航向去掉徑向分量。
      //
      // 【為什麼用自己的航向而不是一個固定的側向】固定側向要選左或右，
      // 而那個選擇本身就是一個會翻的號。用當前航向則是「繼續往前繞」，
      // 沒有選擇也就沒有翻轉點。
      const tan = T.v[2]!
      tan.copy(FWD).applyQuaternion(self.state.orientation)
      tan.y = 0
      tan.addScaledVector(flat, -tan.dot(flat))
      if (tan.lengthSq() < 1e-6) {
        // 航向正對或正背著目標時切向沒有定義。取視線的水平法向
        tan.set(-flat.z, 0, flat.x)
      }
      tan.normalize()

      const w = radial < 0 ? -radial : radial
      flat.multiplyScalar(radial).addScaledVector(tan, 1 - w)
      if (flat.lengthSq() < 1e-6) flat.copy(tan)
      flat.normalize()
      break
    }
    case 'zoom':
      // 【維持當前航向】轉彎會把剛換到的速度花掉
      pitch = ZOOM_PITCH
      flat.copy(FWD).applyQuaternion(self.state.orientation)
      flat.y = 0
      if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1)
      flat.normalize()
      break
    default:
      // 【`off` / `dive` / `cooldown` 不該走到這裡】呼叫端已經分流。
      // 給一個永遠有定義的方向，不要留下上一格的值
      flat.copy(FWD).applyQuaternion(self.state.orientation)
      flat.y = 0
      if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1)
      flat.normalize()
      break
  }

  const c = Math.cos(pitch)
  aim.set(flat.x * c, Math.sin(pitch), flat.z * c).normalize()

  // 【離地底限】低空不能用高度換速度，這一層與 `extendPitchAngle` 的高度項
  // 是同一個安全關切
  const clearance = self.state.position.y - seaHeight
  if (clearance < DEFAULT_STEER.clearanceScale && aim.y < 0) {
    aim.y = 0
    if (aim.lengthSq() < 1e-6) aim.copy(flat)
    aim.normalize()
  }

  out.aimWorld.copy(aim)

  // 【拉桿紀律取兩層的較小值】`unloadPull` 防的是失速（迎角太大），
  // `pullCeiling` 防的是能量見底（速度太低）。誰先擋住算誰的
  const unload = unloadPull(sit.stallMargin, DEFAULT_STEER)
  const ceiling = unload < sit.pullCeiling ? unload : sit.pullCeiling
  shrinkTowardNose(self, ceiling, out.aimWorld)

  // 【四個欄位都要寫】見函數註解
  out.throttle = 1.1
  out.brake = 0
  out.firing = false
}
```

- [ ] **Step 4：跑測試確認它綠**

```
npx vitest run test/unit/ai-tactics.test.ts
npx tsc --noEmit
```

- [ ] **Step 5：commit**

```bash
git add src/ai/tactics.ts test/unit/ai-tactics.test.ts
git commit -m "feat: tacticalCommand —— build / perch / zoom 的瞄準解

dive 與 cooldown 不走這裡，它們覆寫既有的 engage 與 extend。

拉桿紀律取 unloadPull 與 pullCeiling 的較小值 —— 這條路徑繞過 steerCommand，
只套一層會失去「拉太猛」那一半的軟限制。四個欄位每次都完整寫入，out 是
呼叫端重用的物件。"
```

---

## Task 7：`AiController` 接線

**檔案**
- Modify：`src/ai/AiController.ts`
- Modify：`src/battle/setup.ts`（`resetBattle` 呼叫 `resetTactics`）

**介面**
- 消費：Task 4–6 的全部
- 產出：`AiController.tactics`、`AiController.tacticalConfig`、
  `AiController.resetTactics()`

- [ ] **Step 1：加欄位**

`src/ai/AiController.ts`，在 `burstConfig` 附近：

```ts
  /**
   * 戰術相位。**公開是為了量測**——與 `intent`、`mode` 同一個理由：
   * 「AI 現在在做什麼」是 `(intent, mode, phase)` 這一組決定的。
   */
  readonly tactics = createTacticalState()
  /**
   * 可注入的戰術設定。`quota: 0` = 完全關掉這一層。
   *
   * 【為什麼可注入】掃描與消融要能在不改預設值的情況下換一組數字跑，
   * 與 `burstConfig`、`targetConfig`、`wingmanConfig` 同一類。
   */
  tacticalConfig: TacticalConfig = DEFAULT_TACTICS
  /** `stepTactics` 的輸入。每步就地重填 —— 熱路徑不配置 */
  private readonly tacticalInput: TacticalInput = {
    slot: false, suspended: false, targetIndex: -1, range: 0,
    energyRatio: 0, psTarget: 0, closureRate: 0, shotInstant: 0, pressure: false,
  }
  /**
   * 隊內序號的快取。`−2` = 還沒算。
   *
   * 【為什麼是 lazy】`selfIndex` 與 `board` 在建構之後才寫入。要求每個呼叫端
   * 都記得再呼叫一次「算隊內序號」是一條遲早會漏掉的規矩，而漏掉的症狀是
   * 名額分配靜靜地變成全域索引 —— 也就是這一層存在的理由被抵消掉。
   */
  private slotSeed = -2
  private slotHas = false

  /** 重置戰術狀態。`resetBattle` 每一顆呼叫一次 */
  resetTactics(): void {
    resetTacticalState(this.tactics)
    this.slotSeed = -2
    this.slotHas = false
  }
```

import：

```ts
import {
  createTacticalState, resetTacticalState, stepTactics, tacticalCommand,
  teamIndexOf, hasSlot, DEFAULT_TACTICS,
  type TacticalConfig, type TacticalInput,
} from './tactics'
```

- [ ] **Step 2：在決策節拍推進，一拍恰好一次**

**戰術相位是 10 Hz 的決定**（spec §9）。放在 `update` 最前面會讓它每個物理步
仲裁一次，而且讀到的是上一拍的態勢。正確的位置有**兩處**，兩處都在 `decide`
裡：

**（甲）早退路徑：沒有目標時歸零。**

在 `const target = this.target` 之後、`if (!target) {` 的區塊**最前面**：

```ts
    const target = this.target
    if (!target) {
      // 【戰術層在這裡歸零】`update` 有三條 return（飛站位、飛集合點、
      // 平飛）。少了這一格，「目標消失 → off」永遠不會執行，下一個目標會
      // 繼承上一個目標留下的相位與計時。
      //
      // 【只在決策拍呼叫】相位是 10 Hz 的決定。每個物理步呼叫一次等於讓
      // FSM 以 240 Hz 仲裁，違反分頻。
      if (decide) {
        const ti = this.tacticalInput
        ti.slot = false
        ti.suspended = true
        ti.targetIndex = -1
        ti.range = 0
        ti.energyRatio = 0
        ti.psTarget = 0
        ti.closureRate = 0
        ti.shotInstant = 0
        ti.pressure = false
        stepTactics(this.tactics, ti, period, this.tacticalConfig)
      }
      if (reference) {
```

**（乙）交戰路徑：在 `evaluateEnergy` 之後。**

`decide` 區塊裡，`stepRules` 與命令覆寫之後：

```ts
      // 【讀的是當步的態勢】`evaluateGeometry` 每個物理步跑、`evaluateEnergy`
      // 每個決策拍跑，兩者都排在這一行之前。放在 `update` 最前面的話
      // `energyRatio` 會是上一拍（最多 100 ms 前）的值。
      const tcfg = this.tacticalConfig
      if (this.slotSeed !== this.selfIndex || this.slotQuota !== tcfg.quota) {
        this.slotSeed = this.selfIndex
        this.slotQuota = tcfg.quota
        this.slotHas = this.board !== null
          && hasSlot(teamIndexOf(this.board, this.selfIndex), tcfg.quota)
      }
      const ti = this.tacticalInput
      ti.slot = this.slotHas
      ti.suspended = this.transit || this.order !== null
      ti.targetIndex = this.targetIndex
      ti.range = this.sit.range
      ti.energyRatio = this.sit.energyRatio
      ti.psTarget = this.sit.psTarget
      ti.closureRate = this.sit.closureRate
      ti.shotInstant = this.sit.shotInstant
      ti.pressure = this.board !== null && this.selfIndex >= 0
        && this.board.pressure[teamSlot(this.board.candidates[this.selfIndex]!.team)] !== 0
      stepTactics(this.tactics, ti, period, tcfg)
```

**快取的失效條件要含 `quota`**：掃描與消融會在控制器跑過之後換
`tacticalConfig`，只以 `selfIndex` 失效的話名額不會重算，整張消融表會是錯的。
所以欄位是兩個：

```ts
  private slotSeed = -2
  private slotQuota = Number.NaN
  private slotHas = false
```

`resetTactics()` 要把三個都清掉。

- [ ] **Step 2b：目標的識別要與 `this.target` 同步寫入**

**不能用 `board.assignments[selfIndex]`。** 那一格是 `selectTarget` 與
`selectWingmanTarget` 寫的，而長機收到集火令時 `this.target` 會被
`focusTarget` 覆寫、`assignments` **沒有跟著更新**（焦點索引是 `battle` 層
另外解析的）。集火期間 `assignments` 指的是它原本自由選的那一架 —— 一個錯的
識別會讓 §7.0 的重置在每一拍都誤觸發。

加一個欄位，在**每一個**寫 `this.target` 的地方同步寫它：

```ts
  /**
   * 當前目標在指派板上的索引。−1 = 沒有目標。
   *
   * 【為什麼不用 `board.assignments[selfIndex]`】集火時 `this.target` 被
   * `focusTarget` 覆寫，而 `assignments` 沒有跟著更新。戰術層用它判斷
   * 「換目標了沒有」，錯的識別會讓計量的重置每一拍都誤觸發。
   */
  targetIndex = -1
```

四個寫入點：

```ts
      if (this.transit) {
        this.target = null
        this.targetIndex = -1          // ← 新增
        ...
      } else if (this.board) {
        this.target = reference ? selectWingmanTarget(...) : selectTarget(...)
        // ← 新增。這兩支函數就是 assignments 的作者，所以這裡讀它是對的
        this.targetIndex = this.selfIndex >= 0
          && this.selfIndex < this.board.assignments.length
          ? this.board.assignments[this.selfIndex]! : -1
      }
      if (this.order !== null && this.order.kind !== 'focus'
        && reference && this.wingmanState.level > LEVEL_SELF_DEFENCE) {
        this.target = null
        this.targetIndex = -1          // ← 新增
      }
      if (this.focusTarget !== null && !reference) {
        this.target = this.focusTarget
        // ← 新增。集火的權威索引在命令上
        this.targetIndex = this.order !== null ? this.order.focusIndex : -1
      }
```

- [ ] **Step 3：接上覆寫**

在 `decide` 區塊裡、命令覆寫**之後**，加戰術層的覆寫：

```ts
      // 【戰術層排在命令與破防之後】完整的優先序見 spec §6.1。它讓位給：
      // transit、命令、集火、defend，以及**絕對能量見底**（extendFloorLatch）
      // —— 最後那一條是安全問題：`build` 要求正航跡角，一架低於角落速度的
      // 飛機會繼續爬到失速。
      //
      // 【`stepRules` 照常呼叫】閂鎖要繼續維護，否則戰術層解除的那一格會
      // 拿到一組停在幾秒前的閂鎖。與命令層同一個手法。
      const phase = this.tactics.phase
      if (phase !== 'off' && this.order === null
        && !this.rules.defendLatch && !this.rules.extendFloorLatch) {
        if (phase === 'dive') this.intent = 'engage'
        else if (phase === 'cooldown') this.intent = 'extend'
      }
```

【閂鎖的名字已查證】`RuleState.extendFloorLatch`（`rules.ts:264`）。同一個介面
裡還有 `extendEnergyLatch` 與 `extendTurnLatch`，那兩個是**相對**理由，
戰術層**不必**讓位給它們 —— 讓位的只有 `defendLatch` 與 `extendFloorLatch`。

- [ ] **Step 4：接上瞄準解**

在 `steerCommand(...)` 那一段，改成分流：

```ts
    const phase = this.tactics.phase
    const tactical = (phase === 'build' || phase === 'perch' || phase === 'zoom')
      && this.order === null
      && !this.rules.defendLatch && !this.rules.extendFloorLatch
    if (tactical) {
      tacticalCommand(
        phase, this.sit, this.basis, self, this.seaHeight, this.tacticalConfig, raw,
      )
    } else {
      steerCommand(
        this.intent, mode, this.sit, this.basis, self, this.seaHeight,
        this.knobs, this.defend,
        this.order === null || this.order.kind === 'focus' ? null : this.order.point,
        raw,
      )
    }
```

開火那一行改成：

```ts
    raw.firing = !tactical && burstOpen
      && (this.intent === 'rally' ? false : shouldFire(this.sit, this.basis, self))
```

- [ ] **Step 5：`resetBattle` 呼叫 `resetTactics`**

`src/battle/setup.ts` 的 `resetBattle`，在重建控制器那個迴圈裡：

```ts
  for (const c of combatants) {
    if (c.index === b.playerSeat) {
      c.controller = b.playerController
      continue
    }
    // 【保留下來的那幾顆要清戰術狀態】相位、計時、輪次、冷卻與上一個目標
    // 都會跨場殘留，第二場的第一秒就會有幾架飛機從別人的 perch 中途開始
    if (c.controller instanceof AiController) { c.controller.resetTactics(); continue }
```

- [ ] **Step 6：型別檢查與既有測試**

```
npx tsc --noEmit
npx vitest run test/unit/ai-tactics.test.ts test/unit/ai-burst.test.ts
npx vitest run test/unit/ai-fire.test.ts test/unit/ai-steer.test.ts
```

- [ ] **Step 7：commit**

```bash
git add src/ai/AiController.ts src/battle/setup.ts
git commit -m "feat: AiController 接上戰術層

推進放在 update 最前面（早退路徑也要跑，否則「目標消失 → off」永遠不執行）。
覆寫讓位給 transit、命令、集火、defend 與絕對能量見底 —— 最後一條是安全
問題：build 要求正航跡角，低於角落速度時會繼續爬到失速。

resetBattle 對每一顆 AiController 呼叫 resetTactics，否則相位與計時跨場殘留。"
```

---

## Task 8：`quota = 0` 的等價與同設定雙跑

**檔案**
- Create：`test/integration/tactics-off.test.ts`
- Create：`test/integration/replay-determinism.test.ts`

**這個 Task 是後面每一步的安全網。** 沒有它，「戰術層關掉時真的關乾淨」只是
一個宣稱。

- [ ] **Step 1：寫同設定雙跑的護欄**

新建 `test/integration/replay-determinism.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { PlayerController } from '../../src/control/PlayerController'
import { createInputState } from '../../src/input/InputState'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_TACTICS } from '../../src/ai/tactics'
import { replayDigest } from '../tools/spawn-snapshot'

const DT = 1 / 240
const SECONDS = 30
const SEED = 20260822

/**
 * 同一組設定、同一個種子跑兩次，結果必須完全相同。
 *
 * 【為什麼專案需要這一條】`rematch.test.ts` 測的是換設定、戰績隔離與十場
 * 效能，**不是**逐位元重播；`order-of-battle-replay.test.ts` 比的是與一個
 * 固定基準的 digest，那條會在任何行為改動時紅掉。兩者都不回答「同一組設定
 * 跑兩次會不會不一樣」——而那正是 `Math.random`、`Map` 迭代順序、未初始化
 * 記憶體這幾類缺陷的唯一症狀。
 */
async function snapshot(quota: number): Promise<string> {
  const b = createBattle(new PlayerController(createInputState()), DEFAULT_BATTLE, SEED)
  for (const c of b.world.combatants) {
    if (c.controller instanceof AiController) {
      c.controller.tacticalConfig = { ...DEFAULT_TACTICS, quota }
    }
  }
  for (let k = 0; k < Math.round(SECONDS / DT); k++) stepBattle(b, DT)
  // 【用專案既有的那一支】它把完整狀態（含速度、姿態、作動器、指派、彈丸）
  // 轉成 Float64Array 再做 SHA-256。自己挑幾個欄位比會漏掉整條積分。
  return replayDigest(b)
}

describe('同設定雙跑', () => {
  // 【timeout 不能省】每條各跑兩次 30 秒的 20v20 模擬，而 vitest 預設是
  // 5 秒。既有的 order-of-battle-replay 給的是 5 分鐘。
  it('戰術層關掉時兩次完全相同', async () => {
    expect(await snapshot(0)).toBe(await snapshot(0))
  }, 300_000)

  it('戰術層開著時兩次也完全相同', async () => {
    // 【這一條才驗得到戰術層自己的決定性】名額用低差異序列而不是亂數、
    // 隊內序號由候選陣列的順序推導 —— 兩者都必須是確定的。
    expect(await snapshot(0.5)).toBe(await snapshot(0.5))
  }, 300_000)
})
```

- [ ] **Step 2：跑它**

```
npx vitest run test/integration/replay-determinism.test.ts
```

**紅了的話**：先找非決定性的來源（`Math.random`、`Map` / `Set` 的迭代順序、
未初始化的欄位）。**不要**放寬比較。

- [ ] **Step 3：寫 `quota = 0` 的整合級等價**

**直接與 `order-of-battle-replay` 的既有基準比，而且用同一支 `replayDigest`。**

`toFixed(6)` 不是逐位元——小於 5×10⁻⁷ 的差會被四捨五入掉，而且它只抓位置與
血量，漏掉速度、姿態、作動器、指派與彈丸。`test/tools/spawn-snapshot.ts` 的
`replayDigest` 把完整狀態轉成 `Float64Array` 再做 SHA-256，那才是專案的權威
工具。

**而且「與自己比」證明不了等價。** `digest(0) === digest(0)` 只是同設定雙跑，
與 `replay-determinism` 重複。真正要證的是**等於 BASE′**（方向修正之後、
戰術層之前的那個基準）。

新建 `test/integration/tactics-off.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  Idle, SCENES, SEED, STEPS, DT, replayDigest,
} from '../tools/spawn-snapshot'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_TACTICS } from '../../src/ai/tactics'
import { BASE } from '../fixtures/spawn-baseline'

/**
 * 戰術層關掉時，必須與**它上線之前**逐位元相同。
 *
 * 【為什麼單元測試不夠】`stepTactics` 恆回 `off` 只證明那個純函數。
 * `AiController` 整體是否等價還牽涉到新增的 `Situation` 欄位有沒有被別處
 * 讀到、覆寫的順序、早退路徑的推進、以及 `raw` 有沒有被多寫過。
 *
 * 【基準是 BASE′，不是最原始的那一版】§4 的方向修正對所有 AI 生效、不受
 * `quota` 控制，所以它必然改變結果。Task 3 已經重跑過一次基準；這一條比的
 * 是那一次之後的值。
 *
 * 【為什麼把等價寫成永久測試而不是一次性的人工步驟】人工步驟需要「暫時改
 * 一行預設值、跑、記得改回來」，而那一行如果忘了改回去就會被 commit 進去。
 */
describe('戰術層關掉時等於它上線之前', () => {
  for (const [name, cfg] of Object.entries(SCENES)) {
    it(`${name}：quota = 0 的 digest 等於基準`, async () => {
      const b = createBattle(new Idle(), cfg, SEED)
      for (const c of b.world.combatants) {
        if (c.controller instanceof AiController) {
          c.controller.tacticalConfig = { ...DEFAULT_TACTICS, quota: 0 }
        }
      }
      for (let k = 0; k < STEPS; k++) stepBattle(b, DT)
      expect(await replayDigest(b)).toBe(BASE[`${name}_REPLAY`])
    }, 300_000)

    it(`${name}：quota = 0.5 的 digest 不同 —— 否則這一層沒接上`, async () => {
      // 【為什麼要這一條】一個「永遠沒接上」的機制會讓所有等價測試都綠，
      // 而消融表會顯示「開關沒有差別」—— 那看起來像「這個功能沒用」，
      // 不是「這個功能沒裝」。
      const b = createBattle(new Idle(), cfg, SEED)
      for (const c of b.world.combatants) {
        if (c.controller instanceof AiController) {
          c.controller.tacticalConfig = { ...DEFAULT_TACTICS, quota: 0.5 }
        }
      }
      for (let k = 0; k < STEPS; k++) stepBattle(b, DT)
      expect(await replayDigest(b)).not.toBe(BASE[`${name}_REPLAY`])
    }, 300_000)
  }
})
```

**先看 `test/integration/order-of-battle-replay.test.ts` 第 1–50 行**，照抄它
`import` 的名字與 `BASE` 的 key 形狀（`${name}_REPLAY`）。`Idle` 是那支測試
用的空控制器；`SCENES` / `SEED` / `STEPS` / `DT` 也都在 `spawn-snapshot` 裡。

**`300_000` 的 timeout 不能省。** vitest 預設 5 秒，而既有那支 30 秒重播明確
給了 5 分鐘。

- [ ] **Step 4：跑它**

```
npx vitest run test/integration/tactics-off.test.ts
```

**第一組（`quota = 0` 等於基準）紅了**表示戰術層關掉時沒有關乾淨。診斷順序：
`stepTactics` 有沒有在 `quota = 0` 時真的恆回 `off`（Task 5 有那條單元測試）
→ `tacticalCommand` 有沒有被呼叫到 → 新增的 `Situation` 欄位有沒有被別的地方
讀到。

**第二組（`quota = 0.5` 不同）紅了**表示戰術層根本沒生效。檢查順序：名額有
沒有算出來（`slotHas`）、`suspended` 是不是恆為 true、距離閂鎖進不進得去。

- [ ] **Step 5：跑既有的重播護欄**

```
npx vitest run test/integration/order-of-battle-replay.test.ts
```

**預期全綠。** `DEFAULT_TACTICS.quota` 在開發期間是 0，所以預設路徑上戰術層
是關掉的，digest 不該變。

**紅了的話**表示「關掉」沒有關乾淨——某個東西在 `quota = 0` 時仍然改變了
行為。診斷順序與 Step 4 相同。**不要重跑基準**：這個階段還沒有任何要求它
改變的理由。

- [ ] **Step 6：commit**

```bash
git add test/integration/tactics-off.test.ts \
  test/integration/replay-determinism.test.ts
git commit -m "test: 戰術層的等價與決定性護欄

quota = 0 直接與 order-of-battle-replay 的既有基準比，用同一支 replayDigest
（完整狀態的 SHA-256，含速度、姿態、作動器、指派、彈丸）。自己挑幾個欄位
比會漏掉整條積分。

把 BASE 等價寫成永久測試而不是一次性的人工步驟 —— 人工步驟需要「暫時改一行
預設值、跑、記得改回來」，而那一行忘了改回去就會被 commit 進去。

順帶補上專案缺少的「同設定跑兩次結果相同」護欄：rematch.test.ts 測的是換
設定與效能，order-of-battle-replay 比的是固定基準，兩者都不回答這個問題。"
```

# 階段三：跨層與剩下的止損

## Task 9：`protectedMask` 與任務壓力止損

**檔案**
- Modify：`src/ai/target.ts`（`TargetBoard` 加兩條、`PRESSURE_RANGE`、`teamSlot`）
- Modify：`src/battle/setup.ts`（填 `protectedMask`、10 Hz 算 `pressure`）
- Modify：`src/ai/AiController.ts`（讀 `pressure`）
- Modify：`test/unit/ai-tactics.test.ts`

**介面**
- 產出：`TargetBoard.protectedMask: Uint8Array`、`TargetBoard.pressure: Uint8Array`、
  `PRESSURE_RANGE`、`teamSlot(team): number`

- [ ] **Step 1：`target.ts` 加兩條資料與兩個常數**

```ts
  /**
   * `protectedMask[i] !== 0` = 第 i 架是這一關「要被護送／要被攔截」的那些
   * （編組表上 `duty === 'transit'`）。**預設全 0，不分隊。**
   *
   * 【為什麼不借用 `priority > 1`】那個欄位的正式語意是「目標評分倍率」，
   * 不是角色標籤。某次調整若把 `convoyPriority` 設回 1，任務壓力止損會
   * **無聲消失**，而且沒有任何測試會紅。
   */
  readonly protectedMask: Uint8Array
  /**
   * `pressure[teamSlot(team)] !== 0` = 那一隊的被保護單位正在被敵機貼上。
   * **由 `battle` 層每 10 Hz 算一次，全隊共用。**
   *
   * 【為什麼不讓每架自己掃】這個值對同隊的每一架**完全相同**，沒有理由
   * 算 20 次。20v20、4 架被保護單位時，自己掃是每秒 16,000 次距離平方；
   * 算一次是 3,200 次。而且每架自己掃還要各自處理隊別過濾，多一處會錯。
   */
  readonly pressure: Uint8Array
```

```ts
/**
 * 敵機多近算「被保護單位正在挨打」，m。
 *
 * 【為什麼住在這裡而不是 `TacticalConfig`】它的消費端是 `battle` 層算的那
 * 一次掃描，而那一層拿不到每架自己的戰術設定。放在資料的旁邊，兩邊讀的
 * 就是同一個值。**起始值，待掃描。**
 */
export const PRESSURE_RANGE = 2000

/**
 * 隊別對應到 `pressure` 的格子。
 *
 * 【為什麼是一個函數而不是讓呼叫端自己寫 `team === 'blue' ? 0 : 1`】那條
 * 三元式若在兩處各寫一次，其中一處寫反了不會有任何測試紅 —— 症狀是「某一
 * 隊的護航機從來不緊張」。
 */
export function teamSlot(team: Team): number {
  return team === 'blue' ? 0 : 1
}
```

`createTargetBoard` 加第四個可選參數 `protectedMask`，長度檢查與 `priority`
完全同型（照抄那三行的形狀與註解）。`pressure` **不收參數**，一律
`new Uint8Array(2)`——它是每步重算的輸出，不是設定。

- [ ] **Step 2：寫 `target.ts` 的測試**

加到 `test/unit/ai-target.test.ts`。**這個檔案沒有 describe 層級的 `cs`**
（現有的 `cs` 都是各個測試裡的區域變數），所以要自己造：

```ts
describe('指派板的被保護標記', () => {
  /** 造 n 架的候選陣列。只有 index / team / alive 有意義 */
  function candidates(n: number): TargetCandidate[] {
    const out: TargetCandidate[] = []
    for (let i = 0; i < n; i++) {
      out.push({
        index: i,
        team: (i < n / 2 ? 'blue' : 'red') as Team,
        alive: true,
      } as unknown as TargetCandidate)
    }
    return out
  }

  it('省略時 protectedMask 全 0', () => {
    const cs = candidates(4)
    const b = createTargetBoard(cs)
    expect(b.protectedMask.length).toBe(4)
    for (let i = 0; i < 4; i++) expect(b.protectedMask[i]).toBe(0)
  })

  it('長度不符要拋', () => {
    const cs = candidates(4)
    expect(() => createTargetBoard(cs, undefined, undefined, new Uint8Array(1)))
      .toThrow()
  })

  it('pressure 恆為兩格，起始全 0', () => {
    const b = createTargetBoard(candidates(4))
    expect(b.pressure.length).toBe(2)
    expect(b.pressure[0]).toBe(0)
    expect(b.pressure[1]).toBe(0)
  })

  it('teamSlot 兩隊不同格', () => {
    expect(teamSlot('blue')).not.toBe(teamSlot('red'))
    expect(teamSlot('blue')).toBeGreaterThanOrEqual(0)
    expect(teamSlot('red')).toBeLessThan(2)
  })
})
```

- [ ] **Step 3：`setup.ts` 填 `protectedMask`**

找到 `priority` 那三行（`setup.ts:494` 附近）：

```ts
  const priority = new Float64Array(world.combatants.length).fill(1)
  const protectedMask = new Uint8Array(world.combatants.length)
  for (const seat of convoySeats) {
    priority[seat] = cfg.tuning.convoyPriority
    protectedMask[seat] = 1
  }
  const board = createTargetBoard(
    world.combatants, flights.flightOf, priority, protectedMask,
  )
```

- [ ] **Step 4：`setup.ts` 每 10 Hz 算一次 `pressure`**

`Battle` 加一個欄位（放在 `blueCommand` 那幾行附近）：

```ts
  /** 距離下次重算任務壓力還有多久，s。見 `stepPressure` */
  pressureTimer: number
```

`createBattle` 的回傳物件裡給 `pressureTimer: 0`（**起始為 0，第一步就算一
次**——開局正是護航機該知道轟炸機有沒有被咬的時候）。

`resetBattle` 要把它設回 0。

新增函數，放在 `stepCommandLayer` 旁邊：

```ts
/**
 * 重算兩隊的任務壓力，寫進 `board.pressure`。
 *
 * 「這一隊的被保護單位有沒有敵機貼上來」對同隊的每一架**完全相同**，所以
 * 算一次全隊共用（見 `TargetBoard.pressure`）。
 *
 * 【為什麼是 10 Hz 而不是每步】它是一個慢變量，而且是戰術層 10 Hz 決策的
 * 輸入。每步算等於把成本乘 24。
 *
 * 【非護送關卡的成本是零】`protectedMask` 全 0 時外層迴圈直接跑完，一次
 * 距離平方都不算。
 *
 * 熱路徑：不配置。
 */
function stepPressure(b: Battle, dt: number): void {
  b.pressureTimer -= dt
  if (b.pressureTimer > 0) return
  b.pressureTimer += 1 / AI_DECISION_HZ

  const board = b.board
  const cs = board.candidates
  const mask = board.protectedMask
  const out = board.pressure
  out[0] = 0
  out[1] = 0

  const r2 = PRESSURE_RANGE * PRESSURE_RANGE
  for (let i = 0; i < cs.length; i++) {
    if (mask[i] === 0) continue
    const ward = cs[i]!
    if (!ward.alive) continue
    const slot = teamSlot(ward.team)
    if (out[slot] !== 0) continue        // 這一隊已經成立，不必再找
    const wp = ward.aircraft.state.position
    for (let k = 0; k < cs.length; k++) {
      const foe = cs[k]!
      if (!foe.alive || foe.team === ward.team) continue
      if (foe.aircraft.state.position.distanceToSquared(wp) < r2) {
        out[slot] = 1
        break
      }
    }
  }
}
```

在 `stepBattle` 裡呼叫，**排在 `stepCommandLayer` 之後**（兩者都讀當步的
存活狀態，順序一致比較好讀）：

```ts
  stepCommandLayer(b, dt)
  stepPressure(b, dt)
```

**`b.board` 是不是這個名字要先確認**——`createBattle` 裡建的那個
`createTargetBoard(...)` 存在哪個欄位上，照實際的寫。

- [ ] **Step 5：`AiController` 讀它**

Task 7 Step 2 的（乙）已經寫了那一行：

```ts
      ti.pressure = this.board !== null && this.selfIndex >= 0
        && this.board.pressure[teamSlot(this.board.candidates[this.selfIndex]!.team)] !== 0
```

這一步只要把 `teamSlot` 加進 import。**O(1)，沒有掃描。**

- [ ] **Step 6：戰術層的測試**

加到 `test/unit/ai-tactics.test.ts`：

```ts
  it('任務壓力讓 perch 直接俯衝，不等承諾', () => {
    const s = createTacticalState()
    run(s, input({ energyRatio: 0 }), 1)
    run(s, input({ energyRatio: 0.6 }), 1)
    expect(s.phase).toBe('perch')
    // psTarget 是正的（他沒有在耗能量），承諾判準完全不成立
    run(s, input({ energyRatio: 0.6, psTarget: 5, pressure: true }), 1)
    expect(s.phase).toBe('dive')
  })

  it('沒有壓力時承諾判準照舊', () => {
    const s = createTacticalState()
    run(s, input({ energyRatio: 0 }), 1)
    run(s, input({ energyRatio: 0.6 }), 1)
    run(s, input({ energyRatio: 0.6, psTarget: 5, pressure: false }), 5)
    expect(s.phase).toBe('perch')
  })
```

- [ ] **Step 7：跑測試**

```
npx vitest run test/unit/ai-tactics.test.ts test/unit/ai-target.test.ts
npx vitest run test/integration/tactics-off.test.ts
npx tsc --noEmit
```

`tactics-off` **必須還是綠的**——遭遇戰的 `protectedMask` 全 0，`pressure`
恆為 0，不該改變任何東西。

- [ ] **Step 8：效能檢查**

```
npx vitest run test/unit/perf-gate.test.ts
```

【注意 `perf-gate` 量不到護送的最壞情況】它用 `DEFAULT_BATTLE`，那是沒有
convoy 的殲滅戰，所以 `protectedMask` 全 0、`stepPressure` 一次距離平方都
不算。**要另外手動量一次護送卡**：

```
npx tsx -e "..."   ← 用 Task 10 的探針順便量
```

真實的最壞情況是 20v20 + 4 架被保護單位：每 tick 最多 4 × 40 = 160 次距離
平方、10 Hz，也就是每秒 1,600 次。這比每架自己掃的 16,000 次低一個數量級。

- [ ] **Step 9：commit**

```bash
git add src/ai/target.ts src/ai/AiController.ts src/battle/setup.ts \
  test/unit/ai-tactics.test.ts test/unit/ai-target.test.ts
git commit -m "feat: 任務壓力止損 —— protectedMask 與全隊共用的 pressure

用專用欄位而不是借用 priority > 1：那個欄位的語意是評分倍率，某次調整若把
convoyPriority 設回 1，任務壓力會無聲消失而且沒有測試會紅。

壓力由 battle 層每 10 Hz 算一次全隊共用，不是每架自己掃 —— 那個值對同隊的
每一架完全相同，自己掃是每秒 16,000 次距離平方，算一次是 1,600 次。"
```

## Task 10：`energy-cycle.probe.ts`

**檔案**
- Create：`test/tools/energy-cycle.probe.ts`

**這支探針要回答兩件事**：循環跑不跑得完一輪，以及 `buildMax` 該訂多少。

- [ ] **Step 1：寫探針**

新建 `test/tools/energy-cycle.probe.ts`。它要在攔截卡（`allies-intercept`）
跑 300 秒，逐架記錄：

- 每個相位的佔時（六個）
- 完成的循環數（`build → perch → dive → zoom → build` 走完一圈）
- 每一輪的 `energyRatio` 淨變化（中位、p10、p90）
- 每一輪有沒有形成射擊窗的比例
- **`psSelf − psTarget` 的分布**（中位、p10、p90）—— 這是 `buildMax` 的
  回填依據
- 每個相位被什麼結束的（期限 vs 條件）

`AiController.tactics` 是 `readonly` 但欄位可讀，直接取 `.phase`。
`psSelf` / `psTarget` 取 `AiController.sit`。

跑法寫進檔頭：`npx tsx test/tools/energy-cycle.probe.ts`

- [ ] **Step 2：跑它，回填 `buildMax`**

```
npx tsx test/tools/energy-cycle.probe.ts
```

`buildMax` 的回填規則：**取「`energyRatio` 從 0 建到 `perchEnter` 需要多久」
的 p90，再加三成餘裕。**

**單位要換算，不能直接除。** `psSelf − psTarget` 的單位是 **m/s**（比能量的
變化率），而 `energyRatio` 是**無因次**的。兩者差一個尺標：

```
d(energyRatio)/dt = (psSelf − psTarget) / (vc² / 2 G0)
```

`vc` = 自己在**當下高度**的 `manoeuvreSpeed`。**這個尺標隨高度變**，所以探
針要逐格算、取分布，不能用一個代表值反推。

探針要輸出的是 `d(energyRatio)/dt` 的分布（中位、p10、p90），然後：

```
buildMax = perchEnter / p10(d(energyRatio)/dt) × 1.3
```

**取 p10 而不是中位**：期限是一道止損，它該擋掉的是異常慢的那些，不是一半
的人。用 p10 的速率算出來的就是「九成的循環跑得完」的時間。

【為什麼不能用自己的爬升率反推】舊版的推導是「109 爬 630 m 要多久」，那把
「爬升」與「加速」當成兩份可以相加的收益 —— 但它們是**同一份比能量**的分配，
而且敵人同時也在累積能量。用 `psSelf − psTarget` 才是相對的建能速率。

把量到的值寫回 `DEFAULT_TACTICS.buildMax`，並在註解裡記下量到的分布。

- [ ] **Step 3：檢查循環有沒有跑完**

**主判準**：至少有一架完成過完整的一圈。

沒有的話**不要調參數硬湊**。先看探針的「每個相位被什麼結束的」那一欄：

- 大部分 `build` 被期限結束 → 建能太慢，回到 Step 2 重新看 `psSelf − psTarget`
- 大部分 `perch` 被期限結束 → 承諾姿態幾乎不成立，`commitSeconds` 或
  `psTarget < 0` 這個訊號有問題
- 大部分 `dive` 被期限結束 → 進場的瞄準解沒有真的靠近，回頭看 Task 6

- [ ] **Step 4：commit**

```bash
git add test/tools/energy-cycle.probe.ts src/ai/tactics.ts
git commit -m "test: energy-cycle 探針，buildMax 由 psSelf − psTarget 回填

舊的推導用自己的爬升率反推「爬 630 m 要多久」，那把高度與速度當成兩份可加
的收益 —— 但它們是同一份比能量的分配，而且敵人同時也在累積能量。改用雙方
比超量功率之差的實測分布，取 p90 加三成餘裕。"
```

---

## Task 11：整合測試

**檔案**
- Create：`test/integration/ai-tactics.test.ts`

- [ ] **Step 1：寫測試**

```ts
import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, resetBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { PlayerController } from '../../src/control/PlayerController'
import { createInputState } from '../../src/input/InputState'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_TACTICS } from '../../src/ai/tactics'
import type { TacticalPhase } from '../../src/ai/tactics'

const DT = 1 / 240
const SECONDS = 150
const SEED = 20260805

function battle(quota: number) {
  const card = MISSIONS.allies.find(c => c.id === 'allies-intercept')!
  const b = createBattle(
    new PlayerController(createInputState()), missionConfigFrom(card, 'allies'), SEED,
  )
  for (const c of b.world.combatants) {
    if (c.controller instanceof AiController) {
      c.controller.tacticalConfig = { ...DEFAULT_TACTICS, quota }
    }
  }
  return b
}

describe('戰術層的整合行為', () => {
  it('至少有一架完成過一整圈 build → perch → dive → zoom → build', () => {
    // 【這是這份 spec 的主判準】先證明循環跑得起來，才值得談勝率。
    const b = battle(1)
    const seen = new Map<number, TacticalPhase[]>()
    for (let k = 0; k < Math.round(SECONDS / DT); k++) {
      stepBattle(b, DT)
      for (const c of b.world.combatants) {
        const ai = c.controller
        if (!(ai instanceof AiController) || !c.alive) continue
        let seq = seen.get(c.index)
        if (seq === undefined) { seq = []; seen.set(c.index, seq) }
        const p = ai.tactics.phase
        if (seq[seq.length - 1] !== p) seq.push(p)
      }
    }
    const WANT: TacticalPhase[] = ['build', 'perch', 'dive', 'zoom', 'build']
    let completed = 0
    for (const seq of seen.values()) {
      for (let i = 0; i + WANT.length <= seq.length; i++) {
        let ok = true
        for (let j = 0; j < WANT.length; j++) if (seq[i + j] !== WANT[j]) { ok = false; break }
        if (ok) { completed++; break }
      }
    }
    expect(completed).toBeGreaterThan(0)
  })

  it('護航機的交戰佔時上升', () => {
    // 改動前：攔截卡的 Bf 109 只有 2.2% 在 engage，而同一批 AI 在掃蕩卡
    // 是 28.3%。
    function engageShare(quota: number): number {
      const b = battle(quota)
      let engaged = 0
      let alive = 0
      for (let k = 0; k < Math.round(SECONDS / DT); k++) {
        stepBattle(b, DT)
        for (const c of b.world.combatants) {
          const ai = c.controller
          if (!(ai instanceof AiController) || !c.alive) continue
          if (c.team !== 'red' || c.aircraft.spec.role !== 'fighter') continue
          alive += DT
          if (ai.intent === 'engage') engaged += DT
        }
      }
      return alive > 0 ? engaged / alive : 0
    }
    expect(engageShare(1)).toBeGreaterThan(engageShare(0))
  })

  it('rematch 之後戰術狀態是乾淨的', () => {
    const b = battle(1)
    for (let k = 0; k < Math.round(60 / DT); k++) stepBattle(b, DT)
    // 先確認真的有人不在 off
    const busy = b.world.combatants.some(c =>
      c.controller instanceof AiController && c.controller.tactics.phase !== 'off')
    expect(busy).toBe(true)

    resetBattle(b, SEED)
    for (const c of b.world.combatants) {
      if (c.controller instanceof AiController) {
        expect(c.controller.tactics.phase).toBe('off')
        expect(c.controller.tactics.dwell).toBe(0)
        expect(c.controller.tactics.dryRounds).toBe(0)
      }
    }
  })
})
```

- [ ] **Step 2：跑它**

```
npx vitest run test/integration/ai-tactics.test.ts
```

第一條紅的話回到 Task 10 Step 3 的診斷流程。**第二條紅的話先報告數字，
不要調參數**——那可能表示這個機制對這個局面無效，而那是一個要知道的結論。

- [ ] **Step 3：commit**

```bash
git add test/integration/ai-tactics.test.ts
git commit -m "test: 戰術層的整合護欄 —— 一整圈、交戰佔時、rematch 乾淨"
```

---

## Task 12：消融與通用性表

**檔案**
- Create：`test/tools/tactics-ablation.probe.ts`
- Modify：`docs/superpowers/specs/2026-08-22-energy-tactics-design.md`（回填）

- [ ] **Step 1：寫探針**

新建 `test/tools/tactics-ablation.probe.ts`：**七張卡 × `quota` 三檔
（0 / 0.5 / 1）× 五個種子**，逐隊逐機型輸出：

- `engage` 佔時、`extend` 佔時
- 比能量差中位、與最近敵機距離中位
- 射擊窗形成率
- 六個相位的佔時

**七張卡**：遭遇戰（`DEFAULT_BATTLE`）、`allies-sweep`、`allies-intercept`、
`allies-escort`、`allies-evac`、`axis-intercept`、`axis-escort`。

**「戰鬥機對轟炸機」要單獨列一格**（護送與攔截卡上，戰鬥機對 transit 那幾架
的量）——spec §3.1 說明為什麼不能靠無因次化直接宣告成立。

- [ ] **Step 2：先跑 `quota = 0` 的五種子，當雜訊帶**

```
npx tsx test/tools/tactics-ablation.probe.ts
```

【為什麼】「沒有任何一格變差超過雜訊」需要先知道雜訊有多大。**`quota = 0`
的五個種子就是「什麼都沒改」的分散度**，比任何憑空訂的百分比誠實。

- [ ] **Step 3：把三檔的表整理出來**

判準：任何一格的退步不得超過該格在五個種子上的全距。

- [ ] **Step 4：回填 spec**

在 spec 加一節 §14，放消融表、通用性表與雜訊帶。若某個機型或某張卡真的過不
了，**寫清楚是哪一格、差多少**，然後向專案負責人請求裁定「要不要按機型分開
定值」——**不要自己分**。

- [ ] **Step 5：commit**

```bash
git add test/tools/tactics-ablation.probe.ts \
  docs/superpowers/specs/2026-08-22-energy-tactics-design.md
git commit -m "test: 消融與通用性表 —— 七卡 × 三檔 × 五種子

quota = 0 的五種子先跑一次當雜訊帶，「不得變差超過雜訊」才有可執行的定義。
戰鬥機對轟炸機單獨列格。"
```

---

## Task 13：全套回歸與收尾

- [ ] **Step 1：全套回歸**

```
npx vitest run
```

然後單獨跑那兩支：

```
npx vitest run test/unit/perf-gate.test.ts
npx vitest run test/integration/rematch.test.ts
```

- [ ] **Step 2：與基準比對**

改動前的全套是 **2765 綠、5 紅**（既有 3 + `order-of-battle-replay` 那 2 條）。

現在的紅測試逐條分類：

- **既有的三條**（`ai-command-channel` ×2、`ai-withdraw-anchor` ×1）→ 照舊
- **`order-of-battle-replay`** → Task 3 與 Task 8 已經重跑過基準，應該綠
- **其他任何一條** → **先量、先報告、先問**

- [ ] **Step 3：型別與建置**

```
npx tsc --noEmit
```

- [ ] **Step 4：Playwright 冒煙**

```
npx playwright test
```

【為什麼】戰術層會改變 AI 的飛行路徑，而 e2e 有幾條在量畫面上的東西
（HUD、小地圖、標示）。它們不該被影響，被影響就是有東西漏了。

- [ ] **Step 5：清工作區**

一次性的探針全部刪掉：

```bash
git status --short
```

**`test/tools/` 底下的三支是要留的**（`energy-cycle`、`tactics-ablation`、
既有的 `extend-payoff`）。臨時寫在根目錄的 `.xxx.probe.ts` 一律 `rm -f`。

- [ ] **Step 6：回填 backlog**

`docs/backlog.md` §2.0 那條「AI 沒有主動能量經營（★ 人工回報）」標成完成，
並記下：

- 根因（`extend` 觸發相對、執行絕對）
- 兩次基準重跑的日期與裁定
- 消融表的結論
- 這一輪**沒有**碰的兩件事：`extend` 被 `defend` 插隊（§1.4 的第二個失效
  模式）、護送卡的 `convoyPriority` 偏置（§1.3）

- [ ] **Step 7：commit**

```bash
git add docs/backlog.md
git commit -m "docs: backlog §2.0 收尾 —— AI 主動能量經營

順帶記下這一輪明確沒碰的兩件事：extend 被 defend 插隊（要動仲裁的優先序），
以及護送卡的 convoyPriority 偏置（那張卡的 extend 佔時是 0.0%）。"
```

- [ ] **Step 8：翻開預設並重跑基準（第二次裁定）**

到這一步，**所有出貨參數都已經定案**（`buildMax` 由 Task 10 回填、`quota`
由 Task 12 的消融表決定）。現在才把預設翻開：

```ts
  quota: 0.5,     // ← 由 0 翻成 Task 12 定案的值
```

【為什麼拖到現在】戰術層一開就會改變 `order-of-battle-replay` 的 digest，
而每重跑一次基準都要專案負責人裁定。開發期間預設出 0 的話那條測試全程是
綠的，**只需要這一次重跑**。若在 Task 8 就翻開，Task 10 改 `buildMax` 會
再推翻一次，變成要裁定兩次而且第二次的 diff 混了兩個原因。

跑：

```
npx vitest run test/integration/order-of-battle-replay.test.ts
```

**預期會紅。** 向專案負責人報告，內容要包含：

1. `tactics-off.test.ts` 全綠 —— 關掉時逐位元等於基準（這是「diff 全部
   來自戰術層、沒有別的東西混進來」的證據）
2. `replay-determinism.test.ts` 全綠 —— 開著也是決定性的
3. Task 12 的消融表與通用性表
4. 請求重跑 `order-of-battle-replay` 的基準

裁定通過後重跑並 commit：

```bash
git add src/ai/tactics.ts test/fixtures/<基準檔>
git commit -m "feat: 戰術層預設上線，重跑 order-of-battle-replay 基準

專案負責人 <日期> 裁定。quota 由開發期間的 0 翻成 <定案值>。

tactics-off 全綠證明關掉時仍逐位元等於舊基準，所以這次的 diff 全部來自
戰術層本身，沒有別的東西混進來。"
```

- [ ] **Step 9：交 Codex 審程式碼**

`codex exec -s danger-full-access`，prompt 走 stdin，**背景執行**。

審查的重點：熱路徑有沒有配置、逐位元重播有沒有破口、優先序有沒有實作成
spec 寫的那樣、`tacticalCommand` 四個欄位有沒有漏寫、`resetTactics` 有沒有
漏掉某個欄位。

- [ ] **Step 10：交專案負責人試玩驗收**

---

## 自我檢查

**Spec 覆蓋**：§4 → Task 1–3；§5 → Task 5；§6 → Task 6–7；§7.0 → Task 5；
§7.1、§7.2 → Task 5；§7.3 → Task 9；§7.4 → Task 5；§8 → Task 4；§9 → Task 7；
§10 → Task 3、8、11、12；§11 → Task 4、10；§12 → 各 Task 的測試步驟。

**已知的缺口，全部是刻意的**：

- §7.1 的滾動視窗建能率止損 → spec 已經拿掉（未滿視窗的 grace period 與零
  配置的資料結構都要另外定義，而 `buildMax` 已經給了硬上界）
- §4.4 的連續權重（`angleOffTail`）→ spec 明寫「刻意不先做」，Task 2 只把
  三類反例記錄成測試

**型別一致性**：`TacticalPhase` / `TacticalState` / `TacticalConfig` /
`TacticalInput` 在 Task 4 定義，Task 5–7 使用同一組名字；`tacticalCommand`
收 `Command`（不是 `RawCommand`）；`extendPitchAngle` 的第二參數在 Task 2
定案為 `speedAdvantage`，Task 1 產出同名欄位。
