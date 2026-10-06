# 盟 M4 —— 零戰整隊殲滅後整隊重生

2026-09-09

## 1. 要做的事

盟 M4 的紅方改成**席位回收**：開場十六架零戰分四支小隊進場，任何一支被殲滅
之後過幾秒在進場航路整隊重生，最多重生六批；一式陸攻不再看時鐘，改在
**第五批重生時一起進場**。

```
  席位   紅方 20：零戰 16（四支小隊）+ 陸攻 4（預留）    藍方 4
  出擊   零戰 16 + 6 × 4 = 40 架次，陸攻 4
  贏     六批用完、陸攻到場之後紅方歸零
  輸     航母沉沒，或藍方全滅（不變）
```

負責人裁定：

1. 粒度是**整支小隊全滅才整隊重生**，不補半隊
2. 最多重生六批
3. 陸攻跟著第五批重生一起進場
4. 限時防守這一輪不做

## 2. 為什麼是回收席位，不是拉高 `MAX_SIDE`

同時在場的架數才是成本；重生之後在場的零戰不超過 16，與現在相同。拉高
`MAX_SIDE` 的話自訂對戰的滑桿跟著開到 56 對 56，而效能護欄只量過 20v20。

回收席位不動任何容量：`killEvents`、`damageTime`、特效池、殘骸池都按席位配，
紅方仍是 20 席。

## 3. 現有的東西

| 已有 | 在哪 | 可以直接用 |
|---|---|---|
| `World.respawn(c)` | `World.ts` | 血量、冷卻、砲塔、彈艙、傷害紀錄一次清乾淨，`alive = true` |
| 方位與速度抄回 | `resetBattle`（`setup.ts`） | 六行；抽成函數與重生共用 |
| `compactFlights` | `flights.ts` | 每步從存活旗標重算，復活的席位自動歸隊 |
| 站位幾何 | `spawnMember` | 出生點就是站位；抽出「算位置」那一段 |
| 波次的進場座標框 | `waveBeat`／`unitFrame` | 方位旋轉、橫向槽位、高度鋸齒 |
| 指揮板 `u.alive` | `refreshCommandUnits` | 每步同步 |

**不用 `respawnOnDestroy`**：那條路在 `destroy` 裡提前 return，沒有擊墜事件、
沒有爆炸、沒有殘骸、不記功。重生走正常的 `destroy`，事後才復活。

## 4. 卡片怎麼寫

`MissionCard.battle` 多一格 `recycle`。它不是波次 —— 波次是「一支預留的小
隊進場一次」，回收是「開場的小隊死光之後再來」，兩者的席位來源不同。

```ts
recycle: {
  side: 'theirs', role: 'fighter',
  batches: 6,
  warn: '雷達發現更多零戰', warnLead: 5,
  starboard: 45 * DEG,           // 選填，同波次
}
```

陸攻那一個波次的觸發改成新的一種：

```ts
when: { kind: 'batch', at: 5 }   // 第五批重生預警時一起預警
```

零戰原本的兩個波次（第二、三批）刪掉。`redCount` 維持 16，紅方席位
16 + 4 = 20 = `MAX_SIDE`。

### 4.1 `batch` 觸發沒有 `byLatest`

第五批一定到得了：每一批的零戰都是被防空砲打掉的（卡片註解裡的實測），而
批數只增不減。批數到不了五的情形只有藍方全滅或航母沉沒，那兩條都已經判輸。
**這一點負責人裁定**：要兜底的話補一個 `byLatest` 就好，不動結構。

## 5. 引擎怎麼做

### 5.1 節拍多一種

```ts
interface RecycleBeat {
  kind: 'recycle'
  team: Team
  role?: AircraftSpec['role']
  batches: number
  warn: string
  warnLead: number
  /** 重生用的進場座標框，同 `ReinforceBeat.flight.entry` */
  entry: SideEntry
}
```

`BeatCondition` 多一種 `{ kind: 'batch', at: number }`：回收的批數（已預警的）
達到 `at` 即成立。

### 5.2 狀態

`Battle` 多兩格，建構期配好：

- `reviveAt: Float64Array(flights.length)`，−1 = 這支小隊沒有在等重生
- `batches: number`，已預警的批數

一支小隊被殲滅的判準：**roster 的每一席都存在而且都死了**。預留還沒進場
的小隊 roster 指向不存在的席位，不算殲滅。`role` 限定看 roster 第一席的
`spec.role`。釘住玩家的那支小隊永遠不回收。

### 5.3 每步

`stepBeats` 裡，回收節拍每步掃一次分隊（O(分隊數)，不配置）：

1. 小隊殲滅、`reviveAt[f] < 0`、`batches < beat.batches` → `reviveAt[f] = now + warnLead`，
   `batches++`，顯示 `warn`
2. `reviveAt[f] >= 0` 且 `now >= reviveAt[f]` → `reviveFlight(b, f, beat)`，`reviveAt[f] = −1`

`beatsLeft` 在回收節拍 `batches < beat.batches` 或還有 `reviveAt >= 0` 時不歸零。

### 5.4 `reviveFlight`

- 座標框：`cfg.units[f]` 的 members 與 duty，`entry` 換成節拍的，
  `lane = WAVE_LANE + 波次數 + 這支小隊在可回收小隊裡的序號`，`tier = batches`。
  一支小隊一條固定的重生槽位，兩支同時殲滅也不重疊。
- 每一席：算站位 → `world.respawn(c)` → 位置、朝向、速度、`prev*` 抄上去，
  速度用 `openingTas`。**不改 `c.spawnPosition`**，「再打一場」要回開場點。
- 控制器換一顆新的 `AiController`（接 `board`、`selfIndex`、`profile`、決策相位），
  與 `reinforce` 相同。上一條命的目標、模式、計時器不能帶過來。
- `board.assignments[c.index] = −1`
- 記分板：同一列、同一個名字，`alive = true`；擊墜、死亡、助攻累積。
  換名字或清戰績都會讓兇手記到一次沒有人陣亡的擊墜，擊墜總和 = 陣亡總和
  這條守恆律就破了。

`compactFlights` 與 `wireStations` 在 `stepBeats` 之後跑，下一步自動歸隊接站位。

### 5.5 勝利要等

`redInbound` 加上：任何紅方小隊 `reviveAt >= 0`。少了它，最後一支殲滅到重生
之間那五秒紅方是零，會先判勝。

### 5.6 畫面

`Visual.model` 已經交給殘骸池，復活的席位要一具新模型。判準是
`c.alive && v.wrecked`：建一具、加進場景、`wrecked = false`。配置只發生在
復活那一刻。`Visual.model` 從 readonly 改成可寫；`renderPositions` 參考的是
`v.position`，不受影響。

殘骸池是環形，容量 40，本關殘骸最多 44 具，超過時覆蓋最舊的 —— 池子本來
就這樣設計，不動。

## 6. 測試

| 測 | 護欄 |
|---|---|
| `beats.test.ts` | `batch` 條件；殲滅判準排除未進場與其他角色 |
| `battle-recycle.test.ts`（新） | 殲滅一支 → 預警 → 過 `warnLead` 四席復活在進場框、滿血、新名字；批數上限；玩家的小隊不回收；`redInbound` 擋勝利；兩支同時殲滅落在不同槽位 |
| `missions.test.ts` | 盟 M4 紅方席位 ≤ `MAX_SIDE`；陸攻掛在第五批 |
| `mission-config-baseline.test.ts` | 盟 M4 不在凍結名單，不動 |

每一條先驗紅。

## 7. 不做

- 限時防守（`defend` 的 `seconds`）
- 補半隊
- 陸攻重生
