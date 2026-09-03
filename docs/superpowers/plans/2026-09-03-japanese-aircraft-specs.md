# 三台日本機的 spec、命中盒、防護力與史實校準 實作計畫

**Spec**：`docs/superpowers/specs/2026-09-03-japanese-aircraft-specs-design.md`

**目標**：A6M5、Ki-84、G4M 三台在遭遇戰裡**可以編、可以飛、可以被打壞**，
而且每一台都被既有的護欄掃到。外型不動一個位元。

**架構**：五個任務，**每一個做完都要全套綠**。任務零把可行性數字用專案自己的
程式重算一次，任務一把整條路走通（Ki-84，最便宜的一台），任務二、三換數字
與加砲塔，任務四收尾。

**技術**：TypeScript、vitest、three.js r180。

## ✅ 五個任務全部完成（2026-09-03）

```
  任務零     合併主線（faction 的型別）、用專案自己的程式重算可行性   ✅
  任務零之二 防護力下限 0.7 → 0.60，變異測試證明它承重              ✅
  任務一     Ki-84  —— 六項史實驗收全綠                            ✅
  任務二     A6M5   —— 六項史實驗收全綠                            ✅
  任務三     G4M    —— 五項全綠，失速進 PENDING（估算值）           ✅
  任務四     e2e 真的把三台編進戰鬥、roadmap 打勾                   ✅
```

全套測試綠、`tsc` 仍是 23 行、`perf-gate` 與 `rematch` 單獨跑也綠。
**尚未提交** —— 等專案負責人指示。

> **第三版。** 第二版收了 Codex 的四個 P0（見〈審查結論〉）。
> 第三版收專案負責人 2026-09-03 的六項裁決：Ki-84 換成日方實測平均、
> 三台血量取整到百位、A6M5 用五二型甲、**防護力下限由 0.7 降到 0.60**、
> G4M 的爬升進斷言、G4M 失速再查一次。

## 負責人裁決（2026-09-03）

| # | 裁決 | 影響到哪一步 |
| --- | --- | --- |
| 1 | Ki-84 用日方實測平均 **630 km/h @ 6,400 m、3,600 kg**，不用 TAIC 的 687 | 任務一。**兩點反解的一致性由 7.0% 收到 0.6%** |
| 2 | 三台血量四捨五入到百位：**800 / 600 / 2,800** | 三個任務，三台都仍在 ±5% 容差內 |
| 3 | A6M5 用**五二型甲** | 任務二，無額外工作 |
| 4 | 防護力下限 **0.7 → 0.60** | **改護欄**，見任務零之二 |
| 5 | G4M 海平面爬升用 **6.88 m/s**，進斷言 | 任務三，G4M 守**五項**；預期差 10–15%，見設計 3.3 |
| 6 | G4M 乾淨失速再查一次 —— **找到了** | 日方著陸速度 129.6 km/h @ 12,500 kg，反推乾淨失速 **150.5 km/h**、CL_max 1.467（兩條獨立路徑差 0.21%，設計 3.3.1）。仍進 `PENDING`，但理由改成模型對轟炸機失速系統性偏高 5–7%。相對估算只剩兩個 MAC（設計 5.3） |

---

## 全域限制

- **外型不動。** 三支 `.glb`、三支 `*.model.ts`、三支 `build_*.py` 一個位元
  都不改。這一輪只加 `src/specs/`、`src/weapons/` 與登記表。
- **不為外型寫測試**（技能 `aircraft-from-reference` 末段）。
- **護欄重新定值是專案負責人的決定。** 對不上的項目寫進 `PENDING` 並附實測
  偏差，不放寬門檻、不改容差。
- `weapons/` 不得 import `render/` —— 槍口座標寫死在 `weapons/`，推導寫註解。
- 不使用 `Math.random`；不得引入 `@types/node`。
- 熱路徑零配置。
- 註解寫現狀，不寫沿革。
- 每一條新測試都要先驗紅，或以變異證明它承重。
- 全套測試一次，但 `perf-gate.test.ts` 與 `test/integration/rematch.test.ts`
  要單獨跑。
