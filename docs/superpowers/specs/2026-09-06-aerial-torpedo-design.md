# 空投魚雷與投放包絡（2026-09-06）

專案負責人：「魚雷跟炸彈一樣按 B 投放，只是差在投放落水後會持續向前移動，
如果撞山或是撞船則發生爆炸」、「魚雷在水中移動時會在水面上產生小小水柱」
→ 改為「在水面上產生水花粒子就好」、「魚雷的模型可以考慮把炸彈拉長就好」。

**這一份同時補一件炸彈欠的事**：投放包絡。負責人：「投雷包絡要做，只有在
可投彈的位置投彈瞄準框才會變成綠色（否則紅色），炸彈也是一樣要做包絡
（例如顛倒飛不能投彈）」。

`docs/roadmap.md:231` 的那一行：「魚雷：入水、定深、直線航行、**航跡**、
命中船」。

---

## 0. 定案清單（來源：2026-09-06 的往返）

| 項目 | 裁定 |
|---|---|
| 船的水下命中盒 | **方案 (a)**：`ShipClass.hull` 的盒底往下拉到吃水深度 |
| 定深 | 水面下 **1 m** |
| G4M 掛載 | **預設魚雷 × 1**，任務模式可複寫 |
| 裝填 | 魚雷也要裝填時間，**比炸彈久** —— 投失敗不等於這一關結束 |
| 傷害 | 逐機種可調（同炸彈），**預設 15,000** |
| 引信 | **接觸引爆**：無範圍傷害、**不打飛機** |
| 包絡 | 魚雷與炸彈都要。可投 = 準星綠、不可投 = 紅 |
| 航跡 | **水面上的水花粒子**（`render/spray.ts` 現成的池） |
| 展示區 | 要。投彈 → 落水 → 航跡水花 → 引爆，可 REPLAY |

未裁定、由本 spec 定起始值：雷速、射程、包絡的六個門檻、裝填秒數、航跡的
間隔與顆數、吃水三個值。**全部標為「起始值，由試飛裁定」。**

**一個沒有裁定的缺口見 §11.1**（航跡預測線）—— 本期不做，但它決定這個
武器打不打得中，要在試飛之後回頭裁。

---

## 1. 量測：這份設計的數字基礎

### 1.1 諸元（九一式改三 航空魚雷）

```
  全長 5.27 m   直徑 0.45 m   全重 848 kg   炸藥 235 kg
  雷速 42 節 = 21.6 m/s       射程 2,000 m
```

遊戲取 **22 m/s**、**2,000 m** —— 射程用盡剛好 90.9 s。

### 1.2 提前量：這個武器的核心難度

船速 `MissionFleet.speed = 8`（`missions.ts:417`），Fletcher 全長 115 m：

```
  入水點到船    雷程時間    船跑掉      等於幾個艦身
     300 m       13.6 s     109 m          0.9
     500 m       22.7 s     182 m          1.6
   1,000 m       45.5 s     364 m          3.2
   1,500 m       68.2 s     545 m          4.7
   2,000 m       90.9 s     727 m          6.3   ← 射程用盡
```

**這張表是 §11.1 那個缺口的理由。** 現有的瞄具只畫入水點，玩家看不到雷跑
去哪；1,000 m 外投雷要提前三個艦身，靠目測幾乎不可能。

### 1.3 船的水下部分現在不存在

```
  essex     box([-14.2,  0, -133.0], [14.2, 12.0, 133.0])   ← 艦體，底 y = 0
            box([-24.5, 12, -130.0], [18.5, 14.0, 130.0])   ← 飛行甲板，底 y = 12
  fletcher  box([ -6.04, 0,  -57.4], [ 6.04,  4.5,  57.4])  ← 底 y = 0
  wichita   box([ -9.41, 0,  -92.7], [ 9.41,  7.0,  92.7])  ← 底 y = 0
```

