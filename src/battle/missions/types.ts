import type { Vector3 } from 'three'
import type { GroundUnitId } from '../../render/geometry/ground'
import type { EntryPlanId } from '../entry'
import type { ShipClassId } from '../../world/ships'
import type { ShipGunSpec } from '../../world/shipGuns'
import type { FlarePoint } from '../beats'
import type { AircraftSpec } from '../../specs/types'
import type { Team } from '../../world/World'
import type { TerrainKind } from '../../world/terrainKind'
import type { TimeOfDay } from '../../world/timeOfDay'
import type { Loadout } from '../../weapons/stores'
import type { TakeoffLine } from '../../control/takeoffRoll'
import type { GroundMotion } from '../../world/groundMotion'

/**
 * # 任務卡的型別
 *
 * **只有型別，沒有任何一張卡。** 卡片住在 `allies.ts` / `germany.ts` /
 * `japan.ts`，共用的編成與常數住在 `shared.ts`。
 *
 * 【為什麼分成四個檔案】九張卡曾經與型別、共用常數、推導函數擠在同一個
 * 一千三百行的檔案裡。那時同時改兩張卡就會互相覆蓋 —— 而三條線的卡片本來
 * 就是三件不相干的事。分檔之後每一條線各自有主人。
 *
 * 【為什麼型別要單獨一檔】`shared.ts` 的編成表要用這裡的型別，卡片要用
 * 兩者。型別留在門面（`index.ts`）的話就成環了。
 */

/** 任務類型。對應 `docs/prompt.md` 規劃的五種 */
export type MissionType = '殲滅' | '攔截' | '打擊' | '護航' | '撤離'

/**
 * 卡片上的「哪一邊」。**玩家恆在藍隊**，所以 `mine` 就是藍、`theirs` 就是紅。
 *
 * 【它只決定隊伍，不決定機種】機種由卡片直接指名。一支友軍增援與一支敵方
 * 增援可能是同一個機種 —— 那兩件事分開之後才寫得出來。
 */
export type MissionSide = 'mine' | 'theirs'

/**
 * 卡片上的觸發條件。
 *
 * 【為什麼不直接用 `BeatCondition`】那一個講的是 `team: 'red'`。同一張卡上
 * 「敵方」會有兩種寫法（波次寫 `side: 'theirs'`、條件寫 `team: 'red'`），
 * 而兩者哪天不同步不會有人發現。卡片這一層只有一套說法。
 */
export type MissionTrigger =
  /** 開場後第 `at` 秒 */
  | { readonly kind: 'clock'; readonly at: number }
  /**
   * 某一邊（可再限定機種角色）的存活數降到 `atMost` 以下。
   *
   * `byLatest` 是**必填的兜底**：玩家太慢（打不完）或太快（繞過去）時條件
   * 可能永遠不成立，那一關就卡死了。到了這個秒數無條件成立。
   */
  | {
    readonly kind: 'alive'
    readonly side: MissionSide
    readonly role?: AircraftSpec['role']
    readonly atMost: number
    readonly byLatest: number
  }
  /**
   * 這一關的重生（`MissionBattle.recycle`）已經預警第 `at` 批。
   * **沒有重生的卡不能用它** —— 批數永遠是 0，那一波永遠不來。
   */
  | { readonly kind: 'batch'; readonly at: number }
  /**
   * 到了 `byLatest` 秒，敵方地面目標的摧毀數不到 `below` 才成立。
   * **沒有 `ground` 的卡不能用它** —— 摧毀數永遠是 0，條件退化成時鐘。
   */
  | { readonly kind: 'ground'; readonly below: number; readonly byLatest: number }
  /**
   * 敵方地面目標的摧毀數達到 `atLeast`（`unit` 省略 = 全部）。`byLatest` 選填：
   * 到了那一秒無條件成立。**沒有 `ground`／`vehicleConvoy` 的卡不能用它** ——
   * 摧毀數永遠是 0。開到終點退場的車不算摧毀。
   */
  | {
    readonly kind: 'destroyed'
    readonly atLeast: number
    readonly unit?: GroundUnitId
    readonly byLatest?: number
  }

