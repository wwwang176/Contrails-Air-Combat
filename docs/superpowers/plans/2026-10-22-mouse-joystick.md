# 滑鼠搖桿操控（PLAN）

SPEC：`docs/superpowers/specs/2026-10-22-mouse-joystick-design.md`
分支：`feat/mouse-joystick`

每一項先寫測試、確認紅，再實作到綠。型別檢查基準：`npx tsc --noEmit` 0 個錯誤（2026-10-22 量）。

## T1 核心：`Command` 四格與所有控制器

檔案：`src/control/Controller.ts`、`PlayerController.ts`、`ScriptedController.ts`、
`src/ai/AiController.ts`、`src/main.ts`（演練靶機）、`src/tools/range.ts`

- `Command` 加 `manual`、`stickRoll`、`stickPitch`、`stickYaw`；`createCommand` 給 false／0
- AI、腳本靶機、演練靶機、工具頁：每步寫 `manual = false`、三軸 0
- 測試：`controllers.test.ts` 的「接手既有命令」把四格加進 `Object.assign`（`manual: true`、三軸 1），
  先紅；`AiController` 同一類測試若有就一起補（`load-controller.test.ts`、`ai-bombing.test.ts` 看過再定）

## T2 核心：`FlightDirector.updateManual` 與模式切換

檔案：`src/control/FlightDirector.ts`

- 把 `update` 結尾的內環（`actualP/Q/R` 與三個 PID）抽成私有 `inner(state, dt, out, dbg)`，
  兩個模式共用
- 限制器那一段（`gLoad`、`pitchRateLimit`、`nNeg`、`qMin`）抽成私有方法，兩個模式共用
- `updateManual(spec, state, aero, slatsDeployed, stick, dt, out, dbg)`：照 SPEC 4.3
- `manualPrev` 旗標；換模式的那一步清外環積分、`pushMode`、`lastRollCommand`、`resetTrack()`
- `reset()` 一併清 `manualPrev`
- 測試（新檔 `test/unit/manual-stick-director.test.ts`）：SPEC §7 第 1、3 條。
  既有的 `flight-director` 系列測試要全綠 —— 抽方法不得改變自動模式的任何一個數字

## T3 核心：`Aircraft.update` 接 `manual`、`World` 傳進去

檔案：`src/aircraft/Aircraft.ts`、`src/world/World.ts`

- `update(..., pull = false, manual: ManualStick | null = null)`：非 null 時呼叫 `updateManual`
- `World.step`：`c.command.manual ? c.command : null`
- 測試：SPEC §7 第 2 條（飛起來的三個案例），寫在同一個新檔；`World` 的接線用一個小案例
  （玩家席的指令 `manual = true`、滾轉滿桿，一秒後坡度往右）

## T4 輸入：搖桿狀態、曲線、方向舵

檔案：新檔 `src/input/mouseStick.ts`；`InputState.ts`、`bindings.ts`、`holdState.ts`

- `mouseStick.ts`：
  - `STICK_GAIN`、`STICK_RECENTER`（`off`／`slow`／`fast` → ∞／0.8／0.12 s）、`STICK_DEADZONE`、`STICK_EXPO`
  - `stepStick(input, dx, dy, dt)`：累積、夾單位圓、回中（`dt = 0` 不動）
  - `shapeStick(x, y, out)`：死區（徑向）＋指數曲線，寫進 `out`，不配置
- `InputState` 加 `controlMode: 'aim' | 'stick'`、`stickRecenter`、`stickX`、`stickY`、
  `rudderLeft`、`rudderRight`
- `bindings.ts`：A／D 在 `controlMode === 'stick'`、非上帝視角時寫方向舵；keyup 兩邊都清
- `clearInputHolds`：清方向舵
- 測試：`test/unit/mouse-stick.test.ts`（累積、夾、回中三檔、暫停、曲線端點與單調、死區），
  `bindings.test.ts` 補 A／D 三條

## T5 `PlayerController` 寫搖桿指令

