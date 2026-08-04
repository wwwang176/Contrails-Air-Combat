# M10 主選單與遭遇戰設定 設計文件

## 1. 目標

讓這個專案第一次有「開始遊戲」這件事。

1. **Landing** —— 標題與開始按鈕，背景是 3D 場景本身。
2. **主選單** —— 兩張卡：任務模式、遭遇戰模式。
3. **任務模式** —— 選陣營，看到該陣營的五張任務卡。**全部不可點**（內容是 M11 之後的事）。
4. **遭遇戰** —— 選陣營、機型、我方與敵方數量，開始戰鬥。
5. **戰鬥中** —— ESC 叫出小選單（繼續／回主選單），戰鬥**暫停**。
6. **分出勝負** —— 結算畫面（M9 的記分板）＋勝敗橫幅，下方兩個出口：再打一場（同設定）／回設定頁。

M9 已經把介面備好了：`Battle.outcome`、`src/ui/scoreboard.ts` 的渲染函式、依**陣營**而不是隊伍顏色的名冊。這一版把它們接到選單上，並且第一次讓 `createBattle` 吃參數。

---

## 2. 不做的事

| 項目 | 為什麼 |
|---|---|
| 任務模式的任何實際內容 | 任務卡全部 disabled。轟炸機、地面目標、集合點都不存在 |
| 地形**選單** | 只有一種地形，設定頁上不放這一欄。但**地形本身做成可拆可換**（§5.2）—— `prompt.md` 已經預告山丘 |
| 機型卡的第二個選項 | 每個陣營目前就一台。卡片照畫，M11 補機種時自動變好用（§7.2） |
| 音效 | 一直都在延後名單上 |
| 轉場動畫 | 選單是疊在 3D 場景上的 DOM，切換就是顯示／隱藏 |
| 載入畫面 | 量過了，不需要（§5.3） |
| 難度選擇 | `DifficultyProfile` 一貫不碰 |

---

## 3. 畫面與狀態機

```
                    ┌──────────────────────────────────────────┐
                    │                                          │
  landing ──開始──▶ menu ──┬──▶ mission ───返回──────────────────┤
                           │   （陣營卡＋5 張 disabled 任務卡）  │
                           │                                    │
                           └──▶ skirmish ──返回──────────────────┘
                                   │    ▲
                              開始戰鬥   │ 回設定頁
                                   ▼    │
                                 battle ─┘
                                   │
                          ESC ─────┴───── 回主選單 ──▶ menu
```

五個畫面：`landing | menu | mission | skirmish | battle`。

`battle` 之上疊兩種 overlay，兩者互斥：

| Overlay | 何時出現 | 出口 |
|---|---|---|
| 暫停小選單 | 戰鬥中失去指標鎖定（§8） | 繼續／回主選單 |
| 結算 | `outcome !== 'fighting'` | 再打一場（同設定）／回設定頁 |

【為什麼「回主選單」只有 ESC 這一條路】專案負責人裁決。結算畫面下方那個按鈕回到**啟動這場戰鬥的那一頁** —— M10 唯一能開戰的入口是遭遇戰設定頁，所以實際上就是回設定頁；要回主選單再按一次設定頁的「返回」。這讓「剛打完想再打一場」是一次點擊，而「想換模式」多一次。

【為什麼結算出現後 ESC 不再作用】板子本身就是出口，再疊一層暫停選單只會有兩組互相矛盾的按鈕。

【ESC 回主選單＝那一場就沒了】不保留、不能回去繼續。要保留一場打到一半的戰鬥，就得決定它在選單期間是繼續跑還是凍結，而兩個答案都會逼出一堆狀態 —— M10 不需要那個功能。

---

## 4. 狀態機是純函數

```ts
// src/ui/screens.ts
export type Screen = 'landing' | 'menu' | 'mission' | 'skirmish' | 'battle'
export type ScreenEvent =
  | 'start' | 'mission' | 'skirmish' | 'back' | 'fight' | 'toMenu' | 'toSetup'

export function nextScreen(current: Screen, event: ScreenEvent): Screen
```

