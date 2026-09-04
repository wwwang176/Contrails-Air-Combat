# 艦隊防空的設計

> 專案負責人裁定（2026-09-04）：**船是獨立實體，不是 `Combatant`**；防空
> 火力分三層砲位、兩種行為；**砲位可以被打掉，船本期打不沉**；船緩速直航、
> 固定艏向、不閃避。**魚雷、炸彈、擊沉是下一期。**

解鎖 `japan-m4` 倫內爾島的骨架。這一期結束時那一關可以打、可以飛進彈幕、
可以掃掉砲位，但**還不能完成它原本的敘述**（雷擊）——目標暫時是殲滅空中
敵機，等魚雷做好再換。

地基已經有了：`src/world/shipAA.ts` 是 `model-building` 分支量出來的砲位表，
三艘船的外型（`public/models/{essex,fletcher,wichita}.glb`）也在。這一份設計
是把那張表接進戰鬥。

> **第二版。** 第一版有七個 P0（Codex 審查 2026-09-04），最要命的是
> **玩家開 G4M 根本沒有可控武器**——`G4M_BATTERY.mounts` 是空陣列，武器全部
> 做成 AI 砲塔了。第一版同時宣稱「玩家開 G4M」「不做魚雷」「玩家可以掃掉
> 砲位」，那三件事互相不相容。負責人裁定留在 M4、武器等魚雷；補法見 3.4
> 與 10.3。另外六個 P0 是：船砲彈沒有合法的來源編碼、「照抄 `stepTurrets`
> 只差三處」是錯的、`fleet` 會被轉換層靜默丟掉、煙霧池做不出黑雲、
> `applyDamage` 還會除以防護力、三處行號引用錯誤。全部折進來了。

---

## 一、範圍

**做**：船體與運動、三層防空砲位、近炸引信與黑雲、砲位血量與碰撞盒、船血、
飛機撞船、飛機砲塔可以瞄船上的砲位、`japan-m4` 的關卡資料與渲染。

**不做**：魚雷、炸彈、對艦傷害、擊沉、航跡浪、船隨浪起伏、`allies-m4`
沖繩外海、Essex（那一艘留給沖繩）。

**這一期的驗收是「坐進一式陸攻飛過去，手感對不對」**，不是「數字算得對不對」。
表裡每一個數字都是起始值，由試飛裁定。

---

## 二、為什麼船不是 `Combatant`

`Combatant`（`src/world/World.ts:25`）帶著一具 `Aircraft`。把船塞進去，
命中判定、傷害、cull 粗篩、砲塔推進、記分板全部免費，而 `MAX_TURRETS = 8`
還正好等於併區之後的砲區上限——誘惑很大。

**但船要配一具假的飛機。** 升力、失速、螺旋槳、`crashPolicy` 會判它撞海、
`AiController` 要一個假控制器、HUD 的接觸列表會把巡洋艦列成一台飛機、記分板
會統計它。每一處都要加一句「如果是船就跳過」，而那些句子散在飛行模型、AI、
HUD、記分板四層裡。**把不是飛機的東西塞進飛機的形狀，省下的是今天的工，
付出的是往後每一次改飛行模型都要再想一次船。**

船與飛機真正共用的只有一件事：**砲位怎麼瞄準**。而那一層
（`world/lead.ts:66` 的 `solveLead`、`weapons/turret.ts` 的 `inArc` / `slew` /
`applyWobble`、`weapons/burst.ts` 的點放、`weapons/cadence.ts` 的射速時鐘）
已經是純函數，本來就借得到——`world/turrets.ts:36` 的 `TurretCombatant`
註解說得很清楚，那個介面是**刻意**不 import `World.ts` 的。

代價是 `resolveHits`（`World.ts:503`）要多一段對船的判定。四艘船、每艘 ≤8
個砲位：每發彈丸先對四個包圍球比距離（Wichita 全長約 185 m），絕大多數彈丸
在第一個比較就結束。

---

## 三、資料模型

### 3.1 `Box` 從 `HitBox` 抽出來