- 讀 `controlMode`、`stickX/Y`、方向舵；搖桿模式下 `manual = true`，三軸照 `shapeStick`；
  方向舵 `rudderRight − rudderLeft`
- `PlayerInput` 型別多那幾格
- 測試：`controllers.test.ts` 兩條（搖桿模式寫 `manual` 與三軸；瞄準模式 `manual = false`）

## T6 `playerControl` 分派

檔案：`src/app/playerControl.ts`；依賴多一個 `touch: Pick<TouchControls, 'visible'>`

- 有效模式 = `touch.visible ? 'aim' : input.controlMode`。`PlayerController` 讀的是 `input`，
  所以有效模式要寫回一格 `input.stickActive`（每幀寫），控制器讀它而不是讀 `controlMode`
- 一般飛行分支：`stickActive` 時 `stepStick` 吃掉 `aimDeltaX/Y`、`aimWorld` = 機首、
  瞄準輔助 reset；投彈分支同樣（不呼叫 `slewAimWorld`）
- 交還控制器、陣亡那一幀、有效模式換了：搖桿與方向舵歸零
- `centreStick(input)`（`input/mouseStick.ts`）；`main.ts` 的 `respawnPlayer` 呼叫它
  （新的一場與兩種重開都經過那裡）
- `holdIntroInput`（`src/app/missionIntro.ts`）清掉 `stickX/Y`、方向舵
- 測試：`test/unit/player-control.test.ts` 有就補，沒有就新開（SPEC §7 第 6 條）

## T7 設定頁與存檔

檔案：新檔 `src/input/controlPreferences.ts`；`src/ui/menuSettings.ts`、`index.html`、
`src/main.ts`、`src/i18n/zh.ts`、`en.ts`、選單組裝處（`createMenuSettings` 的元素表）

- `controlPreferences.ts`：`CONTROL_MODES`、`STICK_RECENTER_LEVELS`（label 鍵與值）、
  讀寫 `localStorage`（不認得的值當成沒設定）
- 設定頁兩列；回中列在 `draftMode === 'aim'` 時 `disabled`；`onControl(mode, recenter)` 一個 hook
- `main.ts`：開場讀存檔寫進 `input`、hook 寫回 `input` 並存檔、`renderControl`
- i18n：`settings.control`、`settings.control.aim`、`settings.control.stick`、`settings.recenter`、
  三個回中檔名、`hud.keysStick`
- 測試：`menu-settings` 既有測試的檔案補兩列的草稿／確定／取消／預設／disabled；
  `control-preferences.test.ts` 讀寫

## T8 HUD

檔案：`src/hud/types.ts`、`src/hud/widgets/reticle.ts`（或新 widget `stickGauge.ts`）、
`src/hud/widgets/hints.ts`、`src/app/battleFlightHud.ts`、widget 排程處

- `HudFrame` 加 `stickMode`、`stickX`、`stickY`
- `battleFlightHud`：`stickActive` 時 `aimVisible = false`，填搖桿位置
- 搖桿指示：中央細圓環＋點，點吃失速比的顏色；只在 `stickMode`、非上帝視角、非代飛時畫
- `hintKeys(godView, stick)`：搖桿模式回 `hud.keysStick`
- 測試：`hud.test.ts` 的假 ctx 補搖桿指示（畫在中央、點的位置、顏色）、`hintKeys` 三種

## T9 量測出口

`main.ts`：`__stick()`／`__stick(x, y)`（SPEC §6）

## T10 E2E

`test/e2e/mouse-joystick.e2e.ts`：SPEC §8。截圖存 `.shots/stick-*.png`。

## 驗收

1. 相關單元測試全綠；最後整套 `npx vitest run test/unit --maxWorkers=4 --minWorkers=1`
2. `npx tsc --noEmit` 不多於基準
3. i18n 護欄（含著色器註解那一條）綠
4. E2E 全部通過，截圖給負責人看搖桿指示
5. Codex 審查兩輪（PLAN 之後、實作之後）
