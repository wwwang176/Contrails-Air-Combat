import { Vector3 } from 'three'
import { DEFAULT_BATTLE, type BattleConfig } from './setup'
import type { GroundUnitId } from '../render/geometry/ground'
import { VETERAN } from '../ai/profile'
import { DEG } from '../core/math'
import { P51D } from '../specs/p51d'
import { BF109K4 } from '../specs/bf109k4'
import { F6F5 } from '../specs/f6f5'
import { F4F4 } from '../specs/f4f4'
import { B17G } from '../specs/b17g'
import { KI84 } from '../specs/ki84'
import { A6M5 } from '../specs/a6m5'
import { G4M } from '../specs/g4m'
import { ENTRY_PLANS, type EntryPlan, type EntryPlanId, type SideEntry } from './entry'
import { WAVE_LANE, convoyLine, lineAbreast, pincer, rotateEntry, stackedEntry } from './order'
import type { ShipClassId } from '../world/ships'
import { FLAK_SITES, PLANT_TARGETS } from '../world/leuna'
import {
  DUMPS, FLARE_DROPS, HEAVY_FLAK_SITES, LIGHT_FLAK_SITES, PARKED_ROWS, SEARCHLIGHT_SITES,
} from '../world/poltava'
import { HE111 } from '../specs/he111'
import { GROUND_FLAK_SPEC, type ShipGunSpec } from '../world/shipGuns'
import { SCHWARM_SIZE } from './flights'
import type {
  Beat, BeatCondition, FlarePoint, RecycleBeat, ReinforceBeat, WithdrawBeat,
} from './beats'
import type { MissionRules } from './mission'
import type { AircraftSpec } from '../specs/types'
import type { Team } from '../world/World'
import type { TerrainKind } from '../world/terrainKind'
import type { TimeOfDay } from '../world/timeOfDay'
import type { Loadout } from '../weapons/stores'

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
   * `flakHeavy` 在盟 M2、德 M2、日 M4 都出現，直接改那份通用規格會把另外兩關一起改掉。
   * 寫成 `{ ...GROUND_FLAK_SPEC, roundsPerMinute: 30 }` 就看得出改了哪一格。
   */
  readonly flakSpec?: ShipGunSpec
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
  /** 撤離點在我方機首方向多遠，m。與 `targetDistance` 同一套 */
  readonly distance: number
  readonly radius: number
  readonly seconds: number
}



/**
 * 護送與攔截的終點在多遠，m。
 *
 * 【為什麼護送與攔截共用】它們是同一個局面的兩側：一隊轟炸機要飛到一個點，
 * 另一隊要在那之前把它們打光。距離對兩邊同時成立。
 */
const CONVOY_DISTANCE = 12000

/**
 * 抵達半徑，m。**沿用撤離掃描出來的 1,000**。
 *
 * 【它同時是編隊寬度的上界】整隊只有一個判定圈，所以最外側那一架也必須
 * 落得進來。`order.ts` 的 `CONVOY_LANE` 就是照這個數字訂的。
 */
const CONVOY_RADIUS = 1000

/**
 * 被護送的那幾架在敵方目標挑選裡值幾倍。**起始值，試飛中。**
 *
 * 【為什麼一定要大於 1】不加偏置時護航機只要有兩架，轟炸機就**一發都挨不
 * 到**（實測血量 100/100/100/100）—— `targetScore` 只看威脅與幾何，而護航機
 * 兩者都更強：它會還手、而且擺得更高更近。
 *
 * 【為什麼一個數字管兩張卡】它掛在被護送的那幾架身上，只有敵人替它們評分。
 * 護送時是紅隊更想打我方轟炸機，攔截時是藍隊更想打敵方轟炸機 —— **同一個
 * 偏置，兩側同時動**，所以不能只照著一張卡調。
 */
const CONVOY_PRIORITY = 5

/**
 * 護送與攔截共用的幾何。差別只有目標列的文字與雙方飛什麼。
 *
 * 【對頭】護送要打穿出去，攔截則是迎向轟炸機流 —— 同一個擺法對兩邊都成立，
 * 因為它們本來就是同一個局面的兩側。
 *
 * 【無時限】兩組勝負條件裡都沒有時間 —— 護送敗北只有「全部被擊落」，
 * 攔截敗北只有「任一台抵達」。
 */
const CONVOY = {
  convoyCount: 4, convoyPriority: CONVOY_PRIORITY,
  targetDistance: CONVOY_DISTANCE, targetRadius: CONVOY_RADIUS,
  seconds: Infinity,
  entry: 'headOn',
} as const

/** 殲滅：沒有終點也沒有時限，贏的條件就是敵方歸零。 */
const KILL = {
  objective: '擊落全部敵機',
  convoySpec: null, convoyCount: 0, convoyPriority: 1,
  targetDistance: 0, targetRadius: 0, seconds: Infinity,
  entry: 'headOn',
} as const

