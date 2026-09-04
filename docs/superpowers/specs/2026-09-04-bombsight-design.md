# 投彈瞄具（2026-09-04）

專案負責人：「轟炸機可以按 B 切到轟炸模式」、「鏡頭從機身後的第三人稱切到機腹
第一人稱向下看」、「準星用圓形就好，不是十字」、「要自動盯著落點，但要限制角度，
視線不超過圓錐 70 度（等於不可能抬頭，只能往下看）」、「視線轉換時要有 LERP」。

**範圍只有瞄具。** 炸彈真的投得下去、真的落海濺水，就到此為止。地面目標、爆炸、
範圍傷害、對船傷害、炸彈艙開關、掛載影響飛行性能、勝利條件、任務接線——**全部
不在範圍內**，那些是 `docs/roadmap.md` 的里程碑 2，另外走一輪。

---

## 0. 定案清單（來源：2026-09-04 的往返）

| 項目 | 裁定 |
|---|---|
| 進入方式 | `B` 鍵。只有帶彈的機種能按 |
| 視角 | 機腹第一人稱（眼點是機體上的一個點，同 `eyePoint` 的先例） |
| 視線 | **自動盯著落點** |
| 角度限制 | 夾進**機體 −Y（機腹方向）**的 70° 圓錐 —— **機體固定，不是陀螺穩定** |
| 轉換 | 視線 slerp，時間常數 0.25 s |
| 準星 | **圓形**，畫在落點的投影處 |
| 操縱權 | **進入即凍結瞄準點**，指揮儀照舊追它 → 保持航向與姿態。滑鼠無作用 |
| 投彈 | 左鍵，單投。投彈模式下左鍵**不開槍** |
| 炸彈物理 | 240 Hz 固定步長，住在 `World.step`。二次阻力，單一參數＝終端速度 |
| 預測 | 與炸彈**共用同一支 `stepBomb`、同一個 dt** |
| 落海 | 現成的 `render/splash.ts` 水柱池 |
| 落陸 | 消失，不做任何效果（爆炸在範圍外） |

未裁定、由本 spec 定：載彈量、終端速度、水柱倍率、`bombPoint` 的三個座標
（全部標為**起始值，由試飛裁定**，見 §6）。

---

## 1. 量測：這份設計的數字基礎

二次阻力、終端速度 280 m/s、B-17G 巡航 90 m/s、`dt = 1/240`：

```
  高度    真空前拋   含阻力前拋   落地時間   落地速度   落點離天底   積分步數
   500 m     908 m      873 m     10.3 s    123 m/s      60.2°       2,475
  1000 m    1285 m     1212 m     14.8 s    148 m/s      50.5°       3,543
  2000 m    1817 m     1663 m     21.3 s    184 m/s      39.8°       5,120
  4000 m    2570 m     2232 m     31.4 s    225 m/s      29.2°       7,539
  6000 m    3147 m     2605 m     40.0 s    247 m/s                  9,596
  8000 m    3634 m     2872 m     47.9 s    260 m/s                 11,498
```

三個結論直接進設計：

**① 70° 圓錐是安全網，不是常態限制。** 落點離天底達到 70° 是在**高度 200 m**
（70.4°）。平飛投彈時圓錐永遠不作用；它只擋兩種退化情況——貼地投彈（落點跑到
地平線上）、投彈航路上大幅機動（機腹軸被姿態帶歪）。

**② 預測可以用與炸彈完全相同的步長。** 最壞情況 11,498 步／幀，60 fps 下約
69 萬步／秒，相對於現有 40 架 × 240 Hz 的飛行物理可以忽略。粗步長也量過：
`dt` 從 1/240 放寬到 1/4，4,000 m 的前拋都是 2,232 m（差 < 3 m）——**便宜到
不必省，所以不省**。預測器與炸彈共用同一支函式，兩者逐位元相同。

> 【為什麼這一條寫進 spec】這個 repo 為「兩份真相」付過好幾次代價，而且每一次
> 都留了明文鐵律：`world/heightfield.ts`（渲染與碰撞共用同一個 `Float32Array`）、
> `render/ocean.ts`（三個地方必須一致）、`world/shipAA.ts`（由建模腳本產生，
> 不手抄）。準星與炸彈分家的症狀會是「圓圈說一個地方、水柱噴在另一個地方」，
> 而且**隨畫面更新率變動**——慢的機器上更歪。從一開始就不製造第二份。