- `tsc --noEmit` 的既有噪音基準是 **23 行**。
- 提交訊息寫檔案再 `git commit -F`；**絕不 `git add -A`**
  （`bash.exe.stackdump` 是被追蹤且永遠是髒的）。
- 不用 PowerShell 讀寫含中文的檔案。
- **只有負責人說要 commit 才 commit。**
- **`faction` 填 `'japan'`，而那要先合併主線。** 這條分支的
  `AircraftSpec.faction` 還是 `'allied' | 'axis'`（`src/specs/types.ts`），
  聯集加寬在主線上（`main@431959e` 已把型別加為三值、移除 `factionOf`，並讓
  `battle/setup.ts` 直接讀 `spec.faction` 選日本名冊）。任務零就要把主線併
  進來，不然三支 spec 都不會過 `tsc`，而且併進來之後**不必再動 `names.ts`**。
  注意 `battle/names.ts` 的 `Faction`（`'allies' | 'axis'`）是**另一個型別**，
  任務模式的陣營選擇用它，這一輪不動。

---

## 審查結論（Codex 2026-09-03，四個 P0 全部覆核成立）

| # | 結論 | 覆核 | 處置 |
| --- | --- | --- | --- |
| 1 | `hitbox-emit.probe.ts` 只走固定五台，新機會被**靜默略過**（正常結束、只印舊五台） | 成立。`test/tools/hitbox-emit.probe.ts:363` | 每一台的第 5 步明列 import 與陣列 |
| 2 | G4M 的升限**有同源資料**（8,125 m，同一份文件同一重量），卻被排除在斷言外 | 成立。設計自己選了那個值 | G4M 守**四項**，只有 climb／stall 進 PENDING |
| 3 | E2E 只改按鈕數，證明不了三台能生成 | 成立。`test/e2e/skirmish-roster.e2e.ts:67,90,115` 編的還是舊四台 | 任務四加一場真的把三台編進去的戰鬥 |
| 4 | `debris.test.ts` **沒有**同時守三張表，三張表漏填的症狀也各不相同 | 成立。`test/unit/debris.test.ts:56` 只對 `ALL_SPECS` 呼叫 `bodyColorOf`，不碰 `buildAircraft` | 改寫第九節的症狀表；那支測試自己的註解也overclaim了，順手修正 |
| 5 | 漏了五處硬編清單（range、specs.test 砲塔那條、turret-mount、multi-engine-glb、hangar REFS） | 成立 | 見下方清單，逐條標明「要加」或「已知排除」 |
| 6 | 「四個槍口都在自己的**機翼盒**內」不是現有斷言，也不適用 Ki-84 的機首同調槍 | 成立。`test/unit/hitbox.test.ts:145` 要的是「落在**至少一個**命中盒內」 | 改掉驗收文字 |
| 7 | 稱 `geometry.test.ts` 的三台是「程式化機種」是錯的 —— 五台全部走 GLB | 成立。`buildAircraft.ts:36` | 改成「歷史上只抽測三台」 |
| 8 | He 111 對照組的 0.0202 漏了 ram，正確是 0.02053（對出貨 0.0206 差 0.3% 不是 2%） | 成立 | 三台的反解值一律標成**未含 ram 的下界**，任務零用專案自己的程式重算 |

---

## 每一台的固定順序（有相依性，不能換）

```
  1  src/weapons/<id>.ts     WeaponSpec、Battery、（G4M 另有 Turret[]）
  2  src/specs/<id>.ts       完整 spec，命中盒先填**六個粗盒**
                             ＋ <ID>_HISTORICAL
  3  登記表                  buildAircraft.ts 的三個 import ＋ GLB_MODELS
                             ＋ BODY_COLORS  ← buildAircraft 要用
                             ALL_SPECS、menu SHORT_NAME、hangar SPECS 與短名
  4  硬編測試清單            見下方完整清單
  5  hitbox-emit             **先把新 spec import 進探針、加進第 363 行的陣列**，
                             再 `npx vite-node test/tools/hitbox-emit.probe.ts`，
                             確認輸出裡真的出現該 `spec.id`，把盒貼回 spec
  6  校準                    調到 historical.test 的各項 ±5%
  7  全套測試 ＋ tsc
```

