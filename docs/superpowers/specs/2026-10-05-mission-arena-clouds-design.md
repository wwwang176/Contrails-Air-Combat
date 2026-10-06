# 任務戰場邊界與雲場（SPEC）

日期：2026-10-05　分支：`mission-arena-clouds`

## 1. 目的

1. 每一關任務都有一個圓形的戰場邊界，行為與遭遇戰相同：只管玩家，出界倒數 15 秒爆炸，HUD 警告與小地圖畫界。
2. 每一關任務與遭遇戰都有雲：一朵朵分開的小雲（不做整片積層雲），鋪滿「戰場半徑 + 8 km」的圓。雲純粹是畫面，不影響 AI、彈道與判定。

## 2. 戰場邊界

### 2.1 資料

`world/arena.ts`：

```ts
export interface ArenaBounds { readonly x: number; readonly z: number; readonly radius: number }
export const SKIRMISH_ARENA: ArenaBounds = { x: 0, z: 0, radius: 12000 }
export const ARENA_MIN_RADIUS = 10000
```

- `ARENA_RADIUS` 併進 `SKIRMISH_ARENA`，不再單獨存在。
- `ARENA_CEILING`（10,000 m）與 `ARENA_COUNTDOWN`（15 s）不變，任務與遭遇戰共用。
- `MissionBattle.arena: ArenaBounds` 為**必填**：型別保證每一張打得起來的卡都有界。

### 2.2 各關數值

圓心固定，不跟艦隊漂。半徑 =「離圓心最遠的關鍵點 + 3 km」取整，最小 10 km。關鍵點是開場雙方站位、增援波次的出生點、目標與終點、中途撤離點、地面目標與船；重生（recycle）的出生點不算（盟 M3 重生的零戰最多在界外 0.5 km，出生後朝艦隊飛進來）。

| 任務 | 圓心 (x, z) m | 半徑 m |
|---|---|---|
| allies-m1 | (0, −3000) | 12000 |
| allies-m2 | (0, −4000) | 13000 |
| allies-m3 | (0, −2000) | 12000 |
| germany-m1 | (750, 3500) | 12000 |
| germany-m2 | (0, −2000) | 11000 |
| germany-m3 | (3000, −2500) | 10000 |
| germany-m4 | (−3000, 0) | 10000 |
| japan-m1 | (0, −1000) | 10000 |
| japan-m2 | (2000, 2000) | 11000 |
| japan-m3 | (0, 0) | 10000 |
| 遭遇戰 | (0, 0) | 12000 |

### 2.3 行為

- `stepArena(s, bounds, x, y, z, dt)`：水平距離量到 `bounds` 的圓心。熱路徑不配置。
- 玩家陣亡、接手僚機時，倒數狀態歸零。`expired` 是單向的，不清的話界內的僚機會在下一個物理步被殺（遭遇戰原本就有這個缺陷）。
- `main.ts` 在建場時決定這一場的 `ArenaBounds`：任務讀卡片，遭遇戰用 `SKIRMISH_ARENA`。
- `hudFrame.arenaShow` 恆為 true（兩種模式都有界）；新增 `arenaX`、`arenaZ`、`arenaRadius` 給小地圖。
- 小地圖的界圈畫在 `bounds` 的圓心（相對玩家），不再假設是世界原點。
- 過時的註解一併改掉：`arena.ts` 檔頭、`main.ts` 的 `resetArena`、`hud/types.ts` 的 `arenaShow`、`hud/widgets/arena.ts` 都寫著「任務卡的撤離點在 −20 km，所以任務沒有界」。現在的卡片裡沒有那個點。

## 3. 雲場

### 3.1 資料

`world/cloudField.ts`（battle 層不相依 render 層，所以型別住在 world）：

```ts
export type CloudAmount = 'few' | 'some' | 'many'
export interface CloudField { readonly yMin: number; readonly yMax: number; readonly amount: CloudAmount }
/** 每平方公里幾朵 */
export const CLOUD_DENSITY: Record<CloudAmount, number> = { few: 0.1, some: 0.2, many: 0.35 }
/** 雲鋪到戰場半徑再往外多遠，m（雲最遠畫到 8 km：站在界上往外看，地平線前都還有雲） */
export const CLOUD_FIELD_MARGIN = 8000
export function skirmishCloudField(terrain: TerrainKind, timeOfDay: TimeOfDay): CloudField
```