**③ 炸彈不能寄生在 `Projectiles` 上。** 那個池是「等速直線、無阻力、無重力」
（spec §2 裁定），壽命上限 1.2 s。炸彈要重力、要阻力、要飛 48 秒。

---

## 2. 模組

```
  weapons/bomb.ts          BombSpec ＋ 逐機種掛載                    純資料
  world/bomb.ts            stepBomb()    一步 ←── 唯一的真相
                           solveImpact() 重跑同一支到落地
                           Bombs         SoA 池，同 Projectiles 的形狀
  camera/bombsight.ts      coneClamp()   把目標視線夾進圓錐          純數學
  camera/CameraRig.ts      viewMode 加 'bomb'
  hud/widgets/bombsight.ts 圓準星
  render/bombs.ts          落下中的炸彈，InstancedMesh
  input/bindings.ts        B 切換、viewMode 三態
  main.ts                  串接
```

`world/bomb.ts` 與 `camera/bombsight.ts **都不 import three**——與
`world/heightfield.ts` 同一個理由：它們要能在 node 裡跑單元測試。

---

## 3. 彈道

### 3.1 模型

二次阻力，**單一可調參數是終端速度 `vt`**：

```
  k = g / vt²
  a = (0, −g, 0) − k · |v| · v
```

【為什麼用 vt 當參數而不是 Cd·A/m】三者只以 `g/vt²` 的組合出現，拆開來寫是三個
互相抵銷的旋鈕。`vt` 是可以直接查到、也可以直接在試飛裡讀出來的量（落地速度）。

【橫向的減速就是 trail】阻力同時作用在水平分量上，前拋因此比真空解短
（4,000 m 少 338 m）。那正是真機投彈表裡的「trail」，不必另外補一項。

### 3.2 `stepBomb`

半隱式歐拉（先更新速度、再更新位置），與 `Projectiles.step` 的形狀一致：

```ts
export function stepBomb(s: BombState, k: number, dt: number): void
```

【為什麼不用 RK4】步長 1/240 之下歐拉與 RK4 在這條軌跡上的差距遠小於
§1 量到的粗步長差（< 3 m），而 RK4 會讓「預測與實跑逐位元相同」這條護欄
變成四次求值都要對齊。用不上的精度換來的是更難守的不變式。

### 3.3 `solveImpact`

```ts
export function solveImpact(
  px, py, pz, vx, vy, vz: number,
  k: number,
  groundAt: (x: number, z: number) => number,
  maxSeconds: number,
  out: ImpactResult,
): boolean
```

重跑 `stepBomb`，直到 `y ≤ groundAt(x, z)` 或超過 `maxSeconds`。回傳落點、
飛行時間、落地速度。找不到解回 `false`（`bombState: 'none'`）。

- **不得在 t = 0 就終止**：飛機在爬升時炸彈會先往上飛。第一步一定要走。
- **地形只在 `y < land.ceiling` 之下才取樣**：之上一律與 0 比。`ceiling` 是
  `PEAK_MAX = 1000`，`world/archipelago.ts` 已經保證沒有地形高過它。
- **落地那一步做一次線性內插**：`stepBomb` 一步在落地時走 1 m 以上，不內插
  的話落點會系統性偏過頭。
- **熱路徑零配置**：`out` 就地寫入，內部不 new。

---

## 4. 相機

### 4.1 `viewMode` 變三態

`InputState.viewMode: 'third' | 'first' | 'bomb'`。

- `B`：`state.viewMode = state.viewMode === 'bomb' ? 'third' : 'bomb'`，
  且**只在 `state.bombCapable` 為 true 時**有作用。
- `V` 在 `'bomb'` 之下**不作用**——它的語意是「座艙／機外」，投彈模式不是
  那條軸上的一個點。
- 【`bombCapable` 由 `main.ts` 寫入】`bindings.ts` 是純 DOM 外殼，對飛機一無所知
  （檔頭已經明文）。寫入點與 `rig.options.firstPersonOffset.copy(...)` 完全相同
  （`main.ts:424`、`main.ts:1001`）——那兩處本來就是「玩家換了一台飛機」。
- 【換機時要強制退出】`bombCapable` 由 true 變 false 時 `main.ts` 把 `viewMode`
  設回 `'third'`。少了這一條，重生成戰鬥機之後相機會卡在一個沒有 `bombPoint`
  的模式裡。

### 4.2 圓錐夾制

```
  a = 機體 −Y 在世界座標的方向（orientation 旋轉 (0,−1,0)）
  d = normalize(落點 − 眼點)
  若 dot(d, a) ≥ cos(70°)      → 目標視線 = d
  否則  n = normalize(d − a·dot(d, a))
        目標視線 = a·cos(70°) + n·sin(70°)