三個**艦體**盒的底都在水線（Essex 的第二個盒是飛行甲板，底在 12）。定深
−1 m 的魚雷避得開現有的每一個盒，而**失效的樣子是「魚雷安靜地穿過去繼續
跑」** —— 看起來像沒瞄準，不像 bug。與 `ShipClass.radius` 那條註解是同一種
病：算錯不報錯。

### 1.4 「撞岸」的判準是碰撞面，不是水面

這個世界沒有海底：`collisionHeightAt` 在海上一律回 0、出界回 0
（`terrain.ts:125` / `terrain.ts:173` / `terrain.ts:227`）—— 海是一個 y = 0 的
無限深平面（負責人 2026-08-28 裁定：**海面碰撞體是平面，浪只是視覺高低**）。
所以魚雷撞不到海底，唯一撞得到的是**島的岸壁**：

```
  撞岸  ⟺  collisionHeightAt(x, z) > 0
```

**不是 `> 雷體高度`。** 雷體在 −1 m，而海面的碰撞高度是 0 —— `0 > −1` 恆成立，
照那樣寫魚雷一出膛就在海中央自爆。

**也不是問 `waterAt`。** 那一支回的是**含浪的**水面（`ocean.heightAt`），
一次要算 4 + 2 + 3 + 3 = **12 次 `Math.sin`**；而且它與 `collisionHeightAt`
的岸線差一個帶（`h > sea` vs `h > 0`），在淺灘上兩者會給出相反的答案。

> **兩個問題，兩支函式** —— `terrain.ts` 的介面註解已經寫過同一句。
> **魚雷的水陸判準是碰撞面**（平海，一次高度場取樣、零次 `sin`）；
> **炸彈的視覺判準是水面**（含浪，決定噴土還是噴水冠）。各自問對的那一支。

副產物：水中段**每步只付一次高度場取樣**，不必問 `waterAt`。含浪的水面只有
航跡要用，而航跡每 8 m 才取一次（見 §6.2）。

---

## 2. 模組

```
  weapons/stores.ts        Loadout ＋ 逐機種表 ＋ 任務複寫        純資料
  weapons/envelope.ts      canRelease()  投放包絡                  純函數
  world/torpedo.ts         Torpedoes  兩段彈道的 SoA 池
  world/ships.ts           hull 盒底往下拉到吃水
  world/World.ts           torpedoEvents / onTorpedoBlocked / dropTorpedo
  render/torpedoes.ts      拉長的彈體，InstancedMesh
  render/blast.ts          TORPEDO_BLAST 配方
  hud/types.ts             releaseOk / ordnance
  hud/widgets/bombsight.ts 圈的顏色吃 releaseOk
  main.ts                  串接
  torpedo.html
  src/tools/torpedo.ts     展示區
```

### 2.1 三張表併成一張

現在掛載資料散在 `weapons/bomb.ts` 的三個常數上：`BOMB_BAY_BY_AIRCRAFT`、
`BOMB_DAMAGE_BY_AIRCRAFT`、`BOMB_RELOAD_SECONDS`（後者還是全域的）。

**這個專案已經為「兩份清單」付過一次代價**：彈艙表寫 G4M 500 kg × 2、傷害
表卻是 800 kg 的數字，兩張對不起來，是在寫提交訊息時才發現的。加上魚雷之後
會變成六張表。所以併成一張：

```ts
export type OrdnanceKind = 'bomb' | 'torpedo'

export interface Loadout {
  readonly kind: OrdnanceKind
  /** 滿艙幾枚 */
  readonly count: number
  /** 每一枚的傷害。炸彈是爆心傷害，魚雷是接觸傷害 */
  readonly damage: number
  /** 空艙補滿要幾秒 */
  readonly reloadSeconds: number
}

export const LOADOUT_BY_AIRCRAFT: Readonly<Record<string, Loadout>>
export function loadoutOf(aircraftId: string): Loadout | null
```

`canBomb()` 退場，換成 `loadoutOf(id) !== null`。**一份清單，沒有第二份。**

### 2.2 這一期的三台