/**
 * 卡片上的一個波次。**一個波次就是一支小隊**（1 … `SCHWARM_SIZE` 架）。
 *
 * 【為什麼沒有 `duty`】`transit` 的意思是「飛向自己正前方的終點，途中不
 * 交戰」，只有在那一邊的任務**有終點**時才成立。殲滅任務裡放一支 transit
 * 的波次，它會直直飛出地圖而且永遠不死 —— 那一關就再也打不完了。
 * 波次一律 `combat`；哪一天真的需要 transit 的波次，那是一個要連著勝負
 * 條件一起想的決定。
 *
 * 【為什麼沒有進場幾何】波次沿用**那一邊開局的擺法**，也就是它們原本來的
 * 方向。觸發時場上的仗已經飄到中間了，所以波次自然出現在遠方。
 */
export interface MissionWave {
  readonly when: MissionTrigger
  /**
   * 畫面中心的預警文字。
   *
   * 【不要宣稱方位】「正前方」那種寫法是一個**會變成假的斷言** —— 預警在
   * 戰鬥進行中顯示，而玩家那時可能朝任何方向。寫「發生了什麼」，不要寫
   * 「在哪裡」。
   *
   * 唯一的例外是**開場那一刻**（`clock: 0`）：那時玩家一定還朝著機首方向。
   */
  readonly warn: string
  /** 預警到進場之間的秒數 */
  readonly warnLead: number
  readonly side: MissionSide
  /**
   * 這一批飛什麼。**直接指名，不是「那個陣營的第幾台」。**
   *
   * 【為什麼不是 `role: 'fighter' | 'bomber'`】那種相對寫法表達不出第三架
   * 飛機 —— 而日本線有兩台戰鬥機。
   */
  readonly spec: AircraftSpec
  /** 幾架。1 … `SCHWARM_SIZE` */
  readonly count: number
  /**
   * 進場縱深的覆寫，以 `entryRange` 為單位（同 `SideEntry.along`）。
   * **省略 = 沿用那一邊開局的擺法。**
   *
   * 【為什麼需要它】波次原本固定生在那一邊的開局點。玩家往前跑的關卡裡
   * （撤退），紅方開局點在 z = −5,000，而玩家從 z ≈ 0 跑到那裡只要 28 秒。
   * 第二批若晚 40 秒到就生在玩家**背後** —— 那時沒有人追得上任何人。
   *
   * 【為什麼只覆寫 `along` 而不是給一整個 `SideEntry`】要變的只有「這一批
   * 在路的哪一段等你」。橫向、高度、朝向與速度沿用那一邊的擺法才對 ——
   * 它們仍然是那一隊的飛機。
   */
  readonly along?: number
  /**
   * 進場高度的覆寫，m。**絕對值，不是相對任務高度的加成。**
   * 省略 = 沿用那一邊開局的高度。
   *
   * 【為什麼是絕對值】需要它的是雷擊機：投雷高度是 150 m，而它從進場點飛到
   * 艦隊只有幾公里。太高的話飛到目標上方時還沒降完，姿態進不了投放包絡就
   * 不准鎖航向，整趟帶著雷飛過去。那個要求是絕對的 —— 它與這一關的任務高度
   * 訂在哪裡無關。
   */
  readonly altitude?: number
  /**
   * 進場方位的覆寫：繞著世界原點往右舷轉這麼多，rad。
   * **省略 = 沿用那一邊開局的方位。**
   *
   * 【與 `MissionBattle.redStarboard` 是同一個旋轉】開場的第二群與後續的每
   * 一波要落在同一個方位上，所以共用 `order.ts` 的 `rotateEntry`。
   *
   * 【原點就是艦隊中心】有艦隊的關卡才有意義（`MissionFleet.center`）。
   */
  readonly starboard?: number
  /**
   * 從跑道滾行起飛，而不是在進場框的空中生成。**省略 = 空中生成。**
   * 設了它之後 `along`／`altitude`／`starboard` 不影響位置。
   */
  readonly takeoff?: TakeoffLine
  /**
   * 起飛的每一架讓地上一台這種停放單位離場。**配 `takeoff` 用**；省略的話
   * 停機墊上那一架與正在滾行的那一架是同一架飛機的兩份。
   */
  readonly departs?: GroundUnitId
}

/**
 * 開場的小隊被殲滅之後整隊重生。**回收席位，不佔預留** —— 同時在場的架數
 * 不超過開場，`MAX_SIDE` 不必動。
 *
 * 【整隊，不補半隊】理由見 `beats.ts` 的 `RecycleBeat`。
 */
