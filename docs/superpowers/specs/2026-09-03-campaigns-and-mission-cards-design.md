# 三條戰役與任務卡的設計

> 專案負責人 2026-09-03 裁定三件事：
> **一、12 關取代現有的 10 張舊卡**（不並存）。
> **二、任務畫面現在就改成三條戰役**（盟軍／德軍／日本）。
> **三、德 M4 的撤退段，敵人不一定在後方** —— 可以從**斜前方分批出現**，
> 「有點像我方被攔截一樣」。

`docs/roadmap.md` 的 12 關對照表。本輪解鎖 **5 關**：盟 M1、德 M1、德 M4、
日 M1、日 M3。其餘 7 關卡在里程碑 2（地面目標與投放武器），只建**目錄卡**。

> **第三版。**
>
> 第一版：一個 P0、六個 P1。最要命的是**德 M4 根本寫不出來** —— 我把它列進
> 「本輪解鎖」，卻沒有給卡片任何描述返航節拍的欄位。修正之後設計反而**變小**：
> 七張沒做的卡不再被迫填完整的戰鬥資料，而那一併解決了「轟炸機被塞進戰鬥機
> 欄位」。
>
> 第二版：又一個 P0 —— **有了欄位仍然寫不出來**，因為我沒給德 M4 的實際數值，
> 而那一關的觸發條件**不是可以隨便選的**：開場規則是 `annihilate`，返航若用
> 時鐘，玩家提前清光敵軍就直接勝利、永遠進不到返航段（§3.1）。
> 另外補上逐關地形、`ReadyMissionCard`、以及「逐位元相同」那條做不到的驗收。

---

## 一、病灶

三個假設從「只有兩個陣營、一邊兩台飛機」那時候長出來，三條線同時撞上它們。

### 1.1 敵方是「翻一個 bit」算出來的

```ts
// src/battle/missions.ts:508
const mine   = specsFor(faction)
const theirs = specsFor(faction === 'allies' ? 'axis' : 'allies')
```

三選一沒有「另外一個」。而且**敵人會跨線**——`docs/roadmap.md:425`：

```
  盟 M4  艦隊上空 …… 敵方魚雷機用 G4M（里程碑 3）
```

**盟軍線的一關，敵人是日本機。**所以敵方機種連「跟著戰役走」都不成立，
它是**逐卡**的。

### 1.2 一個陣營只有兩格，第三架選不到

`SPECS`（`skirmish.ts:119`）一邊兩台，而 `missionConfigFrom` 吃的是
「`specsFor(f)[0]` 是戰鬥機、`[1]` 是轟炸機」。所以 **F6F-5、Ki-84、A6M5、
G4M 四台在 `ALL_SPECS` 裡，任務模式一台都選不到** —— 而日 M3 玩家開的正是
Ki-84。

### 1.3 「陣營」被當成「戰役」在用

`MISSIONS: Record<FactionChoice, …>`（`missions.ts:340`）與選單的
`FACTION_LABEL`（`menu.ts:43`）都是兩格。

> 【Codex P2-1 更正】`FactionChoice` **今天已經不參與遭遇戰**了 —— 那邊直接
> 持有藍紅逐架名單（`skirmish.ts:53`）。所以它現在的唯一讀者就是任務那一落，
> 而這一輪之後它會**一個讀者都不剩**。見 §2.5。

---

## 二、做什麼

### 2.1 新型別 `Campaign`

```ts
export type Campaign = 'allies' | 'germany' | 'japan'
```

**三個都用國家而不是陣營的字**：`axis` 換成 `germany`，因為日本也是軸心，
留著 `axis` 當德軍的代稱是一個現成的誤讀。

它只做兩件事：**卡片分在哪一落**、**選單那顆按鈕寫什麼**。不參與任何生成邏輯。

### 2.2 卡片拆成「目錄」與「戰鬥設定」

**這是第二版最大的改動**，起因是 Codex 的 I-1：七張沒做的卡被迫填完整的戰鬥
資料，而那正是「轟炸機被塞進 `blueSpec`（宣稱是戰鬥機）」的來源
（盟 M2 的 B-17G、德 M2 的 He 111、日 M4 的 G4M 都是 `role: 'bomber'`）。