```
              掛載                     枚數   每枚傷害   裝填    一趟總量
  B-17G       AN-M64 500 lb            10      9,000     20 s     90,000
  He 111      SC 250                    8      9,300     20 s     74,400
  G4M         九一式改三 魚雷 × 1       1     15,000     45 s     15,000
```

G4M 由「500 kg × 2」改成「魚雷 × 1」—— 一式陸攻的 1,000 kg 上限本來就是
**擇一**：800 kg 魚雷一枚、500 kg 兩枚、250 kg 四枚。

### 2.3 任務複寫

`MissionBattle` 加一欄：

```ts
/** 複寫玩家的掛載。`undefined` = 用機種的預設（`loadoutOf`） */
readonly blueLoadout?: Loadout
```

【為什麼是整個 `Loadout` 而不是 `Partial`】部分複寫要定義「沒填的欄位從哪
來」，而那條規則沒有人會記得；整份替換則是看到什麼就是什麼。日 M3 的護送關
若要 G4M 掛炸彈，就在卡片上寫一份完整的。

【為什麼不放進 `BattleConfig`】它影響模擬，所以**要**進去 —— 與
`timeOfDay` 相反（那一個只影響畫面，明文規定不進 `BattleConfig`，見
`missions.ts:280` 的註解）。`missionConfigFrom` 要帶著它走。

---

## 3. 彈道：兩段

```
  第一段  空中   stepBomb()      與炸彈逐位元相同的自由落體 + 二次阻力
  ────────────── 入水（y ≤ waterAt）
  第二段  水中   定深、等速、直線、無重力、無阻力
```

### 3.1 空中段必須與炸彈共用 `stepBomb`

`world/bomb.ts:151` 花了一整段講「準星的預測與空中的炸彈逐位元相同」。魚雷
的入水點就是那個瞄具解出來的落點，所以**同一條不變式要延伸過來**：

> **入水點 ≡ `solveImpact` 在同一組初始條件下解出來的落點。**

實作上這是免費的：第一段直接呼叫 `stepBomb`，落地判定與內插也照抄那八行
（`world/bomb.ts:366` 已經寫著「差一個字就是準星與水柱分家」）。護欄要
逐位元比，不是 `toBeCloseTo`。

### 3.2 入水即定深

入水那一步：

```
  y  ← −TORPEDO_DEPTH                       （−1 m，平海）
  水平航向 ← 入水速度的水平分量歸一化
  速率     ← TORPEDO_SPEED                  （22 m/s）
  垂直速度 ← 0
```

**深度以平海為基準，不是浪面。** 同 §1.4：碰撞面是平的，浪只是視覺高低。
跟著浪走的話雷體會在 240 Hz 下上下抖，而且每步要付 12 次 `sin`。

**不做下潛過程。** 真實魚雷入水後會先下沉再回到定深，但定深只有 1 m ——
那個過程在畫面上是一公尺的起伏，成本是一條新的狀態與一條新的護欄。

【入水點的水平分量退化怎麼辦】垂直落下時水平分量為 0。包絡（§5）的
pitch 上限是 ±6°，垂直入水在遊戲裡不可能發生；但函式仍要有定義 —— 退化時
沿用**投放瞬間的機首水平方向**，因此 `dropTorpedo` 與 `Torpedoes.spawn`
都要收 `headX / headZ`。**不能從退化的速度反推。**

### 3.3 空中段的兩種去向、水中段的三種結束

空中段落地時，看落點是陸是水：

```
  collisionHeightAt(落點 x, z) > 0   →   撞岸，直接引爆（kind 0）
  否則                                →   入水，轉 phase 1
```

**問的是內插後的落點 x/z，不是步末的 x/z。** 跨越岸線的那一步，兩者會給出
相反的答案。

| 水中段的結束 | 判準 | 表現 |
|---|---|---|
| 撞船 | 線段 vs `hull` 盒（§4） | `TORPEDO_BLAST` ＋ 扣血 |
| 撞岸 | `collisionHeightAt(x, z) > 0` | `TORPEDO_BLAST` |
| 射程耗盡 | 累計航程 > `TORPEDO_RANGE` | **無聲消失**，不爆 |