`hit.ts:65` 的 `segmentBox` 只讀 `box.center` 與 `box.half`，`part` 那一格
它碰都沒碰。船的盒不該被迫帶一個飛機部位。

```ts
export interface Box { center: Vector3; half: Vector3 }
export interface HitBox extends Box { part: HitPart }
```

`segmentBox` 改收 `Box`。`HitPart`、`PART_MULTIPLIER`、`hitAircraft`
一行都不動——**這一步是純粹的型別放寬，行為不變。**

### 3.2 `world/ships.ts`

```ts
export type ShipClassId = 'essex' | 'fletcher' | 'wichita'

/** 艦級的靜態資料。一個艦級一筆，執行期共用。 */
export interface ShipClass {
  readonly id: ShipClassId
  readonly name: string
  /** GLB 路徑 */
  readonly url: string
  /**
   * 船體命中盒，**艦體座標**（與 shipAA.ts 同一套：+X 右舷、Y 上、−Z 艦首，
   * 原點在水線 × 艦體中點 × 中線）。艦體一個、上層建築一個。
   */
  readonly hull: readonly Box[]
  /**
   * 包圍球半徑，m。**必須是上界** —— 算小了會靜靜地漏掉命中，
   * 與 `hit.ts:134` 的 `boundingRadius` 同一個理由。
   */
  readonly radius: number
  /** 船體血量。本期會扣、不會歸零。 */
  readonly hp: number
  readonly zones: readonly ShipAAZone[]
}

/** 場上的一艘船。 */
export interface Ship {
  readonly index: number
  readonly team: Team
  readonly cls: ShipClass
  /** 世界座標，水線。y 恆為 0。 */
  readonly position: Vector3
  /** 只有艏向（繞 Y）。船不橫搖、不縱搖。 */
  readonly orientation: Quaternion
  /** 航速，m/s。固定不變。 */
  speed: number
  hp: number
  guns: ShipGun[]
}
```

`stepShips(ships, dt)`：`position += forward × speed × dt`。就這樣。
不轉向、不加速、不閃避——負責人裁定。

### 3.3 `world/shipGuns.ts`

```ts
export interface ShipGun extends BurstCycle {
  readonly zone: ShipAAZone
  /** 目前指向，艦體座標單位向量。初值 = 該層的射界錐軸。 */
  aim: Vector3
  phase: number
  targetIndex: number
  searchCooldown: number
  /** 射速時鐘。與砲塔的 `turretCooldowns` 同一套語意，但每門自己一格。 */
  flash: number
  hp: number
  alive: boolean
  /** 命中盒，艦體座標，**已經含 ×1.5 的膨脹**。 */
  readonly box: Box
}
```

射速時鐘**不放在 `ShipGun` 裡**：`stepCadence`（`weapons/cadence.ts:12`）的
介面是 `Float32Array + index`，一個單獨的 `number` 接不上去。每艘船持有一份
`gunCooldowns: Float32Array`，與 `Combatant.turretCooldowns` 同一套做法。

`stepShipGuns(ship, combatants, projectiles, flak, time, dt)` 的骨架照抄
`world/turrets.ts:198` 的 `stepTurrets`，**差別有五處**：

1. **候選目標**是 `Combatant[]`，而船自己不在裡面——不必排除自傷。
2. **槍口位置**是艦體座標轉世界，用船的艏向四元數（船只有 yaw，但仍走
   一般的四元數路徑，不特化）。
3. **`flak` 那一層不進彈丸池**，見第六節。
4. **射速時鐘住在船身上**（見上）。
5. **傷害公式不一樣。** `stepTurrets`（`turrets.ts:268`）生彈丸時算的是
   `weapon.damage × guns × TURRET_DAMAGE_SCALE`，而 `TURRET_DAMAGE_SCALE`
   是 0.9375（`weapons/turret.ts:166`）。照抄的話 §5.2 那張表會失真：
   20 mm 的 12 變成 11.25，四聯裝 40 mm 的 40 變成 150。
   **船砲直接用表上的值，不乘 `guns`、不乘 `TURRET_DAMAGE_SCALE`** ——
   那張表寫的就是最終單發傷害。`ShipAAZone.guns` 與 `mountsInZone` 只用來
   決定畫幾根砲管，不參與傷害。