```ts
/** 卡片。**選單畫得出來就靠這幾格。** */
export interface MissionCard {
  readonly id: string
  readonly title: string
  readonly type: MissionType
  /** 卡片上的一行說明 */
  readonly summary: string
  /**
   * 這一關的戰鬥設定。**null = 還沒做**，選單上 disabled。
   *
   * 【下游只收窄型別】`onMission` 的回呼、`main.ts` 的 `pendingMission`、
   * 與 `missionConfigFrom` 都收 `ReadyMissionCard`（見下），所以那三處
   * **不需要任何 null 檢查**。選單迭代 12 張、只把可玩的那幾張接上點擊。
   *
   * 【取代 `playable` 旗標】原本是一個布林值與一堆可能半空的欄位並存，而
   * 「資料要嘛完整、要嘛全空」得靠測試守（`missions.test.ts:111`）。
   * 改成一個可為 null 的物件之後，那個不變量由**型別**保證：拿得到
   * `battle` 就一定拿得到裡面每一格。
   */
  readonly battle: MissionBattle | null
}

/** 一關真的要打起來所需要的一切。 */
export interface MissionBattle {
  /** HUD 目標列上的文字 */
  readonly objective: string
  /** 我方（藍隊）主力機種。**不保證是戰鬥機** —— 盟 M2 玩家開 B-17G */
  readonly blueSpec: AircraftSpec
  /** 敵方（紅隊）主力機種 */
  readonly redSpec: AircraftSpec
  /**
   * 被護送／被攔截的那幾架。**護送算藍隊、攔截算紅隊**，其餘任務為 null。
   * 哪一邊由 `type` 決定，與 `convoyCount` 同一條規則。
   */
  readonly convoySpec: AircraftSpec | null
  readonly blueCount: number
  readonly redCount: number
  readonly convoyCount: number
  readonly convoyPriority: number
  readonly targetDistance: number
  readonly targetRadius: number
  readonly seconds: number
  readonly entry: EntryPlanId
  /**
   * 這一關打在什麼地形。**必填。**
   *
   * 【為什麼要有這一格】`main.ts:563` 現在把每一關寫死成 `archipelago`。
   * 而 roadmap 指定日 M3／M4 與盟 M4 是艦隊海圖 —— 少了這一格，那三關會
   * 靜靜地開在群島上，沒有錯誤（Codex P1-6）。
   */
  readonly terrain: TerrainKind
  /** 這一關的增援波次 */
  readonly waves?: readonly MissionWave[]
  /** 這一關的返航節拍。**德 M4 靠它**（見 §2.4） */
  readonly withdraw?: MissionWithdraw
}
```

```ts
/** 打得起來的卡。**`missionConfigFrom` 只收這一種。** */
export type ReadyMissionCard = MissionCard & { readonly battle: MissionBattle }
```

【為什麼要這一行】少了它，`missionConfigFrom(card)` 得寫 `card.battle!` 或
在裡面拋錯 —— 而「這張卡打得起來」這個事實在 hook 與 state 之間傳遞時就丟了。
一個型別別名把它保留下來，**減少**一次執行期檢查而不是增加結構
（Codex 覆審 P1-1）。

**為什麼放 `AircraftSpec` 物件而不是 id 字串**：id 打錯是執行期才發現
（`specOf` 會靜靜落回第一台），物件打錯是編譯錯誤。而且下游三個依物件識別的
快取（`envelope`、`doctrine`、`ceilings`）本來就要求同一個參考。

> Codex 查證：`battle/` → `specs/` 是既有方向，`specs/ → battle/` 不存在，
> 所以不新增循環。

### 2.3 波次跟著改

```ts
export interface MissionWave {
  readonly when: MissionTrigger
  readonly warn: string
  readonly warnLead: number
  readonly side: MissionSide      // 留著 —— 它決定隊伍，不決定機種
  readonly spec: AircraftSpec     // 取代 role
  readonly count: number
  /**
   * 進場縱深的覆寫，以 `entryRange` 為單位（同 `SideEntry.along`）。
   * **省略 = 沿用那一邊開局的擺法。**
   *
   * 【為什麼需要它】波次原本固定生在那一邊的開局點。德 M4 的玩家是**往前
   * 跑**的：紅方開局點在 z = −5,000，而玩家從 z ≈ 0 跑到那裡只要 28 秒
   * （180 m/s）。第二批若晚 40 秒到，就生在玩家**背後** —— 那正是舊撤離卡
   * 「追不到」的病灶，只是延後三十秒發作。
   *
   * 【為什麼是覆寫 `along` 而不是給一整個 `SideEntry`】要變的只有「這一批
   * 在路的哪一段等你」。橫向、高度、朝向與速度沿用那一邊的擺法才對 ——
   * 它們仍然是那一隊的飛機。
   */
  readonly along?: number
}
```