**第 3 步一定要在第 5 步之前**：`hitbox-emit` 走 `buildAircraft`，而那支對 GLB
機種要求 `GLB_MODELS` 裡有這一格、樣板先載好（`test/fixtures/glb.ts` 掃的就是
`GLB_MODELS`）。沒接進去就跑，會拋「未定義機種外型」。

**第 5 步的第一句是這一版新加的，而且是 P0。** 探針的機種清單是硬編的
（`hitbox-emit.probe.ts:363`）。沒加進去的話它**正常結束、只印舊五台**——
不是紅燈，是完全沒有處理新機，而實作者很容易以為候選盒已經產生了。

**第 2 步的粗盒不是成品。** 它是給探針的種子——那支的機翼分段是拿
`spec.hitBoxes` 裡現有的 `wingRight`／`wingLeft` 去切的（`:125`），
`hitBoxes` 全空時會先產生無效的翼展範圍，最後 `patchHoles` 存取
`undefined` 的最近盒而**崩潰**（`:251`）。

---

## 完整的登記表與硬編清單

**要改的：**

```
  src/render/geometry/buildAircraft.ts   三個 model import ＋ GLB_MODELS ＋ BODY_COLORS
  src/battle/skirmish.ts                 ALL_SPECS（戰鬥機在前）
  src/ui/menu.ts                         SHORT_NAME
  src/tools/hangar.ts:36                 SPECS
  src/tools/hangar.ts:488                行內短名表（**第二張**，與 menu 各寫各的）

  test/tools/hitbox-emit.probe.ts:363    ← P0，漏了就靜默略過
  test/unit/specs.test.ts:11             CASES（**只加兩台戰鬥機**）
  test/unit/specs.test.ts:153            ALL
  test/unit/specs.test.ts:156            「戰鬥機沒有砲塔」目前只點名 P-51／
                                         Bf 109，連 F6F-5 都沒守 → 改成依
                                         `role === 'fighter'` 掃 ALL
  test/unit/hitbox.test.ts:42            CASES
  test/unit/weapons.test.ts:303          MAX_MOUNTS 掃描
  test/unit/turret-mount.test.ts:14      TURRET_CASES 加 G4M
  test/unit/turret-mount.test.ts:93      「mounts 是空的」加 G4M
  test/unit/multi-engine-glb.test.ts:25  G4M 是雙發，見下方註記
  test/performance/historical.test.ts    CASES、PENDING、covered 三處一起改
  test/unit/skirmish.test.ts:13          id 逐字清單
  test/e2e/skirmish-roster.e2e.ts        數量 ＋ **一場真的編進三台的戰鬥**
```

**`multi-engine-glb.test.ts` 不要直接把 G4M 塞進現有的 `CASES`**：第 74–81 行
硬斷言 He 111／B-17G 的六種材質配置，未必適用 G4M。拆成「所有多發 GLB 共通」
（槳數、位置、`setPropSpin`）與「特定舊轟炸機材質」兩組，只把 G4M 加進前者。

**免費跟上的：**

```
  test/fixtures/glb.ts        掃 GLB_MODELS，接進去就載得到
  test/unit/debris.test.ts    掃 ALL_SPECS，但**它只守 BODY_COLORS**
```

**三張表漏填的症狀各不相同**（上一版把它們寫成同一種，那是錯的）：

```
  GLB_MODELS    生成那一架時 buildAircraft 拋「未定義機種外型」
                （buildAircraft.ts:67）。護欄：hitbox.test 與 E2E
  BODY_COLORS   飛機正常出現，**第一次產生擊落碎片**時 bodyColorOf 才拋錯
                （buildAircraft.ts:93）。護欄：debris.test
  ALL_SPECS     **靜默** —— 選單少一張卡；強行送未知 id 的話 specOf 退回
                P-51D（skirmish.ts:119）。護欄：skirmish.test 的逐字 id 清單
```