搜尋節流（`SEARCH_INTERVAL = 1.0`）、開火門檻（`FIRE_THRESHOLD = 2°`）、
搖晃與點放的黃金比錯開，全部沿用。**種子用 `船編號 × 8 + 砲位編號`**，
與飛機砲塔各自一條序列——兩邊是不同的陣列，不會互撞。

### 3.4 飛機砲塔可以瞄船上的砲位

`pickTarget`（`turrets.ts:334`）現在只掃 `Combatant[]`。加上船之後，
一式陸攻進場時它自己的側方與機腹銃手會對著艦上的砲位打——**史實如此，
而且這一期它有一個不能省的職責**，見第十節。

候選多 28 個點（四艘船的存活砲位），受既有的 `SEARCH_INTERVAL` 一秒節流
保護，與現在掃 40 架同一個量級。**只有敵隊的船是候選**，而砲位死了就從
候選名單消失。

---

## 四、編成與擺位

### 4.1 為什麼是兩艘重巡＋兩艘驅逐，而不是航母

倫內爾島海戰（1943 年 1 月）的第 18 特遣艦隊，主力是**重巡洋艦**。
**`public/models/wichita.glb` 這艘本人就在那支艦隊裡**；那一戰被一式陸攻
雷擊、隔天沉沒的是同隊的重巡 Chicago。編隊裡確實有兩艘護航航母
（Chenango、Suwannee），但落在後方，不是黃昏雷擊的接觸對象。

Essex 那時還沒到太平洋（1942 年 12 月服役、1943 年 5 月才進戰區），
放進來會差九個月。**「航母戰鬥群」這個詞留給 `allies-m4` 沖繩外海**——
1945 年 4 月的第 58 特遣艦隊，Essex 在那裡完全合理，而那一關的敘述本來
就是「守住艦隊」，航母當靶心才有意義。

| 艦 | 數量 | 砲區 | 5" / 40 mm / 20 mm |
|---|---|---|---|
| Wichita CA-45 | 2 | 8 | 2 / 2 / 4 |
| Fletcher DD-445 | 2 | 6 | 1 / 1 / 4 |

合計 **28 個砲區**：6 個 5 吋、6 個 40 mm、16 個 20 mm。

> 【時代瑕疵，照舊】1943 年 1 月的攔截機應該是 F4F 野貓，遊戲裡只有 F6F-5。
> `japan-m1`、`japan-m3` 也是這樣處理的。

### 4.2 陣型

兩艘重巡並列在中央（左右相距 800 m），兩艘驅逐在前方兩側外張
（前方 1,200 m、外側 1,500 m）。整隊同一艏向、同一航速。

**航速 8 m/s（≈15.5 節）**，起始值。真艦的戰鬥航速更高，但這一關的重點是
彈幕不是追擊；船跑得太快會讓低空進場的相對幾何每一次都不一樣，調不準。

### 4.3 這一關怎麼擺

玩家的一式陸攻從艦隊**側前方低空**進場，紅隊 F6F 從上方攔截。艦隊中心放在
戰場原點附近，玩家開場在艦隊前側約 6–7 km、高度低——這正好落在 5 吋砲的
射程（4,950 m）外一點點，所以**黑雲會在接近的過程中一朵一朵開出來**，
那是這一關的第一印象。

---

## 五、三層防空

### 5.1 三層砲位，兩種行為

`shipAA.ts:1` 的表頭已經寫明：20 mm 與 40 mm 是機關砲、打直射曳光，行為與
轟炸機的自衛機槍同一類；**會做出黑霧的只有 5 吋兩用砲**。

所以：**三層是火網的層次，不是三套邏輯。**

### 5.2 數字

