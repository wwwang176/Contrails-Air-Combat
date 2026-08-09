# 上帝視角的分隊標示

2026-08-09

## 1. 要求

專案負責人原話：

> 上帝視角 敵我雙方都要有HUD標示，只是跟非上帝視角不同，只需標記小隊的長機
> 然後標記該小隊數量 例如 (2/4)

拆成四件事：

1. 上帝視角要有 HUD 標示 —— 目前一個都沒有（`hudWidgets(true)` 只排小地圖、名冊、提示）
2. **敵我雙方都要**
3. **只標長機**，僚機不畫
4. 標示上要有該分隊的存活／編制，形如 `(2/4)`

## 2. 四個裁決（AskUserQuestion，2026-08-09）

| 問題 | 選定 |
|---|---|
| 標示長什麼樣 | **方框 + 下方 `(2/4)`** —— 沿用座艙目標框的形狀，把距離讀數換成人數 |
| 長機在畫面外 | **不畫**。上帝視角本來就有小地圖畫全場 |
| 顏色 | **兩色**：敵紅、我方藍。玩家分隊的黃色在旁觀視角沒有意義 |
| 框的大小 | **依距離縮放，同座艙**（夾在 9~46 px） |

「框依距離縮放」把 §4 的既有缺陷從「無害」變成「承重」——見那一節。

## 3. 現況

### 3.1 上帝視角畫什麼

```ts
// src/hud/Hud.ts
const GOD: readonly HudWidget[] = ['minimap', 'roster', 'hints']
```

其餘全部是座艙儀表，鏡頭都不在飛機上了，留著只是雜訊；**準星更是直接誤導**
（會讓人以為那個方向會有子彈出去）。這個裁決不變，這次只是加一個**不是座艙
儀表**的新 widget。

### 3.2 編制資料在哪

`src/battle/flights.ts`：

| 東西 | 意思 |
|---|---|
| `Flight.roster` | 出生編制，順序即階層，**不隨陣亡改變** |
| `Flight.members` | 存活成員，由 roster 保序壓縮；`members[0]` 就是長機 |
| `Flight.count` | 存活數 |
| `FlightIndex.flightOf[i]` | 第 i 架屬於哪個分隊；−1 = 已退場 |
| `FlightIndex.positionOf[i]` | 第 i 架在 `members` 裡的位置；**0 = 長機** |

`compactFlights` 每個物理步重算，所以繼位、遞補、重生都不需要額外同步。

### 3.3 接觸點池已經有的東西

`main.ts:788` 的迴圈每幀掃每一架，已經算好螢幕座標（`x`/`y`/`behind`）、
框半徑（`radius`）、敵我（`hostile`）。**上帝視角下自機也在池子裡**
（`main.ts:789` 的註解：中心是鏡頭不是自機，不放進來的話玩家那一架在小地圖上
一個像素都沒有）。

## 4. 順手要修的既有缺陷：`range` 在上帝視角下是錯的

```ts
// main.ts:804（現況）
contact.range = v.position.distanceTo(renderPos)   // renderPos = 玩家飛機
```

`radius` 由 `range` 推出來。上帝視角下這兩個值**都是以玩家飛機為基準算的**，
不是鏡頭。原本無害，因為吃它們的兩個 widget（目標框、邊緣指示）在上帝視角
根本不畫 —— `main.ts:794` 的註解就是這麼寫的：

> 【`range` 與 `radius` 會是 0 與一個很大的值】兩者只有接觸點框與邊緣指示在吃，
> 而那兩個 widget 在上帝視角下根本不畫（`hudWidgets`）。

§2 選了「框依距離縮放」，那句話從此不成立。不修的話，框的大小會跟著一架
**你根本沒在看的飛機**變 —— 鏡頭飛到戰場另一頭，框卻因為玩家飛機靠近某架敵機
而變大。

改法沿用同一個迴圈裡 `refY`（`main.ts:786`）已經確立的形狀：

