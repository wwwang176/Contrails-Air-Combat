# 追擊的離地底限與破防的能量讓位（task #136）

**日期**：2026-08-07
**前置**：`2026-08-07-defend-axis-design.md` §8 —— 破防軸換成水平面之後，
六場實測有兩場掉到 113 / 225 m，觸發該份 §5.4 的否決條件。專案負責人
2026-08-07 裁定保留破防軸、把 #136 升為必要後續（該份 §8.7）。

---

## 1. 問題

### 1.1 表象

真實 `AiController`、三機、180 秒、六場。新破防軸下：

```
場景            最低高度（舊軸 → 新軸）   結局
400 尾追         3999 → 2687             滿場
800 尾追         3180 → 3953             滿場
1000 尾追        3775 →  113 ←           113 s，腳本射手撞海
400 橫越         3999 → 2556             滿場
800 橫越         3999 →  225 ←            99 s，腳本射手撞海
1000 橫越        3999 → 3940             滿場
```

誘餌起始位置微擾 ±20 / ±40 各跑 5 次：新軸那兩場 10 次全部在 98~114 秒
結束，舊軸 10 次全部跑滿。**系統性可重現，不是混沌抽樣。**

### 1.2 根因不在 `defend`

一開始的假設是「破防持續大坡度轉彎把高度換光」。那個假設對 400 m 那兩場
成立，**對撞地的兩場完全不成立**。逐格量測：

```
場景          破防佔比   破防中速度見底   破防中低於 500 m
400 尾追       59.1%        50.1%            0.0%
400 橫越       51.7%        45.1%            0.0%
1000 尾追      24.9%         0.6%            0.0%  ← 撞地的那場
800 橫越       20.1%         0.0%            0.9%  ← 撞地的那場
```

撞地的兩場，**低於 500 m 時 AI 幾乎不在破防**。低於 1500 m 時的意圖分布：

```
場景          approach  engage  merge  defend   下沉中   目標是射手
1000 尾追       60%      30%      —     10%      90%      100%
800 橫越        62%      21%     13%      4%      89%      100%
```

**完整的因果鏈**：

1. 水平面破防**成功**把射手甩開 —— 那是新軸的功勞
2. AI 換目標，由誘餌改追射手（低空追射手 100%，誘餌全程留在 4000 m）
3. 射手往下走，AI 在 `approach` / `engage` 跟著追，低空 90% 的時間仍在下沉
4. 射手撞海，AI 被 120 m 的安全層接住（`minAlt` 113 / 225）

### 1.3 真正缺的東西

`extend` 有 `extendPitchAngle(cornerRatio, groundClearance)`，會隨離地餘裕
連續抬頭。**`engage` / `approach` / `merge` / `defend` 一個都沒有。**
唯一的防線是 `safety.ts` 的 120 m 硬限制 —— 那是最後一道，不是政策。

這個缺陷一直都在，只是舊破防軸從來不把飛機帶到低空，所以沒被觸發。

### 1.4 第二個獨立問題：破防壓過了已經存在的能量政策

`rules.ts` 的 `arbitrate` 第一行是

```ts
if (s.defendLatch) return 'defend'
```

而 `extendFloorLatch`（速度見底，判 `cornerRatio < cornerEnter`）排在它後面。
實測 400 m 那兩場，**破防期間有 50.1% / 45.1% 的時間速度已經見底**，而
`arbitrate` 自己定義的「絕對理由」（見 `rules.ts` 那段長註解：相對理由是
「比他弱」，絕對理由是「我飛不動了」）被 defend 的絕對優先權整條蓋掉。

---

## 2. 設計

兩個獨立的改動。A 治撞地，B 治能量。

### 2.1 A：離地底限（新的後處理層）

放在 `steerCommand` 的意圖分支之後、油門之前 —— 與 `unload` 同一個位置、
同一個形式。

```ts
/** 這個離地餘裕下，瞄準方向的航跡角至少要多少，rad。永遠 ≥ 0 */
export function floorPitchAngle(groundClearance: number, cfg: SteerConfig): number

/** 把 aim 的航跡角抬到不低於 minPitch，水平方位不變。就地修改 */
function applyFloor(minPitch: number, aim: Vector3): void
```

`floorPitchAngle` 的形狀與 `extendPitchAngle` 的 `altitudeDeficit` 同構，
**刻意復用同一個特徵高度 `clearanceScale`（500 m）**，不新增第二套幾何：

```
deficit = clamp(1 − groundClearance / clearanceScale, 0, 1)
return cfg.floorPitch × deficit
```

餘裕 ≥ 500 m 時回傳 0，`applyFloor` 因此是無操作 —— **高空完全不受影響**，
這是它可以無差別套用在所有意圖上的前提。

#### 三個設計約束，都來自這個檔案既有的教訓

| 約束 | 出處 |
|---|---|
| 航跡角相對**地平線**定義，不是相對當前速度向量的增量 | `unloadAim` 的註解：寫成增量會每格滾雪球，實測 `extend` 4 秒內由 −27° 跑到 −56°（垂直俯衝） |
| 連續，不得硬截斷 | `extendPitchAngle`、`unloadPull` 都是為了消抖動才改成連續量 |
| 只動俯仰，水平方位不變 | `shrinkTowardNose` 的註解：動到方位會被指揮儀讀成轉向需求，實測副翼打到滿舵 |

#### 套用範圍：無條件，統一套一次

**所有 `Intent` 與所有 `SteerMode` 都套，沒有例外。** 位置在
`steerCommand` 裡 `unload` 後處理之後、油門段之前，所以
`planeDegenerate` / `speedRecover` / `overshoot` 這三個壓過意圖的 mode
也一併涵蓋。

之所以能無條件套，是因為它只抬不壓且在餘裕 ≥ 500 m 時嚴格回傳 0：

