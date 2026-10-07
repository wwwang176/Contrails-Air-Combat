import type { Vector3 } from 'three'
import type { GroundUnitId } from '../../specs/ground'
import type { EntryPlanId } from '../entry'
import type { ShipClassId } from '../../world/ships'
import type { ShipGunSpec } from '../../world/shipGuns'
import type { FlarePoint } from '../beats'
import type { AircraftSpec } from '../../specs/types'
import type { FeelKind } from '../../specs/feel'
import type { Team } from '../../world/team'
import type { TerrainKind } from '../../world/terrainKind'
import type { TimeOfDay } from '../../world/timeOfDay'
import type { ArenaBounds } from '../../world/arena'
import type { CloudField } from '../../world/cloudField'
import type { Loadout } from '../../weapons/stores'
import type { TakeoffLine } from '../../control/takeoffRoll'
import type { GroundMotion } from '../../world/groundMotion'
import type { MessageKey } from '../../i18n'

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

/**
 * 任務類型。對應 `docs/prompt.md` 規劃的五種。顯示的名稱查 `mission.type.<類型>`
 * （`src/i18n`）—— 這一格是代號，不是給玩家看的字
 */
export type MissionType = 'annihilate' | 'intercept' | 'strike' | 'escort' | 'withdraw'

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
   *
   * 文字表的鍵（`src/i18n`），不是文字本身。
   */
  readonly warnKey: MessageKey
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
   * 橫向槽位的覆寫，以 `schwarmSpacing` 為單位（同 `FlightPlan.lane`）。
   * **省略 = 從 `WAVE_LANE` 起、逐波次 +1**，也就是生在開場所有小隊的外側。
   *
   * 【什麼時候要它】敵機要與玩家正面對頭、而不是從側邊來的關卡（德 M4）：外推 3 格就是軸線外 2.4 km。
   * 同一刻有兩批的話，兩批要各給一個不同的槽位，否則生在同一點上、重疊，而且不會有任何錯誤。
   */
  readonly lane?: number
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
  /** 畫面中心的預警文字的鍵。同 `MissionWave.warnKey`，不宣稱方位 */
  readonly warnKey: MessageKey
  /** 預警到重生之間的秒數 */
  readonly warnLead: number
  /** 重生的進場方位，同 `MissionWave.starboard` */
  readonly starboard?: number
}

