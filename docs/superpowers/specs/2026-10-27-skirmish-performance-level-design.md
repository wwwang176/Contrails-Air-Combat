# 遭遇戰「飛機性能」選項

## 目的

遭遇戰設定頁多一格「飛機性能」，三段：標準、強化、超強。選強化或超強時，
**敵我全部飛機**（戰鬥機與轟炸機）轉彎、爬升、滾轉一起變快，極速大致不變。
任務模式不受影響。

## 倍率

`specs/feel.ts` 的手感輪廓（`GAME_FEEL`／`BOMBER_FEEL`）之上再乘一層：

| 段 | 滾轉 `roll` | 升力 `lift` | 重量 `mass` | 功率 `power` 與阻力 `cd0` |
|---|---|---|---|---|
| 標準 | 1 | 1 | 1 | 1 |
| 強化 | 1.6 | 1.4 | 0.8 | 1.3 |
| 超強 | 2.2 | 1.9 | 0.6 | 1.6 |

- `power` 與 `cd0` 同倍率：高速平飛 `V_max³ ∝ power / cd0`。減重讓平飛的誘導阻力
  也跟著降，所以極速仍會微升（4,000 m 超強段 P-51D +0.5%、B-17G +1.4%）。
- 結構過載 `limits.gPositive` 不動：玩家的黑視從 7.5 G 起算，提高結構上限會讓
  畫面常態發黑。轉得快靠的是升力與重量把「能拉滿 G 的速度」壓低。
- `oswald` 不動：持續迴旋已經由重量與功率推上去。
- 標準段回傳**同一個輪廓物件**，套出來的 spec 與現在逐位元相同。

試算（`analysis/envelope.ts`，3,000 m；極速是 4,000 m）：

| P-51D | 標準 | 強化 | 超強 |
|---|---|---|---|
| 持續迴旋 °/s | 29.6 | 45.9 | 63.6 |
| 最大瞬間迴旋 °/s | 35.7 | 47.3 | 63.6 |
| 瞬間迴旋 °/s @400 km/h | 31.7 | 40.1 | 40.1 |
| 海平面爬升 m/s | 38 | 63 | 104 |
| 滾轉 °/s @400 km/h | 99 | 159 | 219 |
| 角落速度 km/h | 449 | 340 | 253 |
| 失速 km/h | 159 | 120 | 89 |
| 極速 km/h | 665 | 667 | 668 |

Bf 109 K-4 爬升 52 → 85 → 140 m/s；B-17G 爬升 9 → 15 → 26 m/s、持續迴旋 23 → 31 → 42 °/s。
400 km/h 的瞬間迴旋被結構過載（8 G）夾住，迴旋率的增幅出現在角落速度以下的慢速區。

## 資料流

```
SkirmishSetup.performance ──battleConfigFrom──▶ BattleConfig.performance
        │                                              │
   設定頁一格                         feeledSpec(cache, base, feels, performance)
                                                       │
                       applyFeel(base, withPerformance(feelFor(base, kind), performance))
```

- `specs/feel.ts`：`PerformanceLevel = 'standard' | 'boosted' | 'extreme'`、
  `PERFORMANCE`（三段倍率）、`withPerformance(feel, level)`。
- `BattleConfig.performance?`：省略 = 標準。任務卡不設，所以任務模式不變。
- `feeledSpec` 多吃一個 `performance`。**所有呼叫端都要傳同一個值**：快取是
  「base spec → 套過手感的 spec」，生成飛機與地上的飛機（`placeGround`）共用一張，
  任何一條路少傳，先寫進快取的那一份就會讓之後的增援、重生拿到錯的等級。
- `SkirmishSetup.performance`：預設 `'standard'`；`battleConfigFrom` 夾值，
  不是三段之一就落回標準。

AI 的迴旋表等快取以 spec 物件為鍵，開場各算一次，戰鬥中不增加成本。
AI 的能量判準多半是「速度 ÷ 自己的失速／角落速度」這種比值，會跟著飛機走；
超強段轉彎幾乎不掉能量，AI 打起來像不像樣交給試玩判斷。

## 介面

- `index.html` 的設定欄在「時段」之後加一格 `sk-perf`，標籤「飛機性能」。
- 三個選項：標準／強化／超強，提示各一句白話（不寫數字、倍率）。
- 每個選項一張 144×52 的小圖，放 `public/ui/skirmish-options/perf-*.webp`。
- 中英文字串都補。

## 測試（只測小部件）

- `withPerformance`：標準回傳同一個物件；強化／超強只改 `roll`、`lift`、
  `mass`、`power`、`cd0`，且 `power` 與 `cd0` 同倍率；`oswald` 不變。
- `feeledSpec`：給了 `performance` 時，套出來的 spec 等於
  `applyFeel(base, withPerformance(feelFor(base), level))`。
- `battleConfigFrom`：帶出 `performance`；非法值落回標準。
- 護欄用變異測試驗紅。

## 驗收

- `npx tsc --noEmit` 錯誤數不超過動工前的基準。
- 超強段跑一個小場景（無頭），確認物理不發散、AI 照常交戰、沒有成群撞地。
  Node 沒有 `Worker`，要用 `installRecoveryWorkerPortForTest(new RecoveryEngineTestPort())`
  注入改出預演，否則驗到的不是正式的 AI 改出流程。
- 瀏覽器開設定頁截圖，確認第四格與選單排版；手機寬度一併看。

## 實作步驟

1. `specs/feel.ts`：`PerformanceLevel`、`PERFORMANCE`、`withPerformance` ＋ 單元測試（先紅）。
2. `battleConfig.ts` 加 `performance?`；`flightSpawn.ts` 的 `feeledSpec`／`SpawnConfig`、
   `missionSpawns.ts` 的 `placeGround`、`createBattle.ts` 的呼叫一路帶下去 ＋ 測試。
3. `skirmish.ts`：`SkirmishSetup.performance`、`uniform` 預設、`battleConfigFrom` 夾值 ＋ 測試。
4. 介面：`index.html`、`menu.ts`、`menuSkirmish.ts`、i18n、三張小圖。
5. 變異測試、tsc、相關測試、無頭小場景、瀏覽器截圖。
