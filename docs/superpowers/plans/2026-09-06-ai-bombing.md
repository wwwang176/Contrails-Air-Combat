# AI 投彈的實作計畫

Spec：`docs/superpowers/specs/2026-09-06-ai-bombing-design.md`
分支：`feat/ai-bombing`（從 `main` 的 `4025345` 開出）

基準線：`npx tsc --noEmit` 恰好 23 行。每一個 Task 結束時都要回到 23。

---

## T1 `Command.bombing`

`src/control/Controller.ts`

- `Command` 加 `bombing: boolean`
- `createCommand()` 補 `bombing: false`
- **`CommandDelay.push` 直通這一格**（見 C1）

【為什麼與 `firing` 分開】陸攻要能一邊由砲塔自衛一邊投彈。合成一格的話
「開火」與「投彈」互斥，而它們在同一台飛機上是兩套武器。

驗收：`tsc` 23 行。`createCommand()` 的預設是 false（新測試）。

---

## T2 `Combatant.bombBay`

`src/world/World.ts`

- `Combatant` 加 `bombBay: BombBay`（不是 readonly）
- `add()` 建的時候 `createBombBay(bombBayOf(spec.id))`
- `setSpec()` 跟著 `resetBombBay(c.bombBay, bombBayOf(spec.id))`

【放在 `setSpec` 的哪裡】那一段已經在處理 `cooldowns`、`muzzleFlash`、
砲塔三個「換機種會變長度」的陣列。彈艙是第四個，寫在同一段裡。

驗收：換裝機種之後彈艙容量跟著變、載彈滿（新測試，變異：把 `setSpec` 那一行
拿掉，測試要紅）。

---

## T3 `World` 在物理步裡執行 AI 的投彈

`src/world/World.ts`

- `step()` 在開火那一段（673 行 `c.command.firing`）旁邊加一段
- 玩家那一架**跳過** —— 它走 `main.ts` 的幀迴圈那條路，兩邊都投會變兩倍
- `stepBombBay(c.bombBay, dt, c.command.bombing, drop)`，`drop` 呼叫
  `this.dropBomb(質心, 速度, bombDamageOf(spec.id))`

【玩家怎麼認出來】`World` 不知道誰是玩家（既有的設計，見 `damageEvents`
的註解）。所以不是 `World` 認人，而是**玩家的控制器不寫 `bombing`** ——
`PlayerController` 恆寫 false，投彈仍然由 `main.ts` 發動。

【熱路徑零配置】`drop` 不能是每步新建的箭頭函數。與 `onBombImpact` 同一個
手法：綁在實例上的欄位，配一次。要傳的那一架用一個私有欄位帶。

驗收：AI 投得出彈（新測試）。四份重播護欄不變。

---

## T4 轟炸航路的解算

`src/ai/bombRun.ts`（新檔）

```ts
export const BOMB_RUN_RANGE   // 多遠開始進場
export function deckHeightOf(cls: ShipClass): number
export function releaseRadiusOf(cls: ShipClass): number   // = 2 × hull.half.x
export function shipAt(ship: Ship, t: number, out: Vector3): Vector3
export function shouldRelease(self, ship, k, dt): boolean
export function bombRunCommand(self, ship, out: Command): void
```

【為什麼是新檔不是塞進 `shipAttack.ts`】那一支已經 200 行，而且它的主題是
掃射與索敵。投彈是另一件事，只共用「哪一艘船」。

【`solveImpact` 的 `groundAt` 怎麼給】它收的是函數，而熱路徑不得配置。
用模組層級的可變數 + 一個常駐閉包：

```ts
let deckY = 0
const DECK = (): number => deckY
```

驗收（spec §7.2、§7.3）：

- 定高定速直線飛過靜止的弗萊徹 → 投得出來、落點在船體盒內
- **變異**：`shipAt` 改成回當下位置（不外推）→ 落點必須偏出去

---

## T5 `shipAttack` 依彈艙分流

`src/ai/AiController.ts`

- `attackShip` 裡，`bombBayOf(spec.id) > 0` 的走 `bombRunCommand`
- 否則維持 `shipAttackCommand`

【瞄的東西也不同】掃射瞄最近的活砲位，轟炸瞄船的預測位置。所以
`pickShipTarget` 挑到的 `gun` 對轟炸沒有意義 —— 轟炸只用 `ship`。

驗收：G4M 走轟炸、P-51 走掃射（新測試，兩條）。`ai-controller` 與
`ai-target` 不變。

---

## T6 回歸與驗收

- `npx tsc --noEmit` 23 行
- 四份重播護欄 + `ai-controller` + `ai-target`
- 單元全跑（`perf-gate` 除外，它要單獨跑）
- 決定性：同一場兩次，`bombs.dropped` 與落點逐位元相同
- 試飛 `japan-m4`：問專案負責人 AI 準到什麼程度合適，`releaseRadiusOf`
  是唯一的旋鈕