> **專案負責人 2026-09-03 裁定：乙 + 丙。**乙 = 這個選填的縱深覆寫；
> 丙 = 德 M4 的撤離點拉近到 12 km（不是舊撤離卡的 20 km），讓整段路都留在
> 爭奪區內。兩個一起才治得住「第二批生在背後」。

`side` **不刪**：它回答「這一支加進藍隊還是紅隊」，與機種是兩件事（一支友軍
增援與一支敵方增援可能是同一個機種）。

`MissionTrigger` 的 `alive` 條件裡的 `role` 選擇器**留著不動** —— 它問的是
「敵方的**戰鬥機**剩幾架」，那是按角色數存活數，與挑機種無關。

### 2.4 返航節拍上卡片

```ts
export interface MissionWithdraw {
  readonly when: MissionTrigger
  /** 畫面中心的文字，同時取代 HUD 的目標列文字 */
  readonly message: string
  /** 撤離點在我方機首方向多遠，m。與 `targetDistance` 同一套 */
  readonly distance: number
  readonly radius: number
  readonly seconds: number
}
```

`missionConfigFrom` 把它翻成 `WithdrawBeat`：`point` 由 `distance` 沿藍隊
機首方向算出來，與 `missionRules` 算撤離點是同一條路。

**第一版漏了整格**（Codex P0-1），而德 M4 就是它唯一的使用者。

### 2.5 玩家陣營這個概念退場

`missionConfigFrom(card, faction)` 的第二個參數刪掉 —— 卡片自己說了雙方飛
什麼。`main.ts` 的 `missionFaction`（`main.ts:1425` 由 `id.startsWith('axis')`
推）跟著刪。

**接著這三個一起刪**（Codex C 已經掃完，不留給 PLAN 猜）：

```
  FactionChoice    生產碼讀者只剩 main.ts:69 與 menu.ts:4，兩者都是為了任務
  SPECS            私有，只有 specsFor 讀
  specsFor         生產碼只有 missions.ts 用
```

**`ALL_SPECS` 不刪** —— `specOf` 與遭遇戰 UI 都在用。
測試與探針裡的讀者（`mission-waves.test.ts:5`、`skirmish.test.ts:18` 等）
一併改掉，**不用 `.skip`**。

### 2.6 選單那一列要能長出第三顆

`menu.ts:168` 的 `factionRow` 直接迭代 `['allies', 'axis'] as const`。
只加型別與 label 仍然編譯得過，**但日本那顆按鈕永遠不會被畫出來**
（Codex P1-7）。改成迭代 `MISSIONS` 的鍵。

---

## 三、12 關的卡片

**5 關有 `battle`，7 關是 `battle: null` 的目錄卡。**

```
                        我方      敵方     被護送   地形        波次／節拍      本輪
  ──────────────────────────────────────────────────────────────────────────────
  盟 M1  護送堡壘        P-51D    Bf 109   B-17G   archipelago  —              ✅
  盟 M2  深入敵境        —        —        —       —            目錄卡         ✖
  盟 M3  獵殺列車        —        —        —       —            目錄卡         ✖
  盟 M4  艦隊上空        —        —        —       —            目錄卡         ✖
  ──────────────────────────────────────────────────────────────────────────────
  德 M1  攔截            Bf 109   P-51D    B-17G   archipelago  ＋P-51D 波次   ✅
  德 M2  東線鐵路樞紐     —        —        —       —            目錄卡         ✖
  德 M3  最後的 Gustav   —        —        —       —            目錄卡         ✖
  德 M4  帝國最後防線     Bf 109   P-51D    —       farmland     返航＋兩批     ✅
  ──────────────────────────────────────────────────────────────────────────────
  日 M1  零戰            A6M5     F6F-5    —       archipelago  —              ✅
  日 M2  島嶼防衛        —        —        —       —            目錄卡         ✖
  日 M3  護航            Ki-84    F6F-5    G4M     sea          —              ✅
  日 M4  最後的攻擊       —        —        —       —            目錄卡         ✖
```

**地形逐關的理由**（Codex 覆審 P1-2：只加欄位不給值，五關全填 `archipelago`
一樣通得過驗收，而日 M3 仍然開在群島）：

```
  盟 M1 / 德 M1   archipelago   與改動前逐項相同 —— 那兩張本來就是群島
  德 M4           farmland      帝國本土。**現有三種地形裡唯一沒有任何一關
                                用到的一種**，而這一關正好是內陸
  日 M1           archipelago   太平洋島嶼，地形本身是那一關的一部分
  日 M3           sea           往外海攻擊艦隊，投雷點在海上
```