```ts
const refPos = input.godView ? godCam.position : renderPos
contact.range = v.position.distanceTo(refPos)
```

**只動 `range`。** 預瞄環（`main.ts:822-831`）仍然以玩家飛機為基準 —— 那是
玩家的槍線，本來就該是，而且上帝視角下也不畫。

## 5. 設計

### 5.1 資料：`HudContact` 加三個欄位

```ts
/**
 * 這一架是不是自己分隊的長機（`members[0]`）。上帝視角的分隊標示只認它。
 *
 * 【玩家那一架恆為 true】玩家釘死在 `members[0]`（`FlightIndex.pinned`），
 * 所以他永遠是長機 —— 這是既有設計的直接後果，不是新特例。
 */
flightLeader: boolean
/** 它那個分隊還活著幾架。`flightLeader` 為 false 時無意義 */
flightAlive: number
/** 它那個分隊的編制員額。`flightAlive` 的分母 */
flightSize: number
```

`main.ts` 那一圈已經在跑每一架，三行填完：

```ts
const fi = battle.flights
const fIdx = fi.flightOf[c.index]!
contact.flightLeader = fIdx >= 0 && fi.positionOf[c.index] === 0
contact.flightAlive = fIdx >= 0 ? fi.flights[fIdx]!.count : 0
contact.flightSize = fIdx >= 0 ? fi.flights[fIdx]!.roster.length : 0
```

**否決過的兩個做法**

| 做法 | 為什麼不 |
|---|---|
| 另開一個 `HudFlightMarker` 陣列（一分隊一格） | 得把投影邏輯（`project`、`behind`、`radius`）複製第二份。那正是 `hud/types.ts` 的 `contactColor` 註解記下的那類錯誤：目標框改了、小地圖沒改 |
| 讓 widget 自己從編制認長機 | `HudFrame` 沒有編制資訊。要有就得讓 `src/hud` 相依 `src/battle`，破壞 HudFrame 是純 DTO 的分層 |

### 5.2 繪製：新 widget `godMarkers`

```ts
const GOD: readonly HudWidget[] = ['godMarkers', 'minimap', 'roster', 'hints']
```

排最前面：世界疊加層在面板底下，與 `FULL` 裡 `contacts` 排在 `dials`／`minimap`
之前是同一條理由。

新檔 `src/hud/widgets/godMarkers.ts`，三個純函數 + 一個 `drawGodMarkers`。
繪製函數在 node 環境驗不到，所以會壞的規則全部抽出來：

| 函數 | 守什麼 |
|---|---|
| `godMarkerVisible(c, aspect)` | 只畫長機；未啟用、背後、畫面外一律不畫 |
| `flightStrengthLabel(alive, size)` | `(2/4)` 的格式 |
| `godMarkerColor(hostile)` | **兩色**。玩家分隊的長機不得是黃的 |

```ts
export function godMarkerVisible(c: HudContact, aspect: number): boolean {
  return c.active && c.flightLeader && !c.behind
    && Math.abs(c.x) <= aspect && Math.abs(c.y) <= 1
}

export function flightStrengthLabel(alive: number, size: number): string {
  return `(${alive}/${size})`
}

export function godMarkerColor(hostile: boolean): string {
  return contactColor(hostile, false)
}
```

**`godMarkerColor` 不自己寫 `hostile ? danger : friendly`。** 理由與 §5.1
否決第二個做法相同：第三份同義的顏色邏輯遲早會與另外兩份漂開。傳
`flightMate = false` 就正好退化成兩色，而那個 `false` 需要一行註解說明它是
**刻意的裁決**而不是忘了填。

**名稱不叫 `flightLabel`。** `roster.ts` 已經有一個 `flightLabel(alive, size)`，
語意不同：它回傳 `隊 2/4`，而且 `size < 2 || alive < 2` 時回傳 `null`
（「剩一架時沒有『隊』這回事」）。上帝視角相反 —— `(1/4)` 正是「那一隊快被打光了」
這個最值得看的資訊，一定要顯示。兩者共存，名字必須分得開。