/** 這一關的照明彈。**沒有的卡不寫這一格**（與 `waves` 同一個約定） */
export interface MissionFlares {
  readonly when: MissionTrigger
  /** 每一枚的位置、高度、比節拍晚幾秒點燃 */
  readonly points: readonly FlarePoint[]
}

export interface MissionRecycle {
  readonly side: MissionSide
  /** 只回收這個角色的小隊。省略 = 那一邊全部 */
  readonly role?: AircraftSpec['role']
  /** 最多預警幾批。用完之後小隊死光就死光 */
  readonly batches: number
  /** 畫面中心的預警文字。同 `MissionWave.warn`，不宣稱方位 */
  readonly warn: string
  /** 預警到重生之間的秒數 */
  readonly warnLead: number
  /** 重生的進場方位，同 `MissionWave.starboard` */
  readonly starboard?: number
}

/**
 * 一條戰役。**三條線各 4 關。**
 *
 * 【為什麼三個都用國家而不是陣營】日本也是軸心。留著 `axis` 當德軍的代稱，
 * 是一個等著發生的誤讀。
 *
 * 【它不參與任何生成邏輯】只做兩件事：卡片分在哪一落、選單那顆按鈕寫什麼。
 * 雙方飛什麼由卡片自己說（見 `MissionBattle`）—— **敵方機種是逐卡的**，
 * 盟軍線的「沖繩外海」敵人就是日本魚雷機。
 */
export type Campaign = 'allies' | 'germany' | 'japan'

/** 戰役的順序。**選單那一列照這個畫**，測試也照這個掃 */
export const CAMPAIGNS: readonly Campaign[] = ['allies', 'germany', 'japan']

/**
 * 一張任務卡的**目錄**那一半。選單畫得出來就靠這幾格。
 *
 * 【為什麼從 `ui/` 搬到 `battle/`】M10 時它只有標題與文案，是 UI 的東西。
 * 現在它帶著編制與勝負條件 —— 那是**關卡資料**，而選單只是它的一個讀者。
 */
export interface MissionCard {
  /**
   * 全域唯一。`main.ts` 用它認出玩家點的是哪一關。
   *
   * 【前綴就是戰役】`campaigns.test.ts` 釘住。
   */
  readonly id: string
  readonly title: string
  readonly type: MissionType
  /** 卡片上的一行說明 */
  readonly summary: string
  /**
   * 這一關取材自哪一片空域。**簡報上寫的是這個，不是地形（群島／內陸
   * 農地）** —— 地形是模擬的參數，空域才是簡報會寫的東西。
   */
  readonly place: string
  /** 取材自哪一段時間。粗到年或月為止 —— 再細就會跟機型的服役期打架 */
  readonly period: string
  /**
   * 這一關的戰鬥設定。**null = 還沒做**，選單上 disabled。
   *
   * 【不要用 `playable` 旗標】一個布林值加上一堆散在根層、可以只填一半
   * 的欄位，會讓「資料要嘛完整、要嘛全空」只能靠一條測試守。放進一個可為
   * null 的物件之後，那個不變量由**型別**保證：拿得到 `battle` 就一定拿得到
   * 裡面每一格。
   *
   * 【下游收窄型別】`missionConfigFrom` 與選單的點擊回呼都收
   * `ReadyMissionCard`，所以那些地方不需要任何 null 檢查。
   */
  readonly battle: MissionBattle | null
}

/** 打得起來的卡。**`missionConfigFrom` 只收這一種。** */
export type ReadyMissionCard = MissionCard & { readonly battle: MissionBattle }

