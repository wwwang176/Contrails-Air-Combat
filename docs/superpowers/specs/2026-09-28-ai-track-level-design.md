# 跟瞄時的機翼改平：改到轉彎所需的坡度（AI 與玩家）

## §1 問題

AI 咬住一架持續急轉的目標時，射擊解每秒開一下、關一下。

靶機情境（P-51 對 P-51，靶機被追到 400 m 內就以 4 G 持續急轉、機鼻追著 AI，150 秒）：

| | 射擊窗 | 不到 1 秒 |
|---|---|---|
| AI（現行） | 39 段 | 37 段（每段 0.3–0.6 s，幾乎每秒一段） |
| AI（只把改平關掉） | 6 段 | 1 段（最長一段 10.1 s） |

射擊窗＝`shouldFire`（不含點放）連續成立的一段，相隔 ≤ 0.3 s 併成一段。

短窗期間 AI 位在靶機後方 150–200 m、接近率約 0，`trackRatio` 0.55–0.66 —— 幾何上跟得住。

## §2 病因

逐步追蹤（`Aircraft.dbg`）：

- AI 的瞄準指令平順：每秒轉 15–16°，離預瞄點 0.2–0.4°。
- 飛機以 62–76° 的坡度持續轉彎在跟。
- 誤差一進 `wingsLevelFadeAngle`（2.5°）以內，改平的權限由 0 升到 0.98，要求以 −108°/s 滾回水平。
- 維持這個轉彎需要那個坡度。改平一動機首就落後，誤差長回 3° 以上，瞄準那一邊把坡度拉回去。
- 兩邊輪流接手，約 1 Hz 的極限環；開火錐 3°，射擊解跟著開關。

改平的前提是「機首對準之後，繞機首的滾轉不改變指向，坡度是自由的，放平」。瞄準點靜止時成立；瞄準點在轉時不成立 —— 坡度必須維持那個轉彎。

同一條路徑的「完美玩家」（每步把準星放在預瞄點上）也一樣：56 段裡 53 段不到 1 秒。玩家與 AI 一起修。

## §3 做法

### 3.1 改平的參考方向

現行改平的參考是世界上方：`bank = atan2(UP·右, UP·上)`，改平把它拉向 0。

AI 跟瞄時把參考換成**轉彎所需的升力方向**：

```
ω_aim  = 瞄準方向的角速度（世界座標，低通濾波，見 3.2）
a_req  = ω_aim × v                   把速度向量轉到跟著瞄準方向所需的法向加速度
D      = s·a_req + g·UP               升力要提供的（抵銷重力），s 見下
bank   = atan2(D̂·右, D̂·上)            D̂ = D/|D|；改平把它拉向 0
authority = hypot(D̂·右, D̂·上)          D 平行機首時退化，改平自然鬆手
```

- **縮放 s ∈ [0, 1]**：取最大的 s 使 `|s·a_req + g·UP| ≤ limiter.nLimit · g`。夾的是**總升力**（含重力支持），不是只夾 `a_req` —— 氣動上限 2 g 的飛機水平轉 2 g 要的是 √5 g。`nLimit ≤ 1` 時 s = 0。
- **|D| 為零**（升力需求恰好抵銷重力）時 authority 取 0，改平不出力。
- **逐位元相同**：`trackTurn = false` 走原本的運算，一個字不動。`trackTurn = true` 但 ω 為零向量時也直接走原本的 `WORLD_UP` 路徑 —— `atan2(g·x, g·y)` 與 `atan2(x, y)` 代數等價但末位不同。
- 只替換改平（`levelP` 與它的積分）用的參考；`upright` 的坡度夾制仍用世界上方。
- 暫存向量不得與 `bankAttitude` 的 `S.v[1]`、`S.v[2]` 共用；持續狀態預先配置。

### 3.2 瞄準角速度

```
raw  = (上一步的瞄準方向 × 這一步的瞄準方向) / dt
ω    = ω + (raw − ω) · (dt / (τ + dt))，τ = 0.2 s
```

- AI 的瞄準指令在決策拍（10 Hz）可能跳一下，玩家的滑鼠每一幀（60 Hz 上下）才動一次、中間幾個物理步不動；0.2 s 的低通把這些階梯壓成平滑的斜坡。
- **單一步跳超過 5°（`TRACK_JUMP`）當成不連續**：ω 歸零、這一步不微分。重生與接手時瞄準方向一步重設到機首、AI 換目標時一步跳走 —— 拿那一步微分會得到上百 rad/s，濾波後參考歪掉約 0.5 s，而那時機首剛好對準、改平是滿權限。跟目標的滑鼠每幀約 0.25°，甩滑鼠 360°/s 在 30 fps 也才 12°（那時誤差大、改平不出力，歸零無害）。
- 上一步 `trackTurn` 為 false（或剛 reset）時，這一步只記下瞄準方向、ω 歸零，不算角速度 —— 避免從關到開的第一步拿一個舊方向算出暴衝的角速度。
- 新增的狀態（上一步瞄準方向、ω、上一步的開關）進 `reset`；`copyStateFrom`／`writeState`／`readState` 不收 —— 預演一律 `trackTurn = false`（§4），用不到。