/**
 * 一條戰役。每一條幾關由卡片陣列決定，型別與測試都不鎖張數。
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
  /** 標題的鍵（`src/i18n`）。以下 `*Key` 都是文字表的鍵，不是文字本身 */
  readonly titleKey: MessageKey
  readonly type: MissionType
  /** 卡片上的一行說明 */
  readonly summaryKey: MessageKey
  /**
   * 這一關取材自哪一片空域。**簡報上寫的是這個，不是地形（群島／內陸
   * 農地）** —— 地形是模擬的參數，空域才是簡報會寫的東西。
   */
  readonly placeKey: MessageKey
  /**
   * 取材自哪一段時間，到月為止 —— 再細就會跟機型的服役期打架。`month` 從 1 起算，
   * 顯示時依語言格式化（`formatMonth`）
   */
  readonly period: { readonly year: number; readonly month: number }
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
  readonly objectiveKey: MessageKey
  /**
   * 進場橫幅：一進地圖在畫面中央放大印出的那一句，好懂、口語、先講發生了
   * 什麼再講要做什麼。**省略 = 用 `objectiveKey`。** 玩家要一眼讀完：中文不超過
   * 14 個字、英文不超過 30 個字元（護欄在 `missions.test.ts`）。
   */
  readonly bannerKey?: MessageKey
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
  /**
   * 依機種複寫塗裝，鍵是 `spec.id`、值是機型定義登記的變體名（`GlbAircraft.liveryVariants`），**不分隊伍**。
   * 德 M4 用它讓 Ju 87、Yak-1B 與護航的 Bf 109 穿冬季塗裝。**省略 = 全部用預設塗裝。**
   * 只影響畫面，不進模擬；遭遇戰與機庫沒有這個欄位，所以不受影響。
   */
  readonly liveries?: Readonly<Record<string, string>>
  /**
   * 依機種指名用哪一組手感（`specs/feel.ts`），鍵是 `spec.id`，**不分隊伍**，進場、增援、重生都照它。
   * 德 M4 讓 Ju 87 用戰鬥機那一組（`{ ju87: 'fighter' }`）：功率與阻力同倍率放大，只動爬升，極速不動。
   * **省略 = 依機種角色挑**（轟炸機 `BOMBER_FEEL`、戰鬥機 `GAME_FEEL`）。遭遇戰沒有這個欄位。
   */
  readonly feels?: Readonly<Record<string, FeelKind>>
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
   * 轟炸機在敵方目標挑選裡值幾倍。**省略 = 1，沒有偏置。** 見 `mission.ts` 的
   * `MissionTuning.bomberPriority`。
   */
  readonly bomberPriority?: number
  /**
   * 藍隊戰鬥機只打飛機、不掃射地面。**省略 = false。** 見 `MissionTuning.airOnly`。
   */
  readonly airOnly?: boolean
  /**
   * 藍隊**分層擺位**：小隊前後拉開、左右錯開、高度分層，玩家在中間那一隊
   * （`order.ts` 的 `stackedEntry`）。**省略 = 橫隊。**
   *
   * **只是開場站位，不是編隊** —— 沒有隊形維持，起飛之後每一架照自己的
   * 攻擊航路飛。
   */
  readonly blueStacked?: true
  /**
   * 藍隊分批前後排開：每 `size` 架一批，相鄰兩批在世界座標 z 上差 `depth` 公尺，前後交錯進場
   * （`order.ts` 的 `waveColumn`）。**省略 = 橫隊。** 只是開場站位，玩家在第一批。
   */
  readonly blueWaves?: {
    readonly size: number
    readonly depth: number
    /**
     * 與藍隊同一刻生成的護航戰鬥機（`order.ts` 的 `waveColumn`）：分成 `⌈count ÷ 4⌉` 個小隊、
     * 在轟炸機上方、落後第一批 `depth` m。`blueCount` 只數被護航的那一列。**省略 = 沒有護航。**
     *
     * `speed`：護航機的開場空速佔 `BattleConfig.tas` 的比例，省略 = 1。護航機比轟炸機快很多，照戰鬥機的
     * 開場速度會一開場就超過被護航的轟炸機、掉頭回來歸位，那十幾秒機首背對目標。
     */
    readonly escort?: {
      readonly spec: AircraftSpec; readonly count: number; readonly depth: number; readonly speed?: number
    }
  }
  /**
   * 簡報把開場的陣容列出來：`blueWaves.escort` 進我方欄，`waves` 裡開場就在場上的敵方批次進敵方欄
   * （同機種併成一列）。開場就在場上 = `clock: 0` 進場，或從停機位出發（`departs`，從開場就停在地上）。
   * **省略 = 簡報只列 `blueSpec`、`redSpec`、`convoySpec`。**
   *
   * 【為什麼要卡片自己舉手】`waves` 多半是戰鬥中才進場的增援，玩家出擊前不知道，簡報不寫；`clock: 0` 的批次
   * 在別的關卡是空中巡邏，也不算「對面的陣容」。
   *
   * 【為什麼 `departs` 不看時間】停機位上的飛機一架不少地擺在地上，晚到的批次只是晚滑出去；
   * 只看 `clock: 0` 會少列後面的批次。
   */
  readonly briefsOpening?: true
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
   * 有這一格才有警戒（`battle/alert.ts`）：警戒前紅方戰鬥機在艦隊上空直線巡邏不接戰，
   * 紅方艦砲與藍方砲塔停火；藍方被發現就進入警戒，整場不解除。
   *
   * 沒有這一格的關卡一開場就是「已警戒」，行為不變。
   * 【要一路透傳】`MissionBattle` → `BattleConfig` → `createBattle`，漏一處就是警戒靜靜地不存在。
   */
  readonly alert?: MissionAlert
  /**
   * 藍方開場的高度範圍與左右間距（`battle/order.ts` 的 `spreadBlue`）。只動藍方，
   * 而且藍方必須全是單機小隊（轟炸機）。
   */
  readonly blueSpawn?: BlueSpawn
  /**
   * 這一關的地面目標。**沒有這一格的卡完全不產生**（與 `fleet` 同一個約定），
   * 透傳的路也相同 —— 漏一處就是進戰鬥零台，不報錯。
   */
  readonly ground?: readonly GroundEntry[]
  /**
   * 這一關的防空氣球。**沒有這一格的卡完全不產生**，透傳的路與 `fleet` 相同。
   * 不是任務目標：打破幾顆都不影響勝負。
   */
  readonly balloons?: readonly BalloonEntry[]
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
   * 事件啟動的地面縱隊。**展開成 `ground` 的條目**（排在 `ground` 與車隊之後），
   * 每一支配一個 `depart` 節拍。與 `vehicleConvoy` 不同：出發等觸發、走到終點停住
   */
  readonly columns?: readonly MissionGroundColumn[]
  /**
   * 打到一半把炸毀的目標換成另一種單位。必須配 `destroyCount`（第一段）——
   * `campaigns.test.ts` 守著
   */
  readonly retarget?: MissionRetarget
  /**
   * 第一段的目標炸夠數之後，剩下的由地面的己方戰車打掉（不必全部殲滅，隊友的坦克會打）。
   * 劇本打掉的不算進摧毀數
   */
  readonly mopUp?: MissionMopUp
  /**
   * 地面戰的戲：互射、彈著、砲兵塵土、長燒的煙。**純畫面，不進 `BattleConfig`**
   * （與 `timeOfDay` 同一條路，`main.ts` 直接從卡片讀）—— 混進戰鬥設定的話，逐位元
   * 重播的護欄會被純視覺的改動弄紅
   */
  readonly theater?: MissionTheater
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
   * 藍隊的轟炸機（攻擊隊）全滅就判敗，護航機還活著也一樣。**省略 = 藍隊全滅才敗。**
   * 只給炸毀關（`destroyCount`），第二段（`retarget`）沿用。
   */
  readonly defeatOnBombers?: true
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
  /**
   * 玩家的戰場邊界（`world/arena.ts`）。圓心與半徑要把開場雙方站位、目標點、地面目標
   * 與船全部圈進去、離界至少 1 km（`mission-arena.test.ts`）；半徑不小於
   * `ARENA_MIN_RADIUS`。重生的出生點不必在界內 —— 它們出生後朝戰場飛進來。
   *
   * 與時段同理，只在 `main.ts` 讀，不進 `BattleConfig`。
   */
  readonly arena: ArenaBounds
  /**
   * 這一關的雲（`world/cloudField.ts`）：雲底高度與雲量，鋪滿「`arena` 半徑 + 8 km」的圓。
   * 只是畫面，與時段同理不進 `BattleConfig`
   */
  readonly clouds: CloudField
}