【射程耗盡不爆】真實魚雷跑完自沉。爆了的話玩家會以為打中了什麼。

【累計航程而不是計時】速率是常數，兩者等價；但寫成航程時「射程 2,000 m」
在程式碼裡就是字面上的 2,000，不必再乘一次。

【**沒有整體的秒數上限**】空中段沿用炸彈的 `BOMB_MAX_SECONDS`（90 s）；
水中段只由航程回收。給整支魚雷加一個 90 s 上限的話，2,000 m ÷ 22 m/s =
90.9 s 會**在射程用盡之前先被砍掉** —— 射程於是變成一個講不通的 1,980 m。

### 3.4 逐位元護欄要觀察哪一個值

「入水點 ≡ `solveImpact` 的落點」**不能拿池子裡的 `y` 去比**：轉 phase 1 那
一步就把它改成 −1 了，而 `solveImpact` 的 `out.y` 是 `groundAt` 的 0。

所以 `Torpedoes.step` 多一支回呼 `onEntry(x, y, z)`，在轉 phase 1 的那一刻
以**內插後的落點**呼叫一次。護欄比的是它的三軸，`toBe` 不是 `toBeCloseTo`。

`onEntry` 不是只為了測試：入水要濺一叢水花，那一叢就掛在這裡。

---

## 4. 命中船：盒底往下拉到吃水

```
              現在的盒底    改成      實艦吃水
  fletcher        0.0       −4.0        3.8 m
  wichita         0.0       −6.5        7.2 m（滿載）
  essex           0.0       −8.5        8.4 m
```

### 4.1 這個改動對炸彈是零影響（**已用實際的 `pointBoxDistance` 量過**）

`pointBoxDistance` 的 `dy = max(0, |py − cy| − hy)`。爆心在水面 `py = 0` 時：

```
  Fletcher 舊盒 [0, 4.5]：cy = 2.25, hy = 2.25 → |0 − 2.25| − 2.25 = 0     → dy = 0
  Fletcher 新盒 [−4, 4.5]：cy = 0.25, hy = 4.25 → |0 − 0.25| − 4.25 < 0    → dy = 0
```

新舊兩個盒都把水面含在 y 區間內，`dy` 同為 0；橫向兩軸沒動。

**包圍球也不變**：三個吃水（4.0 / 6.5 / 8.5）都小於各自盒頂的絕對值
（4.5 / 7.0 / 12.0），所以 `boundingRadius` 的最遠角仍然由盒頂那一側決定。

**量測**（三個艦級 × 八個爆心高度 × 網格取樣，走真正的 `pointBoxDistance`
與 `bombBlastDamage`，殺傷半徑取 50 m 以便抓得到差異）：

```
  全部取樣          24,600 點     逐位元不同 2,681 點
  其中 py ≥ 0       21,525 點     逐位元不同     0 點
```

**差異全部落在水線之下**，而炸彈的爆心不可能在那裡：落水的那一顆
`onBombImpact` 收到的 `y` 是 `collisionHeightAt` 的 0；打中船的那一顆是
`segmentBox` 的進入點，而炸彈由上而下，進入面恆是盒頂（≥ 4.5）。

**所以炸彈的範圍傷害逐位元不變。** 這一條仍要寫成迴歸護欄——上面是量測，
護欄是為了讓它日後改盒時還會紅。

子彈同理不受影響：彈丸打到水面就停在 y = 0，到不了盒的新增部分。

`ShipClass.radius` 由 `radiusOf()` 就地算出（`ships.ts:213`），會跟著變大
——那個方向是保守的，而且 `ships.test.ts:21` 只斷言它是上界。

### 4.2 魚雷只掃船體，不掃砲位

炸彈的 `onBombBlocked` 兩種盒都掃，理由是「炸彈是面殺傷，落在砲座上與落在
甲板上都是打中這艘船」。魚雷在水面下 1 m，而砲位盒全部在甲板上（Essex 最低
的砲位在 y = 14.18）—— 掃它們是純粹的浪費，而且會讓「魚雷打掉了防空砲」
變成一個講不通的結果。

