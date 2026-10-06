# Ju 87 的 AI 俯衝投彈：實作計畫

規格：`docs/superpowers/specs/2026-10-02-stuka-dive-bombing-design.md`

順序：先量基準 → 規格欄位 → 純函數 → 相位機 → 接進 `AiController` → 探針 → 遊戲內連拍。
每一步先寫測試、親眼看它紅，再實作。

## 0. 動工前的基準

- `npx tsc --noEmit` 的輸出行數記下來，改完比對有沒有增加（不寫死數字）。
- 跑一次相關測試當綠燈基準：`ai-bombing`、`ai-strike-lock`、`ai-strike-sticky`、`ai-strike-target`、
  `ai-ground-strafe`、`ground-battle`。
- 量一次舊行為留底：`test/tools/ju87-ai-dive.probe.ts`（投彈 4 次、離地 1.6 km、航跡角 −0.6°）。
- **寫 `test/tools/dive-bomb-baseline.probe.ts` 並在動 `AiController` 之前量一次留底**：德 M4 的藍隊換成
  He 111、G4M、B-17、P-51D、Bf 109 各跑 60 秒，輸出每架每秒的位置與指令摘要。`strike-replay-baseline`
  的兩個場景沒有地面目標，覆蓋不到對地。

## 1. 規格欄位 `diveBomber`

- `src/specs/types.ts`：`AircraftSpec` 加選填 `diveBomber?: true`，註解寫它的意思與誰讀它。
- `src/specs/ju87.ts`：`diveBomber: true`。
- 測試 `test/unit/dive-bomber-flag.test.ts`：掃全部機種表，只有 `ju87` 是 `true`，其餘 `undefined`。
  先紅（欄位不存在）。

## 2. 純函數與常數（`src/ai/diveBomb.ts`）

- 常數照規格 §4.4，每個都有一行「是什麼、壞了會怎樣」的註解。
- `diveEntryRange(h, tas)`。
- `pickDiveTarget(selfPos, team, targets, range, rank)`：排序與 `pickGroundTarget` 相同
  （價值優先、同價值比距離），取第 `rank` 名、不夠取最後一名；熱路徑，不配置（兩趟：先數再取，
  不建陣列）。
- 測試 `test/unit/dive-bomb.test.ts`：規格 §6 的前兩項與 `pickDiveTarget`。

## 3. 相位機

- `DiveBombState`、`createDiveBombState`、`resetDiveBomb`、`stepDiveBomb(state, self, target, loaded,
  decide, out)`。狀態含相位、鎖定的瞄準點、鎖定的目標（物件身分，換目標時不沿用）。
- 模組私有的暫存向量，熱路徑不配置。
- 測試（同檔）：規格 §6 的相位轉換、夾制、投彈、鎖定瞄準點、減速板。用 `new Aircraft(JU87)`
  直接擺位置、速度與姿態。

## 4. 接進 `AiController`

- 欄位 `readonly diveBomb = createDiveBombState()`、getter `diveBombPhase`（探針與測試讀）。
- 新方法 `diveBombGround(self, dt, out, onlyUnit)`：挑目標（共用基準點＝長機位置、名次＝`selfIndex mod 4`，
  只在 level／egress 重挑）、呼叫 `stepDiveBomb`；俯衝與拉起中沒有目標也要呼叫。
- 兩個入口：`attackShip`（規格 §4.1，位置在取得 `me` 之後、`pickShipTarget` 之前）與 `strafeGround`
  （戰鬥機或 `diveBomber` 才進，`diveBomber` 交給 `diveBombGround`）。
- `clearTerrainState` 加 `resetDiveBomb(this.diveBomb)`。
- 測試（`dive-bomb.test.ts` 的接線一節）：規格 §6 的接線四項。把分支條件改成永遠真，其他機種那幾項要紅。

## 5. 探針與調參

- `test/tools/ju87-dive-proto.probe.ts` 改接真的 `AiController`（接線照
  `ju87-ai-dive.probe.ts`），三個種子各跑 240 秒。
- 驗收：俯衝航跡角 70～85°、滾轉接近 0、最低離地 ≥ 100 m、安全層不介入（`safetyAction`）、藍隊
  沒有墜毀、至少兩輪俯衝。不過就調規格 §4.4 的起始值（調的是 `diveBomb.ts` 的常數，不是門檻）。
- 對照：`dive-bomb-baseline.probe.ts` 的輸出與動手前留底逐位元相同；`strike-replay-baseline` 照舊。
- 驗收要看**真的投出去**：統計彈艙真的減少（`bombBay` 的存量）與落地事件，不是只看投彈指令。

## 6. 遊戲內驗收

- Playwright 開德 M4、上帝視角追一架 AI Ju 87，連拍壓機鼻、俯衝、投彈、拉起，給負責人看。
- 沒有 console 錯誤；幀率不受影響（沒有新的配置、沒有彈道解算，比水平轟炸便宜）。

## 7. 收尾

- `npx tsc --noEmit` 與基準比對；相關測試與 `i18n-guard` 全綠；整套單元測試一次（`--maxWorkers=4`）。
- 護欄逐一弄壞驗過會紅（用編輯工具改、用編輯工具改回來）。
- Codex 審查（實作完一輪）；只收查證過的缺陷。
- commit（功能分支，只 commit 不 push）；探針檔一併提交。