/**
 * 倫內爾島的第 18 特遣艦隊 —— **史實編成的三分之二**。
 *
 * ## 史實
 *
 * 1943 年 1 月 29–30 日，Giffen 少將的 TF 18 接戰時是 **12 艘**：
 * 三艘重巡（Wichita、Chicago、Louisville）、三艘輕巡（Montpelier、
 * Cleveland、Columbia）排成兩列縱隊，六艘驅逐艦在前方張開半圓形警戒幕。
 * 兩艘護航航母（Chenango、Suwannee）跟不上 24 節，**開打前就被留在後面**
 * —— 那也是為什麼那一夜沒有空中掩護。
 *
 * 攻擊方是第 705 與 701 航空隊的一式陸攻，黃昏兩波約 31 架。Chicago 中兩枚
 * 魚雷，隔天被第二批雷擊擊沉。
 *
 * ## 為什麼放 8 艘而不是 12
 *
 * 巡洋與驅逐各四艘，維持史實的一比一。**只有兩個艦級模型**，12 艘會讓
 * 重複太明顯；8 艘已經讀得出是一支艦隊，而四艘散在 3 km 上遠看只是四個
 * 分開的點。
 *
 * ## 陣型
 *
 * 巡洋艦兩列縱隊（橫向相距 500 m、縱向 600 m），驅逐艦在前方張成警戒幕
 * （最外側 ±900 m，前方 900–1,100 m）。整隊橫跨 1.8 km、縱深 1.4 km。
 *
 * 美軍 1943–45 年的防空警戒序列：縱隊裡的主力艦彼此 450–900 m，護衛幕在
 * 距核心 1,400–2,700 m，**遭空襲時會刻意收緊到 1,400–1,800 m 讓火網重疊**
 * —— 收緊正是那個序列的目的。這個擺法落在那個區間的緊端。
 *
 * 航速 8 m/s ≈ 15.5 節，**起始值** —— 真艦的戰鬥航速更高，但這一關的重點
 * 是彈幕不是追擊，船跑太快會讓低空進場的相對幾何每次都不一樣，調不準。
 */
/**
 * 沖繩外海的第 58 特遣支隊 —— **史實編成的三分之一，而且只有三個艦級。**
 *
 * ## 史實
 *
 * 1945 年 4 月，Mitscher 中將的 TF 58 分成四個特遣支隊。單一支隊典型是
 * 艦隊航母 2–3、輕航母 1–2、快速戰艦 2–3、巡洋艦 3–5、驅逐艦 13–18，
 * 合計 22–28 艘。環形防空序列：航母在中心（彼此 2,300–2,750 m）、戰艦與
 * 巡洋艦內環、驅逐艦外環（半徑 3,600–5,500 m）。
 *
 * ## 為什麼航母只有一艘
 *
 * 專案只有三個艦級模型（Essex／Wichita／Fletcher），沒有戰艦、沒有輕航母。
 * 兩艘 Essex 並排會讓重複很明顯（同 `RENNELL_FLEET` 的「12 艘取 8 艘」），
 * 而且**「守兩艘」會讓失敗判定變模糊**。一艘航母＝一個要守的東西。
 *
 * 六艘驅逐艦不是佈景 —— 每一艘都有完整的三層防空（`world/shipAA.ts`），
 * 是玩家真正的火力支援。
 *
 * ## 為什麼中心在原點
 *
 * 雙方 `headOn` 進場都收斂到中點，所以艦隊放原點時**空戰自然發生在艦隊
 * 上空** —— 艦載防空因此真的參戰，而不是遠遠看著。
 *
 * 陣型尺度沿用 `RENNELL_FLEET`（整隊橫跨約 1.8 km）。**起始值，由試飛裁定。**
 */
const TF58_GROUP: MissionFleet = {
  center: new Vector3(0, 0, 0),
  heading: 0,
  speed: 8,
  ships: [
    // 【航母在中心，而且是唯一的要害艦】沉了就輸
    { cls: 'essex', team: 'blue', offset: new Vector3(0, 0, 0), vital: true },
    // 巡洋艦：內環，左右各一
    { cls: 'wichita', team: 'blue', offset: new Vector3(-500, 0, 200) },
    { cls: 'wichita', team: 'blue', offset: new Vector3(500, 0, 200) },
    // 驅逐艦：外環警戒幕。前方張得比後方開 —— 敵機從 −Z 來
    { cls: 'fletcher', team: 'blue', offset: new Vector3(-900, 0, -900) },
    { cls: 'fletcher', team: 'blue', offset: new Vector3(-300, 0, -1100) },
    { cls: 'fletcher', team: 'blue', offset: new Vector3(300, 0, -1100) },
    { cls: 'fletcher', team: 'blue', offset: new Vector3(900, 0, -900) },
    { cls: 'fletcher', team: 'blue', offset: new Vector3(-800, 0, 800) },
    { cls: 'fletcher', team: 'blue', offset: new Vector3(800, 0, 800) },
  ],
}

const RENNELL_FLEET: MissionFleet = {
  center: new Vector3(0, 0, 0),
  heading: 0,
  speed: 8,
  ships: [
    // 巡洋艦：兩列縱隊。−Z 是艦首方向，所以 z 小的是前導艦。
    { cls: 'wichita', team: 'red', offset: new Vector3(-250, 0, -300) },
    { cls: 'wichita', team: 'red', offset: new Vector3(-250, 0, 300) },
    { cls: 'wichita', team: 'red', offset: new Vector3(250, 0, -300) },
    { cls: 'wichita', team: 'red', offset: new Vector3(250, 0, 300) },
    // 驅逐艦：前方的半圓形警戒幕
    { cls: 'fletcher', team: 'red', offset: new Vector3(-900, 0, -900) },
    { cls: 'fletcher', team: 'red', offset: new Vector3(-300, 0, -1100) },
    { cls: 'fletcher', team: 'red', offset: new Vector3(300, 0, -1100) },
    { cls: 'fletcher', team: 'red', offset: new Vector3(900, 0, -900) },
  ],
}

/** 德 M4 撤退段的終點在多遠，m */
const RETREAT_DISTANCE = 12000

/**
 * 三條戰役各四關。
 *
 * ── 為什麼還有四張是 `battle: null` ──────────────────────
 *
 * 它們要的地面目標（工廠、車站、火車、登陸艇）與陸上 Flak 的邏輯還沒有。
 * **編制與機種現在不填** —— 填進一張還打不起來的卡，只會變成一組沒有人
 * 驗證過、卻看起來已經定案的數字。那幾關要用什麼寫在 `docs/roadmap.md`
 * 的對照表裡。
 *
 * ── 八張可玩的來歷 ──────────────────────────────────────
 *
 * ```
 *   盟 M1 / 德 M1   唯二有實測基礎的（掃描定值），由
 *                   `mission-config-baseline.test.ts` 逐項釘住
 *   日 M1 / 日 M3   編制照掃描過的那兩種形狀（8v6 殲滅、護送）
 *   德 M4           返航節拍的第一個使用者
 *   盟 M4 / 日 M4   艦隊：守住與擊沉
 *   盟 M2           地面目標：炸毀（`world/leuna.ts` 的廠區）
 * ```
 */