### 4.3 傷害：接觸引爆

```
  Fletcher 20,000   ÷ 15,000 → 2 枚
  Wichita  40,000   ÷ 15,000 → 3 枚
  Essex    60,000   ÷ 15,000 → 4 枚
```

命中的那一艘扣 `damage`，**就這樣**：沒有距離衰減、沒有第二艘、不掃
`combatants`。`applyBombBlast` 那一支不共用。

【`ships.ts:47` 的註解要改】它現在寫著「驅逐 20,000 ≈ 兩枚（若一枚
10,000）」。一枚改成 15,000 之後枚數不變（20,000 / 15,000 仍是 2 枚），
但那個括號裡的數字是錯的，要就地改掉 —— 註解寫現狀，不寫沿革。

---

## 5. 投放包絡

### 5.1 一支純函數，兩張表

```ts
export interface ReleaseEnvelope {
  /** 最大坡度，rad。倒飛一定超出 */
  readonly maxRoll: number
  /** 俯仰的下界與上界，rad */
  readonly minPitch: number
  readonly maxPitch: number
  /** 離地高度的上下界，m */
  readonly minAgl: number
  readonly maxAgl: number
  /** 真空速的上下界，m/s */
  readonly minTas: number
  readonly maxTas: number
}

export function canRelease(
  env: ReleaseEnvelope,
  roll: number, pitch: number, agl: number, tas: number,
): boolean
```

【為什麼是純函數】`main.ts` 的每幀迴圈進不了單元測試，而「什麼時候投得下
去」是一條有實際後果的規則 —— 與 `bombsightStyle`、`contactColor`、
`minimapSymbol` 同一個做法。

### 5.2 兩張表（起始值，由試飛裁定）

```
                    |roll|     pitch        AGL          TAS
  BOMB_ENVELOPE      ≤ 90°   −70°…+70°    ≥ 60 m       不限
  TORPEDO_ENVELOPE   ≤ 12°    −6°…+6°    20…120 m      不限
```

**炸彈那一張只擋退化狀態。** 90° 是「翻過去就不能投」（負責人：「例如顛倒
飛不能投彈」），60 m 是自己的爆炸半徑（基準彈 30 m）的兩倍。平飛投彈時它
永遠不作用 —— 與 `coneClamp` 的 70° 圓錐是同一種東西：安全網，不是常態限制。

**魚雷那一張是這個武器的玩法**，但**不限速度**（負責人 2026-09-06：
「魚雷包絡先不要限制飛機速度好了，不然很難投彈」）。史實上九一式初期型
限高 20 m、限速 180 節，遊戲只留姿態與高度兩個維度。

`ReleaseEnvelope` 的 `minTas` / `maxTas` **兩張表都填 0 與 `Infinity`**，
欄位保留、`canRelease` 仍收 `tas`。要重新開速度限制時是改一個數字，不是改
一支函式的簽章與它的每一個呼叫端。

`maxAgl` 是魚雷獨有的：太高投下去雷體會折斷。炸彈那一張沒有上界（`Infinity`）。

### 5.3 HUD

`HudFrame` 加兩欄：

```ts
/** 這一幀投得下去嗎。準星的顏色看它 */
releaseOk: boolean
/** 掛的是什麼。`null` = 這一台沒有掛載 */
ordnance: OrdnanceKind | null
```

準星的顏色：

```
  可投    HUD_COLORS.primary   #7dfba8  綠   ← 現況就是這一個
  不可投  HUD_COLORS.danger    #ff5a4d  紅
```

一般飛行的暗圈（`style === 'faint'`）也照這條走 —— 那個圈本來就是「現在按 B
投得中」的訊號，顏色再帶上「而且投得下去」是同一件事的延伸。

抽成純函數 `bombsightColor(style, releaseOk): string`，與 `bombsightStyle`
並排。