參考座標：.50 白朗寧初速 887、800 發/分、單發 18（`weapons/p51d.ts:7`–`9`），
射程 1,064 m 是 `887 × PROJECTILE_LIFETIME` 推導出來的、不是檔案裡的數字；
零戰的 20 mm 單發 100；B-17 球形腹部砲塔一發 33.75（`weapons/turret.ts:166`）。

**表裡的「單發傷害」是最終值**，不再乘 `guns`、不乘 `TURRET_DAMAGE_SCALE`
（見 3.3 第 5 點）。

| | 對應真砲 | 初速 | 射速 | 彈丸壽命 | 射程 | 單發傷害 | 砲位血量 | 碰撞盒（含 ×1.5） | 轉速 |
|---|---|---|---|---|---|---|---|---|---|
| `mg` | 20 mm Oerlikon | 830 | 240 /分 | 1.6 s | 1,330 m | 12 | 60 | 2.4 m 立方 | 60°/s |
| `autocannon` | 40 mm Bofors | 880 | 110 /分 | 2.4 s | 2,110 m | 40 | 120 | 4.0 m 立方 | 45°/s |
| `flak` | 5"/38 兩用砲 | **450** | 20 /分 | 引信 ≤ 11 s | 4,950 m | 爆心 200，50 m 內線性衰減到 0 | 200 | 6.0 m 立方 | 20°/s |

船體血量起始值：Wichita 40,000、Fletcher 20,000。本期不歸零。

射界用 `shipAA.ts:105` 的 `SHIP_AA_ARC_DEFAULTS`（5 吋仰 55°／半角 75°、
40 mm 仰 45°／65°、20 mm 仰 40°／55°）。機庫（`hangar.html` 選船）看得到。

搖晃振幅 1.2°（飛機砲塔是 1.0°）——船是穩定的平台，但**我們要的是玩家有
機會**，不是寫實。起始值。

### 5.3 為什麼 5 吋砲的初速訂 450，真砲是 790

負責人：「射速也慢，初速也慢」。這不是妥協，是這一層成立的條件：

**慢彈才有可見的飛行時間，黑雲才會在你前方一朵一朵開出來。** 代價是它對
閃避中的戰鬥機幾乎打不中——引信是**發射那一刻**解出來的攔截時間，目標一
轉向，雲就開在空的地方。**那正是要的手感：黑雲是危險的招牌，不是必中的
判決。**

### 5.4 曳光只有 20 mm 與 40 mm 有

它們走現有的彈丸池，`render/tracers.ts` 自動就畫了。

5 吋砲彈不進池、也不畫——真實的高射砲彈你看不見，你只看到它炸開。這同時
省掉每個物理步對它做命中判定。

---

## 六、近炸引信與範圍傷害

### 6.1 為什麼另開一個池，而不是塞進 `Projectiles`

`Projectiles`（`Projectiles.ts:2`）是 4,000 格的 SoA，每個物理步對每一發做
線段對 AABB 的判定。**近炸引信不需要那個**——彈丸飛行途中什麼都不會發生，
只有引爆那一刻算數。

所以 `world/flak.ts` 另開一個小池（容量 256：6 個 5 吋區 × 20 發/分 ×
11 秒引信 ≈ 22 發同時在空中，餘裕十倍）：

```ts
export interface FlakShells {
  x, y, z: Float32Array          // 位置
  vx, vy, vz: Float32Array       // 等速直線
  fuse: Float32Array             // 還剩幾秒引爆
  team: Int8Array                // 發射方，−1 = 空槽
}
```

`stepFlak(shells, combatants, dt, out)`：推進、`fuse -= dt`、歸零就引爆。
**引爆不做線段判定**，只掃敵隊飛機的重心距離。

### 6.2 引信怎麼定

發射時對目標解 `solveLead`（`world/lead.ts`），得到攔截時間 t，引信 = t。
解不出來、或 t 超過上限（11 秒）就不開火。

### 6.3 範圍傷害

引爆點半徑 `FLAK_RADIUS = 50` m 內的**敵隊**飛機扣血：

```
damage = FLAK_DAMAGE × (1 − d / FLAK_RADIUS)
```

