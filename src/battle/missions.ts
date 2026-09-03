import { Vector3 } from 'three'
import { DEFAULT_BATTLE, type BattleConfig } from './setup'
import { VETERAN } from '../ai/profile'
import { P51D } from '../specs/p51d'
import { BF109K4 } from '../specs/bf109k4'
import { F6F5 } from '../specs/f6f5'
import { B17G } from '../specs/b17g'
import { KI84 } from '../specs/ki84'
import { A6M5 } from '../specs/a6m5'
import { G4M } from '../specs/g4m'
import { ENTRY_PLANS, type EntryPlan, type EntryPlanId } from './entry'
import { convoyLine, lineAbreast } from './order'
import { SCHWARM_SIZE } from './flights'
import type { Beat, BeatCondition, ReinforceBeat, WithdrawBeat } from './beats'
import type { MissionRules } from './mission'
import type { AircraftSpec } from '../specs/types'
import type { Team } from '../world/World'
import type { TerrainKind } from '../world/terrainKind'

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
  /** 畫面中心的預警文字 */
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
}

/**
 * 一條戰役。**三條線各 4 關。**
 *
 * 【為什麼三個都用國家而不是陣營】日本也是軸心。留著 `axis` 當德軍的代稱，
 * 是一個等著發生的誤讀。
 *
 * 【它不參與任何生成邏輯】只做兩件事：卡片分在哪一落、選單那顆按鈕寫什麼。
 * 雙方飛什麼由卡片自己說（見 `MissionBattle`）—— 那是這一輪的整個重點：
 * **敵方機種是逐卡的**，盟軍線的「艦隊上空」敵人就是日本魚雷機。
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
   * 這一關的戰鬥設定。**null = 還沒做**，選單上 disabled。
   *
   * 【取代了 `playable` 旗標】原本是一個布林值與一堆散在根層、可以只填一半
   * 的欄位並存，而「資料要嘛完整、要嘛全空」得靠一條測試守。搬進一個可為
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
   * 我方（藍隊）的主力機種。**不保證是戰鬥機** —— 有幾關玩家開轟炸機。
   *
   * 【為什麼是 `AircraftSpec` 物件而不是 id 字串】id 打錯是執行期才發現
   * （`specOf` 會靜靜落回第一台），物件打錯是編譯錯誤。而且下游三張依物件
   * 識別的快取（`envelope`、`doctrine`、`ceilings`）認的就是這個參考。
   */
  readonly blueSpec: AircraftSpec
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
  /** 被護送／被攔截的那幾架有幾架。其餘任務為 0 */
  readonly convoyCount: number
  /**
   * 被護送的那幾架在**敵方**目標挑選裡值幾倍。**1 = 沒有偏置。**
   *
   * 【為什麼在卡片上而不是一個全域常數】專案負責人 2026-08-21：「任務可能
   * 會需要有一些獨立的小參數可以調。」護送與攔截要的量不一定一樣 —— 護送
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
   * 【為什麼是每張卡自己的欄位】專案負責人 2026-08-16：「任務的擺位不一定
   * 只有對頭 OR 追我，應該要把擺位、面向、初始狀態都寫成陣列，讓每個任務
   * 有不同的擺法。」
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
   * 這一關的返航節拍：打到一半任務目標換成「飛回基地」。
   *
   * 【觸發條件不是可以隨便選的】開場規則若是 `annihilate`，返航用時鐘的話
   * 玩家在那一秒之前清光敵軍就直接判勝，返航段永遠不會發生。綁在**我方**
   * 存活數上才對 —— 那也正是這一關的敘述：「友軍逐漸減少 → 任務更新」。
   */
  readonly withdraw?: MissionWithdraw
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
 * 被護送的那幾架在敵方目標挑選裡值幾倍。**專案負責人的裁定，試飛中。**
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
 * 【無時限】專案負責人 2026-08-21 給的兩組勝負條件裡沒有時間 —— 護送敗北
 * 只有「全部被擊落」，攔截敗北只有「任一台抵達」。
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
 * 撤離時限的餘裕倍率。**這是難度的旋鈕**，1.4 = 四成的機動預算。
 *
 * `evacuate.probe.ts` 表一給的是**直飛、不迴避**的路徑時間下限；乘上餘裕才是
 * 「一邊閃一邊走」的預算。1.2 緊到完全不能停下來打，1.6 寬到時限形同虛設。
 */
const EVAC_MARGIN = 1.4

/**
 * 德 M4 撤退段的時限，秒。**推導出來的，不是挑的。**
 *
 * ```
 *   表一   P-51D 直飛 12 km            84.0 s
 *   表四   Bf 109 ÷ P-51D（20 km）     168.2 / 125.5 = 1.34
 *   →     Bf 109 直飛 12 km           84.0 × 1.34 = 112.6 s
 *   →     × EVAC_MARGIN               158 s
 * ```
 *
 * 兩張表都在 `test/tools/evacuate.probe.ts` 的檔頭。
 */
