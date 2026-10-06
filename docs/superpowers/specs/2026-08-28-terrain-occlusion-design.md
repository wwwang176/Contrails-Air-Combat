# 山要擋得住子彈與視線 設計

日期：2026-08-28
分支：`feat/terrain-occlusion`
前一份：`2026-08-27-terrain-in-play-design.md`

---

## 1. 現況：專案沒有「遮蔽」這個概念

專案負責人 2026-08-28 問的兩件事，**兩件都成立**，而且第三件更嚴重：

```
  一、AI 會對地形後面的敵人開火      shouldFire 的四個條件全是幾何與運動學
  二、AI 會對地形後面的瞄準做防禦    alarmFactor 只算「他的預瞄環套得住我嗎」
  三、子彈真的會穿過山打死人        Projectiles.step 是純等速直線，
                                     World.resolveHits 只做彈丸線段 × 命中盒
```

整個 `src/` 裡 `blocked` 這個字只出現在 `terrainSense.ts`（繞路判斷）。

第三件是**正確性問題**，前兩件是效率問題 —— 只修 AI 端會變成「AI 不開槍，
但玩家的子彈照穿」。

### 1.1 為什麼不去仗裡量發生率

在一場仗裡數「有幾發穿山」會數到 0 —— **那個 0 只代表這一場沒撞上，不代表
沒有這個 bug**。遮蔽是一個確定的幾何事實，直接算出來、把情境造出來就好。
專案負責人 2026-08-28 的裁定。

（掃描算過：有效射程內、兩架都離地 30 m 以上、繞著錨島取樣，被擋的比例是
0.12~0.42%。低是因為島是 smoothstep 的圓丘，平均坡度只有 0.5。）

### 1.2 一組算出來的 fixture

```
  兩架同高 y = 850 m
  各在錨島（cx 2500、cz −950、peak 900、outerRadius 1806）島心兩側 500 m
  相距 1,000 m —— 在有效射程之內
  兩架離地都是 126.6 m —— 高於安全層的 clearance（120），也就是正常在飛
  山頂比兩者的連線高 49.6 m
```

掃過「離島心多遠 × 多高」的網格，在「兩架離地都 ≥ 120 m」的條件下取視線
沉得最深的一組（`test/tools/occlusion-case.probe.ts`）。

---

## 2. 目標與界線

```
  彈丸           撞到陸地 → 火花 + 消失。畫面上打得到的地方就是子彈到得了的地方
  戰鬥機 AI      視線被陸地擋住時不開火、也不對它做閃躲
```

**「AI」含轟炸機砲塔。** 專案負責人 2026-08-28：「轟炸機身上的自動機槍
理論上不應該把山後的敵人列入考慮。」`world/turrets.ts` 的 `pickTarget`
因此也要擋。

**但只擋選目標，不擋扳機。** 搜尋每 `SEARCH_INTERVAL`（1 秒）一次，扳機
是每步的 —— 160 座砲塔 × 240 Hz 的遮蔽查詢付不起（砲塔有自己的 perf
gate）。代價是目標剛轉到山後的那**最多一秒**裡砲塔還在打，而那些子彈由
彈丸端收掉，畫面上是打在山壁上的火花。**這是取捨，不是漏掉。**

### 2.1 驗收

```
  彈丸    有山：命中 0、火花 > 0；沒山：命中 > 0             ← 對照組
  AI      有山：shouldFire false、danger 0；沒山：兩者都回來  ← 對照組
  海面    水柱仍在 y = 0、彈丸仍到 SEA_KILL_Y 才消失、沒有地形火花
  既有    三支 digest 護欄不變、全套全綠、perf-gate（含新的地形案例）
```

---

## 3. 設計

### 3.1 `LandField`：陸地，而且只有陸地

```ts
export interface LandField {
  /** 與 `render/island.ts` 切 mesh 用的是同一份 */
  readonly field: HeightFieldData
  /** 全場陸地的最高點，m */
  readonly ceiling: number
}
```

**不另造 `at`／`step`。** `HeightFieldData` 已經有 `sample` 與 `cell`，
再包一層同義的介面只是多一份要維護的東西。真正缺的只有 `ceiling`。

**沒有陸地就是 `null`，不是一個假的平原。** `'sea'` 那一種地形回 `null`。
造一個 `ceiling = SEA_FLOOR` 的假物件會讓每一發入海的子彈都去查高度場，
而且下面那條「陸地要 > 0」的判斷會變成唯一擋住海面回歸的東西 —— 兩道
保險比一道好。

**判準是 `land > 0`，不是 `land > −∞`。** 高度場沒有島的地方是
`SEA_FLOOR = −8`（`archipelago.ts`）。少了 `> 0` 這一半，一發入海的子彈會在
水下 8 m 被當成「撞地」，推一筆火花並提早消失 —— 而現行行為是在 y = 0 推
水柱、到 `SEA_KILL_Y = −20` 才回收。**海面那一條一個字都不動。**

### 3.2 彈丸：先算交點，再跟 `bestT` 比先後

`World` 加 `land: LandField | null = null`。`resolveHits` 對每一發：