/**
 * 洛伊納的廠區與預定砲位，世界座標。佈局在 `world/leuna.ts`，這裡只把相對
 * 偏移換成絕對座標。砲位是不還手的靶（`groundTargets.ts` 檔頭）。
 */
const LEUNA_GROUND: readonly GroundEntry[] = [
  ...PLANT_TARGETS.map((p): GroundEntry => ({
    unit: p.kind, team: 'red', x: p.x, z: p.z, heading: p.heading,
  })),
  ...FLAK_SITES.map((s): GroundEntry => ({
    unit: 'flakHeavy', team: 'red', x: s.x, z: s.z, heading: s.heading,
  })),
]

/**
 * 波爾塔瓦機場：24 架停放的 B-17、油桶堆兩塊、彈藥堆一塊、輕砲 16、重砲 6、
 * 探照燈 6。全部是紅方的地面目標，全部算進炸毀的池。佈局在 `world/poltava.ts`。
 */
const POLTAVA_GROUND: readonly GroundEntry[] = [
  ...PARKED_ROWS.map((p): GroundEntry => ({
    unit: 'parkedB17', team: 'red', x: p.x, z: p.z, heading: p.heading,
  })),
  ...DUMPS.map((d): GroundEntry => ({
    unit: d.kind, team: 'red', x: d.x, z: d.z, heading: d.heading,
  })),
  ...LIGHT_FLAK_SITES.map((s): GroundEntry => ({
    unit: 'flakLight', team: 'red', x: s.x, z: s.z, heading: s.heading,
  })),
  ...HEAVY_FLAK_SITES.map((s): GroundEntry => ({
    unit: 'flakHeavy', team: 'red', x: s.x, z: s.z, heading: s.heading,
  })),
  ...SEARCHLIGHT_SITES.map((s): GroundEntry => ({
    unit: 'searchlight', team: 'red', x: s.x, z: s.z, heading: s.heading,
  })),
]

