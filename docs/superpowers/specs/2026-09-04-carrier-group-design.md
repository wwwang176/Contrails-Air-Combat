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

---

## 一、範圍

**做**：船體與運動、三層防空砲位、近炸引信與黑雲、砲位血量與碰撞盒、船血、
飛機撞船、`japan-m4` 的關卡資料與渲染。

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
（`src/weapons/turret.ts` 的 `solveLead` / `inArc` / `slew` / `applyWobble`、
`weapons/burst.ts` 的點放、`weapons/cadence.ts` 的射速時鐘）已經是純函數，
本來就借得到——`world/turrets.ts:36` 的 `TurretCombatant` 註解說得很清楚，
那個介面是**刻意**不 import `World.ts` 的。

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
  cooldown: number
  flash: number
  hp: number
  alive: boolean
  /** 命中盒，艦體座標，**已經含 ×1.5 的膨脹**。 */
  readonly box: Box
}
```

`stepShipGuns(ship, combatants, projectiles, flak, time, dt)` 的骨架照抄
`world/turrets.ts:198` 的 `stepTurrets`，差別只有三處：

1. **候選目標**是 `Combatant[]`，而船自己不在裡面——不必排除自傷。
2. **槍口位置**是艦體座標轉世界，用船的艏向四元數（船只有 yaw，但仍走
   一般的四元數路徑，不特化）。
3. **`flak` 那一層不進彈丸池**，見第六節。

搜尋節流（`SEARCH_INTERVAL = 1.0`）、開火門檻（`FIRE_THRESHOLD = 2°`）、
搖晃與點放的黃金比錯開，全部沿用。**種子用 `船編號 × 8 + 砲位編號`**，
與飛機砲塔各自一條序列——兩邊是不同的陣列，不會互撞。

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

參考座標：.50 白朗寧初速 887、800 發/分、單發 18、射程 1,064 m
（`weapons/p51d.ts:5`）；零戰的 20 mm 單發 100；B-17 球形腹部砲塔一發 33.75
（`weapons/turret.ts:166`）。

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

線性衰減，爆心 200、邊界 0。**走 `World.applyDamage` 的 `fuselage` 部位**
（倍率 1.0）——高砲破片不挑部位，而且座艙的 ×2.5 用在這裡會讓傷害隨機到
無法調校。

掃描是 O(架數)，一次引爆掃 40 架；四艘船每秒總共約 2 次引爆。可以忽略。

### 6.4 黑雲

借現有的煙霧池（`render/smoke.ts`，顏色已經是近黑的 `0x1a1a1a`），只多一支
發射函數。每次引爆噴一小團：起始半徑約 6 m、壽命 4 秒、**幾乎不上升**、
慢慢膨脹——高砲雲會掛在空中好幾秒。不另開粒子系統。

---

## 七、命中與傷害

### 7.1 判定順序

`resolveHits`（`World.ts:503`）現有的順序是「飛機 → 陸地 → 海面」，用線段
參數 `t` 比先後。**船插在飛機與陸地之間**，同樣比 `t`——同一個物理步之內
「先擦過一架飛機、再撞上艦橋」是合法的，而彈丸一步走 3.7–4.5 m。

每發彈丸先對四艘船的包圍球比距離平方（`hit.ts:222` 的
`segmentPointDistanceSq`，粗篩用的既有工具）。過了才把線段轉進艦體座標，
測那艘船的船體盒與**還活著的**砲位盒。

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

`japan-m4` 的 `battle` 從 `null` 填成真的：玩家開 G4M、紅隊 F6F-5、地形
`sea`、目標**暫時是殲滅空中敵機**。魚雷做好之後這一關只要換目標與加一條
擊沉判定，幾何一格都不動。

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
| 7 | `MissionBattle.fleet`、`japan-m4` | 沒有 `fleet` 的卡一艘船都不產生 |
| 8 | 渲染與 e2e、效能閘門 | 進關看得到船與黑雲、打得掉一個砲位；28 個砲區進得了現有閘門 |

第 3 列那條「逐位元不變」是這一期最重要的護欄：它保證彈丸池上動的兩刀沒有
悄悄改掉現有的空戰。

---

## 十二、刻意不做的

| | 為什麼 |
|---|---|
| 魚雷、炸彈、對艦傷害、擊沉 | 負責人裁定：這一期只做前兩段 |
| `allies-m4` 沖繩外海 | 下一期，那一關才輪到 Essex |
| 航跡浪、船隨浪起伏 | 畫面，不影響手感 |
| 船的損管與砲位修復 | 沒有人要求 |
| 船對船、船對地 | 這個遊戲只有空戰 |
| 黃昏燈光 | 卡片寫「黃昏」，但燈光是另一件事，另案 |
| G4M 機腹的魚雷外觀 | 跟著魚雷那一期走 |