線性衰減，**爆心 200、邊界 0，那是進 `applyDamage` 的輸入值**。

走 `World.applyDamage` 的 `fuselage` 部位——高砲破片不挑部位，而且座艙的
×2.5 用在這裡會讓傷害隨機到無法調校。

> **實扣的血不等於 200。** `applyDamage`（`World.ts:643`）除的是
> `PART_MULTIPLIER[part] / protection[part]`。`fuselage` 的倍率是 1.0，但
> **機種的防護力不是**：F6F-5 是 1.15、P-51D 是 0.80，同一朵雲對它們分別扣
> 174 與 250。這一關的 G4M 剛好是 1.00（`specs/g4m.ts:266`），所以表上的
> 數字看起來成立——**那是巧合，不是規則**。防護力照走，因為「機身裝甲厚的
> 飛機比較耐炸」本來就該成立；要記住的是調表時看的是輸入值。

掃描是 O(架數)，一次引爆掃 40 架；四艘船每秒總共約 2 次引爆。可以忽略。

### 6.4 黑雲

**不能借現有的煙霧池。** 壽命、上升、起訖尺寸是**整池共用的建立期設定**
（`render/smoke.ts:8`、`:23`、`:33`），而 `Particles.emit`
（`render/particles.ts:52`）只覆寫得了位置、速度與整體尺寸倍率，覆寫不了
單顆的壽命與重力。殘骸的煙 2.5 秒、以 3 m/s 上升、2→9 m，與高砲雲要的
「4 秒、幾乎不上升、6 m 起慢慢膨脹」不相容。

但代價比「另開一套粒子系統」小得多：`createParticles(cfg)`
（`render/particles.ts:173`）本來就吃設定物件。**再開一份同一套的實例**，
容量約 512、顏色同樣近黑、壽命 4 秒、重力接近 0、尺寸 6→14 m。一個新的
`ParticleConfig` 字面值，不是一套新程式。

---

## 七、命中與傷害

### 7.1 判定順序

`resolveHits`（`World.ts:503`）現有的順序是「飛機 → 陸地 → 海面」，用線段
參數 `t` 比先後。**船插在飛機與陸地之間**，同樣比 `t`——同一個物理步之內
「先擦過一架飛機、再撞上艦橋」是合法的，而彈丸一步走 3.7–4.5 m。

每發彈丸先對四艘船的包圍球比距離平方（`hit.ts:192` 的
`segmentPointDistanceSq`，粗篩用的既有工具）。過了才把線段轉進艦體座標，
測那艘船的船體盒與**還活著的**砲位盒。

### 7.1.1 船砲彈的來源怎麼編碼

`Projectiles` 用 `owner === -1` 表示**空槽**（`Projectiles.ts:96`、`:136`），
所以船不能用 −1：那會讓 `liveCount` 加上去卻永遠不推進，慢慢漏光整個池。
而用 `ship.index` 的 0–3 更糟——`resolveHits` 會把它當成同索引的**飛機**，
於是錯誤地排除那一架，還把命中數與助攻記到它頭上（`World.ts:637`、`:652`）。

**編碼**：`owner = SHIP_OWNER_BASE − ship.index`，其中
`SHIP_OWNER_BASE = -1000`。負數區間與 −1 不重疊、與任何 combatant 索引不
重疊，而且一眼看得出不是飛機。`resolveHits` 現有那句
「`owner >= 0 && owner < combatants.length` 才查 shooter」原樣就擋掉了它，
所以船打死人不會記分給任何飛機——**這是對的，船不參與記分板**。

### 7.1.2 排除規則

沒有排除規則的話會出兩件事，而且都不報錯：

1. **自傷。** 砲口就在砲位盒裡，`segmentBox`（`hit.ts:65`）對「起點已在盒內」
   回傳 `t = 0` —— 每一發直射彈**在出膛的那一步就打中自己的砲位**。
2. **船打船。** 第十二節明令不做船對船，但同隊的姊妹艦就在 800 m 外。