【為什麼抽成純函數】DOM 進不了單元測試，而「從結算按返回會不會跑到 landing 去」這種事只有轉移表看得出來。`back` 從 `mission` 與 `skirmish` 都回 `menu`；不合法的組合回傳 `current`（不動），而不是丟例外 —— 選單上一個按不到的按鈕不該讓整個遊戲當掉。

【`fight` 有兩個來源】從 `skirmish` 按「開始戰鬥」，與從結算按「再打一場」。**兩者都導向 `battle`** —— 後者是 `battle → battle`，畫面沒變但戰鬥重建。把「重建」與「換畫面」分開之後，狀態機不必知道有「重打」這回事。

---

## 5. 生命週期：什麼永遠不拆

### 5.1 基礎設施：永不拆，而且**地形換了也不必拆**

renderer、相機、`THREE.Scene` 這個容器、HUD 畫布與 `Hud`、輸入繫結、rAF 迴圈，**以及全部特效池**。

【為什麼】這些東西沒有一個有拆除路徑：`createScene`（`scene.ts:46`）與 `Hud`（`Hud.ts:22`）各掛了一個 `resize` 監聽器而**兩者都沒有移除的方法**。

但關鍵是：**它們也不需要有。** 沒有拆除路徑的那幾樣（渲染器、相機、視窗縮放）恰好是**地形永遠不會改變的部分** —— 換成山丘不會換掉渲染器。會隨地形改變的是海面與參照物，而那兩個**完全沒有監聽器**，各只有一個 mesh，釋放就是 `geometry.dispose()` 加 `material.dispose()`。

【原稿在這裡是錯的】初稿把「3D 場景」當成一整塊、結論是全部不拆。專案負責人指出未來會有其他地形（`prompt.md` 已經預告山丘），而拆開來看之後，**要拆的與拆不動的根本不是同一批東西**。

**特效池一律開在上限。** `createMuzzles(n)` 與 `createWrecks(n, cb)` 目前吃參戰架數，改成吃 `MAX_COMBATANTS = 40`（每隊上限 20）。其餘的池子本來就是固定容量。

【為什麼不隨架數縮放】2v2 時多配 36 個槽位的代價是幾 KB 與一次性的實例矩陣配置；換來的是「換一場不必重建任何 GPU 資源」。M8 已經做過「死槽位不寫矩陣」的最佳化（`zeroed` 旗標），所以每幀的成本跟著**存活數**走而不是容量。

### 5.2 地形是一個可拆可換的單元

```ts
// src/render/terrain.ts
export type TerrainKind = 'sea'

export interface Terrain {
  /** 加進場景的那個節點。換地形時整個移除 */
  readonly object: Object3D
  /** 地形高度場。撞地判定、水柱、殘骸入水都讀它 */
  heightAt(x: number, z: number, time: number): number
  /** 每幀更新。海浪要動；靜態地形是空操作 */
  update(time: number, centerX: number, centerZ: number): void
  dispose(): void
}

export function createTerrain(kind: TerrainKind): Terrain
```

海面（`createOcean`）與參照物（`createProps`）包成 `'sea'` 這一個實作，兩者各補一個 `dispose()`。

**`main.ts` 用 `let terrain` 持有，所有存取一律經過它** —— `world.crashPolicy`、水柱的 `heightAt`、殘骸與零件的入水判定、每幀的 `update`。這一條是換地形唯一真正的風險：任何一處把 `ocean.heightAt` 抓進閉包快取起來，換地形之後那一處就還在讀舊的高度場，而症狀（飛機撞到看不見的海面）離成因非常遠。

### 5.3 每場重建

- `Battle` 整個 —— `World`、`Combatant[]`、`TargetBoard`、`FlightIndex`、`Roster`
- 40 架的飛機模型（`main.ts` 的 `visuals`）
- **地形** —— 即使種類沒變也重建

【為什麼種類沒變也重建】M10 只有一種地形，所以「只在種類改變時才換」等於一條**永遠不會執行的路徑**，而那種路徑會在 M11 第一次用到它的時候壞掉。無條件重建讓「換一場 = 重建世界、模型、地形」是一條沒有分支的規則，每一場都走過。代價量過了：13.4 ms（§5.4）。