```

- **軸是機體固定的**（負責人裁定）。等於「機腹上的一個窗口」：側滾大了看到的
  就是天，機動中投不了彈。這比陀螺穩定更誠實，也自然懲罰在投彈航路上亂動。
- 退化情況：`d` 與 `a` 恰好反向時 `n` 未定義。取任一垂直方向即可——那個姿態下
  畫面上是什麼都無所謂，重點是不能產生 NaN（同 `CameraRig.baseOrientation`
  對天頂的處理）。

### 4.3 LERP

`CameraRig` 自持一個 `bombDir`，每幀以 `1 − exp(−dt/τ)` slerp 向夾制後的目標，
`τ = BOMB_LERP_TIME`。

- **進入時**由當下的相機朝向起算，所以視線是轉過去的，不是跳過去的。
- **離開時**第三人稱照現有的 `initialised = false` 吸附——與 `V` 鍵現況相同。
- **相機位置**（機外 → 機腹）是硬切。這與 `V` 鍵的現況一致，不另外處理。

### 4.4 上方向量

**不隨機體側滾**，沿用 `baseOrientation` 那一套。

【理由】`CameraRig` 檔頭的鐵律「相機不隨機體側滾」防的是滑鼠的正回饋螺旋，
而投彈模式的視線根本不吃滑鼠，那條理由在這裡不成立。但另一半成立：地平線
跟著轉會讓「落點在畫面上往哪邊漂」變得讀不出來。圓錐軸隨姿態轉、影像保持水平
——側滾時落點滑向畫面一側，那正是要看得見的東西。

---

## 5. HUD

### 5.1 widget 清單

```
  BOMB = FULL 把 'reticle' 換成 'bombsight'
```

【為什麼一定要把 `reticle` 換掉而不是疊上去】瞄準點在投彈模式下是**凍結**的，
畫出來就是一個指著沒有意義的方向的圓圈。這與 `Hud.ts` 對上帝視角寫的理由
逐字相同：「準星更是直接誤導——它會讓人以為那個方向會有子彈出去」。

### 5.2 `HudFrame` 新欄位

```ts
  bombX: number          // NDC，−1…1。慣例同 noseX
  bombY: number
  bombVisible: boolean   // 落點在相機前方且投影在畫面內
  bombState: 'solved' | 'clamped' | 'none'
  bombLoad: number       // 剩餘彈數
```

### 5.3 畫法

圓，半徑 11 px × `L.scale`（與現有滑鼠準星同一個尺寸，`reticle.ts:44`）。

```
  solved    HUD_COLORS.primary   實線
  clamped   HUD_COLORS.warn      虛線 —— 圓錐夾住了，圓圈不在真正的落點上
  none      不畫圓，只在中心留一個小點  —— 90 秒內解不出來