const RETREAT_SECONDS = Math.round(84.0 * (168.2 / 125.5) * EVAC_MARGIN)

/** 德 M4 撤退段的終點在多遠，m */
const RETREAT_DISTANCE = 12000

/**
 * 三條戰役各四關。
 *
 * ── 為什麼有七張是 `battle: null` ────────────────────────
 *
 * 它們卡在里程碑 2（地面目標與投放武器）。**編制與機種現在不填** ——
 * 填進一張還打不起來的卡，只會變成一組沒有人驗證過、卻看起來已經定案的
 * 數字。那幾關要用什麼寫在 `docs/roadmap.md` 的對照表裡。
 *
 * ── 五張可玩的來歷 ──────────────────────────────────────
 *
 * ```
 *   盟 M1 / 德 M1   舊的 allies-escort / axis-intercept，數字一個都沒動
 *                   —— 那兩張是唯二有實測基礎的（2026-08-21 掃描定值），
 *                   由 `mission-config-baseline.test.ts` 逐項釘住
 *   日 M1 / 日 M3   新的。編制照掃描過的那兩種形狀（8v6 殲滅、護送）
 *   德 M4           新的。返航節拍的第一個真實使用者
 * ```
 */
export const MISSIONS: Record<Campaign, readonly MissionCard[]> = {
  allies: [
    {
      id: 'allies-m1', title: '護送堡壘', type: '護航',
      summary: '把 B-17 帶到集合點。它們自己防不住 Bf 109。',
      battle: {
        ...CONVOY, objective: '護送轟炸機抵達集合點',
        blueSpec: P51D, redSpec: BF109K4, convoySpec: B17G,
        blueCount: 4, redCount: 10,
        terrain: 'archipelago',
      },
    },
    {
      id: 'allies-m2', title: '深入敵境', type: '打擊',
      summary: '坐進 B-17 的駕駛座，穿過防空網把工廠炸掉。',
      battle: null,
    },
    {
      id: 'allies-m3', title: '獵殺列車', type: '打擊',
      summary: '低空掃射補給線上的列車與調車場。',
      battle: null,
    },
    {
      id: 'allies-m4', title: '艦隊上空', type: '殲滅',
      summary: '守住航艦。打退零戰之後，雷達發現低空來的魚雷機。',
      battle: null,
    },
  ],
  germany: [
    {
      id: 'germany-m1', title: '攔截轟炸機群', type: '攔截',
      summary: '突破護航網，在 B-17 投彈前把它們打下來。',
      battle: {
        ...CONVOY, objective: '在轟炸機抵達前擊落',
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
      id: 'germany-m2', title: '東線鐵路樞紐', type: '打擊',
      summary: '駕駛 He 111，把東線的調車場癱瘓。',
      battle: null,
    },
    {
      id: 'germany-m3', title: '最後的 Gustav', type: '打擊',
      summary: '掛彈起飛，攻擊推進中的裝甲縱隊。',
      battle: null,
    },
    {
      id: 'germany-m4', title: '帝國最後防線', type: '殲滅',
      summary: '本土上空的攔截戰。撐不住的時候，就往回飛。',
      battle: {
        objective: '擊落全部敵機',
        blueSpec: BF109K4, redSpec: P51D, convoySpec: null,
        blueCount: 8, redCount: 10,
        convoyCount: 0, convoyPriority: 1,
        targetDistance: 0, targetRadius: 0, seconds: Infinity,
        entry: 'headOn',
        terrain: 'farmland',
        /**
         * 【觸發綁我方存活數，不是時鐘】開場規則是 `annihilate`，紅隊歸零
         * 就直接判勝。用時鐘的話玩家在那一秒之前清光敵軍，返航段永遠不會
         * 發生。藍 8 打紅 10 再加兩批共 8 架，「藍隊剩 ≤4」一定比「紅隊
         * 歸零」先到 —— 而那正是這一關的敘述：友軍逐漸減少 → 任務更新。
         */
        withdraw: {
          when: { kind: 'alive', side: 'mine', atMost: 4, byLatest: 90 },
          message: 'RETURN TO BASE',
          distance: RETREAT_DISTANCE, radius: CONVOY_RADIUS,
          seconds: RETREAT_SECONDS,
        },
        /**
         * 【敵人從斜前方分批來，不是在後面追】專案負責人 2026-09-03。
         * 撤離點在 −Z，紅方的進場點也在 −Z —— 所以波次生在玩家**前方**，
         * 玩家必須打穿出去。舊撤離卡的「追不到」從根本消失，因為沒有人在追。
         *
         * 【第二批要往前挪】玩家從 z≈0 跑到紅方開局點只要 28 秒。第二批不
         * 覆寫縱深的話會生在他背後 —— 見 `MissionWave.along`。
         */
        waves: [
          {
            when: { kind: 'clock', at: 0 },
            warn: '前方有攔截機',
            warnLead: 4,
            side: 'theirs', spec: P51D, count: 4,
          },
          {
            when: { kind: 'clock', at: 45 },
            warn: '又一批，正前方',
            warnLead: 4,
            side: 'theirs', spec: P51D, count: 4, along: -1.0,
          },
        ],
      },
    },
  ],
  japan: [
    {
      id: 'japan-m1', title: '零戰', type: '殲滅',
      summary: '沒有裝甲、沒有自封油箱，換來的是誰都跟不上的迴轉。',
      battle: {
        ...KILL,
        blueSpec: A6M5, redSpec: F6F5,
        blueCount: 8, redCount: 6,
        terrain: 'archipelago',
      },
    },
    {
      id: 'japan-m2', title: '島嶼防衛', type: '殲滅',
      summary: '攔下艦載機，再回頭掃射灘頭的登陸艇。',
      battle: null,
    },
    {
      id: 'japan-m3', title: '護航', type: '護航',
      summary: '駕駛疾風，把一式陸攻帶到投雷點。',
      battle: {
        ...CONVOY, objective: '護送轟炸機抵達投雷點',
        blueSpec: KI84, redSpec: F6F5, convoySpec: G4M,
        blueCount: 4, redCount: 10,
        terrain: 'sea',
      },
    },
    {
      id: 'japan-m4', title: '最後的攻擊', type: '打擊',
      summary: '駕駛一式陸攻，黃昏低空穿過防空火網投雷。',
      battle: null,
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
    // 症狀是「轟炸機從圈旁邊飛過去，任務永遠不結束」（2026-08-21 由
    // `test/tools/convoy.probe.ts` 表三抓到）。
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
 * ——盟軍線的「艦隊上空」敵人是日本魚雷機。
 *
 * 【為什麼架數不夾制】`battleConfigFrom` 要夾是因為那些數字從 DOM 讀進來；
 * 這裡的來源是本檔的常數表，夾制只會把一個寫錯的關卡藏起來。
 *
 * 【但「寫錯就會炸」只對一半】`blueCount` 為 0 時 `createBattle` 確實會拋
 * 「玩家沒有被建立」；**大於 `MAX_SIDE` 不會拋**，只會建一個超出特效池容量
 * 假設的超大戰場（Codex 審查 2026-08-16）。所以那道保險由
 * `test/unit/campaigns.test.ts` 補上。
 */
export function missionConfigFrom(card: ReadyMissionCard): BattleConfig {
  const b = card.battle
  const rules = missionRules(card, DEFAULT_BATTLE.altitude, DEFAULT_BATTLE.lateralOffset)
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
    : lineAbreast(plan, b.blueSpec, b.blueCount, b.redSpec, b.redCount)
  const beats = cardBeats(card, plan)
  return {
    ...DEFAULT_BATTLE,
    units,
    aiProfile: VETERAN,
    rules,
    // 【只有護送／攔截會偏離中性值】其餘卡片的 `convoyPriority` 是 1，
    // 那時這一份與 `NEUTRAL_TUNING` 的行為逐字相同
    tuning: { convoyPriority: b.convoyPriority },
    ...(beats === undefined ? {} : { beats }),
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
function cardBeats(card: ReadyMissionCard, plan: EntryPlan): readonly Beat[] | undefined {
  const b = card.battle
  const out: Beat[] = []
  b.waves?.forEach((w, i) => out.push(waveBeat(w, i, plan)))
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
function waveBeat(w: MissionWave, index: number, plan: EntryPlan): ReinforceBeat {
  if (!Number.isInteger(w.count) || w.count < 1 || w.count > SCHWARM_SIZE) {
    throw new Error(`波次的架數要是 1…${SCHWARM_SIZE} 的整數，收到 ${w.count}`)
  }
  const ours = w.side === 'mine'
  const base = ours ? plan.blue : plan.red
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
 * 波次的橫向槽位起點，單位是 `schwarmSpacing`。
 *
 * 【為什麼不是 0】開場的分隊佔的是 −2…+2（一隊最多 5 個小隊，
 * `lane = f − (flights−1)/2`），而波次沿用**同一個 `entry`**。用 0 的話，
 * 一個開場就成立的波次會生在開場某一隊身上 —— 那兩架會在同一點上重疊，
 * 而且不會有任何錯誤。3 是比最寬的開場槽位再外一格。
 */
const WAVE_LANE = 3

/** 卡片的說法 → 引擎的說法。`mine`／`theirs` 在這裡才變成藍／紅 */
function triggerToCondition(t: MissionTrigger): BeatCondition {
  if (t.kind === 'clock') return { kind: 'clock', at: t.at }
  return {
    kind: 'alive',
    team: t.side === 'mine' ? 'blue' : 'red',
    ...(t.role === undefined ? {} : { role: t.role }),
    atMost: t.atMost,
    byLatest: t.byLatest,
  }
}