### 5.3 框半徑的夾制移到 `types.ts`

`contacts.ts` 目前把 9~46 px 的夾制寫在繪製函數裡（`BOX_MIN`／`BOX_MAX`）。
兩個 widget 要用同一個尺，就搬到 `types.ts`：

```ts
export function contactBoxRadius(radius: number, unit: number, scale: number): number {
  return Math.max(BOX_MIN * scale, Math.min(BOX_MAX * scale, radius * unit))
}
```

**為什麼是 `types.ts` 而不是留在 `contacts.ts` 讓另一邊 import**：那個檔案的
`contactColor` 註解已經把這條規則寫死了 —— 「兩個 widget 都要用它。留在其中
一邊就會變成另一邊自己寫一份」。這裡照辦。搬過去順帶讓那個夾制第一次有測試
（原本的註解記著一個真的踩過的錯：先乘 `L.scale` 再夾，順序反了會二次縮放）。

### 5.4 繪製內容

```
    ┌────┐
    │    │      ← 方框，半徑 = contactBoxRadius(c.radius, L.unit, L.scale)
    └────┘
     (2/4)      ← 字級 10 × L.scale，貼在框底下 3 × L.scale px
```

線寬與字級沿用 `contacts.ts` 的目標框（1.5 × scale、10 × scale），因為它們
是同一套視覺語言 —— 只是讀數的意思換了。間距也照抄 `3 * L.scale`：**不乘
`scale` 的話高 DPI 下字會貼到框上**，那是 `contacts.ts` 註解記過的同一類錯誤。

**編制員額 1 的分隊照畫 `(1/1)`。** 架數不是 `SCHWARM_SIZE` 的倍數時最後一個
分隊比較小（`flights.ts` 的 `createFlights`），那不需要特例 —— 分母就是它的
`roster.length`。

**敵我是相對玩家的。** `hostile = c.team !== player.team`，沿用接觸點池既有的
定義。玩家退場後 `player` 物件仍在，`team` 不變，所以顏色不會在他陣亡的那一幀
整片翻掉。

## 6. 自然落出來、不必寫特例的三件事

| 情形 | 結果 | 為什麼不必特例 |
|---|---|---|
| 長機陣亡 | 標示跳到新長機 | `compactFlights` 每個物理步重壓，`members[0]` 自動換人 |
| 玩家那一架 | 恆有標示 | 玩家釘死在 `members[0]`（`FlightIndex.pinned`） |
| 全隊覆沒 | 標示消失 | `count = 0`，沒有成員進得了接觸點池 |

## 7. e2e 的中央判準被這個功能作廢，要換掉

`test/e2e/god-view.e2e.ts` 目前斷言：

```
上帝視角下 HUD 畫布中央 ±40 裝置像素內的不透明像素必須是 0
```

守的是「準星在上帝視角絕不出現」，因為準星**是誤導**不只是雜訊。

**新標示會讓它變成偽陽性**：任何一架長機投影到畫面中央附近，方框的邊就落在
離中心 9~46 CSS px（dpr 2 下 18~92 裝置像素）處，直接進到那個 ±40 的框裡。
戰鬥中誰會飛到畫面中央是不可控的，所以它會**間歇性地紅**，而那是最壞的一種紅。

**換法：中央只數綠色的墨水。**

```
準星（滑鼠圈、機首十字、兩者間的虛線）  HUD_COLORS.primary #7dfba8 / dim  → 綠
分隊標示                                 danger #ff5a4d / friendly #5aa9ff → 紅、藍
```

判準改成「中央 ±40 裝置像素內，`g > r && g > b` 的像素必須是 0」。紅框的
`g > r` 不成立、藍框的 `g > b` 不成立，兩者都不會被算進去；而準星的三個部件
**全部**是綠的，一個都逃不掉。