/**
 * 這一關的艦隊。
 *
 * 【為什麼是一個中心＋一個艏向＋相對偏移】改艏向時若每一艘各存世界座標，
 * 全部都要重算，而重算的錯誤是「陣型悄悄歪掉」—— 沒有任何測試會紅。
 */
/** 卡片上的警戒設定。觸發門檻寫死在 `battle/alert.ts`，這裡只有這一關自己的東西 */
export interface MissionAlert {
  /** 進入警戒時的訊息（`src/i18n`） */
  readonly messageKey: MessageKey
  /** 巡邏線兩端離艦隊中心的左右距離，m */
  readonly patrolHalfWidth: number
  /** 巡邏高度，m（世界高度） */
  readonly patrolAltitude: number
  /** 長機離端點多近（水平距離）就折返，m */
  readonly patrolRadius: number
}

/** 藍方開場：高度在 `altitudeMin`…`altitudeMax` 之間依序平均排開，相鄰左右間距 `spacing`，m */
export interface BlueSpawn {
  readonly altitudeMin: number
  readonly altitudeMax: number
  readonly spacing: number
}

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
  /**
   * 照劇本在第幾秒被打掉，世界秒。**0 = 開場就是殘骸**（不爆、照樣冒煙）。
   * 劇本打掉的不算進摧毀數（`GroundTarget.scripted`）
   */
  readonly killAt?: number
  /** 開局藏著，到了出發時刻才出現。只有縱隊展開時填（`columnGround`） */
  readonly hidden?: true
}