【shader 不會重編】`createOcean` 用 `onBeforeCompile` 注入頂點位移。新的 material 每次注入的字串完全相同，three.js 的程式快取因此命中同一支已編譯的程式。**但如果哪天海面 shader 長出變體，就必須同時實作 `customProgramCacheKey()`** —— 否則兩個不同的變體會共用同一把快取鑰匙，畫出來的是先編譯的那一支。

### 5.4 換場要多久：量過了

| 動作 | 實測 |
|---|---|
| 建 20 架 P-51D | 60.7 ms（每架 3.04 ms） |
| 建 20 架 Bf 109 G-6 | 50.5 ms（每架 2.52 ms） |
| 釋放 40 架 | 0.2 ms |
| 建海面（37,249 個頂點） | 12.3 ms |
| 建 600 個參照物 | 1.1 ms |

**合計約 125 ms** —— 一格長幀，不是載入畫面。所以「開始戰鬥」直接切，**M10 不需要 loading 狀態**。

地形只佔 11%，這是「種類沒變也重建」付得起的原因。

（量測在 node 環境，不含 GPU 的緩衝上傳；但現在的頁面本來就在載入時建這一整套，實際上感覺不到。）

### 5.5 每場要歸零的池 —— 這是最容易漏的一段

**目前沒有任何一個特效池能歸零。** 全部只有 `dispose()`，而 `Projectiles.clear()` 是唯一的例外。

要加 `reset()` 的地方：

| 檔案 | 涵蓋 |
|---|---|
| `render/particles.ts` | **一次解決三個** —— 火球、煙、噴濺都是 `createParticles` 包出來的 |
| `render/sparks.ts` | 火花 |
| `render/splash.ts` | 水柱 |
| `render/debris.ts` | 零件 |
| `render/wrecks.ts` | 殘骸 |

**殘骸池最危險**：它**持有**上一場的 `AircraftModel`，並在回收時透過建構時傳入的回呼把模型移出場景。不歸零的話，新的一場會混進上一場的殘骸，而且那些模型永遠不會被釋放。`reset()` 必須對每一具還在場的殘骸走一次那個回呼。

曳光（`tracers`）與槍焰（`muzzles`）**不需要 reset** —— 它們每幀從 `Projectiles` 與 `combatants` 重建全部實例矩陣，彈丸池清空之後下一幀自己就對了。

【為什麼不用「整個池子 dispose 再建一個」】那會重新配置 GPU 緩衝，而且要把新的 `object` 重新加進場景 —— 一條只在換場時才走、因此永遠測不夠的路徑。`reset()` 是純粹的狀態歸零，可以在 node 環境直接斷言 `live === 0`。

---

## 6. `BattleConfig` 要開的口

```ts
export interface BattleConfig {
  /** 藍隊架數，**含玩家**。1~20 */
  blueCount: number
  /** 紅隊架數。1~20 */
  redCount: number
  /** 藍隊機種 */
  blueSpec: AircraftSpec
  /** 紅隊機種 */
  redSpec: AircraftSpec
  altitude: number
  tas: number
  entryRange: number
  schwarmSpacing: number
  lateralOffset: number
  altitudeSpread: number
}
```

`perSide` 拆成兩個數字，機種由寫死改成參數（目前是 `const spec = blueSide ? P51D : BF109G6`）。

【「我方 20」含玩家】專案負責人裁決。20 vs 20 名副其實，而且這正是現在 `perSide` 的意思 —— 語意不變，只是拆成兩個。

**生成迴圈要吃兩邊不同的架數**：`flightCount` 現在算一次給兩邊用，要改成各算各的。玩家仍然是**藍隊正中央分隊的長機**（`playerSlot = floor(blueFlightCount / 2) * SCHWARM_SIZE`）。

【小架數的邊界】`blueCount = 1` 時只有一個分隊、一架，玩家就是那一架，沒有僚機 —— 他一死就是落敗（M9 §7.3 已經處理）。`altitudeOffset` 的週期 5 在分隊少於 5 個時仍然有效（`flight % 5`）。M6 對 `lateralOffset ≥ 1448` 的推導與架數無關（它守的是雙方彈道匯聚點不重疊），照用。

