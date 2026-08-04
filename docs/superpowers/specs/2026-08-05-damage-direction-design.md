# 受擊方向指示器 設計文件

被擊中時，螢幕邊緣依來彈方向閃出紅色漸層並淡出。

## 1. 為什麼要有它

20v20 裡「有人在打我」與「有**兩個**人從兩邊打我」是完全不同的處境，而目前
畫面上沒有任何東西區分它們 —— HP 條只說掉了多少血，不說從哪裡來。被咬住
的時候，玩家需要的是**往哪邊轉**，那是 HP 條回答不了的問題。

`HudFrame.hitFlash` 是**我打中人**（讀 `player.hitsDealt`），方向相反，不能沿用。

## 2. 四個裁決

專案負責人在原型上逐項決定：

| 題目 | 裁決 | 被否決的選項 |
|---|---|---|
| 漸層形狀 | **連續一團**，中心落在來彈角度上 | 四個角落依角度分配權重 |
| 正後方（畫面上沒有角度） | **整圈亮**，張角隨偏離視線的程度連續變化 | 固定畫在下緣／改用水平方位角 |
| 淡出期間玩家轉向 | **釘在畫面上**，只變淡不移動 | 跟著轉（世界鎖定） |
| 同時多方向 | **可以**，痕跡池 + 依 3D 方向合併 | 只留最後一發 |

### 2.1 「整圈」為什麼不是特例而是主幹

追尾視角下，**被咬六點是最常見的中彈方式**，而那個方向正好投影在畫面正中央
—— 沒有螢幕角度可言。所以它不是邊緣情形，是必須先解決的主要情形。

解法是讓角度窗與「均勻一圈」連續混合，混合比例就是**偏離視線的程度**
`m = hypot(x, y)`：側面來彈（m = 1）是一團，斜後方（m ≈ 0.7）是一團加一圈
微亮的底，正後方（m = 0）就是整圈。沒有門檻、沒有跳變。

### 2.2 光只在邊緣

偏離越小，光是**沿著邊界往兩側攤開**，不是往畫面中心移動。所以往內衰減的
距離是一個固定值，與方向無關。

## 3. 資料路徑

### 3.1 `World` 新增 `damageEvents`

`src/world/damage.ts`，與 `world/kills.ts` 同一套形狀：

```ts
export const DAMAGE_STRIDE = 4
export interface DamageEvents {
  readonly capacity: number
  /** 每筆 4 個 float：受害者索引, dx, dy, dz（來彈方向，世界座標單位向量） */
  readonly data: Float32Array
  count: number
  dropped: number
}
export function createDamageEvents(capacity?: number): DamageEvents
export function pushDamage(e, victim, dx, dy, dz): void
export function clearDamage(e): void
```

容量沿用 `IMPACT_CAPACITY = 64` 的推導：每次命中推一筆，與 `hitEvents` 同數量。

在 `World.resolveHits` 命中的那一步推，位置就在既有的 `pushImpact` 旁邊。

**【為什麼另開一個緩衝而不是塞進 `hitEvents`】** 那個型別是 `x,y,z,nx,ny,nz`，
消費者是火花與水柱。加兩個欄位會逼它們去猜哪幾個 float 是自己的 ——
`kills.ts` 的檔頭已經寫過這個理由。

**【為什麼對每一架都推，而不是只推玩家的】** `World` 不知道誰是玩家，這一版
也不該讓它知道。一次 push 是四個 float，`main.ts` 自己過濾。

### 3.2 方向取「彈丸速度的反向」

```ts
// 命中的那一步，p.vx/vy/vz 就在手上
const s = Math.hypot(vx, vy, vz)
if (s > 1e-6) pushDamage(this.damageEvents, victim.index, -vx / s, -vy / s, -vz / s)
```

**不是射手的位置。** 三個理由：

1. 命中那一步速度就在手上，不必反查射手 —— 而射手可能已經死了。
2. 887 m/s 飛 500 m 要 0.56 秒，射手早就移動了。指他**現在**的位置，指的是
   一個玩家沒看到過的東西。
3. 「子彈從那裡來」正是玩家在畫面上看到的曳光彈方向 —— 指示器與畫面一致。

## 4. 純邏輯：`src/hud/damageMarks.ts`

```ts
export interface DamageMark {
  /** 中彈當下的**視角座標**來彈方向，單位向量。x=右 y=上 z=後 */
  x: number; y: number; z: number
  /** 剩餘強度 0..1。0 = 空格 */
  intensity: number
}

export function createDamageMarks(): DamageMark[]
export function pushDamageMark(marks, x, y, z): void
export function stepDamageMarks(marks, dt): void
export function resetDamageMarks(marks): void

/** 螢幕上的角度。0 = 正右、π/2 = 正上 */
export function markAngle(m: DamageMark): number
/** 偏離視線多少。1 = 正側面、0 = 正前或正後（畫面上沒有角度） */
export function markOffAxis(m: DamageMark): number
/** 角度窗：中心最亮，往兩側以升餘弦落到 0，並依 `offAxis` 混合到均勻一圈 */
export function damageWindow(delta: number, half: number, offAxis: number): number
/** 兩個角度的最短夾角，−π..π */
export function angleDelta(a: number, b: number): number
```