> 【七張目錄卡只有標題、類型與文案】機種與編制**現在不填**。盟 M4 的敵方
> 魚雷機是 G4M、日 M4 玩家開 G4M 這些 roadmap 已經定的事，寫在
> `docs/roadmap.md` 的對照表裡就夠 —— 填進一張還打不起來的卡，只會變成
> 一組沒有人驗證過、卻看起來已經定案的數字。

### 3.1 五關的內容

**盟 M1 護送堡壘**與**德 M1 攔截**是現有兩張卡換名字與文案：
`allies-escort` 與 `axis-intercept` 的規則、幾何、編制**一個數字都不動**。
那兩張是唯二有實測基礎的關卡，重新調數值等於把既有的驗收丟掉。

```
  盟 M1   P-51D 4 架、Bf 109 10 架、藍隊 B-17G convoy 4 架
  德 M1   Bf 109 10 架、P-51D 4 架、紅隊 B-17G convoy 4 架
```

**德 M1 要新加一個波次。**roadmap 對德 M1 的敘述是「發現 B-17 編隊 →
『敵方護航機！』P-51 出現」。

> 【第一版寫錯了一句】我寫「德 M1 連第二波都已經在了」。**那是錯的** ——
> 現有的波次掛在 `axis-patrol`（帝國防空巡邏）上，不是 `axis-intercept`
> （Codex P1-1）。而帝國防空巡邏**在 12 關裡沒有對應，會被刪掉**。
>
> 【所以那個波次要換觸發條件】原本是 `alive`（敵方戰鬥機剩 ≤2）＋兜底 120 s。
> **那在攔截卡上很可能來不及**：`convoyPriority: 5` 讓我方一心衝轟炸機，我實測
> 的那一場 145 s 護航機一架都沒掉，而那一關 145.5 s 就分勝負。
>
> 【措辭更正】第二版寫「不會成立」，**太滿了** —— 玩家自己選擇先打護航機的話
> 它就會成立，沒有任何規則擋著（Codex 覆審 P2-1）。準確的說法是：**那個條件
> 的節奏不可靠**，一次實測裡它從頭到尾沒有動過。所以德 M1 的波次用**時鐘**：
> `clock: 60`、`warnLead: 4`、P-51D 4 架。
>
> ⚑ **這代表你原本要試飛的那張卡不見了。**帝國防空巡邏的
> `atMost: 2 / byLatest: 120` 是為殲滅卡訂的，而攔截卡的動態完全不同。
> 60 秒是新的起始值，一樣待試飛。

**日 M1 零戰**：`annihilate`，A6M5 對 F6F-5，藍 8 紅 6（照 `axis-patrol` 的
編制）。**不加波次** —— 2026-09-01 定的四個動詞裡，這一關是「讓飛機性能本身
當關卡內容」，多一批敵機會沖淡它。

**日 M3 護航**：`convoy`，Ki-84 護送 G4M，F6F-5 來攔。與盟 M1 同一張卡換機種，
勝利條件是「G4M 飛抵投雷點」（2026-09-01 裁定：不判定魚雷命中）。

**德 M4 帝國最後防線**：`annihilate` 開場 → 返航節拍 → **一批批敵機從斜前方
擋路**。

> **專案負責人 2026-09-03：「敵人不一定要在後方，可以是斜前方多次批次出現，
> 有點像我方被攔截一樣。」**
>
> 這個形狀**不需要任何新機制，而且解掉了舊撤離卡的病灶**。舊卡失敗的原因是
> `pursuit` 幾何把敵機放在身後，玩家開著全場最快的東西直線跑掉
> （`missions.ts` 的 `EVAC` 註解）。新形狀反過來：
>
> ```
>   entry      headOn         紅方在 −Z，也就是藍隊機首方向
>   撤離點      z = −12,000    在敵人後面 —— 玩家必須打穿出去
>   第一批      along −0.5     z = −5,000、x = +3,150   斜前方，迎面
>   第二批      along −1.0     z = −10,000、x = +3,950  路的下一段
> ```
>
> 「打穿出去」正是護送卡已經驗證過會動的幾何。**追不到**這個問題從根本消失
> ——因為沒有人在追。
>
> 【撤離點為什麼是 12 km 而不是舊撤離卡的 20 km】玩家從 z = +5,000 出發，
> 20 km 的點在 z = −20,000 —— 越過第二批之後還有 10 km 的空路。12 km 讓整段
> 都留在爭奪區內。這是 §2.3 那個 `along` 覆寫的另一半：**兩個一起才治得住
> 「第二批生在背後」**（專案負責人 2026-09-03 裁定「乙 + 丙」）。