---

## 7. 陣營與機種

### 7.1 陣營不改變隊伍顏色

**玩家恆在藍隊。** 選軸心國＝藍隊飛 Bf 109、紅隊飛 P-51D。

【為什麼】HUD 的藍＝我方、紅＝敵方是一整套既有語意：接觸點框、小地圖符號、存活數、勝負判定（`aliveCount(b.red) === 0 → victory`）。讓顏色跟著史實陣營走，等於要求上述每一處都改成「跟著玩家走」，換來的只是顏色的史實正確性 —— 而玩家看的是敵我，不是國旗。這一條在 M9 spec §14 就寫下了，M10 照辦。

名冊那一層 M9 已經備好：`factionOf(spec.id)` 讀的是**機種**，所以藍隊飛 Bf 109 時自動拿德文名。

### 7.2 機型卡只有一個選項

同盟國 → P-51D；軸心國 → Bf 109 G-6。**卡片照畫**（專案負責人裁決），預設選取，點了沒有別的可選。

【為什麼不乾脆不畫】M11 補第三台機的時候，版面、選取狀態、`SkirmishSetup` 的欄位就都已經在了，那時只要往陣列裡多塞一台。現在省下的是一個 `<div>`，日後要補的是一整條資料流。

敵方機種**不可選** —— 自動是另一個陣營的那一台。

### 7.3 對應關係抽成純函數

```ts
// src/battle/skirmish.ts
export type FactionChoice = 'allies' | 'axis'

export interface SkirmishSetup {
  faction: FactionChoice
  /** 機種代號。M10 只有一個合法值，但欄位先開著 */
  specId: string
  blueCount: number
  redCount: number
}

export const DEFAULT_SKIRMISH: SkirmishSetup
export const MIN_SIDE = 1
export const MAX_SIDE = 20

/** 該陣營可選的機種。M10 每個陣營恰好一台 */
export function specsFor(faction: FactionChoice): readonly AircraftSpec[]

/** 設定 → 戰鬥設定。夾住數量、決定雙方機種 */
export function battleConfigFrom(setup: SkirmishSetup): BattleConfig
```

【為什麼要有 `battleConfigFrom` 而不是讓 DOM 直接組 `BattleConfig`】「選軸心國時紅隊是不是真的變成 P-51」這件事必須測得到，而 DOM 測不到。夾制也放在這裡：數量從 DOM 讀進來是字串，被改成 999 或 0 不該讓生成迴圈崩潰。

---

## 8. 暫停

### 8.1 這個專案第一次有「暫停」

**所有模擬時間都不前進**：物理子步不跑、`elapsed` 不累加、特效不 `step`、相機不更新。只有 `renderer.render` 照跑，讓視窗縮放仍然有反應。

【為什麼 `elapsed` 也要停】海面的波形是 `elapsed` 的函數。只停飛機的話，畫面上是一批定格的飛機浮在繼續起伏的海上 —— 那看起來像當掉，不像暫停。撞海判定也讀同一個 `elapsed`（`world.crashPolicy`），兩者一致才不會在恢復的瞬間突然判定撞海。

【為什麼不是把 `dt` 傳 0 就好】`FixedStepAccumulator` 會累積餘數。餵 0 是安全的（不產生子步），但更清楚的做法是整段跳過 —— 暫停時連 `loop.advance` 都不呼叫。

**HUD 照畫，數值凍結。** 它是那一格畫面的一部分，收掉反而像切換了模式。**TAB 在暫停時不作用** —— 暫停選單已經佔著畫面，再攤開一張記分板只是兩層疊在一起。

### 8.2 觸發：指標鎖定掉了，不是 ESC 的 keydown

**不能綁 `Escape` 的 `keydown`。** 指標鎖定期間按 ESC，瀏覽器會解除鎖定並**吃掉那個鍵盤事件** —— 這是瀏覽器的安全行為，不是可以繞過的東西。