- `extend` 不需要特例 —— `extendPitchAngle` 與 `floorPitchAngle` 自然取較高者
- `speedRecover`（主動壓機頭 20° 換速度）也套：「沒速度」與「快撞地」同時
  發生時撞地優先，那本來就是安全層與瞄準點層的既有順序（`safety.ts`
  的註解：「瞄準點層是技巧、這一層是硬限制」）
- `overshoot`（刻意消耗能量）也套：撞地比讓對方跑掉嚴重

#### `floorPitch` 的定值

**待實測掃描回填。** 掃描範圍 10° / 20° / 30° / 40°，判準是「六場的
`minAlt` 都拉回 500 m 以上，而 `shootableShare` 不變差」。

起始值取 `20°`，與 `speedRecoverPitch` 和安全層的 `recoveryPitch` 相同 ——
這個專案的三處抬頭／壓頭幅度目前都是 20°，先維持一致再看實測。

### 2.2 B：破防不再壓過「絕對理由」的 extend

`arbitrate` 裡把

```ts
if (s.extendFloorLatch && sit.energyAdvantage < cfg.floorExempt) return 'extend'
```

移到 `if (s.defendLatch) return 'defend'` **之前**。不新增任何參數、不新增
任何狀態 —— 只是讓 `rules.ts` 自己定義的分野對 `defend` 也生效。

#### 這一項的收益未經證實，風險具體

**風險**：被咬時切 `extend` 就是沿速度向量直線飛（`unloadAim`），那是把
尾巴送給對方。

**收益未證實**：400 m 那兩場破防期間有 50% 的時間速度見底，但
`shootableShare` 並沒有因此變差（新軸 23.4% vs 舊軸 21.6%）。能量赤字是
真的，但它還沒表現成可量測的防禦退化。

**因此 B 的驗收是硬性的**：`shootableShare` 不得比只做 A 的版本差。
變差就退回 B、只留 A，並把結果記進本文件。這是專案負責人 2026-08-07
的裁定（「照寫，B 用數據守著」）。

---

## 3. 不做的

- **不動破防軸、不動 `defendOffset`、不動 `defendTilt`**。前一份已經定案，
  抬角 20 / 30 / 40 / 50 全掃過，每一個都至少有一場掉到 11~345 m ——
  高度不是抬角能解的（前一份 §8.4）。
- **不動安全層**（`safety.ts` 的 120 m）。它是最後一道硬限制，這一份加的是
  它上面的**政策層**。兩者的關係與 `speedRecoverMargin`（1.25）對
  安全層 `factor`（1.5）相同：政策先動，硬限制只在政策失效時動。
- **不改測試場景的腳本射手**。射手一路追到撞海確實不像真人，但實測給它
  600 m 地板之後 AI 的 `minAlt` 沒有改善（115 / 238），所以責任不在場景。
- **不處理高空的高度消耗**。400 m 那兩場由 4000 掉到 2556 / 2687，那是
  閃躲的正常代價 —— 舊軸不掉高度的原因正是它根本沒在閃。

---

## 4. 驗收

### 4.1 主判準（解除前一份 §5.4 的否決條件）

六場（400 / 800 / 1000 m × 尾追 / 橫越，180 秒）的 `minAlt` **全部 > 500 m**，
且六場都跑滿 180 秒。

**為什麼是 500 m 而不是「不低於舊軸同場景」**：前一份 §5.4 那條標準預設了
「閃躲不該有代價」，而舊軸不掉高度的原因正是它沒在閃（位移 2.96° 對
新軸的 9.99°）。可執行的標準是**不進安全層的作用區**——
安全層 `clearance` 是 120 m，`clearanceScale` 是 500 m，取後者。

### 4.2 護欄：閃躲效果不得因此打折

`ai-visible-evasion` 的 `shootableShare` 在 700 / 900 m 兩場都不得比現在
（6.3% / 5.5%）差。**這一條同時是 B 的否決條件**（§2.2）。

### 4.3 回歸

- 全套 `npx vitest run --exclude "**/perf-gate**" --exclude "**/rematch**"`
- `perf-gate` 與 `rematch` 單獨複測（並行下會假紅）
- `ai-duel-matrix` L4-C（目前紅著）重測：確認它是自己綠了，還是要由專案
  負責人重新定值

### 4.4 事先講好的否決條件

以下任何一條成立，**整份撤回，不是調數字**：

- 六場的 `minAlt` 仍有任何一場低於 500 m（A 沒達成目的）
- `shootableShare` 變差（護欄 §4.2 破了）
- `floorPitchAngle` 在高空（餘裕 ≥ `clearanceScale`）不是嚴格的無操作
  —— 那表示它污染了與撞地無關的場景

---

## 5. 影響範圍

| 檔案 | 改動 |
|---|---|
| `src/ai/steer.ts` | 新增 `floorPitchAngle` / `applyFloor`；`SteerConfig` 加 `floorPitch`；`steerCommand` 加後處理 |
| `src/ai/rules.ts` | `arbitrate` 移動一行（B） |
| `test/unit/ai-steer.test.ts` | `floorPitchAngle` 的連續性與端點、`applyFloor` 的方位不變性 |
| `test/unit/ai-rules.test.ts` | B 的優先序 |
| `test/integration/ai-manoeuvre.test.ts` | 六場 `minAlt` 的護欄 |

`safetyShare`（`ai-manoeuvre.test.ts`，現行上限 0.05、實測最差 1.83%）
預期會**下降** —— 政策層提早介入，硬限制就少動。那是這一份要的效果，
不是迴歸，而且它是單邊上限，下降不會讓它變紅。

**護欄重新定值是專案負責人的決定，不是實作者的。** 紅了先量、先報告、先問。