#### 德 M4 的完整資料

```ts
{ blueSpec: BF109K4, redSpec: P51D, convoySpec: null,
  blueCount: 8, redCount: 10, convoyCount: 0, convoyPriority: 1,
  targetDistance: 0, targetRadius: 0, seconds: Infinity,   // 開場是 annihilate
  entry: 'headOn', terrain: 'farmland',
  withdraw: {
    when: { kind: 'alive', side: 'mine', atMost: 4, byLatest: 90 },
    message: 'RETURN TO BASE',
    distance: 12000, radius: 1000, seconds: 158,
  },
  waves: [
    { when: { kind: 'clock', at: 0 }, warn: '前方攔截機！', warnLead: 4,
      side: 'theirs', spec: P51D, count: 4 },              // 沿用開局縱深
    { when: { kind: 'clock', at: 45 }, warn: '又一批，正前方', warnLead: 4,
      side: 'theirs', spec: P51D, count: 4, along: -1.0 },
  ] }
```

**返航的觸發是「我方剩不多」，不是時鐘 —— 而這一格是必須的，不是風格問題。**

> 開場規則是 `annihilate`：紅隊歸零就直接判勝。用時鐘的話，玩家在那一秒之前
> 清光開場敵軍，**任務結束，返航段永遠不會發生**（Codex 覆審 P0-2）。
>
> 綁在**我方**存活數上就沒有這個問題：藍 8 打紅 10 再加兩批共 8 架，
> 「藍隊剩 ≤4」一定比「紅隊歸零」先到。而且那正是 roadmap 對這一關的敘述
> ——「友軍逐漸減少 → 任務更新」。`byLatest: 90` 是兜底。

**`seconds: 158` 是推導出來的，不是挑的。**`evacuate.probe.ts` 的表一（P-51D
直飛）12 km 要 84.0 s；表四給 Bf 109 對 P-51D 在 20 km 的比值 168.2 / 125.5
= 1.34。所以 Bf 109 飛 12 km ≈ 112.6 s，乘 `EVAC_MARGIN` 1.4 = **158 s**。

**第一批的 `when` 是 `clock: 0`**：它們是開場就在的攔截網的一部分，不是增援。
（波次在 `warnLead` 之後才進場，所以開場那一瞬間場上仍是 8 對 10。）

⚑ **這六個數字全部是起始值，一定要試飛。**`atMost: 4`、`byLatest: 90`、
第二批的 `at: 45`、兩批各 4 架、12 km、158 s。

### 3.2 兩張撤離卡刪掉，而測試要跟著改

現有的 `allies-evac` 與 `axis-evac` 在 12 關裡沒有對應，隨舊卡一起刪。
判定、圓環、目標列與機制全部留著 —— 德 M4 的返航節拍接手當使用者。

> 【第一版說「那三支測試照留」，那是錯的】Codex F 逐條列出會紅的：
>
> ```
>   mission-evacuate.test.ts:68     從 MISSIONS.allies 找撤離卡 → undefined
>   missions.test.ts:94             兩張撤離卡的時限
>   missions.test.ts:132            撤離的實測資料一個都沒掉
>   missions.test.ts:143            三條 missionRules 撤離測試拿卡當 fixture
>   missions.test.ts:175            數條 missionConfigFrom 測試拿卡當 fixture
> ```
>
> 處置：那些測試改成**自己建一份撤離設定**（`mission.test.ts:22` 已經是這個
> 做法，所以它不會紅）。
>
> 【第二版說「兩個時限常數留在 `missions.ts`」，那會編不過】卡一刪它們就是
> 未使用的私有常數，而專案開著 `noUnusedLocals`（`tsconfig.json:9`，
> Codex 覆審 P1-4）。處置：**`EVAC_MARGIN` 留著**（德 M4 的 158 s 用它推），
> `EVAC_SECONDS_ALLIES` 與 `EVAC_SECONDS_AXIS` 兩個常數刪掉 ——
> 它們是 20 km 的值，而 12 km 的德 M4 用不到。**那張表一與表四的實測數字
> 不會不見**：它們的家一直是 `test/tools/evacuate.probe.ts` 的檔頭，
> `missions.ts` 這邊只是抄過來的副本。