正確的觸發是「指標鎖定沒了」。而 `input/bindings.ts` 的 `tick()` **已經在每幀輪詢** `document.pointerLockElement`（用來在切出視窗時清掉扳機）。直接沿用那個輪詢，多送一個狀態出來：

```ts
// InputState
/** 這一幀是否剛失去指標鎖定。呼叫端消費後自行清除 */
pointerLockLost: boolean
```

【為什麼不加 `pointerlockchange` 監聽器】`bindings.ts` 裡已經寫明了原因：既有測試的 `document` 替身只有 `pointerLockElement` 一個欄位，沒有 `addEventListener`，加監聽器會讓 `bindings.test.ts` 整檔在 `attachInput` 就拋錯。輪詢每幀本來就在跑，順手比對一次是零成本的。

### 8.3 恢復

「繼續」按鈕重新請求指標鎖定（按鈕點擊本身就是使用者手勢，這是合法的請求時機）。鎖定回來之後才解除暫停 —— 否則會出現「已經在飛但滑鼠還沒被抓住」的一瞬間。

### 8.4 進戰鬥時直接鎖定

「開始戰鬥」那一下點擊也是使用者手勢，可以**直接請求指標鎖定**，省掉現在「進去之後還要再點一次畫面」那一步。

---

## 9. DOM 與版面

### 9.1 一律是 DOM，與記分板同一套

所有選單都是 `index.html` 裡的 `<section hidden>`，疊在兩張 canvas 之上。切換畫面就是改 `hidden`。

【為什麼不用前端框架】專案負責人問過這一題。同一頁的真正風險是 three.js 的資源生命週期（§5.1），而那是框架碰不到的地方；框架能幫的是狀態同步，而這裡的狀態是「五個畫面之一」加上一個設定物件 —— 用一個 `Screen` 變數與一次 `render()` 就寫完了。多一個相依、多一套建置設定，換不到東西。

### 9.2 遭遇戰設定頁：左右兩欄

專案負責人選定：

```
┌─────────────────────────────────┐
│            遭 遇 戰              │
│                                  │
│  陣營            │  我方數量      │
│  ┌──────┐        │   ◀  20  ▶    │
│  │◆同盟國│        │                │
│  └──────┘        │  敵方數量      │
│  ┌──────┐        │   ◀  20  ▶    │
│  │ 軸心國│        │                │
│  └──────┘        │                │
│                  │                │
│  機型            │                │
│  ┌────────┐      │  〔 開始戰鬥 〕 │
│  │◆ P-51D │      │                │
│  └────────┘      │  〔 返    回 〕 │
└─────────────────────────────────┘
```

數量用「◀ 數字 ▶」而不是滑桿：1~20 只有二十格，一格一格點比拖曳準，而且鍵盤與觸控都能用。按住不放要能連續加減。

### 9.3 卡牌

主選單的兩張、陣營的兩張、機型的一張、任務的五張共用同一個卡牌樣式：標題、一行說明、選取狀態、disabled 狀態。

【為什麼 disabled 的卡片要畫得清楚是 disabled】任務卡全部不可點。看起來可點卻沒反應，玩家會以為程式壞了。降低不透明度、游標維持預設、右上角標「未開放」。

### 9.4 Landing

標題與開始按鈕水平垂直置中，背景是 3D 場景。**只有海與天，鏡頭緩緩平移**（專案負責人裁決）—— 選單期間沒有任何 `World`、沒有飛機、沒有 AI、沒有彈丸。

```ts
// src/app/menuCamera.ts
/** 選單期間的鏡頭：定高緩慢繞偏航，看向地平線 */
export function menuCameraPose(elapsed: number, out: { position: Vector3; yaw: number }): void
```

【為什麼抽成純函數】它是時間的函數，沒有狀態。抽出來就能斷言「不會飄到海面下」「偏航是連續的」這種事。

---

## 10. 任務卡（M10 全部不可點）

專案負責人核可的文案。五種類型對應 `prompt.md` 的規劃。

**同盟國（1944，西線）**