### 5.4 包絡不成立時，扳機怎麼辦

**吃掉扳機，不投。** 與 `stepBombBay` 在回補期間吃掉扳機是同一條規則
（`weapons/bomb.ts` 已經寫過理由）：按了沒反應會被當成 bug，但「準星是紅的」
是一個玩家看得到的狀態，所以它是規則而不是失靈。

已經排進 `queue` 的連投遇到包絡失效時**暫停**而不是取消 —— B-17G 一串十枚
投到一半被防空砲打得翻過去，取消整串會比暫停更難懂。

**所以 `releaseOk` 必須是 `stepBombBay` 的參數，不是呼叫端的一個 `&&`。**
那支狀態機有兩段各自獨立的分支：

```
  if (trigger && b.queue === 0 && b.load > 0) b.queue = b.load   ← 排入整艙
  if (b.queue > 0 && b.timer <= 0) { drop(); b.load--; b.queue-- } ← 真正投彈
```

在呼叫端寫 `press && releaseOk` 只閘得住第一段，`queue` 裡的照樣投出去。
而只把 `drop()` 換成空函數更糟：`load` 與 `queue` 仍然遞減，**彈藥被無聲
吃掉**。

`releaseOk === false` 時：兩段都不執行，但 `timer` 與回補照常推進 ——
補彈不該因為玩家在翻滾而停住。

---

## 6. 表現

### 6.1 模型：把炸彈拉長

```
              全長      直徑     長徑比
  AN-M64      1.6 m    0.36 m     4.4
  九一式      5.27 m   0.45 m    11.7
```

`createBombGeometry()` 的 `PROFILE` 與尾翼常數抽成參數：軸向 ×3.3、徑向
×1.25、尾翼跨度縮到彈體直徑的 1.5 倍（炸彈是 1.9 倍）。旋成體仍是 `RADIAL = 5`
的五邊形剖面。`bombOrientation()` 直接沿用 —— 入水後速度水平，姿態自然就對。

【共用 `InstancedMesh` 嗎】不。兩種幾何不同，而 `InstancedMesh` 一個實例
一種幾何。多一個 draw call，池只有 8 格。

### 6.2 航跡：水面上的水花

魚雷每跑 `WAKE_INTERVAL` 公尺，在**含浪的水面**（`waterAt`，不是雷體高度）
推一筆 `ImpactEvents`，交給現成的 `emitSpray`。**這是整條路上唯一問
`waterAt` 的地方** —— 每 8 m 一次而不是每步一次，那 12 次 `sin` 於是從
每秒 5,280 次（22 m/s ÷ 240 Hz）降到每秒 33 次。入水的那一叢走 `onEntry`
（§3.4），同一個池子：

```
  WAKE_INTERVAL     8 m      22 m/s 之下每 0.36 s 一叢
  WAKE_SPRAY_COUNT  3        一叢三顆
```

`SPRAY_LIFE = 0.6 s`，所以同時活著約 5 顆 —— 池子 1,024 格綽綽有餘。跑滿
2,000 m 共 250 叢 × 3 = 750 顆，全程不會繞回去打到自己。

【為什麼不是 `splashes` 的水柱】那個池的尺寸寫死在模組常數上
（`SPLASH_HEIGHT = 12` m），航跡要的是水面上的一點白 —— 差兩個數量級。
負責人裁定改水花粒子。

【錐軸是 +Y】`emitSpray` 已經寫死了這一條，而且註解說明了理由（水面法線
幾乎恆為向上）。航跡正好要那個方向。

### 6.3 命中的爆炸

新配方 `TORPEDO_BLAST`：以水冠為主，**比 `WATER_BLAST` 更窄更高** ——
魚雷命中船側是一道貼著艦身升起的水牆，不是散開的水冠。

```
                  WATER_BLAST   TORPEDO_BLAST
  jetCount            13             9
  jetSpread          6.5 m         4.0 m
  jetHeight           34 m          46 m
  jetRadius          3.2 m         3.6 m
  mistPerJet           5             6
```