所以船這一段的判定要兩條排除：**跳過發射的那一艘**（用 owner 解回船編號），
以及**跳過與彈丸同隊的船**（用 8.1 的 `team`）。兩條都要，理由與
`World.ts:515` 那句「同隊過濾已經涵蓋自傷，但這一條要留」一模一樣。

### 7.2 三種結果

| 打到 | 效果 |
|---|---|
| 船體 | 火花、船扣 `damage`、回收彈丸 |
| 砲位 | 火花、**砲位扣 `damage` 且船也扣 `damage`**、回收彈丸 |
| 都沒有 | 照現有的路走（陸地／海面／繼續飛） |

**不套部位倍率。** `PART_MULTIPLIER`（`hit.ts:14`）是飛機的六個部位，船沒有
座艙也沒有機翼。打中哪裡都是 `p.damage[i]` 的原值——**船的裝甲差異由砲位與
船體各自的血量表達，不由倍率表達。**

砲位歸零 → `alive = false`：不再搜尋、不再轉、不再開火、槍焰熄掉，**而且
那個盒從判定裡拿掉**——負責人裁定：打掉的砲位是一個洞，不是還會擋子彈的
殘骸。

### 7.3 飛機撞船

**不能用重心判定**（負責人裁定）。低空雷擊一定會有人擦著艦體過去，用重心
的話機翼會穿過上層建築而沒事。

新增 `world/obb.ts`：兩個帶姿態的盒相交嗎（分離軸測試，15 條軸）。飛機的
命中盒本來就是機體座標的 AABB ＋ 姿態 ＝ OBB，船體盒同理（只有艏向）。

每架每步先對四艘船比包圍球（飛機的 `boundingRadius` ＋ 船的 `radius`），
只有真的貼近的那一架才做分離軸測試。相交 → 判墜毀，走現有的 `crashPolicy`
那條路（`World.ts:338` 的「撞地要在開火之前判」那一段）。

---

## 八、彈丸池的兩個新欄位

### 8.1 `team`

現在 `resolveHits` 從射手的 combatant 索引反查陣營。**船不是 combatant，
查不到**——同隊過濾會失效，船會打自己人。

改成生成時就記：`spawn(..., owner, team)`。飛機那一側填的值與現在反查出來
的完全相同。

### 8.2 `life`

彈丸壽命現在是全域常數 1.2 秒（`Projectiles.ts:15`）。40 mm 要飛到 2,110 m
就得飛 2.4 秒。改成每發自己一格，飛機全部填 `PROJECTILE_LIFETIME`。

`PROJECTILE_LIFETIME` **這個常數留著**：它同時是砲塔與 HUD 預瞄環的射程
判準（`turrets.ts` 的 `leadInBody`、`main.ts` 的預瞄環），那條「看得到預瞄環
＝打得到」的等式不能動。

### 8.3 護欄：逐位元不變

這兩刀動的是空戰最熱的那條路。**驗收方式是現有的重播快照必須一格不差**
（`test/tools/spawn-snapshot.ts`）——比的是**既有的那些欄位**（位置、速度、
傷害、射手、游標），新加的兩格不進舊快照的比對，否則「不變」會變成一句
自己證明自己的話。這一步**不加任何新行為**，只加欄位。

但那份快照只涵蓋固定槍：兩個基準場景是 P-51D 與 Bf 109
（`test/tools/spawn-snapshot.ts:192`），**跑不到 `stepTurrets` 的生彈丸那一
行**。而 `turret-replay.test.ts:129` 是把新實作跑兩次互相比較——參數順序
如果接反，兩次會一樣地錯，測試照樣綠。所以還要：

- **新參數設必填，不給預設值。** 全樹有 64 個 `spawn` 呼叫散在 16 個檔案裡
  （含 `tools/propdisc.ts:160`、benchmark 與大量單元測試）。必填的話漏改的
  地方是**編譯錯誤**；給了預設值就是靜默的 `team = 0`／`life = 0`，而
  `life = 0` 的彈丸下一步就過期消失——症狀是「某些槍不會發射」。
