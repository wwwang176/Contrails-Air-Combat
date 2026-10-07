# 倫內爾島警戒機制（PLAN）

SPEC：`docs/superpowers/specs/2026-10-08-rennell-alert-design.md`　分支：`feat/jp-m3-rennell`

每一項先寫測試、驗紅，再實作。熱路徑（`stepBattle` 每個物理步）不配置。

## 任務 1：停火旗標（World、艦砲、砲塔）

**檔案**：`src/world/World.ts`、`src/world/shipGuns.ts`、`src/world/turrets.ts`

- `World` 新增 `readonly holdFire = new Uint8Array(2)`，索引是 `teamSlot`（0 藍、1 紅），預設 0。
- `stepGunPlatform(ship, all, projectiles, flak, time, dt, fleet, holdFire = false)`、`stepTurrets(c, all, projectiles, time, dt, land, ships, holdFire = false)` 各加最後一個參數。
- 兩支裡 `trigger` 的那一行改成 `trigger = !holdFire && firingWindow && …`。**照常搜尋、照常追瞄、射速時鐘照常每步呼叫一次**（`trigger` 為 false 時的既有行為）。
- `World.step` 呼叫時傳 `this.holdFire[teamSlot(c.team)] === 1`（砲塔）、`this.holdFire[teamSlot(s.team)] === 1`（船與地面砲位）。

**測試**（`test/unit/` 既有的 shipGuns／turrets 測試旁）：

- 一艘紅船、一架藍機在射程內：`holdFire = true` 跑幾步，彈丸池與高砲池都沒有新的；改回 false 後有。
- 一架帶砲塔的藍機、一架紅機在射程內：同上。
- 省略參數時行為與現在相同（既有測試全綠）。

## 任務 2：卡片與設定的欄位

**檔案**：`src/battle/missions/types.ts`、`src/battle/battleConfig.ts`、`src/battle/missions/configuration.ts`

```ts
// types.ts（MissionBattle）
/** 有這一格才有警戒（SPEC §4）。警戒前紅方戰鬥機巡邏、艦砲與藍方砲塔停火 */
readonly alert?: MissionAlert
/** 藍方開場的高度範圍與左右間距（SPEC §4.4）。只動藍方 */
readonly blueSpawn?: { readonly altitudeMin: number; readonly altitudeMax: number; readonly spacing: number }

export interface MissionAlert {
  readonly messageKey: string
  /** 巡邏線兩端離艦隊中心的左右距離，m */
  readonly patrolHalfWidth: number
  readonly patrolAltitude: number
  /** 到端點多近算到達、折返，m（水平距離） */
  readonly patrolRadius: number
}
```

- `BattleConfig` 加 `alert?: MissionAlert`；`missionConfigFrom` 明列透傳（省略時連鍵都不放）。
- `blueSpawn` 在 `missionConfigFrom` 裡處理（任務 3），不進 `BattleConfig`。

**測試**：`missions.test.ts` 加一條：`japan-m3` 的設定帶著 `alert`，其他卡片都沒有。

## 任務 3：藍方開場的高度與間距

**檔案**：`src/battle/order.ts`（新函數 `spreadBlue`）、`configuration.ts`

```ts
export function spreadBlue(
  units: OrderOfBattle, spawn: { altitudeMin, altitudeMax, spacing },
  altitude: number, schwarmSpacing: number,
): OrderOfBattle
```

- 藍方小隊依編組表順序編號 i = 0…n−1（`soloBombers` 之後，一架一隊）。
- `lane = (i − (n−1)/2) × spacing / schwarmSpacing`、`depth = 0`、`slide` 拿掉。
- 高度：`tier = 2`（鋸齒 `altitudeOffset(2, ·) = 0`，與 spread 無關），`rise = y_i − altitude − entry.climb`，`y_i = altitudeMin + (altitudeMax − altitudeMin) × i / (n−1)`（n = 1 時取中點）。
- 只有藍方、而且只有全是單機小隊時才套；有多機小隊就拋錯（站位偏移會破壞間距，寫錯的卡要炸出來）。
- `player` 旗標原樣保留。紅方小隊原樣。
- `missionConfigFrom`：`b.blueSpawn` 存在時對 `soloBombers(...)` 的結果再套一次。

**測試**（`order.test.ts` 或新檔）：

- 11 架：高度都在 [200, 300]、端點恰為 200 與 300、相鄰左右間距 = 400、玩家恰一架、紅方逐位元不變。
- 經 `unitFrame` 算出來的開場高度與 `y_i` 相同（鋸齒歸零的保證）。
- 有多機藍方小隊時拋錯。

## 任務 4：警戒狀態與掃描

**新檔**：`src/battle/alert.ts`；**修改**：`battleState.ts`、`createBattle.ts`、`battleRuntime.ts`

```ts
export const ALERT_ALTITUDE = 500
/** G4M 機槍（九二式 7.7 mm）的射程：745 m/s × 1.2 s ≈ 894 m，取整 */
export const ALERT_RANGE = 900

export interface AlertState {
  readonly spec: MissionAlert
  alerted: boolean
  timer: number
  /** 依紅方長機座位索引：+1 往右端、−1 往左端 */
  readonly legs: Int8Array          // 長度 64
  readonly initialLegs: Int8Array
  /** 依紅方長機座位索引的巡邏命令，建立時配好 */
  readonly orders: (FlightOrder | null)[]
}
```