export const MISSIONS: Record<Campaign, readonly MissionCard[]> = {
  allies: [
    {
      id: 'allies-m1', title: '護送堡壘', type: '護航',
      summary: '護送第八航空軍的 B-17 深入德國本土，轟炸施韋因富特的滾珠軸承廠。',
      place: '德國　施韋因富特上空', period: '1944 年夏',
      battle: {
        ...CONVOY, objective: '護送轟炸機抵達投彈點', banner: '護送 B-17 飛到投彈點',
        blueSpec: P51D, redSpec: BF109K4, convoySpec: B17G,
        blueCount: 4, redCount: 10,
        terrain: 'archipelago',
      },
    },
    {
      id: 'allies-m2', title: '梅澤堡的油廠', type: '打擊',
      summary: '駕駛第八航空軍的 B-17G 轟炸洛伊納合成油廠，穿過德國空軍那年秋天最大的一次攔截。',
      // 【與德 M1 是同一場的兩個座位】空域字串要不同 —— 簡報的護欄要求
      // 十二關各不相同；這一關的視角在廠區上空，德 M1 在梅澤堡外圍攔截
      place: '德國中部　洛伊納油廠上空', period: '1944 年 11 月',
      battle: {
        objective: '炸毀洛伊納油廠', banner: '轟炸洛伊納油廠',
        blueSpec: B17G, redSpec: BF109K4, convoySpec: null,
        /**
         * 【十二架分三個小隊擺開】玩家在中間那一隊當長機，前後各一隊
         * （`order.ts` 的 `stackedEntry`：前後 500 m、左右錯半個身位、高度分層）。
         * **只是開場站位，不編隊** —— 十一架 AI 照自己的攻擊航路投
         * （`ai/strikeRun.ts`）。
         *
         * 【為什麼不是四架】史實這一場第八航空軍出動六百多架；四架在畫面上
         * 是一支巡邏隊，不是一次轟炸。**起始值，由試飛裁定。**
         *
         * 開場四架 Bf 109 由 `headOn` 放在正前方，接近約 40 秒 —— 1944 年
         * 標準的十二點鐘正面攻擊
         */
        blueCount: 12, redCount: 4,
        blueStacked: true,
        convoyCount: 0, convoyPriority: 1,
        targetDistance: 0, targetRadius: 0, seconds: Infinity,
        entry: 'headOn',
        terrain: 'leuna',
        // 十一月的正午：太陽低、天色灰（`render/timeOfDay.ts`）
        timeOfDay: 'novemberNoon',
        /**
         * 【1,500 m 而不是預設的 4,000】史實的投彈高度在 7,000 m 以上，但
         * 那個高度上廠區只剩一片灰色的紋理，而投下的彈要飛四十秒才落地。
         * **起始值，由試飛裁定。**
         */
        altitude: 1500,
        ground: LEUNA_GROUND,
        /**
         * 【這一關的高砲射速是通用值的兩倍】洛伊納是德國本土最密的火網之一，
         * 而 `GROUND_FLAK_SPEC` 的 15 發/分是路邊一座砲位的值。
         *
         * 30 發/分超出 88 的持續射速（史實約 20），與 5 吋砲初速訂 450（真砲
         * 790）同一個性質：那一層的存在條件是手感。**起始值，由試飛裁定。**
         */
        flakSpec: { ...GROUND_FLAK_SPEC, roundsPerMinute: 30 },
        // 【炸毀任意六座】計數的池是廠區十二座構件與四十八座砲位 —— 全部都是
        // 敵方的地面目標。**起始值**
        destroyCount: 6,
        waves: [{
          when: { kind: 'clock', at: 90 },
          warn: '警告：敵機從後方接近',
          warnLead: 5,
          side: 'theirs', spec: BF109K4, count: 4,
          // 【從後方】對應突擊大隊從尾部衝進轟炸箱。省略的話沿用紅方的正面
          // 進場，會生在前方反向飛來
          starboard: Math.PI,
        }],
      },
    },
    {
      id: 'allies-m4', title: '沖繩外海', type: '殲滅',
      summary: '駕駛 F6F-5 守住沖繩外海的第 58 特遣艦隊，攔下零戰與低空進場的一式陸攻。',
      place: '沖繩外海　慶良間列島以西', period: '1945 年 4 月',
      battle: {
        ...KILL,
        objective: '守住艦隊', banner: '敵機來襲，守住航母',
        blueSpec: F6F5, redSpec: A6M5,
        /**
         * 【開場十六架分兩路，被殲滅的小隊整隊重生】掛彈的零戰走的是掃射航路
         * （`ai/bombRun.ts` 的落彈點瞄準）：機首指著艦隊一路壓下去、投彈、
         * 再拉起。那條航路把自己送進近迫火網。
         *
         * 【十六架是門檻，不是喜好】投彈點在離目標約 600 m 的斜距上，而它們
         * 在 900 m 附近就開始掉。實測開場八架時**一枚都投不出來**：每一架都
         * 死在 900 到 600 那一段。十六架同時到，防空火力分不完，才有幾架
         * 突得進去（十枚）。
         *
         * 分兩路的用意也是分散火力：艦隊的防空要同時顧兩個方位，四架 F6F
         * 也只攔得住其中一路。重生讓畫面上一直有東西在進場，而席位維持
         * 16 + 4 —— 同時在場的架數不比開場多。
         */
        blueCount: 4, redCount: 16,
        redStarboard: 45 * DEG,
        terrain: 'sea',
        fleet: TF58_GROUP,
        /**
         * 【2,000 m 而不是預設的 4,000】G4M 進場之後要降到
         * `ai/torpedoRun.ts` 的 `RUN_ALTITUDE`（150 m）才投得出雷，從
         * 4,000 m 掉下來那一段是空白時間。**起始值，由試飛裁定。**
         */
        altitude: 2000,
        /**
         * 【哪一支小隊被殲滅，那一支就整隊重生】掛彈的零戰是被**防空砲**打掉
         * 的，不是被 F6F 攔掉的：一架活到離航母 936 m、剛切進落彈點瞄準，
         * 零點三秒後陣亡。四支小隊各自在防空網前面死光、各自重生，場上於是
         * 一直有零戰在進場，而同時在場的不超過十六架。
         *
         * 【六批】開場 16 加重生 24，共 40 架次零戰。
         *
         * 【`warnLead` 那幾秒不會被判成勝利】`MissionInputs.redInbound`
         * 擋著（`defend` 的勝利條件讀它），等重生的小隊也算在路上。少了那
         * 一格，紅方在預警期間歸零會先判勝、下一批永遠不來。
         *
         * 全部的數字都是**起始值，由試飛裁定**。
         */
        recycle: {
          side: 'theirs', role: 'fighter', batches: 6,
          // 【不宣稱方位】重生的橫向槽位把它推到開場那兩路之外，實際方位
          // 因此不等於這裡設的 45°。寫「發生了什麼」，不要寫「在哪裡」
          //
          // 【寫成無線電通報，不寫批數】玩家不知道也不該知道自己在打第幾批
          // —— 那是設定檔的內部結構。1945 年的第 58 特遣艦隊有戰鬥機管制台，
          // 雷達通報就是這一則訊息的來源
          warn: '雷達發現更多零戰',
          warnLead: 5,
          starboard: 45 * DEG,
        },
        /**
         * 【陸攻跟著第五批重生進場】它與零戰的節奏綁在一起：玩家打得越快，
         * 雷擊來得越早。批數只增不減，所以不必兜底。
         */
        waves: [
          {
            when: { kind: 'batch', at: 5 },
            warn: '低空發現雷擊機',
            warnLead: 6,
            side: 'theirs', spec: G4M, count: 4,
            /**
             * 【1,000 而不是任務高度的 2,000】投雷高度是 150 m，而進場點到
             * 艦隊只有 5.5 km —— 以 130 m/s 飛只有四十二秒。從 2,000 掉下來
             * 的話飛到航母正上方時還在 250 m，姿態進不了投放包絡就不准鎖
             * 航向，整個第一趟帶著雷飛過去，繞回來才投得出，而那時水中航程
             * 只剩一百多公尺 —— 雷幾乎是貼著船身入水的。
             *
             * **起始值，由試飛裁定。**
             */
            altitude: 1000,
          },
        ],
      },
    },
  ],
  germany: [
    {
      id: 'germany-m1', title: '梅澤堡上空', type: '攔截',
      summary: '駕駛 Bf 109 K-4 撕開 P-51 的護航網，攔下飛往梅澤堡洛伊納油廠的 B-17G。',
      place: '德國中部　梅澤堡—洛伊納', period: '1944 年 11 月',
      battle: {
        ...CONVOY, objective: '在轟炸機抵達前擊落', banner: '攔下 B-17，守住油廠',
        blueSpec: BF109K4, redSpec: P51D, convoySpec: B17G,
        blueCount: 10, redCount: 4,
        terrain: 'archipelago',
        // 【用時鐘不用存活數】這一關的 `convoyPriority` 是 5，我方一心衝
        // 轟炸機 —— 實測一整場 145 s 護航機一架都沒掉，而勝負 145.5 s 就
        // 定了。「敵方戰鬥機剩不多」那個條件的節奏在這裡不可靠
        waves: [{
          when: { kind: 'clock', at: 60 },
          warn: '警告：敵方護航機接近中',
          warnLead: 4,
          side: 'theirs', spec: P51D, count: 4,
        }],
      },
    },
    {
      id: 'germany-m2', title: '波爾塔瓦之夜', type: '打擊',
      summary: '駕駛 KG 55 的 He 111 夜襲波爾塔瓦機場，炸掉穿梭轟炸落地的 B-17。',
      place: '烏克蘭　波爾塔瓦機場上空', period: '1944 年 6 月',
      battle: {
        objective: '炸毀停放的 B-17', banner: '夜襲機場，炸毀 B-17',
        blueSpec: HE111, redSpec: P51D, convoySpec: null,
        // 【沒有敵機】史實上蘇軍夜戰機沒有攔到任何一架；壓力全在地面的防空。
        // `redSpec` 只是型別要填：野馬就在皮里亞廷，沒起飛
        blueCount: 8, redCount: 0,
        blueStacked: true,
        convoyCount: 0, convoyPriority: 1,
        targetDistance: 0, targetRadius: 0, seconds: Infinity,
        entry: 'headOn',
        terrain: 'poltava',
        timeOfDay: 'night',
        /**
         * 【1,500 m】輕型砲射程 2,640 m 打得到、重砲也打得到；爬到 3,000 以上
         * 輕砲搆不著但瞄準變難 —— 那是這一關的取捨。**起始值，由試玩裁定。**
         */
        altitude: 1500,
        ground: POLTAVA_GROUND,
        // 【炸毀任意十二座】池是 24 架 B-17、3 堆、22 座砲位、6 座探照燈。
        // 8 架 × 8 枚 = 64 枚。**起始值**
        destroyCount: 12,
        // 蘇軍的 85 mm：射速比 88 慢
        flakSpec: { ...GROUND_FLAK_SPEC, roundsPerMinute: 12 },
        /**
         * 【80 秒】He 111 約 85 m/s 從 12 km 外進場，80 秒時離機場約 5 km；
         * 照明彈燒到 380 秒，整個投彈段都亮著。各枚的高度與時間差在
         * `FLARE_DROPS`，都在投彈高度之下 —— 光在飛機下面，照的是地。
         * **起始值，由試玩裁定。**
         */
        flares: { when: { kind: 'clock', at: 80 }, points: FLARE_DROPS },
      },
    },
    {
      id: 'germany-m4', title: '帝國最後防線', type: '殲滅',
      summary: '駕駛 Bf 109 K-4 從巴伐利亞的野戰機場升空，迎擊掃蕩德國本土的第八航空軍 P-51D。',
      place: '德國南部　巴伐利亞上空', period: '1945 年春',
      battle: {
        objective: '擊落全部敵機', banner: '野馬掃蕩本土，升空迎擊',
        blueSpec: BF109K4, redSpec: P51D, convoySpec: null,
        blueCount: 8, redCount: 10,
        convoyCount: 0, convoyPriority: 1,
        targetDistance: 0, targetRadius: 0, seconds: Infinity,
        entry: 'headOn',
        terrain: 'farmland',
        // 【拂曉】野戰機場的攔截隊天亮就升空 —— 停在地面上等於被掃射
        timeOfDay: 'dawn',
        /**
         * 【`byLatest` 必須早於「打得完敵軍」的那一刻】開場規則是
         * `annihilate`，紅隊歸零就**直接判勝**，之後返航節拍再也沒有機會
         * 接管規則 —— 那一關設計好的下半場就整段跳過了。
         *
         * 【40 秒是怎麼來的】它要滿足兩件事：
         *
         * ```
         *   早於第二批進場（49 s）  →  第二批因此變成「擋在逃生路上」，
         *                              而不是「還在纏鬥時多來四架」
         *   早到打不完 14 架        →  開場 10 架＋第一批 4 架。離線探針裡
         *                              AI 400 秒才掉 2 架；人快得多，但
         *                              40 秒清 14 架不是一個能穩定做到的事
         * ```
         *
         * 【`atMost: 4` 仍然有用】玩家撐不住時它會**更早**觸發，那才是這一關
         * 的敘述：友軍逐漸減少 → 任務更新。兩個是「誰先到算誰」。
         *
         * ⚑ 兩個數字都是起始值，待試飛。
         */
        withdraw: {
          when: { kind: 'alive', side: 'mine', atMost: 4, byLatest: 40 },
          message: '返航',
          distance: RETREAT_DISTANCE, radius: CONVOY_RADIUS,
          /**
           * **無時限** —— 撤離不倒數。
           *
           * 【為什麼倒數是多的】這一關的壓力來源是**擋在路上的兩批攔截機**，
           * 不是碼表。再壓一個倒數上去，玩家要同時應付「打穿出去」與「來不
           * 來得及」兩件事，而後者他無從估計 —— 他不知道還有幾批。
           *
           * 【`Infinity` 不是特例】`stepMission` 的撤離分支本來就走得到它：
           * `Infinity − dt` 仍是 `Infinity`、`Infinity <= 0` 是 false，
           * HUD 的 `formatCountdown` 對非有限值回空字串。
           */
          seconds: Infinity,
        },
        /**
         * 【敵人從斜前方分批來，不是在後面追】撤離點在 −Z，紅方的進場點
         * 也在 −Z —— 波次生在玩家**前方**，玩家必須打穿出去。從後面追的
         * 擺法會遇到「追不到」，這一種沒有人在追。
         *
         * 【第二批要往前挪】玩家從 z≈0 跑到紅方開局點只要 28 秒。第二批不
         * 覆寫縱深的話會生在他背後 —— 見 `MissionWave.along`。
         */
        waves: [
          {
            when: { kind: 'clock', at: 0 },
            // 【這一則說得出方位】它在開場那一刻顯示，那時玩家一定還朝著
            // 機首方向 —— 而波次就生在那裡
            warn: '前方有攔截機',
            warnLead: 4,
            side: 'theirs', spec: P51D, count: 4,
          },
          {
            when: { kind: 'clock', at: 45 },
            warn: '警告：敵方援軍加入戰鬥',
            warnLead: 4,
            side: 'theirs', spec: P51D, count: 4, along: -1.0,
          },
        ],
      },
    },
  ],
  japan: [
    {
      id: 'japan-m1', title: '臺灣沖航空戰', type: '殲滅',
      summary: '駕駛 A6M5 從新竹起飛，迎戰空襲臺灣的第 38 特遣艦隊艦載機。',
      place: '臺灣　新竹外海', period: '1944 年 10 月',
      battle: {
        ...KILL,
        banner: '艦載機空襲，擊落全部敵機',
        blueSpec: A6M5, redSpec: F6F5,
        blueCount: 8, redCount: 6,
        terrain: 'archipelago',
        // 【清晨】1944 年 10 月 12 日第 38 特遣艦隊的首波在天亮時到新竹上空
        timeOfDay: 'dawn',
      },
    },
    {
      id: 'japan-m3', title: '雷伊泰的投雷點', type: '護航',
      summary: '駕駛 Ki-84 參加捷一號作戰，護送一式陸攻穿過 F6F 的攔截抵達投雷點。',
      place: '菲律賓　雷伊泰灣', period: '1944 年 10 月',
      battle: {
        ...CONVOY, objective: '護送轟炸機抵達投雷點', banner: '護送陸攻飛到投雷點',
        blueSpec: KI84, redSpec: F6F5, convoySpec: G4M,
        blueCount: 4, redCount: 10,
        terrain: 'sea',
      },
    },
    {
      id: 'japan-m4', title: '倫內爾島', type: '打擊',
      summary: '駕駛第 705 海軍航空隊的一式陸攻，在黃昏低空雷擊倫內爾島外的第 18 特遣艦隊。',
      place: '所羅門　倫內爾島外海', period: '1943 年 1 月',
      battle: {
        ...KILL,
        objective: '擊沉任意四艘敵艦', banner: '低空雷擊，擊沉四艘敵艦',
        // 【F4F-4 不是 F6F-5】1943 年 1 月的攔截者是企業號 VF-10 的野貓；
        // 地獄貓 1943 年 8 月才首戰，晚了七個月。
        blueSpec: G4M, redSpec: F4F4,
        // 【11 對 8 是史實的量級】倫內爾島 29 日黃昏兩波共約 31 架一式陸攻，
        // 30 日再來 11 架、被 VF-10 的野貓打下 8 架。取 30 日那一波的架數，
        // 但**保留 29 日的黃昏**（卡片文案就是那一波）。
        blueCount: 11, redCount: 8,
        terrain: 'sea',
        fleet: RENNELL_FLEET,
        // 【低空】卡片寫的是「低空雷擊」。用預設的 4,000 m 的話，開場時
        // 艦隊在 6.3 km 外、3.85 km 正下方 —— 不低頭看不到船。**起始值。**
        altitude: 1000,
        // 【擊沉任意四艘】八艘裡挑四艘，玩家自己決定打哪幾艘 —— 那本來
        // 就是雷擊機該做的決定。
        sinkCount: 4,
        // 【沒有 `blueLoadout`】掛魚雷，照 G4M 的預設。卡片文案是「低空
        // 雷擊」，而 AI 的雷擊剖面在 `ai/torpedoRun.ts`
        // 【卡片文案就寫黃昏】「在黃昏低空雷擊」
        timeOfDay: 'dusk',
      },
    },
  ],
}