### 3.3 這一輪要改的範圍比看起來大

Codex 掃出來的數字：**19 支測試檔**讀 `MISSIONS`／`missionConfigFrom`／
`FactionChoice`／`specsFor`，另有 **12 支探針**。而 `tsconfig.json:18` 把整個
`test/` 納入編譯 —— **探針不由 vitest 執行，但會讓 `tsc --noEmit` 紅**。

除了 §3.2 那五處，至少還有：

```
  ai-tactics.test.ts:178        找 allies-intercept
  extend-recovery.test.ts:66    找 axis-escort／allies-escort
  mission-convoy.test.ts:123    大量以舊 id 建卡並覆寫根層欄位
  convoy.probe.ts:16            讀 MISSIONS
```

**逐檔清單由 PLAN 列，但規模寫在這裡** —— 免得有人以為這是「改幾張卡」。

### 3.4 `mission.e2e.ts` 要重寫，不是調斷言

現行腳本只看預設的同盟國那一頁、不斷言可點張數、而且只點第一張可用的卡
（`mission.e2e.ts:99, 118, 128`）。§5.9 要求「切三條線、逐一啟動五關」——
那是一支新腳本，不是把數字從 5 改成 12。

---

## 四、不做什麼

- **不做戰役進度／解鎖／存檔。**12 關全部一開始就看得到，做好的可點。
- **不動遭遇戰。**它已經是逐架名單，八台都編得到。
- **不碰 `MissionRules`。**三條規則夠這 5 關用；新的勝利條件是里程碑 2。
- **七張目錄卡不填編制。**見 §3 的註。

---

## 五、驗收

1. `MISSIONS` 三落各 4 張，12 個 id 唯一，前綴對得上戰役。
2. 5 張有 `battle`、7 張是 null。**沒有「半套」這個狀態** —— 由型別保證，
   所以原本那條「資料必須全空」的測試改成驗**目錄卡的 `battle` 是 null**。
3. 每一張卡的機種都是 `ALL_SPECS` 裡的**同一個物件參考**（`toBe`，不是 `toEqual`）。
4. 護送／攔截的卡有 `convoySpec`，其餘為 null；與 `type` 逐條對得上。
5. **盟 M1 與德 M1 的 `BattleConfig` 與改動前的 `allies-escort`／
   `axis-intercept` 相同**（`beats` 除外 —— 德 M1 多一個波次）。

   > 【不是「逐位元」】第二版那樣寫是錯的：`BattleConfig` 是一張物件圖，
   > 含新建的 `Vector3`、共用的 `AircraftSpec` 參考與 `Infinity`。兩次**正確**
   > 生成也不會有相同的物件身分（Codex 覆審 P2-2）。
   >
   > 做法照 `spawn-baseline.ts` 既有的那一套：把 config **正規化成純量快照**
   > （機種寫 `spec.id`、向量寫 `[x,y,z]`、`Infinity` 寫成明確的標記字串），
   > 存成 fixture，再對快照做深度相等。**fixture 要在改動前產生**，而且
   > **不得 import 任何 spec 常數** —— 否則 spec 改壞時 fixture 跟著變，
   > 兩邊一起錯還是全綠。
6. `MissionWithdraw` 翻成的 `WithdrawBeat`：撤離點的座標與 `missionRules`
   對同一個 `distance` 算出來的相同。
7. 三顆戰役按鈕都畫得出來 —— **迭代的是 `MISSIONS` 的鍵**，不是寫死的陣列。
8. 每一關的地形由卡片決定；`main.ts` 不再寫死 `archipelago`。
9. `mission.e2e.ts`：三顆按鈕、12 張卡、可點的 5 張真的打得起來。
10. 日 M3 開得成 —— Ki-84 護送 G4M，兩者都真的生成。
11. 兩份重播校驗和不變（它們不吃任務卡，是廣域回歸閘門，**不**證明這一輪正確）。

---

## 六、風險

| # | 風險 | 處置 |
|---|---|---|
| 1 | 刪 10 張舊卡會弄紅一批測試與 e2e | §3.2 已逐條列出；不用 `.skip` |
| 2 | 德 M4 的節奏（幾批、隔多久、幾架） | 起始值，一定要試飛 |
| 3 | 德 M1 的波次改成時鐘 60 s，沒有實測基礎 | 起始值，一定要試飛 |
| 4 | `MissionCard` 拆成兩層會擴散到 menu、main、測試 | 那是這一輪的本體，不是意外 |