/** 一關真的要打起來所需要的一切。 */
export interface MissionBattle {
  /**
   * HUD 目標列上的文字。
   *
   * 【為什麼放在卡片上而不是 `MissionState`】它是常數。放進狀態的話
   * `stepMission` 每個物理步跑 240 次，等於每秒配置 240 個字串。
   */
  readonly objective: string
  /**
   * 進場橫幅：一進地圖在畫面中央放大印出的那一句，好懂、口語、先講發生了
   * 什麼再講要做什麼。**省略 = 用 `objective`。** 不超過 14 個字，玩家要一眼
   * 讀完（護欄在 `missions.test.ts`）。
   */
  readonly banner?: string
  /**
   * 我方（藍隊）的主力機種。**不保證是戰鬥機** —— 有幾關玩家開轟炸機。
   *
   * 【為什麼是 `AircraftSpec` 物件而不是 id 字串】id 打錯是執行期才發現
   * （`specOf` 會靜靜落回第一台），物件打錯是編譯錯誤。而且下游三張依物件
   * 識別的快取（`envelope`、`doctrine`、`ceilings`）認的就是這個參考。
   */
  readonly blueSpec: AircraftSpec
  /**
   * 複寫玩家這一關掛什麼。**省略 = 用 `blueSpec` 的預設掛載。**
   *
   * 【為什麼要有】G4M 的預設是魚雷 × 1（`weapons/stores.ts`），但護送關的
   * 那一台該掛炸彈。機種與掛載本來就是兩件事。
   */
  readonly blueLoadout?: Loadout
  /**
   * 依機種複寫掛載，鍵是 `spec.id`，**不分隊伍**。盟 M3 用它讓零戰掛爆戦 ——
   * 那一關的紅隊還有掛雷的陸攻，整隊複寫的話魚雷會被換掉。
   */
  readonly loadouts?: Readonly<Record<string, Loadout>>
  /** 敵方（紅隊）的主力機種 */
  readonly redSpec: AircraftSpec
  /**
   * 被護送／被攔截的那幾架是什麼。**護送算藍隊、攔截算紅隊**，其餘為 null。
   * 哪一邊由 `type` 決定，與 `convoyCount` 同一條規則。
   */
  readonly convoySpec: AircraftSpec | null
  /**
   * 我方**主力**的架數，含玩家。
   *
   * 【不含被護送的那幾架】它們由 `convoyCount` 另外給 —— 兩者的編隊方式、
   * 高度層與行為完全不同（見 `order.ts` 的 `SideOrder`），混在同一個數字裡
   * 的話這一層要自己去猜哪幾架是哪一種。
   */
  readonly blueCount: number
  readonly redCount: number
  /**
   * 複寫這一關陸上重高砲的規格。**省略 = `GROUND_FLAK_SPEC`。**
   *
   * `flakHeavy` 在盟 M2、德 M2、日 M3 都出現，直接改那份通用規格會把另外兩關一起改掉。
   * 寫成 `{ ...GROUND_FLAK_SPEC, roundsPerMinute: 30 }` 就看得出改了哪一格。
   */
  readonly flakSpec?: ShipGunSpec
  /**
   * 戰鬥機優先掃射的地面單位。省略時空中目標仍優先；設定後只有遭到敵機
   * 直接瞄準時會先自衛。這是任務目標提示，不改掃射或防墜模型。
   */
  readonly priorityGroundUnit?: GroundUnitId
  /**
   * 藍隊**分層擺位**：小隊前後拉開、左右錯開、高度分層，玩家在中間那一隊
   * （`order.ts` 的 `stackedEntry`）。**省略 = 橫隊。**
   *
   * **只是開場站位，不是編隊** —— 沒有隊形維持，起飛之後每一架照自己的
   * 攻擊航路飛。
   */
  readonly blueStacked?: true
  /**
   * 紅隊分兩路夾擊：後半繞著艦隊往右舷轉這麼多，rad。**省略 = 一路壓上來。**
   *
   * 【它繞的是世界原點】`MissionFleet.center` 就在原點，兩者是同一個點。
   * 沒有艦隊的關卡用它只會把敵人擺到一個奇怪的方位，所以那些卡片不填。
   */
  readonly redStarboard?: number
  /** 被護送／被攔截的那幾架有幾架。其餘任務為 0 */
  readonly convoyCount: number
  /**
   * 被護送的那一群排成三中隊箱型（`order.ts` 的 `pushBox`）。**省略 = 一條橫線。**
   *
   * 橫線的寬度隨架數線性長，十幾架排成一線會超出抵達半徑；箱型把寬度分給
   * 高度與縱深兩軸，整隊才落得進同一個判定圈。
   */
  readonly convoyBox?: true
  /**
   * `convoySpec` 那幾架的職務。**省略 = `transit`。**
   *
   * ```
   *   transit  被護送：飛向終點、不交戰。只在護航／攔截的規則下成立
   *   strike   我方的攻擊隊：combat 職務，照常走攻擊航路，不需要護送規則
   *   stream   敵方的轟炸機流：transit 職務、飛向終點，到了就從起點重新進場
   *            （`conveyor` 節拍）。終點不判勝負，勝負由卡片自己的規則決定
   * ```
   *
   * `strike` 一律排進藍隊、`stream` 一律排進紅隊。勝負由卡片自己的規則決定
   * （例如 `sinkCount`、`huntCount`）。`stream` 的終點照攔截的算法放在
   * `targetDistance`／`targetRadius`。
   */
  readonly convoyDuty?: 'transit' | 'strike' | 'stream'
  /**
   * 被護送的那幾架在**敵方**目標挑選裡值幾倍。**1 = 沒有偏置。**
   *
   * 【為什麼在卡片上而不是一個全域常數】護送與攔截要的量不一定一樣 —— 護送
   * 是「敵人更想打我方轟炸機」，攔截是「我方更想打敵方轟炸機」。同一個
   * 機制、兩個可以分開調的數字。詳見 `mission.ts` 的 `MissionTuning`。
   */
  readonly convoyPriority: number
  /**
   * 終點在該隊機首方向多遠，m。沒有終點的任務為 0。
   *
   * 【為什麼是距離而不是座標】方向跟著那一隊走：撤離與護送是藍隊、朝 −Z；
   * 攔截是紅隊、朝 +Z。寫成座標的話這件事會被藏進一個負號。
   */
  readonly targetDistance: number
  /** 抵達半徑，m。**就是圓環半徑**。沒有終點的任務為 0 */
  readonly targetRadius: number
  /** 時限，秒。無時限為 `Infinity` */
  readonly seconds: number
  /**
   * 開局怎麼擺。**`battle/entry.ts` 那張表的鍵。**
   *
   * 【為什麼是每張卡自己的欄位】擺位不只有對頭與追我，每個任務都可以有
   * 不同的擺法。
   */
  readonly entry: EntryPlanId
  /**
   * 這一關打在什麼地形。
   *
   * 【為什麼是卡片的欄位而不是寫死】`main.ts` 原本把每一關寫死成群島。
   * 太平洋那幾關要海面、帝國本土那一關要內陸 —— 少了這一格它們會靜靜地
   * 開在群島上，沒有任何錯誤。
   */
  readonly terrain: TerrainKind
  /**
   * 這一關的增援波次。**沒有波次的卡不寫這一格**（不是寫空陣列）。
   *
   * 【為什麼是選填而不是預設空陣列】`missionConfigFrom` 對沒有這一格的卡
   * 完全不產生 `beats`，而 `stepBeats` 第一行就早退。
   */
  readonly waves?: readonly MissionWave[]
  /**
   * 這一關的整隊重生。**沒有的卡不寫這一格**（與 `waves` 同一個約定）。
   */
  readonly recycle?: MissionRecycle
  /** 這一關的照明彈。**沒有的卡不寫這一格**（與 `waves` 同一個約定）。 */
  readonly flares?: MissionFlares
  /**
   * 這一關的返航節拍：打到一半任務目標換成「飛回基地」。
   *
   * 【觸發條件不是可以隨便選的】開場規則若是 `annihilate`，返航用時鐘的話
   * 玩家在那一秒之前清光敵軍就直接判勝，返航段永遠不會發生。綁在**我方**
   * 存活數上才對 —— 那也正是這一關的敘述：「友軍逐漸減少 → 任務更新」。
   */
  readonly withdraw?: MissionWithdraw
  /**
   * 這一關的艦隊。**沒有這一格的卡完全不產生船**（與 `waves` 同一個約定）。
   *
   * 【它要一路透傳】`MissionBattle` → `BattleConfig` → `missionConfigFrom`
   * → `createBattle`。少任何一處都是「型別過了但進戰鬥零艘船」，不報錯。
   */
  readonly fleet?: MissionFleet
  /**
   * 這一關的地面目標。**沒有這一格的卡完全不產生**（與 `fleet` 同一個約定），
   * 透傳的路也相同 —— 漏一處就是進戰鬥零台，不報錯。
   */
  readonly ground?: readonly GroundEntry[]
  /**
   * 沿公路開往前線的車隊。**展開成 `ground` 的條目**（`missionConfigFrom`），
   * 每一台帶 `motion`。與 `ground` 可以並存。
   */
  readonly vehicleConvoy?: MissionVehicleConvoy
  /**
   * 截斷車隊：炸毀 `count` 輛 `unit`，抵達 `leak` 輛就輸。**有這一格就是截斷關**，
   * 勝負規則變成 `{ kind: 'interdict' }`。它必須配 `vehicleConvoy`，而且要有
   * 「摧毀 ≥ count」觸發的 `withdraw` —— `campaigns.test.ts` 守著。
   */
  readonly interdict?: { readonly count: number; readonly leak: number; readonly unit: GroundUnitId }
  /**
   * 開場高度，m。**省略 = `DEFAULT_BATTLE.altitude`（4,000）。**
   *
   * 【為什麼要有它】在這一格之前，十二關的開場高度全部寫死成同一個值。
   * 對倫內爾島那種**低空**雷擊來說 4,000 m 是錯的 —— 實測玩家開場在
   * 3,850 m，而艦隊在 6.3 km 外、3.85 km 正下方：不低頭看不到船，
   * 而那一關的第一印象本來就該是海面上的艦隊。
   *
   * 【它同時是撤離點與集合點的高度】`missionRules` 拿它算那些點，所以
   * 兩邊要餵同一個值，不能一個讀卡片一個讀預設。
   */
  readonly altitude?: number
  /**
   * 要擊沉幾艘。**有這一格就是擊沉關**，勝負規則變成 `{ kind: 'sink' }`。
   *
   * 【它必須配 `fleet`】沒有艦隊卻要求擊沉是一個永遠打不完的任務，
   * 而且畫面上一切正常 —— `campaigns.test.ts` 那一層守著。
   */
  readonly sinkCount?: number
  /**
   * 要炸毀幾座。**有這一格就是炸毀關**，勝負規則變成 `{ kind: 'destroy' }`。
   * 它必須配 `ground`，而且不得與 `sinkCount` 共存 —— `campaigns.test.ts`
   * 守著。
   */
  readonly destroyCount?: number
  /**
   * 只算這一種地面單位。**省略 = 敵方地面目標全部都算。**
   *
   * 【為什麼需要它】德 M3 要的是停放的 P-51，而油桶堆與輕高砲也是敵方目標。
   * 不限定的話打掉八座砲位與油桶就過關 —— 目標列寫的「P-51」一架都沒動。
   */
  readonly destroyUnit?: GroundUnitId
  /**
   * 要擊落幾架。**有這一格就是擊落關**，勝負規則變成 `{ kind: 'hunt' }` ——
   * 沒有判定圈、沒有抵達，累積擊落數到了就贏。
   *
   * 【它與 `sinkCount`／`destroyCount` 不得共存】三者都是「這一關要數什麼」，
   * 同時存在時只有一個會生效，而落選的那個在卡片上看起來完全正常。
   * `campaigns.test.ts` 守著。
   */
  readonly huntCount?: number
  /**
   * 只算這個角色的擊落。**省略 = 全部都算。**
   *
   * 【為什麼需要它】德 M1 要數的是轟炸機，而場上同時有護航的戰鬥機。
   * 不限定的話打護航機也能過關 —— 那一關的內容就整個變了，而畫面上一切正常。
   */
  readonly huntRole?: AircraftSpec['role']
  /**
   * 護送要送到幾架才算達成。**省略 = 1，也就是任一架抵達就定案。**
   *
   * 【它同時帶進一個新的敗北條件】還活著的加上已經送到的湊不到這個數時，
   * 當場判定 —— 16 架剩 7 架還在飛的那一關已經結束了，不必再飛兩分鐘。
   * 逐格語意見 `mission.ts` 的 `MissionRules.convoy`。
   */
  readonly need?: number
  /**
   * 這一關的時段。**省略 = `'noon'`。**
   *
   * 【它只影響畫面，不進 `BattleConfig`】光照與模擬無關，所以它不走
   * `missionConfigFrom` 那條路 —— `main.ts` 直接從卡片讀。混進戰鬥設定的話，
   * 逐位元重播的護欄會開始被純視覺的改動弄紅。
   */
  readonly timeOfDay?: TimeOfDay
}