- **補一個帶砲塔的快照場景**（B-17G 或 He 111），讓 `stepTurrets` 那條路也
  有一份改動前抓的基準。

---

## 九、渲染

- `render/ships.ts`：載 Wichita 與 Fletcher 兩支 GLB（Essex 這一期不載），
  每艘一個 `Group`，每幀跟著位置與艏向更新。船固定在水線，不隨浪起伏、
  沒有航跡浪——**兩項都不做**。
- **砲管與槍焰要自己一份**：`render/turretBarrels.ts` 與 `render/muzzle.ts`
  的實例容量是「架數 × `MAX_TURRETS`」，寫死給 combatant 用的。船用平行的
  一份，容量「船數 × 8」。
- **砲位被打掉**：砲管隱藏 ＋ 當場一團火球（借 `render/fireball.ts`），
  之後那個位置不再有槍焰。
- **黑雲**：借煙霧池，見 6.4。

---

## 十、任務接線

`MissionBattle`（`battle/missions.ts:164`）加一格選填：

```ts
/** 這一關的艦隊。**沒有這一格的卡完全不產生船**（與 `waves` 同一個約定）。 */
readonly fleet?: MissionFleet

export interface MissionFleet {
  /** 艦隊中心的世界座標。 */
  readonly center: Vector3
  /**
   * 整隊的艏向，rad（繞 Y，0 = 朝 −Z）。**一個數字管全隊** —— 船不各自轉向，
   * 而「同一個艏向」正是「不閃避」在資料上的樣子。
   */
  readonly heading: number
  readonly ships: readonly FleetEntry[]
}

export interface FleetEntry {
  readonly cls: ShipClassId
  readonly team: Team
  /**
   * 相對艦隊中心的**艦隊座標**（+X 右、−Z 前，與艦體座標同一套朝向）。
   * 擺位時先轉 `heading` 再加 `center`。
   *
   * 【為什麼不是世界座標】改艏向時每一艘的座標都要重算，而重算的錯誤是
   * 「陣型悄悄歪掉」，沒有任何測試會紅。
   */
  readonly offset: Vector3
}
```

### 10.1 `fleet` 要一路透傳，不會自己流過去

任務進場的實際路徑是

```
MissionBattle → missionConfigFrom → BattleConfig → createBattle → World
```

（`battle/missions.ts:591`、`battle/setup.ts:50`、`:603`、`main.ts:551`）。
`missionConfigFrom` **明列回傳欄位、不透傳未知資料**。只在 `MissionBattle`
上加一格的話，型別檢查會過、`japan-m4.battle.fleet` 讀得到，但進戰鬥之後
**一艘船都不會有**，而且不報錯。

所以這一項要動四處：`MissionBattle`、`BattleConfig`、`missionConfigFrom`
複製它、`createBattle` 建船並掛進 `World.ships`。

### 10.2 `japan-m4` 的內容

玩家開 G4M、紅隊 F6F-5、地形 `sea`、目標**暫時是殲滅空中敵機**。魚雷做好
之後這一關只要換目標與加一條擊沉判定，幾何一格都不動。

### 10.3 這一期玩家沒有可控武器 —— 這是已知的，不是漏掉的

`G4M_BATTERY.mounts` 是空陣列（`weapons/g4m.ts:20`）：一式陸攻的武器全部
做成 AI 砲塔了。而 `World.fire`（`World.ts:435`）只跑固定掛架。**所以這一期
玩家坐進 M4 按下扳機，什麼都不會發射。**

負責人裁定（2026-09-04）：**留在 M4，武器等魚雷那一期一起補。**

代價是「砲位可以被打掉」在座艙裡看不到——只剩測試看得到。補法是 3.4：
**讓 G4M 自己的 AI 砲塔瞄船上的砲位。** 史實上一式陸攻進場時側方與機腹的
20 mm 銃手就是對著艦上掃的；做進去之後玩家會看見自己的銃手把一座 20 mm
打啞。**玩家仍然沒有扳機，但這一期的兩個成果都在座艙裡看得見了。**