| 任務 | 類型 | 難度 |
|---|---|---|
| 諾曼第上空掃蕩 | 殲滅 | ★★ |
| 攔截 He 111 轟炸群 | 攔截 | ★★★ |
| 打擊魯爾鐵路 | 對地 | ★★★ |
| 護送 B-17 至集合點 | 護航 | ★★★★ |
| 且戰且走 | 撤離 | ★★★★★ |

**軸心國（1944，本土防空）**

| 任務 | 類型 | 難度 |
|---|---|---|
| 帝國防空巡邏 | 殲滅 | ★★ |
| 攔截 B-17 轟炸群 | 攔截 | ★★★ |
| 打擊登陸艦隊 | 對海 | ★★★★ |
| 護送運輸機 | 護航 | ★★★ |
| 撤出包圍 | 撤離 | ★★★★★ |

資料放在 `src/ui/missions.ts`，只是一個常數陣列。**沒有任何行為** —— 每張卡都是 `disabled`。

---

## 11. 檔案結構

**新增**

| 檔案 | 職責 | 測得到 |
|---|---|---|
| `src/ui/screens.ts` | `Screen`、`ScreenEvent`、`nextScreen` 轉移表 | ✅ |
| `src/battle/skirmish.ts` | `SkirmishSetup`、`specsFor`、`battleConfigFrom`、上下限 | ✅ |
| `src/ui/missions.ts` | 兩組任務卡的常數 | ✅（只有一致性斷言） |
| `src/ui/menu.ts` | 各畫面的 DOM 工廠與按鈕繫結 | ❌ |
| `src/app/menuCamera.ts` | 選單期間的鏡頭運動 | ✅ |
| `src/render/terrain.ts` | `Terrain` 介面、`TerrainKind`、`createTerrain` | ✅ |

**修改**

| 檔案 | 改什麼 |
|---|---|
| `src/battle/setup.ts` | `BattleConfig` 拆成雙方架數與雙方機種；生成迴圈吃兩邊不同架數 |
| `src/render/particles.ts` | 加 `reset()`（火球、煙、噴濺一次解決） |
| `src/render/sparks.ts`、`splash.ts`、`debris.ts`、`wrecks.ts` | 各加 `reset()` |
| `src/render/muzzle.ts`、`wrecks.ts` | 容量改吃 `MAX_COMBATANTS` |
| `src/render/ocean.ts`、`props.ts` | 各加 `dispose()`。`createProps` 回傳型別由 `InstancedMesh` 改成帶 `dispose` 的物件 |
| `src/input/InputState.ts`、`bindings.ts` | `pointerLockLost` |
| `src/main.ts` | 畫面分支、換場、暫停、選單接線 |
| `index.html` | 五個畫面與兩個 overlay 的 DOM 與 CSS |

【`main.ts` 的幀迴圈怎麼拆】現有那一整段搬進一個 `stepAndDrawBattle()` 區域函數，`frame()` 依畫面決定呼叫它還是 `drawMenuBackground()`。**是機械式的抽出，不動內容** —— `main.ts` 沒有測試護著，這一步要看得出來只是搬家。

---

## 12. 測試

**純函數（node 環境）**

- `nextScreen`：每一條合法轉移；不合法的組合維持原狀；從 `battle` 按「回主選單」回到 `menu`。
- `battleConfigFrom`：選同盟國 → 藍隊 P-51D、紅隊 Bf 109；選軸心國 → 反過來。數量被夾在 1~20（0、−1、999、NaN 都要有定義的結果）。
- `specsFor`：每個陣營至少一台；兩個陣營的機種沒有交集。
- `menuCameraPose`：高度恆為正；偏航連續（相鄰取樣的角差有上界）。
- `missions.ts`：兩個陣營各五張；難度落在 1~5；標題不重複。

**池子的歸零**

每一個加了 `reset()` 的池子各一條：發射一批 → `reset()` → `live === 0`。**殘骸池另外一條**：`adopt` 兩具 → `reset()` → 回收回呼被呼叫兩次（模型真的被還出去了）。

**地形**