`debris.test.ts:47` 的註解自己也宣稱守三張表，順手改成只守塗裝那一張。

**已知排除（刻意不加，寫在這裡才不會被當成遺漏）：**

```
  src/tools/range.ts:42          射擊場的兩台基準機（F6F-5、He 111、B-17G
                                 本來也不在）。它是武器試射工具不是登記表
  src/tools/hangar.ts REFS       參考模型疊圖的對齊值。三台是在 Blender 裡
                                 直接對著 ref 建的，沒走機庫疊圖那條路
  test/unit/geometry.test.ts:270 「法線朝外」等四條**歷史上只抽測三台**
                                 （五台其實全部走 GLB，上一版寫成「程式化
                                 機種」是錯的）。其中
                                 `wingTip` 對 `spec.wing.span/2` 那一條
                                 （:405）是真正有價值的跨模組斷言 ——
                                 **要不要擴成所有 GLB 機種請負責人裁決**
  低速權限／推進／包絡三支         斷言是由 P-51D 與 Bf 109 實測定出來的門檻
                                 （48°/s、8.1 s、靜推力 15–30 kN），
                                 **對新機是假的**。B-17G 那一輪的教訓：
                                 加進去等於斷言一件假的事，那不叫覆蓋率
```

---

## 任務零：可行性數字用專案自己的程式重算

上一版的反解 cd0 是手算的，**漏了 ram**：He 111 對照組正確值是 0.02053
（對出貨 0.0206 差 0.3%），不是文件寫的 0.0202 差 2%。三台的估計值因此
都是**未含 ram 的下界**。

### 做什麼

- 先把主線併進來（`faction` 的型別）。
- 寫 `test/tools/japan-feasible.probe.ts`，走**正式路徑**
  （`analysis/envelope.ts` 的 `dragAt`／`thrustAt`、`physics/propulsion.ts`
  的 `enginePower` 含 `ramFactor`），對每一台在兩個高度反解 cd0，並把
  ram、etaMax、vRef、oswald、質量、面積六個輸入一起印出來。
- **A6M5 也要進表**（上一版整台漏了）。它的主幹沒有同源的海面極速，只解得出
  臨界高度那一點——那本身就是要記錄的事實。
- 用重算的結果更新設計文件 §5.1。

### 驗收

He 111 反解出來的 cd0 與出貨的 0.0206 差 < 1%；三台的兩點差印出來。
**這一步不改任何 spec。**

---

## 任務零之二：把防護力的下限由 0.7 降到 0.60

**這是唯一一次動護欄，而且是負責人的裁決，不是為了讓誰變綠。**

### 做什麼

`test/unit/specs.test.ts` 的「每一格都在 0.7～1.5 之間」改成 0.60～1.5，
並在那一條的註解裡記明：**誰、哪一天、為什麼**（照 `historical.test.ts`
記錄 He 111 升限降級那一輪的寫法）。理由是 A6M5 甲型史實上確實比 0.7 還脆
—— 一手史料見設計 7.2。

### 驗收

- 現有五台不受影響（最低的是 P-51D 的 `fuselage` 0.80）
- 這一步**先做、單獨跑一次全套**，讓「改護欄」與「加新機」在 git 歷史上
  分得開。日後有人問「0.60 是誰放寬的」，`git log` 直接答得出來

---

## 任務一：Ki-84 —— 把整條路走通

先做這一台的理由不是它最重要，是它**最便宜**：戰鬥機路徑、沒有砲塔、
史實表六項齊全（見 spec 3.1）。

### 做什麼

**`src/weapons/ki84.ts`**

```
  HO103   一式十二・七粍   780 m/s   850 発/分   傷害 30
  HO5     二式二十粍       741 m/s   850 発/分   傷害 80
```