```
  1. 照舊掃視窗內的飛機，得到 bestT（最近的命中）
  2. 算這一步的線段第一次沉進陸地的 landT
  3. landT < bestT  → 火花 + kill，不算命中
     否則           → 照舊
```

**為什麼不能在迴圈開頭直接 `continue`。** 那會吃掉同一步之內「先打中飛機、
後進入地面」的合法命中。飛機真的會貼著坡面飛 —— 上一輪的甲板實測量到過
**離地 6 m**，而彈丸一步走 3.7~4.5 m（`.50` 的 887 m/s 加上射手速度）。
那個窗口是真的。

**`landT` 怎麼算。** 沿這一步的線段以 `cell / 4`（10 m）為步長掃，取第一個
`y < land` 的取樣點。**不是只查終點** —— 兩端都在地形之上，中間仍可能跨過
一條稜線（格內是兩個平面三角形，`heightfield.ts` 明寫）。10 m 的步長在
坡度 ≤ 0.5 的地形上把漏判的深度壓到 2.5 m 以下。

**這一條保住了鐵律。** `field.sample` 讀的是 `render/island.ts` 切 mesh 用的
**同一份 `Float32Array`**、用**同一組三角形**。

### 3.3 火花：沿用 `hitEvents`，法線取三角形的

推一筆 `hitEvents`。**渲染層一行都不用改** —— 它現在的消費者是
`sparks.emit`（`main.ts` 與 range 工具），傷害走的是另一條（`damageEvents`）。
專案負責人 2026-08-28 指定「跟打到飛機一樣的火花」。

**不推 `damageEvents`。** 那一條是「我被誰從哪個方向打到」的 HUD 指示器，
要一個 `victim.index`。山不是一架飛機。

**法線用三角形的真法線，不是 +Y 也不是中央差分。** `heightfield.ts` 的
`sample` 已經明確定義格內是哪兩個三角形（對角線是 `tx + tz = 1`），所以
那個平面的法線是閉式的：

```
  三角形 a–c–b   ∂h/∂x = (h10 − h00)/cell   ∂h/∂z = (h01 − h00)/cell
  三角形 b–c–d   ∂h/∂x = (h11 − h01)/cell   ∂h/∂z = (h11 − h10)/cell
  n = normalize(−∂h/∂x, 1, −∂h/∂z)
```

**它就是畫面上那個面的法線** —— 與 `sample` 共用同一段三角形判斷，
所以不會有第二個真相。中央差分算的是跨好幾格的平滑近似，那才是憑空多出來
的第三份幾何。

**`hitEvents` 的語意變了，要寫下來。** 它從此是「彈丸撞到了東西」而不是
「彈丸打中了飛機」。`multi-battle.test.ts` 拿 `hitEvents.count` 當命中數
（那一支不注入地形，所以不受影響），但下一個人會踩到。

**容量要驗，不要先猜。** `IMPACT_CAPACITY = 64` 的推導只算了 40 架的固定槍；
現在還有 160 座砲塔，而山壁會讓大量彈流在同一子步集中撞擊。護欄斷言
`dropped === 0`，**不夠再調**。

### 3.4 AI：遮蔽在 `AiController` 套，不進 `assess.ts`

```
  shouldFire   加第五個條件，查的是**預瞄射線**：self → self + basis.leadPoint
  danger       AiController 算出 visible 之後，threat 與 alarm 一起歸零
```

**為什麼遮蔽不進 `threatFactor` / `alarmFactor`。** 那兩個函式的呼叫端不只
一處：`evaluateThreat`、`considerThreatFrom`、`targetScore` 各有自己的路徑。
把地形做成可選參數穿過去，漏接哪一條都**不會有型別錯誤**，而症狀是
「測試全綠但飛機照樣閃山後面的瞄準」。在 `AiController` 套一次 mask 是
一個地方、一條路。

**為什麼 threat 與 alarm 一定要一起歸零。** `danger = max(threat, alarm)`，
而「`alarm ≥ threat` 恆成立」有單元測試釘住。只擋一邊等於沒擋。

**為什麼查預瞄射線而不是目標現在的位置。** 子彈飛的是預瞄那條線。
`buildEngageBasis` 已經算好 `leadPoint = P + V·t`，橫向相對速度 200 m/s、
攔截時間 1 秒就是 200 m 的差 —— 那個差足以讓「目標看得見但預瞄射線撞山」
與「目標被擋但預瞄射線繞過去」兩種都發生。

**目標選擇不改。** `targetScore` 仍然可能選一個山後面的敵人。那是另一個
需求（`targetScore` 有 base／opportunity／range／turn 四項，threat 歸零
不等於不選它），這一輪不做。

### 3.5 `losBlocked`：取樣，而且說清楚它的界

```ts
export function losBlocked(
  ax, ay, az, bx, by, bz, land: LandField,
): boolean
```

- 兩端都高於 `land.ceiling` → 立刻 false。
- 否則沿線段以 `cell / 2`（20 m）為步長掃。