/**
 * 撤離點的座標。**返航節拍與撤離卡共用這一條。**
 *
 * 【為什麼是固定的世界座標而不是「從玩家位置往前 distance」】藍隊開局在
 * z ≈ +5,000，所以 `distance = 12,000` 實際要飛約 17 km。那是刻意的：終點
 * 是關卡設計的一部分，不該隨玩家開場飄。
 *
 * 【高度取戰場高度，不是玩家那一架的】單一分隊的高度層會偏 ±300 m
 * （`altitudeOffset`），而判定半徑是 1,000 m —— 差得進去。
 */
function evacuatePoint(altitude: number, distance: number): Vector3 {
  return new Vector3(0, altitude, -distance)
}

/**
 * 卡片 → 勝負條件。
 *
 * 【為什麼撤離點的高度是參數而不是常數】高度設定改了，撤離點要自動跟上。
 * 寫死 4000 的話兩者會在某次調整之後靜靜地差開 —— 而症狀是「圓環浮在
 * 戰場上方，飛過去卻沒判到」。
 *
 * 【為什麼判準是 `type` 而不是 `targetDistance > 0`】後者把「這是撤離任務」
 * 這件事編碼進一個數字的正負，而那個數字的意思是距離。
 */
export function missionRules(
  card: ReadyMissionCard, altitude: number, lateralOffset: number,
): MissionRules {
  const b = card.battle
  // 【擊沉排在最前面】判準是卡片上有沒有 `sinkCount`，不是 `type` ——
  // `type` 是給玩家看的分類（打擊／殲滅／護航…），一張打擊卡可能是炸機場、
  // 也可能是雷擊。用 type 推導的話，日後多一張「打擊」卡就會靜靜地變成
  // 擊沉任務。
  if (b.sinkCount !== undefined) {
    return { kind: 'sink', count: b.sinkCount }
  }
  // 【炸毀與擊沉並列】同樣是「卡片上有沒有那一格」，同樣排在守住艦隊之前
  if (b.destroyCount !== undefined) {
    return { kind: 'destroy', count: b.destroyCount }
  }
  // 【判準是「艦隊裡有沒有要害艦」，不是 `type`】理由同上面那一段：`type`
  // 是給玩家看的分類，用它推導的話日後多一張「殲滅」卡就會靜靜地變成
  // 守住艦隊。**排在擊沉之後** —— 進攻的規則優先，而日 M4 的艦隊一艘
  // `vital` 都沒有，所以順序不影響它
  if (b.fleet?.ships.some((s) => s.vital === true) === true) {
    return { kind: 'defend' }
  }
  if (card.type === '撤離') {
    return {
      kind: 'evacuate',
      point: evacuatePoint(altitude, b.targetDistance),
      radius: b.targetRadius,
      seconds: b.seconds,
    }
  }
  if (card.type === '護航' || card.type === '攔截') {
    // 【護航是我方的轟炸機、攔截是敵方的】這一行就是兩張卡的**全部**差別，
    // 判定那一側是同一條規則（見 `mission.ts` 的 convoy）
    const owner: Team = card.type === '護航' ? 'blue' : 'red'
    // 【方向跟著那一隊的機首】藍隊開局朝 −Z、紅隊朝 +Z。所以護送的終點在
    // 敵人後方（要打穿出去，理由同撤離），而攔截的終點在**我方**後方 ——
    // 那正是「別讓它飛過去」的意思
    const z = owner === 'blue' ? -b.targetDistance : b.targetDistance
    // 【圈要放在那一隊自己的航道上，不是 x = 0】兩隊對頭時各自橫向偏
    // `across × lateralOffset`（起始值 ∓750 m）—— 那是為了不對撞。判定圈釘在
    // 0 的話，最外側那一架到圈心是 750 + 300 = 1,050 m，**永遠判不到**，而
    // 症狀是「轟炸機從圈旁邊飛過去，任務永遠不結束」（`test/tools/
    // convoy.probe.ts` 表三）。
    const x = ENTRY_PLANS[b.entry][owner].across * lateralOffset
    return { kind: 'convoy', owner, point: new Vector3(x, altitude, z), radius: b.targetRadius }
  }
  return { kind: 'annihilate' }
}