### 4.1 合併規則

新的一發進來時，若與某一格既有痕跡的**點積** > `DAMAGE_MERGE_DOT`，就把那一格
的 `intensity` 設回 1 並**保持方向不變**；否則佔用 `intensity` 最小的一格。

**【為什麼用 3D 方向而不是螢幕角度判斷】** 正後方來的兩發沒有螢幕角度可以比
（都投影在中心），但 3D 方向幾乎平行 —— 用點積，那個退化情形自然就對了。

**【為什麼合併時不動方向】** 動了的話連射會讓那團光左右抖。一個攻擊者應該是
**一團持續亮著**，不是六十團。

### 4.2 角度窗

```ts
const lobe = d >= half ? 0 : 0.5 * (1 + Math.cos(Math.PI * d / half))
return offAxis * lobe + (1 - offAxis)
```

**【為什麼是升餘弦而不是線性】** 升餘弦（Hann）兩端的**斜率都是 0**，所以光
消失的地方切線平滑接上背景。線性衰減會在那個角度留下一道看得見的折痕。

## 5. 繪製：`src/hud/widgets/damageEdge.ts`

`drawDamageEdge(ctx, L, f)`。三個東西在做事：

**一、射線與矩形求交。** 由畫面中心朝角度 θ 射出，取
`t = min(cx / |cos θ|, cy / |sin θ|)` —— **最小值**才會打在真正的矩形邊上，
角落自然被包進去。用圓的話四個角會空掉。

**二、固定螢幕距離的往內衰減。** 深度是 `min(w, h) × DAMAGE_DEPTH`，
**不是半徑的百分比**。用百分比的話角落的半徑比中間長四成，紅帶會在四個角腫
起來。

**三、沿邊界掃 `DAMAGE_SEGMENTS` 段。** 每段一個梯形，配一條由**邊界指向畫面
中心**的 `createLinearGradient`（alpha 由該段的值衰減到 0）。方向永遠垂直於
邊界，所以長邊、短邊、角落看起來是同一條帶子。

**先把所有痕跡加總成一個 `alpha(θ)` 再畫**：

```ts
let a = 0
for (const m of marks) {
  if (m.intensity <= 0) continue
  a += m.intensity
    * damageWindow(angleDelta(mid, markAngle(m)), DAMAGE_HALF_WIDTH, markOffAxis(m))
}
a = Math.min(1, a) * DAMAGE_PEAK_ALPHA
```

重疊的痕跡自然疊亮（夾在 1 以內），而且每幀的填充次數固定
`DAMAGE_SEGMENTS` 次，與同時有幾個痕跡無關。

### 5.1 畫在哪一層

`Hud.render` 裡排在 `drawGEffect` 之後、`drawContacts` 之前 —— 壓在世界上面，
但儀表與數字壓在它上面維持可讀。與黑視／紅視同一個理由。

## 6. 接線

`HudFrame` 加一個欄位，與既有的 `contacts` 同一個模式（固定容量、`intensity === 0`
是空格）：

```ts
/** 受擊方向痕跡。`main.ts` 推入與步進，widget 只讀 */
damageMarks: DamageMark[]
```

`main.ts`：

1. **子步回呼裡**排空 `world.damageEvents`，只取 `victim === player.index` 的，
   轉到視角座標後 `pushDamageMark`，然後 `clearDamage`。位置就在既有的
   `clearImpacts(world.hitEvents)` 旁邊。
2. **幀尾**（`nextHitFlash` 旁邊）`stepDamageMarks(hudFrame.damageMarks, frameSeconds)`
   —— 一幀一次，不是一個子步一次。

### 6.1 視角座標的轉換用的是上一幀的相機

排空發生在物理迴圈裡，而 `rig.update` 排在它之後 —— 所以轉換讀到的
`camera.quaternion` 是**上一幀**的。硬轉率 90°/s、一幀 16 ms 下的誤差是 1.4°，
對一個 70° 寬的光團看不出來。**刻意不修**：為了少一幀而多開一個暫存緩衝，
複雜度換不到任何看得見的東西。

### 6.2 清除的時機

**`resetDamageMarks` 與 `resetGEffect` 成對出現。** 兩者的觸發條件完全相同：
玩家的處境發生了不連續的改變。目前是三處 —— `respawnPlayer`、接手僚機的
轉移、死亡鏡頭開始的那一幀。