### 3.3 開關：`Command.trackTurn`

與 `Command.upright` 同一個模式（只有 AI 寫的一格）：

| 位置 | 做什麼 |
|---|---|
| `control/Controller.ts` | `Command.trackTurn: boolean`，`createCommand` 預設 false |
| `ai/delay.ts` | **跟瞄準方向一起進緩衝**（多一條 `Uint8Array`，讀同一格 `r`）；零延遲捷徑直接複製 |
| `world/World.ts` | 傳進 `aircraft.update` |
| `aircraft/Aircraft.ts` | `update(..., upright, trackTurn = false)` 傳給指揮儀 |
| `control/FlightDirector.ts` | `update(..., upright, trackTurn = false)` |
| `control/PlayerController.ts` | 每步寫 true —— 玩家的瞄準方向是世界固定的滑鼠準星，不是由自己的速度導出的，沒有 AI 那幾個要排除的分支 |
| `ai/AiController.ts` | 每步先清成 false；空戰路徑在「瞄準貼著預瞄點」時寫 true（見下） |
| `main.ts` | 交還操縱、接手新機時瞄準方向一步重設到機首，同時呼叫 `director.resetTrack()` —— 不到 5° 的重設 `TRACK_JUMP` 攔不到，會被微分成假的角速度 |
| `ai/safety.ts` | 任何接管（ground／terrain／overspeed／stall，也就是不是 `'none'`）時清成 false |
| `ai/recoveryRollout.ts`、`ai/recoveryWorker*`、`ai/recoveryProtocol.ts`、`tools/recoveryModel.ts` | 不傳（預設 false）；快照長度不變 |

**只在瞄準貼著預瞄點時開**：

```
trackTurn = intent ∈ {engage, approach, merge}
         && 有攔截解（basis.interceptTime ≠ NO_INTERCEPT）
         && ∠(raw.aimWorld, 預瞄方向) ≤ TRACK_TURN_CONE（10°）
```

- 有目標時的集合（intent 被覆寫成 rally）、脫離（`extend`）、找回速度（`speedRecover`）、卸載（`unloadAim`）都走同一個 `steerCommand` 呼叫點，而它們的瞄準方向由**自己的速度**導出：自己正在轉，瞄準方向跟著轉，新的參考會把它讀成「要維持這個轉彎」，抵銷卸載要的改平。以瞄準方向是否貼著預瞄點判定，這些分支自然排除。
- 對地、對艦、攻擊航路、站位、平飛不走這條路徑，每步清成 false 就排除了。
- 病只發生在誤差進 `wingsLevelFadeAngle`（2.5°）以內的跟瞄；10° 的錐把「正要咬上」的那一段也包進來，讓濾波在誤差變小之前就收斂。**起始值，由試飛裁定。**

## §4 不做

- 任何增益、門檻的重新定值。
- 射擊窗太短就脫離（另案，量完本案之後再評估）。

## §5 驗收

單元（`test/unit/`）：

1. `trackTurn = false`：與現行逐位元相同（同一串輸入，舵面輸出相等）。
2. `trackTurn = true` 而瞄準方向**從啟用起一直**靜止：與 false 逐位元相同（轉動過再停下來，濾波還有殘值，不要求相同）。
3. `trackTurn = true`、瞄準方向以固定角速度水平旋轉：改平的參考坡度等於協調轉彎坡度 `atan(v·ω/g)`（誤差在濾波收斂後 < 1°）。
4. 從 false 切到 true 的第一步 ω 為 0，不暴衝。
5. `PlayerController` 每步把 `trackTurn` 寫成 true；`safety` 接管時清成 false；`delay` 與瞄準方向同一格輸出。
9. 瞄準方向一步跳 30° 之後靜止：與 false 逐位元相同（跳的那一步不微分）。
10. 滑鼠式的階梯輸入（每 4 個物理步更新一次）跟轉動的目標：機首一樣停得住。
6. 總升力夾制：水平急轉的需求超過 `nLimit` 時，參考坡度停在 `acos(1/nLimit)`。
7. `|D| = 0` 時改平不出力、不出 NaN。
8. AI：瞄準貼著預瞄點才開；脫離、卸載、集合時關。

情境（探針，不進測試）：

- 4 G 急轉靶機：AI 的短窗由 37 段降到 ≤ 5 段。
- 其他靶機情境（迎頭、橫越、同向、同高、繞圈）不變差。

護欄：指揮儀既有的整套測試（L4 矩陣等）全綠 —— 它們跑的都是 `trackTurn = false`。