/**
 * 卡片 → 戰鬥設定。與 `skirmish.ts` 的 `battleConfigFrom` 對稱 ——
 * **兩者都是「設定 → `BattleConfig`」的唯一入口**，難度也在這裡套
 * （理由見 `setup.ts` 的 `aiProfile` 註解）。
 *
 * 【玩家恆在藍隊】換的是機種不是隊伍顏色（M9 spec §14、M10 spec §7.1）。
 *
 * 【不再吃陣營】雙方飛什麼由卡片自己說。三條戰役之後「另外一個陣營」不存在
 * ——盟軍線的「沖繩外海」敵人是日本魚雷機。
 *
 * 【為什麼架數不夾制】`battleConfigFrom` 要夾是因為那些數字從 DOM 讀進來；
 * 這裡的來源是本檔的常數表，夾制只會把一個寫錯的關卡藏起來。
 *
 * 【但「寫錯就會炸」只對一半】`blueCount` 為 0 時 `createBattle` 確實會拋
 * 「玩家沒有被建立」；**大於 `MAX_SIDE` 不會拋**，只會建一個超出特效池容量
 * 假設的超大戰場。所以那道保險由
 * `test/unit/campaigns.test.ts` 補上。
 */
export function missionConfigFrom(card: ReadyMissionCard): BattleConfig {
  const b = card.battle
  // 【高度只讀一次，兩邊共用】`missionRules` 拿它算撤離點與集合點的高度。
  // 一邊讀卡片、一邊讀預設的話，圓環會浮在編隊上方幾千公尺而不報錯。
  const altitude = b.altitude ?? DEFAULT_BATTLE.altitude
  const rules = missionRules(card, altitude, DEFAULT_BATTLE.lateralOffset)
  // 【擺法是生成器的第一個參數】`entry` 仍然是 `ENTRY_PLANS` 的鍵，那張表
  // 一個字不動
  const plan = ENTRY_PLANS[b.entry]
  const units = rules.kind === 'convoy'
    ? convoyLine(plan, {
      fighter: b.blueSpec,
      fighters: b.blueCount,
      bomber: rules.owner === 'blue' ? convoyOf(card) : null,
      bombers: b.convoyCount,
    }, {
      fighter: b.redSpec,
      fighters: b.redCount,
      bomber: rules.owner === 'red' ? convoyOf(card) : null,
      bombers: b.convoyCount,
    })
    : b.blueStacked === true
      ? stackedEntry(plan, b.blueSpec, b.blueCount, b.redSpec, b.redCount)
      : b.redStarboard === undefined
        ? lineAbreast(plan, b.blueSpec, b.blueCount, b.redSpec, b.redCount)
        : pincer(
          plan, b.blueSpec, b.blueCount, b.redSpec, b.redCount, b.redStarboard,
          DEFAULT_BATTLE.entryRange, DEFAULT_BATTLE.lateralOffset,
        )
  const beats = cardBeats(card, plan, altitude)
  return {
    ...DEFAULT_BATTLE,
    units,
    altitude,
    aiProfile: VETERAN,
    rules,
    // 【只有護送／攔截會偏離中性值】其餘卡片的 `convoyPriority` 是 1，
    // 那時這一份與 `NEUTRAL_TUNING` 的行為逐字相同
    tuning: { convoyPriority: b.convoyPriority },
    ...(beats === undefined ? {} : { beats }),
    ...(b.fleet === undefined ? {} : { fleet: b.fleet }),
    ...(b.ground === undefined ? {} : { ground: b.ground }),
    ...(b.flakSpec === undefined ? {} : { flakSpec: b.flakSpec }),
    // 【明列，因為這一支不透傳】漏抄的症狀是複寫靜靜失效、玩家掛著預設的
    // 東西起飛，而且不報錯。護欄在 `missions.test.ts`
    ...(b.blueLoadout === undefined ? {} : { blueLoadout: b.blueLoadout }),
  }
}