- `createTerrain('sea')` 的 `heightAt` 與 `gerstnerHeight` 逐點一致 —— 包起來之後不能換成另一份波形，否則畫面上的浪與撞得到的浪會分家。
- `dispose()` 之後 geometry 與 material 真的被釋放（用 three.js 的 `dispose` 事件或旗標斷言，不是只看沒有拋例外）。
- 連續 `createTerrain` / `dispose` 十次不累積 —— 這條守的是「每場重建」不會洩漏。

**`createBattle` 的新參數**

- `blueCount !== redCount` 時雙方架數正確，且玩家在藍隊。
- `blueCount = 1` 時只有玩家一架，`playerFlight` 仍然回得出一個分隊。
- 機種依參數，不是寫死的。
- 名冊跟著機種走：藍隊飛 Bf 109 時拿的是德文名（守住 §7.1 那條裁決）。

**不測**：DOM 的渲染與按鈕繫結、`main.ts` 的接線。與 HUD、記分板同一條紀律。

---

## 13. 常數

| 常數 | 值 | 為什麼 |
|---|---|---|
| `MIN_SIDE` | 1 | 一架也要能打。玩家自己一架時沒有僚機可接，他一死就落敗 |
| `MAX_SIDE` | 20 | M5 以來的既有上限，效能閘門是照 40 架訂的 |
| `DEFAULT_SKIRMISH` 的數量 | 20 / 20 | 專案負責人裁決 |
| `MAX_COMBATANTS` | 40 | `MAX_SIDE * 2`。特效池的容量 |

---

## 14. 人工驗收條件

1. 開頁面看到 landing：標題與開始按鈕置中，背景是緩緩平移的海與天，**沒有飛機**。
2. 按開始 → 兩張卡（任務模式、遭遇戰模式）。
3. 任務模式 → 選陣營 → 五張任務卡，全部明顯不可點，點了沒有任何反應也沒有錯誤。
4. 兩個陣營的任務卡是不同的五張。
5. 遭遇戰 → 版面是左右兩欄，陣營兩張、機型一張、兩個數量各自可調 1~20。
6. 選軸心國 → 機型卡變成 Bf 109 G-6。
7. 開始戰鬥 → **不必再點一次畫面**，滑鼠直接被抓住。
8. 選軸心國打一場：自己飛 Bf 109、敵人是 P-51D，而 HUD 上自己仍然是藍的。
9. 記分板上我方是德文名、敵方是英文名。
10. 打 3 vs 5 → 場上真的是 3 架對 5 架。
11. 戰鬥中按 ESC → 出現小選單，而且**海浪停住、飛機停住**。
12. 按繼續 → 滑鼠重新被抓住，戰鬥從停住的地方接下去。
13. ESC → 回主選單 → 再開一場：上一場的殘骸、煙、彈丸**一個都沒有留下來**。
14. 打完一場 → 結算畫面，再打一場（同設定）→ 名字換一批、戰績歸零。
15. 結算 → 回設定頁 → 改成 2 vs 2 → 開始 → 真的是 2 vs 2。
16. 連續換場五次，畫面不會愈來愈慢（模型與地形都沒有洩漏）。
17. 連續換場五次之後，海面仍然只有一片 —— 舊地形沒有疊在新的下面（會表現為 z-fighting 的閃爍）。

---

## 15. 與 M11 的介面

- `SkirmishSetup.specId` 已經是欄位，`specsFor` 回傳陣列 —— 補第三台機時只要往陣列裡塞。
- `src/ui/missions.ts` 的每一張卡已經有類型與難度欄位，任務真的要做的時候在那裡加一個「怎麼打」的描述。
- `nextScreen` 的轉移表加一個 `mission → battle` 就能讓任務卡可點。
- `BattleConfig` 已經吃雙方機種與雙方架數 —— 任務關卡要的「10 架敵機對 4 架我機」不必再改簽章。
- **加一種地形 = `TerrainKind` 多一個值、`createTerrain` 多一個分支。** 拆除與重建的路徑 M10 每一場都在走，不是一條等著被第一次使用的死碼。撞地判定讀的是 `Terrain.heightAt`，所以山丘不必改 `World` 一個字。

M11 才動、這一版刻意不碰的：非戰鬥機的單位（轟炸機、地面目標）、集合點與勝利條件的多樣化、難度、地形選單。