---

## Codex 審查（2026-09-06）補進來的七條

審查在**實作之前**跑，七條都附了實跑證據。其中兩條會讓這個功能**完全不
動作而且不報錯**。

### C1 `bombing` 要繞過 `CommandDelay`，而且每步先歸零

`ai/delay.ts` 的零延遲與緩衝兩條路徑都只複製 `aimWorld/throttle/brake/
firing` —— 探針實跑：輸入 true、輸出 false。**AI 一顆都投不出來。**

**但不是補一行複製就好。** 反應延遲模型的是「看到→動作」的遲滯，而投彈的
判準是 AI 對**自己此刻的彈道**算出來的。延遲 0.3 s 之後飛機已經走了 27 m
（90 m/s），大於 Fletcher 的 12.08 m 釋放半徑 —— 每一顆都會系統性地落在
船尾之後。所以 `bombing` **直通，不進緩衝區**。

`raw` 是長存物件，別的航路不寫這一格會殘留 true（探針也驗了）。所以
`update()` 每一步開頭先 `raw.bombing = false`。

### C2 轟炸機的對艦仲裁要排到空中接戰與站位之前

`AiController.ts:557` 把整個對艦分支包在 `if (!target)` 裡，`:588` 的站位
又排在 `:599` 的 `attackShip` 前面。探針實跑 `japan-m4` 48 步：**五架 AI
一式陸攻的 `shipAim.ship` 全是 −1** —— #0 選了空中目標，其餘四架有站位參考。

轟炸機出擊就是為了炸船，空中目標與編隊都不該蓋過它。新的優先序**只對
有彈艙的機種成立**：

```
有彈艙 且 有活的敵艦在接戰半徑內  →  轟炸航路（最優先）
其餘                              →  維持原本的仲裁
```

### C3 彈艙只能有一份

`main.ts:329` 有模組級的玩家彈艙，`Combatant` 又有一個。玩家投完按 `I`
代飛，AI 拿另一個滿艙再投；而 `main.ts:1319` 明寫代飛時既有連投會繼續 ——
兩條路可能同時投。

**改法：`main.ts` 不再自己持有，改用 `player.bombBay`。** 投彈仍然在幀
迴圈（spec §一排除了搬進物理步），但庫存只有一份。

### C4 `World.respawn()` 要重設彈艙

「再打一場」不重建 World。探針把彈艙設成 `{load:0, queue:3, timer:7,
reloading:true}`，respawn 後四個值完全不變。

### C5 `applySafety` 的兩個接管分支要關掉 `bombing`

`safety.ts:380` 與 `:397` 只關 `firing`。實跑低空下沉狀態拿到
`{action:"ground", firing:false, bombing:true}` —— 炸彈會在已經偏離解算
航路時放出去。

### C6 `solveImpact` 不能從進場就每拍跑

spec §4.1 引用的「便宜到不必省」是**單一準星**的估算。實測單次
1,000 m 57.9 µs、4,000 m 123.4 µs、8,000 m 188.3 µs；40 架 × 10 Hz 攤到
物理步是 +96／+206／+314 µs。現有 20v20 是 248 µs，合起來 329～552 µs，
**超過 300 µs 的設計預算**。而現有的 perf gate 量不到 —— 那兩個場景都
沒有艦隊。

改法：**`solveImpact(1/240)` 仍然是最終釋放判準**（不能分家），但前面加
一道便宜的幾何閘 —— 只有在「有可能投得到」的走廊裡才跑精確解。8 km 外
進場的那一大段完全不解算。

### C7 船寬取 `hull[0]`

`ShipClass.hull` 是陣列。Essex 主艦體寬 28.4 m、飛行甲板 43 m，照甲板高度
那樣取最大值會讓釋放半徑放大 51%。

---

## 已知的坑

1. **玩家與 AI 兩條投彈路徑並存。** T3 的註解要把「為什麼不統一」寫清楚：
   統一要把玩家的投彈搬進物理步，而那會改掉 `bombPoint` 對準星的意義。
   這一輪不動。
2. **`bombs` 池只有 64 格。** 六架 G4M × 2 枚 = 12，加玩家 2 枚，離滿還遠。
   但 B-17 十枚 × 四架 = 40 —— 對地轟炸那一輪要重新看。
3. **AI 不知道彈艙空了。** `stepBombBay` 在回補期間吃掉扳機，所以 AI 會
   持續要求投彈而沒有反應。行為上是對的（它繼續繞），但如果試飛看起來像
   「一直飛過去卻不投」，成因在這裡。