不清的話上一場的紅邊會留到新的一場，而那正是 M10 在特效池上踩過的同一類問題。

## 7. 常數

| 常數 | 值 | 怎麼來的 |
|---|---|---|
| `DAMAGE_MARK_CAPACITY` | 6 | 同時有六個不同方向的攻擊者已經是極端情形；再多也讀不出來 |
| `DAMAGE_MARK_SECONDS` | **0.5** | 專案負責人裁決。比命中標記的 0.15 s 長 —— 那個是「我打中了」的瞬間回饋，這個是「有人在打我」的處境資訊，要撐得夠久讓人反應 |
| `DAMAGE_MERGE_DOT` | `cos 30°` | 同一個攻擊者連射的方向抖動遠小於 30°；兩個真正不同的方向遠大於 30° |
| `DAMAGE_HALF_WIDTH` | **70°** | 原型上調出來的 |
| `DAMAGE_DEPTH` | **0.22** | 短邊的比例。原型上調出來的 |
| `DAMAGE_PEAK_ALPHA` | **0.55** | 原型上調出來的 |
| `DAMAGE_SEGMENTS` | 64 | 每段 5.6°，配上升餘弦窗看不出接縫 |
| `DAMAGE_COLOR` | `rgb(255, 42, 32)` | **刻意比 `HUD_COLORS.danger`（#ff5a4d）更飽和**：danger 是目標框那種細線的強調色，攤成一大片半透明會發粉 |

## 8. 測試

全部是純函數，全部進得了 node 環境的單元測試。

**`damageMarks.ts`**

- `markAngle`：正右（x=1, y=0）→ 0；正上（x=0, y=1）→ π/2；
  「右上 15°」（x=cos 15°, y=sin 15°）→ 15° —— 也就是專案負責人原話裡的那個例子
- `markOffAxis`：正側面 → 1、正後方 → 0、正前方 → 0
- `damageWindow`：`offAxis = 1` 時中心為 1、`|delta| ≥ half` 為 0；`offAxis = 0` 時**任何角度都是 1**（整圈）
- `angleDelta`：跨過 ±π 取最短的那一邊
- `pushDamageMark`：幾乎平行的兩發只佔一格、`intensity` 回到 1、**方向不變**；相反方向佔兩格；滿了取 `intensity` 最小的一格
- `stepDamageMarks`：`DAMAGE_MARK_SECONDS` 之後歸零，且不會變成負數
- `resetDamageMarks`：全部歸零

**`damageEdge.ts`**：邊界點求交抽成可測的純函數 `borderPoint(theta, cx, cy, out)`

- 正右 → `(w, cy)`；正上 → `(cx, 0)`；正左 → `(0, cy)`
- **16:9 下的 45°打在上緣而不是右緣** —— 這一條擋的是「用圓當邊界」那個經典錯誤
- 任何角度算出來的點都落在矩形邊界上（四條邊各自的方程式）

**`damage.ts`**：`pushDamage` / `clearDamage` / 溢位計數，與 `kills.test.ts` 同一組。

**整合**：一場 20v20 打到有人中彈，`world.damageEvents.dropped` 恆為 0。

## 9. 人工驗收

1. 被打一發 → 紅光出現在正確的方位，0.5 秒內淡掉。
2. 被咬六點 → **整圈**，不是某一邊。
3. 左右各一個攻擊者 → **兩團**，各自淡出。
4. 同一個人連射 → **一團持續亮著**，不左右抖。
5. 光還亮著時大幅轉向 → 光**不動**，只變淡。
6. 任何情形下光都只在邊緣，不會出現在畫面中央。
7. 換一場、接手僚機、死亡鏡頭開始 → 紅光立刻清掉。
8. 紅光亮著時，儀表數字、目標框、準星仍然讀得清楚。
9. 20v20 混戰十分鐘，`dropped` 為 0（可用測試代替）。

## 10. 刻意不做

- **強度不隨傷害變化。** 被打就是被打；傷害量由 HP 條負責。
- **不區分正前方與正後方**（兩者都是整圈）。正面來的攻擊者本來就在畫面上
  看得見，多一個訊號回答同一個問題正是要避免的事。
- **不跟著轉。** 已裁決。
- **不脈動、不抖動。** 這是處境資訊，不是驚嚇效果。

## 11. 與原型的關係

`damageedge.html` ＋ `src/tools/damageedge.ts` 是調參數用的原型，§7 的三個數字
就是在它上面調出來的。它**現在自己抄了一份痕跡池與繪製邏輯**。

**實作完成後，工具頁必須改成 import `src/hud/damageMarks.ts` 與
`src/hud/widgets/damageEdge.ts`，不留第二份。** 留兩份就是這個專案一再點名的
「只有一份會被修好」—— 而工具頁的那一份還會反過來製造錯誤的信心，因為它看
起來像在驗證正式的東西。
