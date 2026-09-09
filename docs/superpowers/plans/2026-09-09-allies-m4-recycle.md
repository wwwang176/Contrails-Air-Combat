# 盟 M4 整隊重生 —— 實作計畫

SPEC：`docs/superpowers/specs/2026-09-09-allies-m4-recycle-design.md`

每一步先寫紅的測試，再改到綠。只跑碰到的測試。

## T1 `beats.ts`：第三種節拍與第三種條件

- `BeatCondition` 加 `{ kind: 'batch'; at: number }`
- `conditionMet(when, time, aliveOf, batches)`：`batch` 在 `batches >= at` 成立
- `RecycleBeat { kind: 'recycle', team, role?, batches, warn, warnLead, entry }`
- `createBeatStates`：`recycle` 的 `slot` 是 −1（不佔預留佇列）

測：`beats.test.ts` —— `batch` 條件的邊界（`at − 1` 不成立、`at` 成立）；
`createBeatStates` 對 recycle 給 −1 而且不推進 reinforce 的 slot。

## T2 `flights.ts`：小隊殲滅的判準

- `flightWiped(fi, f, all)`：roster 每一席都存在（`all[i] !== undefined`）
  而且都 `!alive`。任何一席不存在 → false。

測：`flights.test.ts` —— 全死 true；一席活 false；預留未進場 false；
空 roster 不會出現（`createFlights` 已擋）。

## T3 `setup.ts`：狀態、每步、重生

### 3.1 抽共用

- `placeMember(frame, k, made, out)`：從 `spawnMember` 抽出「第 k 席的出生點」
  （`STATION_REFERENCE`／`stationPoint`／長機用 `frame.lead*`）
- `settle(c, pos, q, tas)`：位置、`prevPosition`、朝向、`prevOrientation`、
  速度 `FWD·q·tas`。`resetBattle` 那六行改呼叫它。

### 3.2 `Battle` 多兩格

- `reviveAt: Float64Array`，長度 `flights.flights.length`，建構期 `fill(-1)`
- `batches: number`，起始 0
- `beatsLeft`：recycle 也算一個沒走完的節拍

### 3.3 `stepBeats`

recycle 分支（每步，O(分隊數)，不配置）：

```
for f in flights:
  if flight.team !== beat.team → skip
  if role 限定且 roster[0] 的 spec.role 不符 → skip
  if f 是玩家釘住的小隊 → skip
  if reviveAt[f] < 0:
    if batches < beat.batches && flightWiped(f):
      reviveAt[f] = now + warnLead; batches++; message = warn
  else if now >= reviveAt[f]:
    reviveFlight(b, f, beat); reviveAt[f] = −1
if batches === beat.batches && 沒有任何 reviveAt >= 0 && 還沒記過 → beatsLeft--, phase = 'done'
```

`conditionMet` 多傳 `b.batches`。recycle 節拍排在波次之前（`cardBeats`），
陸攻的 `batch` 條件在同一步讀到剛加的批數，兩則預警同一步、陸攻的那則
留在畫面上。

### 3.4 `reviveFlight(b, f, beat)`（export，測試要用）

1. `unit = cfg.units[f]`，組一個 plan：members／duty 沿用，`entry = beat.entry`，
   `lane = WAVE_LANE + 波次數 + f 在同隊同角色小隊裡的序號`，`tier = b.batches`
2. `frame = unitFrame(cfg, plan)`
3. 對每一席 k：`placeMember` → `world.respawn(c)` → `settle(c, SPAWN, frame.orientation, openingTas(...))`
   → 新 `AiController`（board、selfIndex、profile、相位）→ `board.assignments[i] = −1`
   → `roster.pilots[i]`：`alive = true`、新名字
4. 名字與戰績不動：同一席位、同一列。換名字或清戰績會破壞擊墜總和 = 陣亡總和

`WAVE_LANE` 從 `missions.ts` 搬到 `order.ts`（`setup.ts` 不能 import `missions.ts`，
會循環）。

### 3.5 `redInbound`

`stepBattle` 算 `inp.redInbound` 時加：任一紅方小隊 `reviveAt[f] >= 0`。

### 3.6 `resetBattle`

`reviveAt.fill(-1)`、`batches = 0`、`beatsLeft` 重算。

測：新檔 `battle-recycle.test.ts`，用 `lineAbreast` 4v8 + 一個 recycle beat：

- 殺光紅方第一支 → 該步之後 `reviveAt[f] >= 0`、`batches === 1`、`message === warn`
- 過 `warnLead` 後四席 `alive`、`hp === spec.hp`、位置在 `unitFrame` 的框內
  （z 等於 `entry.along × entryRange + gap` 附近、與開場點不同）、名字與死前不同
- `compactFlights` 之後 `flight.count === 4`
- 殺 `batches` 次之後不再重生
- 藍方（玩家的小隊）被殺光不重生
- 兩支同時殲滅 → 兩支的長機 x 不同
- 預警期間 `stepBattle` 的 `mission.outcome` 仍是 `fighting`（規則 `annihilate`
  的話紅方歸零會判勝 —— 用 `defend` 或直接讀 `redInbound` 的等價量）
- `killEvents`／`damageTime` 的參考不變（與 reinforce 同一條）
- `resetBattle` 之後 `reviveAt` 全 −1、`batches === 0`

## T4 `missions.ts`：卡片

- `MissionTrigger` 加 `{ kind: 'batch'; at: number }`；`triggerToCondition` 透傳
- `MissionRecycle { side, role?, batches, warn, warnLead, starboard? }`
- `MissionBattle.recycle?: MissionRecycle`
- `cardBeats`：recycle → `RecycleBeat`（方位旋轉與 `waveBeat` 同一段，抽成
  `entryFor(side, starboard, altitude?)`）；排在波次之前
- `allies-m4`：刪兩個零戰波次；加 `recycle`；陸攻 `when: { kind: 'batch', at: 5 }`
- 更新卡片註解（現況與理由，不寫沿革）

測：

- `defend-fleet.test.ts`：改寫波次那四條 —— 只剩陸攻一個波次、條件是
  `batch 5`、recycle 六批、`cardBeats` 產出 recycle + reinforce 各一、
  右舷方位那條改讀 recycle 的 entry
- `missions.test.ts`：`batch` 觸發的卡必須同時有 `recycle`，而且 `at <= batches`
- `strike-replay-baseline.test.ts`：盟 M4 那一格會變 —— **負責人已裁定改編成**，
  重凍時把新雜湊寫進去並在 commit 訊息寫明

## T5 `main.ts`：畫面

- `Visual.model` 改為可寫
- 內插迴圈：`if (v.wrecked) { if (!c.alive) continue; v.model = buildAircraft(spec);
  scene.add; v.wrecked = false }`
- 只在復活那一刻配置

驗：`npm run dev` 開盟 M4，看零戰整隊死光後五秒重新進場、殘骸照樣落海。

## T6 收尾

- `npx tsc --noEmit` 錯誤行數不多於基準
- 跑：`beats`、`flights`、`battle-recycle`、`battle-reinforce`、`battle-beats`、
  `defend-fleet`、`missions`、`campaigns`、`mission-config-baseline`、
  `strike-replay-baseline`
- Codex 審查 diff