/**
 * 這一關的艦隊。
 *
 * 【為什麼是一個中心＋一個艏向＋相對偏移】改艏向時若每一艘各存世界座標，
 * 全部都要重算，而重算的錯誤是「陣型悄悄歪掉」—— 沒有任何測試會紅。
 */
export interface MissionFleet {
  /** 艦隊中心的世界座標。 */
  readonly center: Vector3
  /**
   * 整隊的艏向，rad（繞 Y，0 = 朝 −Z）。**一個數字管全隊** ——
   * 船不各自轉向，而「同一個艏向」正是「不閃避」在資料上的樣子。
   */
  readonly heading: number
  /** 航速，m/s。整隊一樣。 */
  readonly speed: number
  readonly ships: readonly FleetEntry[]
}

/**
 * 一台地面目標的擺位，**世界座標**。
 *
 * 【為什麼是絕對座標而不是艦隊那種「中心＋偏移」】船要排陣型、要整隊同
 * 一個艏向；地面目標是散落在道路、調車場、砲位上的個體，各自有各自的
 * 朝向。高度不用填 —— 落地時照地形取。
 */
export interface GroundEntry {
  readonly unit: GroundUnitId
  readonly team: Team
  readonly x: number
  readonly z: number
  /** 航向，rad（繞 Y，0 = 車頭朝 −Z）。 */
  readonly heading: number
  /**
   * 沿路線移動的設定。**省略 = 不動。** 由 `vehicleConvoy` 展開時填
   * （`missions/index.ts` 的 `convoyGround`），卡片不直接寫。
   */
  readonly motion?: GroundMotion
  /**
   * 身上的武裝。**省略 = 看單位**：`flakLight`／`flakHeavy` 是砲位，其餘不還手。
   * `'mg'` = 車頂一挺 .50 機槍（`GROUND_MG_SPEC`）。
   */
  readonly guns?: 'mg'
}