**它不是精確的，不要宣稱它是。** 格內是兩個平面三角形，取樣更細**確實會**
多知道事情。20 m 步長在坡度 ≤ 0.5 的地形上把漏判壓到 5 m 以下 —— 而這一層
漏判的代價是**AI 多開一輪空槍**，彈丸那一側仍然會把子彈收掉。
兩層的失效方向不同，所以精度要求也不同。

（`terrainSense` 的避障刻意不取樣，因為那一層漏判的代價是撞山。）

---

## 4. 介面

```ts
// world/heightfield.ts
normalAt(x, z, out: {nx,ny,nz}): void        // 與 sample 共用三角形判斷

// world/occlusion.ts（新檔）
export interface LandField { field: HeightFieldData; ceiling: number }
export function losBlocked(ax,ay,az, bx,by,bz, land): boolean
export function landHitT(ax,ay,az, bx,by,bz, land): number   // 無交點回 Infinity

// world/World.ts
land: LandField | null = null

// render/terrain.ts
interface Terrain { readonly land: LandField | null }   // 'sea' 是 null

// ai/terrainSense.ts
interface TerrainSource { readonly land?: LandField }

// ai/fire.ts
shouldFire(sit, basis, self, cfg?, land?: LandField | null): boolean
```

**全部是可選的最後一個參數或可選欄位。** 不給 = 現況。

---

## 5. 量測與驗收

### 5.1 主要護欄：`test/integration/terrain-occlusion.test.ts`

用 §1.2 的考題，**每一條都有對照組**（`land` 設成 `null` 再跑一次）：

```
  彈丸   開火 6 秒      有山 命中 0、火花 > 0     沒山 命中 > 0
  AI     shouldFire     有山 false                沒山 true
  AI     跑 AiController 有山 不進 defend          沒山 進 defend
```

**第三條要跑控制器，不能只測純函式。** 只測 `shouldFire` 抓不到「mask 沒
接上」——而那正是這一輪最容易漏的地方。要跑滿反應延遲與 `alarmRamp` 的
飽和時間。

**對照組是這一支的一半。** 沒有它，「命中 0」也可能是因為兩架根本打不到
對方（初稿的探針就犯過：把兩架擺在 1,800 m 外，量到的是射程不是遮蔽）。

### 5.2 其餘新測試（每一條先驗紅）

```
  occlusion   兩點都高於 ceiling → 不擋，而且**不查高度場**（用計數的假物件）
  occlusion   §1.2 的考題 → 擋；兩架各抬高 60 m → 不擋
  heightfield normalAt 與 sample 用同一個三角形（平面上取三點驗共面）
  world       land 為 null 時彈丸行為與改動前逐位元相同
  world       海面回歸：水柱仍在 y = 0、彈丸到 SEA_KILL_Y 才消失、無地形火花
  world       同一步先中飛機、後進地形 → 算命中，不算撞地
  world       撞到陸地推 hitEvents、**不推** damageEvents
  perf-gate   注入地形、彈丸在 ceiling 以下的 20v20
```

### 5.3 不得退步

```
  replay-determinism / order-of-battle-replay / tactics-off   三支 digest 護欄
  perf-gate          既有 6 條 + 新的地形案例
  全套               3,017 條全綠
  terrain-in-play    甲板 7/40、中空 0/40
```

**`rematch` 不是 digest 護欄。** 它驗的是「連開十場不會愈來愈慢」。
前兩輪的收尾把它寫成 replayDigest 的護欄，那是引錯了 —— 真正算 digest 的
是上面那三支（2026-08-28 實跑 10/10 綠）。

**`perf-gate` 現有的六條證明不了這一輪。** `bench/projectile-load.ts`、
`ai-load.ts`、`multi-load.ts` 建的 `World` 都沒有地形，新路徑一次都沒走到。
而且甲板的仗裡子彈本來就在 `ceiling` 以下 —— **`ceiling` 早退在這一輪真正
要支援的情境裡不會早退**。所以要加一個注入地形的案例。

---

## 6. 事前約定的否決條件

- 新的 perf 案例超出預算 → **回頭改演算法，不改門檻**
- 三支 digest 護欄任一條變了 → 有東西漏進了不該有地形的路徑
- 海面回歸那一條紅 → `land > 0` 或 `null` 這兩道保險漏了一道
- 對照組（沒山）那一半不成立 → 考題擺錯了，不是修好了

---

## 7. 明確不做

- **砲塔的扳機** —— 只擋選目標，見 §2。
- **戰鬥機的目標選擇** —— `targetScore` 仍可能選一個山後面的敵人。
  它有 base／opportunity／range／turn 四項，threat 歸零不等於不選它，
  要改是另一個需求。見 §3.4。
- **新的粒子種類** —— 火花沿用 `hitEvents`。水柱那一條（`splashEvents`）
  是水面專用的，不動。
- **玩家的預瞄環** —— 玩家看得到山。
- **遮蔽的部分可見** —— 只有「擋住／沒擋住」。
- **AI 的路徑層／地形戰術層** —— 見上一輪。

---

## 8. 全域限制

- `src/ai/` 熱路徑不得配置、不得 `Math.random`
- 註解寫現狀，不寫沿革
- 不寫飛機外形的測試
- 每一條新測試先驗紅，或以變異證明承重