/**
 * 被護送／被攔截的機種。**護送與攔截一定要有，否則那一關贏不了。**
 *
 * 【為什麼拋錯而不是落回一台】少填的症狀是那一隊沒有轟炸機，而勝負條件
 * 是「轟炸機抵達／全滅」—— 一場永遠不會結束的仗，畫面上一切正常。
 */
function convoyOf(card: ReadyMissionCard): AircraftSpec {
  const s = card.battle.convoySpec
  if (s === null) throw new Error(`${card.id} 是${card.type}，但沒有指定被護送的機種`)
  return s
}

/**
 * 卡片上的波次與返航 → 節拍。**沒有任何一種就回 undefined。**
 *
 * 【為什麼返航排在波次後面】`createBattle` 的 `reserve` 是照 `beats` 裡
 * reinforce 的順序推的，而 `stepBeats` 依陣列順序判斷。返航不佔預留的位子，
 * 所以排哪裡都不影響行為 —— 寫死在最後只是為了讀起來一致。
 */
function cardBeats(
  card: ReadyMissionCard, plan: EntryPlan, altitude: number,
): readonly Beat[] | undefined {
  const b = card.battle
  const out: Beat[] = []
  // 【重生排在波次前面】掛在 `batch` 條件上的波次讀的是同一步剛加上的批數，
  // 排在後面會晚一個物理步預警，而兩則預警本該同一刻
  if (b.recycle !== undefined) out.push(recycleBeat(b.recycle, plan))
  b.waves?.forEach((w, i) => out.push(waveBeat(w, i, plan, altitude)))
  if (b.flares !== undefined) {
    out.push({ kind: 'flare', when: triggerToCondition(b.flares.when), points: b.flares.points })
  }
  if (b.withdraw !== undefined) out.push(withdrawBeat(b.withdraw))
  return out.length === 0 ? undefined : out
}