初速取 HE 彈那一個（Catalog of Enemy Ordnance 1945 分彈種實測：AP 123.2 g
702 m/s、HE 84.3 g 741 m/s）。**註解要寫明「後期減裝藥導致初速下降」這個
流傳的說法查無一手來源**，不要讓下一位又去改。

槍位：機首兩挺照 109 的做法取引擎罩背線、分置中軸線兩側；翼砲的展向站位由
`tools/blender/build_ki84.py` 的輪艙位置往外推（史料寫明在起落架收納位外側）。
`sight` 取初速最快的那挺（HO103）。`convergence` 1000。

**`src/specs/ki84.ts`** —— 照 `f6f5.ts` 的骨架。`faction: 'japan'`、
`mass` **3600**、`hp` **800**、
`wing` `{ area: 21.00, span: 11.238, chord: 1.948, oswald: 由任務零反解 }`、
`engine.gears` 填**公称出力**（離昇 2,000 PS ／ 一速 1,860 PS @1,750 m ／
二速 1,620 PS @6,100 m），**不是 W.E.P.** —— 日方那三次試飛寫的是
「定格 3,000 rpm +350 mmHg」，那就是公称，史實表與出力狀態必須一致。
`ramEfficiency` 預估 0.3–0.4（飛機峰值 6,400 m 對引擎二速全開 6,100 m，
只抬了 300 m）。`protection` 見 spec 7.1。

**`KI84_HISTORICAL`**（見 spec 3.1）：

```
  臨界極速   630 km/h @ 6,400 m    日方三次試飛平均
  海面極速   545 km/h              日方
  海面爬升   15.0 m/s              **推導**：日方到 5,000 m 平均 13.93
                                   × 本模型三台戰鬥機的 SL÷平均 1.078
  失速       164.6 km/h            102 mph IAS，同一架機（跨源，接縫 0.5%）
  升限       12,400 m              日方官方諸元（跨源）
  clMax      1.315                 由失速反解，寫成算式不要填常數
```

**爬升那一項如果紅了，先看換算不要先動係數**：1.078 這個比值在三台之間
散佈 1.038–1.126（±4%），而容差是 ±5%，餘裕很薄。更好的做法是替
`HistoricalReference` 加一個「到某高度的秒數」的驗收項 —— 日方對 Ki-84 與
G4M 給的本來都是時間不是速率。**列為建議，由負責人裁決。**

### 測試（先寫，先驗紅）

把 `KI84` 加進上方清單裡屬於它的每一格，**在 spec 還沒調對之前先跑一次
確認它們是紅的**。`specs.test.ts` 的 `CASES` 要加（戰鬥機，AR 6.01、
cd0 預估都在區間內）。

新增 `test/tools/japan-tune.probe.ts`（複製 `f6f-tune.probe.ts`），
**是探針不是測試，不斷言任何事**。

### 驗收

- `historical.test.ts` 的 Ki-84 六項全綠
- `hitbox.test.ts`：每個頂點都在盒內、沒有空盒、盒的體積和小於整機包圍盒、
  **四個槍口都落在至少一個命中盒內**（機首兩挺會落在 engine／fuselage 盒，
  那是對的 —— 探針本來就會跳過展向不在機翼區的掛架）
- `specs.test.ts`：CL_max ±8%、展弦比 4–8、cd0 0.014–0.035、etaMax ≤ 0.90、
  防護力 0.60–1.5、hp 正比質量 ±5%
- `tsc --noEmit` 仍是 23 行

---

## 任務二：A6M5a —— 同一條路，換數字

### 做什麼

**`src/weapons/a6m5.ts`**

```
  TYPE97   九七式七粍七        747 m/s   900 発/分   傷害 4
  TYPE99_2 九九式二〇粍二号四型 750 m/s   620 発/分   傷害 100
```

**與 G4M 的九九式不共用物件**（一号旋回式 600 m/s／535 発/分，彈殼長度也
不同），但兩份的註解要互相指過去。