火與煙都是 0 —— 水下爆炸不出火球。撞岸時用同一份（岸邊的水柱），本期不為
撞岸另開一張。

---

## 7. `World` 的接線

```ts
readonly torpedoes = new Torpedoes()
/** nx: 0 撞岸 1 撞船。ny: 傷害 */
readonly torpedoEvents: ImpactEvents = createImpacts()
/** 入水與航跡的水花事件。呼叫端每**物理子步**排空 */
readonly torpedoWakeEvents: ImpactEvents = createImpacts()
dropTorpedo(x, y, z, vx, vy, vz, damage, headX, headZ): void
/** `onTorpedoBlocked` 找到的那一艘，`onTorpedoEnd` 接著讀 */
private torpedoShip: Ship | null = null
```

`step()` 的 3.5 之後插一段 3.6，形狀與炸彈那一段相同。散佈沿用
`spreadPair(this.torpedoes.dropped, …)` —— 確定性重播是這個專案的鐵律
（`resetBattle` 對 `world.time` 寫過）。

### 7.1 命中的是哪一艘，靠欄位傳遞

`TorpedoBlockFn` 只回一個 `t`，而扣血要知道是哪一艘 —— 與炸彈的 `bombShip`
完全相同的處置（`World.ts:296`）：兩支回呼在同一個迴圈裡連續呼叫，用一個
欄位傳遞就不必配置。**每次進 `onTorpedoBlocked` 的第一行清成 `null`。**

比較的形狀也要照抄，`NO_HIT` 是 **−1** 不是 `Infinity`：

```ts
if (t === NO_HIT || (best !== NO_HIT && t >= best)) continue
```

寫成 `t >= best` 而不先擋 `best === NO_HIT` 的話，初值 −1 會讓每一個合法的
`t ≥ 0` 都被跳過。池子那一端則是 `bt >= 0 && bt <= 1`（同 `Bombs.step:352`）。

### 7.2 `resetBattle` 要清池

`setup.ts` 的 `resetBattle` 現在明列清彈丸與炸彈。魚雷要一起：不清的話上一
局的魚雷會在新的一局繼續跑，而 **`dropped` 不歸零則重播的散佈不同** ——
`Bombs.clear` 已經示範過兩者都要重設（`world/bomb.ts:303`）。

---

## 8. 展示區

`torpedo.html` ＋ `src/tools/torpedo.ts` ＋ `vite.config.ts` 的
`rollupOptions.input` —— 與 `blast.html` 同一套慣例。

**演的是一整條**：投放 → 空中段 → 入水 → 航跡 → 命中引爆。

旋鈕：

```
  投放高度 AGL     20…200 m        （看得到包絡的上下界）
  投放速度 TAS     40…140 m/s
  投放坡度／俯仰   ±30°            （紅綠準星在這裡看得出來）
  定深             0.5…4 m
  雷速             10…40 m/s
  射程             200…2,000 m
  航跡間隔／顆數
  目標距離         200…1,500 m     （一艘 Fletcher，會動）
  目標航速         0…16 m/s
  整體播放速度     0.1…2×
  自動重播
```

`__torpedoProbe.sheet()` 照 `blast.ts` 那一支：固定 dt 手動推進、在瀏覽器內
合成 contact sheet，`toDataURL` 在 `render()` 之後的同一個同步區塊取。

---

## 9. 起始值總表（由試飛裁定）

```
  TORPEDO_SPEED           22 m/s
  TORPEDO_RANGE        2,000 m
  TORPEDO_DEPTH            1 m      ← 負責人指定
  TORPEDO_DAMAGE      15,000        ← 負責人指定（預設值）
  TORPEDO_RELOAD          45 s
  WAKE_INTERVAL            8 m
  WAKE_SPRAY_COUNT         3
  吃水  fletcher −4.0 / wichita −6.5 / essex −8.5
  TORPEDO_ENVELOPE   roll 12°, pitch ±6°, AGL 20…120 m, TAS 不限
  BOMB_ENVELOPE      roll 90°, pitch ±70°, AGL ≥ 60 m,  TAS 不限
```