/**
 * 縱隊走到路線終點前展開成寬楔形（`MissionGroundColumn.deploy`）。
 *
 * 【楔尖是路線的終點】第一輛停在終點；後面的輛交替往右、往左展開（右 1、左 1、右 2、左 2……），
 * 離楔尖越遠越往後退：每橫向 1 m 退 `wingBack` m。展開後每輛的車頭都朝 `facing`。
 *
 * 【各輛分頭開向自己的楔位】路線的前 `keep` 個點是共用的行進路線；其後每一輛從共用路線的最後一點
 * 直接開向自己楔位後方 `lead` m 的地方，再朝前開上楔位。`lead` 要長過轉彎所需的直線，否則最後的
 * 轉彎會吃掉那一段。停妥後的位置只由楔形決定，不受 `stagger` 影響。
 */
export interface ColumnDeploy {
  /** 展開後車頭朝哪裡，世界航向，rad（0 = 朝 −Z） */
  readonly facing: number
  /** 相鄰兩個楔位的橫向間距，m */
  readonly spacing: number
  /** 兩翼往後退的比例：每橫向 1 m 往後退幾 m */
  readonly wingBack: number
  /** 每輛楔位後方的直線進場段長度，m */
  readonly lead: number
  /** 路線前幾個點是共用的行進路線；路線最後一點是楔尖 */
  readonly keep: number
}

/**
 * 事件啟動的地面縱隊：沿路線排成一列，觸發成立才出發，走到終點**保持車距**停住
 * （或展開成楔形，見 `deploy`）。
 *
 * 【集結】第一輛停在路線起點往前 `(n − 1) × gap`，最後一輛在起點。路線的第一段
 * 要比整列長，開場的車頭才朝同一個方向。
 */
export interface MissionGroundColumn {
  readonly team: Team
  /** 路線，世界座標。與地上畫的路是同一份 */
  readonly route: readonly { readonly x: number; readonly z: number }[]
  /** 車速，m/s */
  readonly speed: number
  /** 轉角圓弧的半徑，m */
  readonly turnRadius: number
  /** 前後兩輛的車距，m。停住時也是這個距離（有 `deploy` 時停妥的位置由楔形決定） */
  readonly gap: number
  /**
   * 行進時前後車左右交錯的幅度，m：偶數輛（第 0 輛起）在路線左 `stagger`、奇數輛在右 `stagger`，
   * 各走自己那條平行線，前後車不在同一條直線上。省略或 0 = 全部走在路線上（一列）。
   */
  readonly stagger?: number
  /** 走到終點前展開成寬楔形。省略 = 沿路線停成一列 */
  readonly deploy?: ColumnDeploy
  /** 依行進順序，第一個是車頭 */
  readonly units: readonly GroundUnitId[]
  readonly depart: MissionTrigger
  /** 出發之前不在場上：不畫、不擋彈、不是目標、不算摧毀。省略 = 開場就在 */
  readonly hidden?: true
}

/** 打到一半換目標。見 `beats.ts` 的 `RetargetBeat` */
export interface MissionRetarget {
  readonly when: MissionTrigger
  /** 畫面中心的文字，同時取代 HUD 目標列 */
  readonly messageKey: MessageKey
  readonly destroyCount: number
  readonly destroyUnit: GroundUnitId
}

/**
 * 條件成立之後，這一種單位剩下還活著的，由地面戰的己方戰車在隨後幾秒內打掉。德 M4：炸掉七門砲
 * 就進下一段，剩下的幾門由前進的德軍坦克處理。見 `beats.ts` 的 `MopUpBeat`
 */
export interface MissionMopUp {
  readonly when: MissionTrigger
  readonly unit: GroundUnitId
  /** 每一個剩下的在條件成立後第幾秒被打掉，s；各自依索引雜湊散在這個範圍裡 */
  readonly within: readonly [number, number]
}