- `MissionBattle.clouds: CloudField` 為**必填**。
- 雲的半徑 60～140 m（同短片遠景）。朵數 = round(密度 × π × (戰場半徑 + 8 km)² / 10⁶)。
- 雲底高度在 `yMin`～`yMax` 之間均勻；位置在圓內按面積均勻（`scatterClouds`，`inner: 0`）。
- 種子由關卡鍵（任務 id；遭遇戰為 `skirmish:<terrain>:<timeOfDay>`）雜湊而來：同一關每次一樣。

### 3.2 各關數值

| 任務 | 雲底 m | 雲量 | 理由 |
|---|---|---|---|
| allies-m1 | 1200～1800 | some | 夏天晴天積雲，在 4000 m 的轟炸機腳下 |
| allies-m2 | 2000～2600 | few | 高過 1500 m 的投彈高度，不擋攻擊路線 |
| allies-m3 | 600～900 | some | 熱帶海上的積雲低 |
| germany-m1 | 800～1500 | many | 秋冬陰天 |
| germany-m2 | 2000～2500 | few | 夜間的雲是暗藍灰，多了糊成一片 |
| germany-m3 | 800～1500 | few | 清晨，積雲還沒長起來 |
| germany-m4 | 1500～2200 | some | 高過 Ju 87 的 800 m 進場俯衝 |
| japan-m1 | 600～900 | some | 熱帶積雲 |
| japan-m2 | 400～900 | many | 暴雨雲低又多；暗色雲與天空接近，要多才看得出來 |
| japan-m3 | 800～1500 | some | 黃昏的橘雲 |

遭遇戰（`skirmishCloudField`）：雲底照地形，雲量照時段（暴雨 many、夜間 few、其餘 some）。

| 地形 | 雲底 m |
|---|---|
| sea、archipelago | 600～900 |
| leyte | 500～900 |
| farmland | 1200～1800 |
| autumnFarmland、leuna、asch、rzhev | 800～1500 |
| poltava | 1000～1600 |

### 3.3 渲染

- `CLOUD_PUFF_CAPACITY` 由 1536 提高到 16384。最密的組合（germany-m1 與暴雨遭遇戰：半徑 20 km、many，440 朵）最壞是 440 × 30 = 13,200 團；超過容量的雲塊會被靜靜截掉，所以由測試逐關加總守住。
- 建場（`buildBattleTerrain`，時段套用之後）把雲場換上；離開戰鬥清掉（短片接手時再放它自己的雲）。
- 雲色照這一場的時段（`cloudColorOf`）。

## 4. 不做

- 雲不影響 AI 視線、玩家鎖定或彈道。
- 不做整片積層雲、不做會動的雲。
- 戰場圓心不跟艦隊漂（船速 8 m/s，打 15～20 分鐘才會漂到邊上）。
- AI 仍然沒有邊界。

## 5. 測試

- `arena`：圓心不在原點時的界內／界外、高度上限、倒數與 `arenaKills` 不變。
- 任務卡：每一張打得起來的卡 `arena.radius ≥ ARENA_MIN_RADIUS`；開場所有飛機（藍、紅）、地面目標、船、`missionRules` 的目標點、每一個增援節拍的出生點、每一個撤離節拍的撤離點都在界內、離界至少 1 km。驗紅要用越界的出生點與撤離點，不能用半徑（半徑會先被最小半徑擋下）。
- 接手僚機後倒數歸零：在 `main.ts`，Playwright 驗（出界爆炸 → 接手界內僚機 → 仍存活）。
- 雲場：朵數公式、所有雲在「半徑 + 8 km」內、高度在範圍內、同一個鍵每次一樣；**每一關與每一種遭遇戰組合的雲塊總數 ≤ `CLOUD_PUFF_CAPACITY`**。
- HUD 排版與小地圖的圈不寫測試（截圖驗）。

## 6. 驗收

- 十關任務與遭遇戰各截開場畫面：看得到雲、雲色符合時段。
- 任務裡把玩家移到界外：警告與倒數出現、小地圖的圈在正確位置。
- 效能：在雲量 many 的一關（germany-m1）用 GPU timer query 量有雲與沒雲的差，同頁 A/B。數字回報給負責人。