**這比原本的判準更強，不是更弱** —— 原本只要中央有任何墨水就算違規，包含
與準星無關的東西；換過之後它真正只盯準星。右下角儀表區那一條（`dials === 0`）
不受影響，照舊。

## 8. 測試

### 8.1 單元（`test/unit/hud.test.ts`）

| 條 | 內容 |
|---|---|
| 1 | `hudWidgets(true)` 等於 `['godMarkers', 'minimap', 'roster', 'hints']` —— 既有那條寫死三個，要一起改 |
| 2 | `godMarkers` 排在 `minimap` 之前（疊層順序） |
| 3 | `hudWidgets(false)` 不含 `godMarkers` —— 座艙有完整的目標框，再疊一層分隊框是雜訊 |
| 4 | `godMarkerVisible`：長機且在畫面內 → true |
| 5 | `godMarkerVisible`：非長機 → false（即使在畫面內） |
| 6 | `godMarkerVisible`：`behind` → false |
| 7 | `godMarkerVisible`：`x` 超出 aspect、`y` 超出 1 → false（各一條） |
| 8 | `godMarkerVisible`：`active` 為 false → false |
| 9 | `flightStrengthLabel(2, 4)` === `'(2/4)'` |
| 10 | `flightStrengthLabel(1, 4)` === `'(1/4)'` —— **與 `roster.ts` 的 `flightLabel` 相反，剩一架照樣顯示** |
| 11 | `godMarkerColor(true)` 是 danger、`godMarkerColor(false)` 是 friendly，且**兩者都不是 warn** |
| 12 | `contactBoxRadius` 夾在下界、夾在上界、中間段線性 —— 三條 |
| 13 | `contactBoxRadius` 的夾制是先乘 scale 再夾：`scale = 2` 時下界是 18 不是 9 |
| 14 | `createHudContact()` 的三個新欄位有初始值 |

### 8.2 e2e（`test/e2e/god-view.e2e.ts`）

- 中央判準換成 §7 的綠色版本，並在檔頭記下為什麼換
- 進上帝視角後截圖，人工看：**雙方**都要有框、框裡是長機、下面有 `(n/4)`
- console 錯誤 0 則（既有）

### 8.3 不做的事

**不寫「畫出來好不好看」的測試。** canvas 在 node 環境驗不到，而顏色、位置、
字級好不好只有專案負責人看得出來 —— 沿用天空海面那一份的裁決。

## 9. 不做

| 不做 | 為什麼 |
|---|---|
| 畫面外的邊緣箭頭 | §2 裁決。小地圖已經畫全場 |
| 分隊代號（`R2 (2/4)`） | §2 裁決。20v20 是十個分隊，十組文字太吵 |
| 僚機的任何標示 | 要求原文「只需標記小隊的長機」 |
| 血量 | M2 §8 的裁決不變：你看不出對方的結構完整度。「還有幾架」才是真實可觀察的量 |
| 座艙視角也加分隊框 | 座艙已經有完整的目標框與預瞄環，再疊一層是雜訊 |
| 小地圖上標長機 | 要求裡沒有。小地圖現在畫全部，改成只畫長機是資訊變少 |

## 10. 驗收回填（2026-08-09）

### 10.1 自動化

| 項目 | 結果 |
|---|---|
| `test/unit/hud.test.ts` | 66 → **81 條**（+15：`contactBoxRadius` 5、欄位初始值 1、`godMarkerVisible` 6、`flightStrengthLabel` 3、`godMarkerColor` 1、`drawGodMarkers` 3、池子容量 1、座艙不畫 1，其中一條既有的改寫） |
| `test/unit/battle-flights.test.ts` | 14 → **19 條**（+5：`flightOfIndex` / `isFlightLeader`） |
| 全套 | **2395 / 2401** —— 紅的是既有的那五條（三條傷害 ×3 待裁定、兩條更早的），**沒有多出第六條** |
| `perf-gate`、`rematch` | 4/4、3/3（單獨跑） |
| `npx tsc --noEmit` | 通過 |

### 10.2 突變驗證（七個，每個只殺該殺的）