/** 地面戰的戲。見 `render/groundBattle.ts` */
export interface MissionTheater {
  /** 會開火的單位 */
  readonly shooters: readonly GroundUnitId[]
  /** 平均幾秒一發，s */
  readonly period: number
  /** 射程，m：範圍內最近的存活敵方才打 */
  readonly range: number
  /**
   * 砲兵彈著的有向矩形與平均間隔，s。**中心是世界座標；`across` 是矩形橫向的單位向量
   * （世界），`along` 是縱向的單位向量；半寬與半長沿這兩軸**。戰場跟著路轉
   * （`world/rzhev.ts`），軸對齊的外接矩形會讓彈著落到無人地帶之外
   */
  readonly artillery?: {
    readonly x: number; readonly z: number
    readonly across: { readonly x: number; readonly z: number }
    readonly along: { readonly x: number; readonly z: number }
    readonly halfAcross: number; readonly halfAlong: number
    readonly period: number
  }
  /** 整場不熄的煙柱，世界座標 */
  readonly smokes?: readonly { readonly x: number; readonly z: number }[]
  /** 戰場的高度霧（`render/heightFog.ts`）：圓心與半徑，世界座標，m。省略 = 沒有 */
  readonly haze?: { readonly x: number; readonly z: number; readonly radius: number }
  /**
   * 高度霧的底色（sRGB 十六進位），再混四成天色（`battleFogTint`）。**省略 = 灰黃的塵煙**。塵團的顏色
   * 跟著霧（霧色乘 0.85），只在有 `haze` 的戰場有意義。放在 `theater` 底下而不是 `haze` 裡：
   * `battle-haze-wiring.test.ts` 對 `haze` 做整個物件的比對
   */
  readonly fogColor?: number
  /**
   * 塵團的出處，世界座標：每一處附近持續冒出慢慢長大、往同一個方向飄散的塵團（`render/groundBattle.ts`）。
   * 顏色跟著高度霧（`haze`），所以只在有 `haze` 的戰場有意義。省略 = 沒有
   */
  readonly dusts?: readonly { readonly x: number; readonly z: number }[]
}

/**
 * 一顆防空氣球（`world/balloons.ts`）。
 *
 * 錨點兩種：**繫在船上**（`ship` 是這一關艦隊的第幾艘、`deck` 是那艘的艦體座標）
 * 或**地面絞車**（世界座標，高度落地時照地形取）。
 */
export interface BalloonEntry {
  readonly team: Team
  readonly anchor:
    | { readonly ship: number; readonly deck: Vector3 }
    | { readonly x: number; readonly z: number }
  /** 鋼索放出多長，m：吊索匯集點在錨點上方這麼高 */
  readonly tether: number
  /** 艇首朝向，rad（繞 Y，0 = 朝 −Z） */
  readonly heading: number
}

/** 車隊的一批：車距 `gap` 排成一列的幾輛 */
export interface MissionVehicleBatch {
  /** 依行進順序，第一個是車頭 */
  readonly units: readonly GroundUnitId[]
}

/**
 * 沿公路開往終點的車隊。**全部是紅方。**
 *
 * 【開場就全部在走】各批沿同一條路排開：最後一批的車尾在起點，前一批在它前面
 * `batchGap`，依此類推。車速相同，前後距離整場不變 —— 沒有停在原地等出發的車。
 */
export interface MissionVehicleConvoy {
  /** 路線，世界座標。**與地上畫的路是同一份**（日 M2 的 `LEYTE_ROAD`） */
  readonly route: readonly { readonly x: number; readonly z: number }[]
  /** 車速，m/s */
  readonly speed: number
  /** 轉角圓弧的半徑，m */
  readonly turnRadius: number
  /** 同一批裡前後兩輛的車距，m */
  readonly gap: number
  /** 前一批的車尾與後一批的車頭之間多遠，m */
  readonly batchGap: number
  /** 依行進順序，第一批走在最前面 */
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
   * 這一艘的艏向，rad，**相對整隊的 `heading`**。**省略 = 與整隊同向。**
   *
   * 只給不會動的船用（日 M2 搶灘的 LST 各自垂直於腳下那一段岸）。會動的
   * 艦隊一艘一個艏向，陣型走幾分鐘就散了。
   */
  readonly heading?: number
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
  /** 畫面中心的文字的鍵，同時取代 HUD 目標列上那一句 */
  readonly messageKey: MessageKey
  /**
   * 撤離點在我方機首方向多遠，m。與 `targetDistance` 同一套。**負值 = 在我方
   * 開局位置的後方**（撤離點在來時的方向，日 M2）
   */
  readonly distance: number
  readonly radius: number
  readonly seconds: number
}