### 10.4 重開一場要重設船與 flak

`japan-m4` 沒有 `waves`，所以「再打一場」走的是就地 `resetBattle`
（`main.ts:491`、`battle/setup.ts:1462`），**不重建 World**。現有的
`resetBattle` 只清彈丸、時鐘、飛機、AI、任務與記分。

少了這一段，第二局會是：船停在第一局結束的位置、被打掉的砲位仍然是死的、
上一局的高砲彈還在空中而且會引爆。**全程不報錯。**

`resetBattle` 要加：船的位置與艏向、船與砲位的 `hp` / `alive` / `aim` /
`cooldown` / 點放相位、以及 flak 池清空。

---

## 十一、驗收怎麼切

每一段自己有紅的測試，而且每一段結束時遊戲都跑得起來。

| # | 內容 | 護欄 |
|---|---|---|
| 1 | `Box` 抽出、`world/obb.ts` 分離軸 | 純函數；`hitAircraft` 行為不變 |
| 2 | `ShipClass` 表、建隊、`stepShips` | 60 秒後往艏向走 480 m，艏向沒變 |
| 3 | 彈丸池加 `team` 與 `life` | **重播快照一格不差** |
| 4 | `stepShipGuns` 瞄準與開火 | 射界外不開火、目標死了放棄、射速、點放、砲位死了完全不動 |
| 5 | 命中與傷害 | 打砲位扣兩邊血；砲位歸零後**同一條線段第二次穿過去打不到**；飛機撞船判墜毀 |
| 6 | `flak.ts` 引信與範圍傷害 | 引信＝發射瞬間解出的 t；爆心最痛；半徑外為零 |
| 7 | 透傳鏈與 `japan-m4`、`resetBattle` | 進戰鬥後真的有四艘船；沒有 `fleet` 的卡一艘都不產生；**第二局船回到起點、砲位滿血、flak 池空** |
| 8 | 渲染與 e2e、效能閘門 | 進關看得到船與黑雲、砲塔打得掉一個砲位 |

第 3 列那條「逐位元不變」是這一期最重要的護欄：它保證彈丸池上動的兩刀沒有
悄悄改掉現有的空戰。

### 效能閘門要先有一個綠的基準

**現有的閘門在這台機器上本來就是紅的**（Codex 2026-09-04 實測：20v20
1,274 µs > 900、160 砲塔無目標 981 µs > 900、160 砲塔追瞄 5,549 µs > 3,500）。
這與 `docs/backlog.md` §1.1 記的「並行負載下假紅」一致，但**它意味著
「28 個砲區進得了現有閘門」這句話現在沒有可比較的對象**。

所以第 8 段的做法是：先在同一台機器、同樣的閒置條件下取一份改動前的基準，
再量加上四艘船與滿池彈丸之後的差。**比的是差值，不是絕對值。**

船這一段的成本 Codex 量過：滿池時是每步固定 4,000 × 4 = 16,000 次
`segmentPointDistanceSq`，約 65 µs——**不是可以忽略的**（`resolveHits` 本身
約 202 µs），但可以接受。飛機端只有 40 × 4 = 160 次球比較，SAT 只在貼近時
才跑。

---

## 十二、刻意不做的

| | 為什麼 |
|---|---|
| 魚雷、炸彈、對艦傷害、擊沉 | 負責人裁定：這一期只做前兩段 |
| **玩家在 M4 的可控武器** | 負責人裁定：跟著魚雷一起補。見 10.3——這一期玩家沒有扳機 |
| `allies-m4` 沖繩外海 | 下一期，那一關才輪到 Essex |
| 航跡浪、船隨浪起伏 | 畫面，不影響手感 |
| 船的損管與砲位修復 | 沒有人要求 |
| 船對船、船對地 | 這個遊戲只有空戰 |
| 黃昏燈光 | 卡片寫「黃昏」，但燈光是另一件事，另案 |
| G4M 機腹的魚雷外觀 | 跟著魚雷那一期走 |