```

`bombVisible` 為 false（落點在相機後方或投影到畫面外）時**什麼都不畫**。
不做離屏箭頭——落點跑出畫面只會發生在 `clamped` 之下，而那個狀態本身已經在
警告了，再加一個指標是同一件事講兩次。

**圓圈不會恆在畫面中央，那正是它的價值。** 相機自動盯落點，所以解穩定時圓圈
回到中心；飛機一機動、速度一變、圓錐一夾制，LERP 就讓圓圈漂開。這與現有
「圓圈是你指的、十字是砲指的，分離量就是飛機跟不上」是同一個語言，只是這次
分離量代表「投彈解還沒收斂」。

---

## 6. 設計值

**全部是起始值，由試飛裁定**——性質同 `WOBBLE_AMPLITUDE`，也同
`weapons/turret.ts` 對射界寫的「設計值，不是量測值」。

| 常數 | 起始值 | 理由 |
|---|---|---|
| `BOMB_CONE_HALF_ANGLE` | 70° | 負責人指定。§1 量測：只在 200 m 以下作用 |
| `BOMB_LERP_TIME` | 0.25 s | 對齊 `CameraRig.lookReturnTime` |
| `BOMB_TERMINAL_SPEED` | 280 m/s | 500 lb GP 級 |
| `BOMB_MAX_SECONDS` | 90 s | 8,000 m 落地 47.9 s，留近一倍餘裕 |
| `BOMB_RELEASE_INTERVAL` | 0.25 s | 單投，可以走棋盤式散布 |
| `BOMB_SPLASH_SCALE` | 3× | 現有水柱是子彈打出來的 12 m |
| `BOMBS_CAPACITY` | 64 | 玩家單次最多 8 顆同時在空中（落地要 48 s，全投完第一顆還沒落地）。64 是留給日後 AI 投彈的餘裕，且相對 `PROJECTILE_CAPACITY = 4000` 可以忽略 |
| 載彈量 | B-17G 8、He 111 8、G4M 4 | 史實量級。**投完就沒有，本輪不做補彈**；重生時回滿 |
| `bombPoint` | 三架各一個值 | 照 `eyePoint` 的先例（`assembly.ts:183`：一機一個值，不從幾何推） |

---

## 7. 資料流

```
  每幀（60 Hz）
    main.ts  → solveImpact(玩家位置, 玩家速度, k, groundAt)   ← 「現在投會落在哪」
             → coneClamp → rig.update(…, 'bomb', 落點)
             → 投影落點 → HudFrame.bombX/Y/State

  每子步（240 Hz，World.step）
    bombs.step(dt)  →  stepBomb 每一顆
                    →  y ≤ groundAt → 落地事件

  幀率（純裝飾）
    落地事件 → waterAt 有限 ? splash.spawn : 什麼都不做
```

- `World` 新增 `groundAt: (x, z) => number`，由 `main.ts` 指派
  `terrain.collisionHeightAt`——**與 `crashPolicy` 同一個注入方式**。
  直接讀 `world.land.field.sample()` 再自己 `max(0)` 會複製「海面是平的」
  這條規則，那是第二份真相。
- 投彈是**邊緣觸發**：`firing` 是持續按著的布林，要記上一幀的值。
- 投彈模式下 `firing` **不餵給玩家的機砲**。

---

## 8. 測試

`world/bomb.ts` 與 `camera/bombsight.ts` 是純函數，headless 可測：

**`test/unit/bomb.test.ts`**
- 無阻力（`k = 0`）時 `solveImpact` 對得上解析解 `t = √(2h/g)`、`x = v·t`
- 終端速度收斂到 `BOMB_TERMINAL_SPEED`（長時間自由落體）
- 爬升中投彈：先上升再落下，不在 t = 0 終止
- 落在島上時落點高於海面，且等於 `groundAt` 在該點的值
- 解不出來時回 `false`（例如初速朝上且超過 `maxSeconds`）
- **護欄：預測與實跑逐位元相同**——`solveImpact` 的結果與把同一顆炸彈放進
  `Bombs` 池、以同一個 dt 跑到落地的結果完全相等

**`test/unit/bombsight.test.ts`**
- 錐內不動、錐外落在錐面上（與軸的夾角恰為 70°）
- 恆不在機腹軸的 70° 之外
- `d` 與 `a` 反向時不產生 NaN
- 側滾 60° 時圓錐軸跟著轉（機體固定的驗收）

**`test/unit/bindings.test.ts`**（補）
- `bombCapable` 為 false 時 `B` 無作用
- `'bomb'` 之下 `V` 無作用

**`test/unit/hud.test.ts` / widget 測試**（補）
- `BOMB` 清單不含 `reticle`、含 `bombsight`

**驗收（試飛）**：圓圈壓在哪，水柱就噴在哪。這是這個功能唯一真正的驗收標準，
而且它同時驗證了預測與實跑沒有分家。

---

## 9. 明確不做

地面目標、爆炸、範圍傷害、對船／對機傷害、炸彈艙開關與動畫、掛載改變飛行性能、
「摧毀 N 個目標」勝利條件、任務接線、AI 投彈、魚雷、串投／齊投、投彈提前量提示線。

`docs/roadmap.md` 的里程碑 2 與 4 不因這份 spec 而縮小——它只把其中
「投彈瞄準輔助」那一條做掉。