/** 一個返航 → 一個 `WithdrawBeat`。撤離點與 `missionRules` 走同一條路 */
function withdrawBeat(w: MissionWithdraw): WithdrawBeat {
  return {
    kind: 'withdraw',
    when: triggerToCondition(w.when),
    message: w.message,
    point: evacuatePoint(DEFAULT_BATTLE.altitude, w.distance),
    radius: w.radius,
    seconds: w.seconds,
  }
}

/**
 * 一個波次 → 一個增援節拍。
 *
 * 【橫向槽位逐波次 +1，而且從 `WAVE_LANE` 起跳】出生點是
 * `lane × schwarmSpacing + across × lateralOffset`（`unitFrame`），而高度那一軸
 * 的鋸齒**週期只有 5**（`altitudeOffset`）—— 光靠 `tier` 的話第 1 與第 6 個
 * 波次會生在完全相同的一點上。橫向槽位每支差 1，任何兩支就至少差一個
 * `schwarmSpacing`。
 */
function waveBeat(
  w: MissionWave, index: number, plan: EntryPlan, altitude: number,
): ReinforceBeat {
  if (!Number.isInteger(w.count) || w.count < 1 || w.count > SCHWARM_SIZE) {
    throw new Error(`波次的架數要是 1…${SCHWARM_SIZE} 的整數，收到 ${w.count}`)
  }
  const ours = w.side === 'mine'
  const turned = turnedEntry(plan, w.side, w.starboard)
  // 【卡片寫絕對高度，`SideEntry` 存的是相對任務高度的加成】換算只有這一處
  const base = w.altitude === undefined
    ? turned
    : { ...turned, climb: w.altitude - altitude }
  return {
    kind: 'reinforce',
    when: triggerToCondition(w.when),
    warn: w.warn,
    warnLead: w.warnLead,
    flight: {
      team: ours ? 'blue' : 'red',
      members: Array.from({ length: w.count }, () => w.spec),
      // 【只覆寫縱深】橫向、高度、朝向與速度沿用那一邊的擺法 ——
      // 它們仍然是那一隊的飛機，只是在路的另一段等你
      entry: w.along === undefined ? base : { ...base, along: w.along },
      duty: 'combat',
      lane: WAVE_LANE + index,
      tier: index,
    },
  }
}

/**
 * 那一邊開局的擺法，依卡片指定的方位轉過去。
 *
 * 【方位先轉，高度與縱深後套】旋轉是繞原點的幾何，改的是 across／along／
 * heading；呼叫端另外覆寫的那兩格是獨立的，順序因此不影響結果。
 */
function turnedEntry(plan: EntryPlan, side: MissionSide, starboard?: number): SideEntry {
  const base = side === 'mine' ? plan.blue : plan.red
  if (starboard === undefined) return base
  return rotateEntry(
    base, starboard, DEFAULT_BATTLE.entryRange, DEFAULT_BATTLE.lateralOffset,
  )
}

/** 卡片的重生 → 重生節拍 */
function recycleBeat(r: MissionRecycle, plan: EntryPlan): RecycleBeat {
  if (!Number.isInteger(r.batches) || r.batches < 1) {
    throw new Error(`重生的批數要是正整數，收到 ${r.batches}`)
  }
  return {
    kind: 'recycle',
    team: r.side === 'mine' ? 'blue' : 'red',
    ...(r.role === undefined ? {} : { role: r.role }),
    batches: r.batches,
    warn: r.warn,
    warnLead: r.warnLead,
    entry: turnedEntry(plan, r.side, r.starboard),
  }
}

/** 卡片的說法 → 引擎的說法。`mine`／`theirs` 在這裡才變成藍／紅 */
function triggerToCondition(t: MissionTrigger): BeatCondition {
  if (t.kind === 'clock') return { kind: 'clock', at: t.at }
  if (t.kind === 'batch') return { kind: 'batch', at: t.at }
  return {
    kind: 'alive',
    team: t.side === 'mine' ? 'blue' : 'red',
    ...(t.role === undefined ? {} : { role: t.role }),
    atMost: t.atMost,
    byLatest: t.byLatest,
  }
}