**`src/specs/a6m5.ts`**：`mass` 2733、`hp` **600**、
`wing` `{ area: 21.30, span: 11.00, ... }`、`engine.gears` 填**公称出力**
（栄二一型沒有水甲醇噴射，沒有戰鬥出力可填 —— 照 F6F-5 的前例並在註解寫明
它與 P-51D 的 throttle 1.1 不對等）、`ramEfficiency` 很低（飛機與發動機的
臨界高度都是 6,000 m，衝壓一點也沒把峰值往上抬）。

`chord` **沒有來源，用相對法估 2.00 m**：S/b ＝ 1.936 乘上四台戰鬥機的
MAC÷(S/b) 平均 1.031（設計 5.3）。**註解要標明這是估算不是量測**
（技能坑 34：量不到的時候要說自己在猜），並把算式寫進去讓下一位能重算。

### 兩個預期會撞牆的地方

1. **CL_max 1.727 可能過不了 ±8%**（要 `clAlpha × (alphaCrit − alphaZero)`
   ≥ 1.59，接近 18° 的失速迎角）。調不到就把失速那一項列 `PENDING` 並記下
   實測偏差 —— **不動門檻**。
2. **防護力吃的是任務零之二放寬後的下限。** 表是
   `cockpit 0.65 / wing 0.65 / fuselage 0.75 / engine 1.10 / tail 1.00`
   （設計 7.2）。取 0.65 而不是 0.60 是為了不坐在界限上。

### 驗收

同任務一。

---

## 任務三：G4M2a —— 轟炸機路徑，加砲塔

### 做什麼

**`src/weapons/g4m.ts`**：`G4M_BATTERY` 的 `mounts` 是**空的**（機首那挺是
手持活動槍，交給 AI，照 He 111 的裁決），但 `sight` 仍然被 `ai/assess.ts` 與
`ai/steer.ts` 讀，要填。

```
  TYPE92    九二式七粍七旋回     745 m/s   700 発/分   傷害 5
  TYPE99_1  九九式二〇粍一号旋回  600 m/s   535 発/分   傷害 80
```

`G4M_TURRETS` 五座（nose 7.7、dorsal 20、beamL/R 7.7、tail 20），
位置用 `muzzleAt(蒙皮點, axis)`，蒙皮點從 `tools/blender/build_g4m.py` 的
剖面表讀。**半角與旋轉速率是設計值不是量測值** —— 照片讀不出射界邊界，
一個中心方向加一個半角才是可以被試飛推翻的形式。

**`src/specs/g4m.ts`**：`role: 'bomber'`（`feelFor` 靠它挑 `BOMBER_FEEL`）、
`mass` 12500、`hp` **2800**、`wing.area` 78.125、雙發要注意 `prop.diameter` 進的
是動量理論，照 He 111 的做法填**等效單槳盤**並在檔頭寫推導。

### `historical.test.ts` 守五項

升限 8,125 m 與極速出自**同一份文件、同一個重量**，是高品質的錨點；排除它
等於讓一個有來源的值完全沒有護欄（Codex 審查 P0）。爬升由負責人裁決進斷言。

```ts
checks: ['vmaxCritical', 'vmaxSeaLevel', 'climb', 'ceiling', 'peak']
mass: 12500,  hp: 2800,  climbRateSeaLevel: 6.88
```

**只有 `stall` 進 `PENDING`。** `PENDING` 的長度斷言與 `covered` 清單要一起
改；**兩份手維護的清單對不起來正是這一條最容易出錯的地方**，順手把 `PENDING`
改成 `{ id, check, reason }` 的結構資料，讓 `covered` 從它算出來。

`stallSpeed` 填 **150.5 km/h**、`clMax` 填 **1.467**。它不是憑空估的 ——
日方諸元表有著陸速度 129.6 km/h @ 12,500 kg（原始單位是 70 節），配上 F6F-5
在同一天同一架機上實測的襟翼增量（乾淨 98.0 / 放襟翼 84.5 mph，CL 比 1.345）
反推得 150.31；另一條完全不相干的路（He 111 乾淨失速 × √翼負荷比）給
150.62。**兩條差 0.21%。** 完整推導與三個陷阱見設計 3.3.1。