/** 車隊的一批：同一刻出發的幾輛 */
export interface MissionVehicleBatch {
  /** 開場後第幾秒出發 */
  readonly departAt: number
  /** 依行進順序，第一個是車頭 */
  readonly units: readonly GroundUnitId[]
}

/**
 * 沿公路開往終點的車隊。**全部是紅方。**
 *
 * 【集結】全部車輛排在路線起點往前的同一條線上：第一批的車頭最遠，最後一批
 * 的車尾在起點。車速相同，後一批晚出發也不會追撞前一批。
 */
export interface MissionVehicleConvoy {
  /** 路線，世界座標。**與地上畫的路是同一份**（日 M2 的 `LEYTE_ROAD`） */
  readonly route: readonly { readonly x: number; readonly z: number }[]
  /** 車速，m/s */
  readonly speed: number
  /** 轉角圓弧的半徑，m */
  readonly turnRadius: number
  /** 同一條路上前後兩輛的車距，m */
  readonly gap: number
  /** 依出發順序 */
  readonly batches: readonly MissionVehicleBatch[]
  /** 這幾種單位車頂帶一挺機槍（`GroundEntry.guns = 'mg'`）。省略 = 都不帶 */
  readonly armed?: readonly GroundUnitId[]
}

export interface FleetEntry {
  readonly cls: ShipClassId
  readonly team: Team
  /**
   * 相對艦隊中心的**艦隊座標**（+X 右、−Z 前，與艦體座標同一套朝向）。
   * 擺位時先轉 `heading` 再加 `center`。
   */
  readonly offset: Vector3
  /**
   * 這一艘沉了就輸。**只有 `defend` 規則讀它**（`mission.ts` 的 `vitalSunk`）。
   *
   * 【為什麼是旗標而不是把艦級寫進規則】`cls === 'essex'` 那種寫法把「誰
   * 要緊」耦進判定裡，換一艘船當主角就要改規則；旗標與艦名單住在同一個
   * 地方，看得到編成就看得到誰要緊。
   *
   * 【為什麼是 `?: true` 而不是 `boolean`】`exactOptionalPropertyTypes`
   * 開著，與 `FlightPlan.player` 同一個寫法 —— 不必為每一艘補 `vital: false`。
   */
  readonly vital?: true
}

/** 打到一半把任務目標換成撤離。 */
export interface MissionWithdraw {
  readonly when: MissionTrigger
  /** 畫面中心的文字，同時取代 HUD 目標列上那一句 */
  readonly message: string
  /**
   * 撤離點在我方機首方向多遠，m。與 `targetDistance` 同一套。**負值 = 在我方
   * 開局位置的後方**（撤離點在來時的方向，日 M2）
   */
  readonly distance: number
  readonly radius: number
  readonly seconds: number
}