**沒有 `TORPEDO_MAX_SECONDS`** —— 見 §3.3：空中段用炸彈的 90 s，水中段只
由航程回收。

### 9.1 效能：量過的

現行的 `perf-gate` 20v20 走 `DEFAULT_BATTLE`，**沒有艦隊也沒有魚雷**，所以
跑它對這一輪不承重。另外量（`bench/torpedo-load.ts`，倫內爾島 8 艘船 ×
12 架飛機，兩份負載交錯 4,000 步，傷害設 0 以免船沉了讓「有魚雷」看起來
反而更快）：

```
  8 枚魚雷        86.8 µs/step
  0 枚魚雷（對照） 77.3 µs/step
  ────────────────────────────
  增量             9.5 µs/step  ＝ 每枚 1.19 µs
```

`perf-gate` 的硬門檻是 900 µs、設計預算 300 µs —— 八枚滿池是預算的 **3%**。

【為什麼這麼便宜】水陸判準改成平海的 `collisionHeightAt > 0` 之後，每一枚
每一步只付**一次高度場取樣**（零次 `Math.sin`），加上對每一艘船一次線段到
船心的粗篩。含浪的 `waterAt`（12 次 `sin`）每 8 m 才問一次。

---

## 10. 測試計畫

每一條**先驗紅**。

| 檔案 | 承重的斷言 |
|---|---|
| `torpedo.test.ts` | 入水點與 `solveImpact` **逐位元**相同；入水後定深；水中段不受重力；射程耗盡不推事件；撞岸推事件 |
| `torpedo-vs-ship.test.ts` | 命中扣 `damage`；三級船各要幾枚；**不掃 `combatants`**；**不掃砲位盒**；從船底下 −1 m 通過會命中（1.3 的那個坑） |
| `ship-draft.test.ts` | 每個艦級的 `hull` 最低點 < 0；**炸彈近失傷害在改盒前後逐位元相同** |
| `envelope.test.ts` | 倒飛（roll 180°）不能投；魚雷包絡四個維度各自的兩個邊界；炸彈包絡在平飛投彈的整個高度帶恆為真 |
| `stores.test.ts` | 三台各自的掛載；任務複寫蓋得掉預設；`loadoutOf` 與能不能按 B 是同一份清單；魚雷的裝填比炸彈久 |
| `hud-bombsight.test.ts` | `bombsightColor` 的四種組合 |

`perf-gate.test.ts` 與 `rematch.test.ts` 單獨跑（併行會假紅）。

---

## 11. 不做

| 項目 | 理由 |
|---|---|
| **航跡預測線** | 見 §11.1 —— 待裁定 |
| AI 投雷 | `ai/shipAttack.ts:132` 已經備好目標（砲位打光改瞄船體），但 AI 的攻擊航路是另一輪 |
| 魚雷影響飛行性能 | roadmap §2.3 的獨立一條 |
| 跳彈／雷體折斷的失敗表現 | 包絡直接擋住，投不出去 |
| 撞岸專用的爆炸配方 | 沿用 `TORPEDO_BLAST` |
| 水下的雷體要不要看得見 | 定深 1 m，本來就看得到；不另做水下渲染 |
| 任務接線（日 M4） | 這一份只做武器 |

### 11.1 缺口：航跡預測線

§1.2 那張表說明了，1,000 m 外投雷要提前三個艦身，而現有瞄具只畫**入水點**。
沒有提前量提示的話，這個武器在遊戲裡幾乎打不中移動中的船。

最小的補法是從入水點沿投雷航向畫一條線，帶幾個秒數刻度（10 / 20 / 30 s
的雷位），玩家自己把刻度對到船的未來位置上。成本是兩個世界座標的投影連線。

**本期不做**：負責人的裁定清單裡沒有它，而它會改變瞄具的視覺語言。
**要在試飛之後回頭裁** —— 若試飛證實打不中，這是第一個該補的東西。