- `alertTriggered(combatants, ships, projectiles, torpedoes, bombs): boolean` —— 純函數：
  1. 活著的藍機 `y > ALERT_ALTITUDE`；
  2. 活著的藍機與活著的紅機、或活著的紅船（`ship.position`），三維距離 `< ALERT_RANGE`；
  3. 彈丸池有 `owner !== −1 && team === 0` 的一格；魚雷池、炸彈池有 `active && team === 0`；
  4. 紅機 `hp < spec.hp`、或紅船 `hp < cls.hp`。
- `stepAlert(b, dt)`：`b.alert === null` 或已警戒就只更新巡邏（見任務 5）並返回；否則 10 Hz 計時器（`AI_DECISION_HZ`，同 `stepPressure`），到點時呼叫 `alertTriggered`。成立：`alerted = true`、`world.holdFire.fill(0)`、`b.message = spec.messageKey`。
- `Battle` 加 `alert: AlertState | null`。
- `createBattle`：`cfg.alert` 有值就建 `AlertState`、`world.holdFire.fill(1)`；沒有就 `null`、`holdFire` 維持 0。
- `resetBattle`：有 `alert` 就 `alerted = false`、`timer = 0`、`legs.set(initialLegs)`、`holdFire.fill(1)`。
- `stepBattle`：`stepAlert` 排在 `stepBeats` 之後、`stepCommandLayer` 之前 —— 同一步觸發，同一步就把命令交回指揮官。

**測試**（`alert.test.ts`，假的 combatant／ship／池子）：

- 四種條件各一條成立、各一條差一點不成立（499 / 501 m，899 / 901 m）。
- 死掉的藍機、死掉的紅機、沉掉的紅船不算。
- 紅方的子彈不算；彈丸池空槽（`owner −1`）不算。
- `stepAlert`：觸發後 `holdFire` 歸零、訊息寫入；之後條件不成立仍維持警戒；`b.alert === null` 時什麼都不動。
- `resetBattle` 之後回到未警戒、`holdFire` 為 1。

## 任務 5：F4F 巡邏

**檔案**：`alert.ts`（`stepPatrol`）、`commandLayer.ts`

- `stepPatrol(b)`（`stepAlert` 每步呼叫，未警戒時才做）：
  - 艦隊中心 = 活著的紅船位置的平均（暫存向量，不配置）；沒有活船時用 `cfg.fleet.center`。
  - 對每個紅方小隊：長機座位 `s = flight.members[0]`；端點 = 中心 + (`legs[s]` × `patrolHalfWidth`, 0, 0)，`y = patrolAltitude`；寫進 `orders[s].point`。長機與端點的水平距離 `< patrolRadius` 就 `legs[s] = −legs[s]`。
  - `orders[s]` 是建立時配好的 `{ kind: 'rally', point, radius: patrolRadius, targetFlight: −1, side: 0, focusIndex: −1 }`。
  - `initialLegs`：紅方小隊依建立時的順序交替 −1、+1（兩隊反方向，覆蓋比較廣）。
- `commandLayer.ts` 發命令那一段：

  ```ts
  const patrolOrder = flight.team === 'red' && b.alert !== null && !b.alert.alerted
    ? b.alert.orders[flight.members[0]!] ?? null : null
  const order = convoyOrder ?? evacOrder ?? patrolOrder ?? state.orders[f] ?? null
  ...
  ai.transit = convoyOrder !== null || patrolOrder !== null
  ```

- **長機換人**（長機陣亡、壓縮後換成別人）：新長機座位的 `orders` 為 null 時當場配一張（只在建立時與換人時配置，不是每步）—— 或建立時就為每個紅方座位都配好。**取後者**，64 張以內、只在 `createBattle` 配一次。

**測試**：

- 未警戒：紅方 AI 拿到 `rally` 命令、`transit === true`、端點在艦隊中心左右 `patrolHalfWidth`；長機進入半徑後端點換邊。
- 警戒後：紅方回到指揮官的命令、`transit === false`。
- 藍方不受影響。
- 接線護欄（讀原始碼，同 `audio-wiring.test.ts` 的寫法）：`stepBattle` 裡 `stepAlert` 在 `stepBeats` 之後、`stepCommandLayer` 之前。

## 任務 6：卡片與文案

- `japan-m3`：

  ```ts
  alert: { messageKey: 'mission.japan-m3.alert', patrolHalfWidth: 5000, patrolAltitude: 800, patrolRadius: 500 },
  blueSpawn: { altitudeMin: 200, altitudeMax: 300, spacing: 400 },
  ```

  `altitude: 1000` 留著（紅方開場高度用）。註解寫現狀與理由（SPEC §2 的史實、500／900 的出處）。
- `i18n/zh.ts`：`'mission.japan-m3.alert': '進入警戒狀態'`；`en.ts`：`'Enemy alerted'`。

**測試**：

- 用 `missionConfigFrom(japan-m3)` 建一場（`createBattle`）：開場時 `alertTriggered` 為 false（SPEC §4.4 的保證）、`holdFire` 兩隊都是 1。
- i18n 的既有護欄（兩語系鍵一致）會涵蓋新鍵。

## 任務 7：驗收

- `npx tsc --noEmit` 錯誤數不增加；相關測試全綠；合併前整層（`--maxWorkers=4 --minWorkers=1`）。
- 最小情境（探針，不進測試）：建 `japan-m3`，把一架藍機抬到 600 m → 下一次掃描觸發；另一場讓一架藍機貼海直飛最近的船 → 距離 < 900 m 時觸發。
- Playwright：開 `japan-m3`，截 F4F 巡邏、觸發訊息兩張圖給負責人。

## 不動

AI 陸攻、F4F 的戰鬥邏輯、擊沉條件、其他關卡（沒有 `alert` 的卡片 `holdFire` 恆為 0、不建 `AlertState`）。