**它仍然不進斷言**，但理由不是資料而是模型：He 111 的失速在模型裡 +5.6%、
B-17G +7.3%，**三台轟炸機同方向偏一樣的量**。拿一個自己偏 5.6% 的錨去做
±5% 斷言，數學上不成立。實測偏差要記進 `PENDING` 的 `reason`，
**那條線索值得日後單獨查**。

`chord` 填 3.14（＝S/b，兩台已出貨的轟炸機用的就是這個）。

⚠️ **爬升那一項預期會差 10–15%。** 6.88 是「到 3,000 m 的平均」不是海平面
值，而本模型裡兩台轟炸機的 SL÷平均是 1.165 與 1.075。負責人 2026-09-03：
先照 6.88 填、跑跑看。真的差了就回報實測偏差，二選一由他裁決 —— 改填換算後
的約 7.7 m/s，或加「到某高度的秒數」那個驗收項。**不要自己放寬容差。**

**G4M 不進 `specs.test.ts` 的 `CASES`**（那組的展弦比 4–8 與 cd0 0.014–0.035
的註解裡就寫著「二戰戰鬥機」），與 He 111、B-17G 的前例一致。它仍然進 `ALL`
與 `hitbox.test.ts` 的 `CASES`。

> **審查提的一個改進**：`CASES` 目前把「戰鬥機專屬」（CL_max、AR、cd0）與
> 「所有飛機都該成立」（阻尼符號、靜穩定、操縱符號、增壓檔位遞增、過載符號、
> etaMax、figureOfMerit、ramEfficiency、vRef）綁在同一份清單，所以排除 G4M
> 也一併排除了那些通用不變量。拆成 `FIGHTER_CASES` 與掃 `ALL` 的通用組。
> **這是擴大覆蓋不是放寬**，兩台舊轟炸機也會第一次被通用組掃到。

### 額外的測試

```
  test/unit/turret-mount.test.ts:14   TURRET_CASES 加 G4M
  test/unit/turret-mount.test.ts:93   「mounts 是空的」加 G4M
  test/unit/multi-engine-glb.test.ts  拆組後把 G4M 加進共通那一組
```

`turret-mount` 守的是「沿 −axis 回走 `TURRET_MOUNT_REACH` 會碰到機體」，
不是「槍口在盒內」—— 真機的槍管本來就伸在蒙皮外面。

### 驗收

同上，另加：五座砲塔全部過 `turret-mount`、`MAX_TURRETS` 沒超、
`historical.test` 的 G4M **四項**全綠。

---

## 任務四：收尾

### E2E 要真的把三台編進去

**上一版只把「兩排各有五台」改成八台，那證明不了任何事** —— 三台全都沒接
`GLB_MODELS` 時按鈕數照樣是八。做法：

- 數量斷言改八
- **新增一場編成**，藍紅兩邊各放進 A6M5、Ki-84、G4M
- 開始戰鬥後驗 log 含三個新 id、等數個 frame、canvas 還在、console 無錯

### 其餘

- `docs/aircraft-balance.md` 的快照從 `aircraft-compare.probe.ts` 重貼
- `docs/roadmap.md` 里程碑 3 的六項打勾（外型那兩項已經打了）
- 全套測試（`perf-gate` 與 `rematch` 單獨跑）＋ `tsc --noEmit`

---

## 這一輪不做

魚雷與炸彈（里程碑 4）、彈藥量模型（現有五台也沒有）、任務模式的日本關卡
（`FactionChoice` 只有兩值，要動 `missions.ts`）、`feel.ts` 的第三組手感輪廓
（`feelFor` 已經照 `role` 自動分）、`src/specs/catalog.ts` 那種單一機種目錄
（審查建議的後續重構，本輪只做「測試裡的 `ALL` 直接取 `ALL_SPECS`、
fighter/bomber 由 `role` 篩」這一小步）。