| 突變 | 轉紅的 |
|---|---|
| `contactBoxRadius` 先夾再乘 | 只有「scale 不會把中間段乘第二次」—— 兩條夾制測試**照樣過**（9×2 = 18、46×2 = 92 剛好也對） |
| `contactBoxRadius` 完全不乘 scale | 「scale = 2 時下界是 18」與上界那條 |
| `godMarkerVisible` 拿掉 `c.flightLeader` | 「不是長機就不畫」+ 假 ctx 的「兩架同隊只畫一個框」 |
| `godMarkerColor` 傳 `flightMate = true` | 「敵方是危險色、我方是友軍色，沒有第三個」 |
| `godMarkers` 排到 `GOD` 名單最後 | 「上帝視角畫分隊標示、小地圖、名冊、提示」 |
| `flightStrengthLabel` 分子分母對調 | 三條（含假 ctx 的「框下的字是 (存活/編制)」） |
| `drawGodMarkers` 的 y 軸不翻 | 假 ctx 的兩條位置測試 |
| `isFlightLeader` 把 `positionOf` 寫成 `flightOf` | 「每個分隊的 members[0] 是長機」 |
| `flightOfIndex` 的 `f >= 0` 放寬成 `f >= -1` | 「已退場的那一架沒有分隊」 |

第一個突變**推翻了初版計畫的說法** —— 它原本宣稱兩條夾制測試會抓到，實際不會。
Codex 在審查時算出來的（`docs/superpowers/plans/2026-08-09-god-view-flight-markers.md`
的審查紀錄）。

### 10.3 e2e

```
[16] 座艙：中央的綠色 61、儀表區 37318
[17] 上帝視角：中央的綠色 0、儀表區 0（都必須是 0）
[17a] 分隊標示的像素 465
[21] console 錯誤 0 則
```

`[16]` 的 61 是新判準的反面驗證：`g > r && g > b` 加上 `a >= 128` 這把尺
**真的抓得到準星**。舊的「任意墨水」計數是 ~510，新的只數 α ≥ 128 的純綠
核心，所以少了一個數量級 —— 但它要守的東西沒變，而且不再會被紅藍的標示
誤觸。`battlefield-visuals.e2e.ts` 也跑過：console 錯誤 0、圖形 warning 0。

### 10.4 一個實測發現：進上帝視角的當下，戰鬥不在畫面裡

第一次拍出來的 `god-2-entered.png` 上一個框都沒有。查下去**不是缺陷** ——
量到的數字是：

| | 值 |
|---|---|
| 相機 | (−750, 4802, 4868)，俯角 −45°、yaw 0、fov 65 |
| 最近的一架 | (−2350, 3705, 4715) |
| 換到相機座標 | 前 857 m、左 1600 m、下 697 m |
| 偏離視軸 | 垂直 39.1°、水平 61.8° |
| 半視角 | 垂直 32.5°、水平 48.6° |
| 結果 | `NDC = (−1.649, −1.277)`，四十架**全部**在畫面左下角外面 |

手算的 NDC 與程式算出來的逐位元相同，所以投影本身沒問題。
`god-2-entered.png` 裡那些橄欖色的板子是**參照物不是飛機**。

**後果**：那一張不能當分隊標示的證據。`god-view.e2e.ts` 因此多了第 17a 步，
把鏡頭往左 1,600 m、往後 940 m、再爬高，讓兩隊同時落進視錐，拍
`god-2b-markers.png`。取景吃 `waitForTimeout` 與當下的幀率，所以那一步
**只記錄不斷言** —— 框畫不畫得出來由假 `CanvasRenderingContext2D` 的三條
單元測試守著。

### 10.5 截圖

`.shots/god-2b-markers.png`：上方五個紅框、下方四個藍框，全部 `(4/4)`，
一個分隊一個框。

### 10.6 專案負責人判定

（待填 —— 截圖已交付，等回覆。**這一格不得由實作者代填。**）
