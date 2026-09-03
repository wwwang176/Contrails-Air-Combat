import { Vector3 } from 'three'
import { DEFAULT_BATTLE, type BattleConfig } from './setup'
import { specsFor, type FactionChoice } from './skirmish'
import { VETERAN } from '../ai/profile'
import { ENTRY_PLANS, type EntryPlan, type EntryPlanId } from './entry'
import { convoyLine, lineAbreast } from './order'
import { SCHWARM_SIZE } from './flights'
import type { BeatCondition, ReinforceBeat } from './beats'
import type { MissionRules } from './mission'
import type { AircraftSpec } from '../specs/types'
import type { Team } from '../world/World'

/** 任務類型。對應 `docs/prompt.md` 規劃的五種 */
export type MissionType = '殲滅' | '攔截' | '打擊' | '護航' | '撤離'

/**
 * 卡片上的「哪一邊」。
 *
 * **卡片是陣營中立的**：同一張卡，玩家選盟軍或選軸心，敵我機種會對調。
 * 所以卡片上只能說「我方／敵方」，實際機種由 `missionConfigFrom` 在知道
 * 陣營之後才解析。玩家恆在藍隊，所以 `mine` 就是藍、`theirs` 就是紅。
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
 * 【為什麼不讓它寫機種】見 `MissionSide`。`role` 選的是那個陣營的第幾台
 * （`specsFor` 的第一台是戰鬥機、第二台是轟炸機），不是一個寫死的 id。
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
  readonly role: AircraftSpec['role']
  /** 幾架。1 … `SCHWARM_SIZE` */
  readonly count: number
}

/**
 * 一張任務卡。
 *
 * 【為什麼從 `ui/` 搬到 `battle/`】M10 時它只有標題與文案，是 UI 的東西。
 * 現在它帶著編制與勝負條件 —— 那是**關卡資料**，而選單只是它的一個讀者。
 */
export interface MissionCard {
  /**
   * 全域唯一。`main.ts` 用它認出玩家點的是哪一關。
   *
   * 【前綴就是陣營】`main.ts` 由 `id.startsWith('axis')` 推陣營，由
   * `test/unit/missions.test.ts` 釘住。
   */
  id: string
  title: string
  type: MissionType
  /**
   * 1~5 星。**這一張卡的配置的標籤，不是玩家的選項** —— 難度由編制與幾何
   * 給，`DifficultyProfile` 一貫不碰（見 `setup.ts` 的 `aiProfile` 註解）。
   */
  difficulty: number
  /** 卡片上的一行說明 */
  summary: string
  /**
   * HUD 目標列上的文字。未實作的卡是空字串。
   *
   * 【為什麼放在卡片上而不是 `MissionState`】它是常數。放進狀態的話
   * `stepMission` 每個物理步跑 240 次，等於每秒配置 240 個字串。
   */
  objective: string
  /**
   * 我方**戰鬥機**的架數，含玩家。
   *
   * 【2026-08-21 起不含被護送的那幾架】它們由 `convoyCount` 另外給 ——
   * 兩者的編隊方式、高度層與行為完全不同（見 `order.ts` 的 `SideOrder`），
   * 混在同一個數字裡的話這一層要自己去猜哪幾架是哪一種。
   */
  blueCount: number
  redCount: number
  /**
   * 被護送／被攔截的那幾架有幾架。**護送算在藍隊、攔截算在紅隊**，
   * 其餘任務為 0。
   *
   * 【為什麼一個欄位就夠】一張卡只會有一邊有轟炸機 —— 那正是護送與攔截的
   * 定義。哪一邊由 `type` 決定，見 `missionRules`。
   */
  convoyCount: number
  /**
   * 被護送的那幾架在**敵方**目標挑選裡值幾倍。**1 = 沒有偏置。**
   *
   * 【為什麼在卡片上而不是一個全域常數】專案負責人 2026-08-21：「任務可能
   * 會需要有一些獨立的小參數可以調。」護送與攔截要的量不一定一樣 —— 護送
   * 是「敵人更想打我方轟炸機」（讓這一關真的變成護送），攔截是「我方更想
   * 打敵方轟炸機」（突破護航網）。同一個機制、兩個可以分開調的數字。
   *
   * 詳見 `mission.ts` 的 `MissionTuning.convoyPriority`。
   */
  convoyPriority: number
  /**
   * 終點在該隊機首方向多遠，m。沒有終點的任務為 0。
   *
   * 【為什麼是距離而不是座標】方向跟著那一隊走：撤離與護送是藍隊、
   * 朝 −Z；攔截是紅隊、朝 +Z。寫成座標的話這件事會被藏進一個負號。
   */
  targetDistance: number
  /** 抵達半徑，m。**就是圓環半徑**。沒有終點的任務為 0 */
  targetRadius: number
  /** 時限，秒。無時限為 `Infinity` */
  seconds: number
  /**
   * 開局怎麼擺。**`battle/entry.ts` 那張表的鍵。**
   *
   * 【為什麼是每張卡自己的欄位】專案負責人 2026-08-16：「任務的擺位不一定
   * 只有對頭 OR 追我，應該要把擺位、面向、初始狀態都寫成陣列，讓每個任務
   * 有不同的擺法。」寫成 `type === '撤離' ? 追擊 : 對頭` 的話，第三種擺法
   * 一出現那條式子就要改，而且它會散落在別處。
   */
  entry: EntryPlanId
  /**
   * 這一張卡做了沒有。false 的在選單上維持 disabled。
   *
   * 【為什麼是資料而不是由 `type` 推導】推導要寫成
   * `type === '殲滅' || type === '撤離'`，而那條式子會散落在選單與測試裡。
   * 補上攔截時只要把那張卡的旗標翻成 true。
   */
  playable: boolean
  /**
   * 這一關的波次。**沒有波次的卡不寫這一格**（不是寫空陣列）。
   *
   * 【為什麼是選填而不是預設空陣列】既有 10 張卡一格都不能動 ——
   * `missionConfigFrom` 對沒有這一格的卡完全不產生 `beats`，走的是與波次
   * 上線之前逐位元相同的那條路。
   */
  waves?: readonly MissionWave[]
}

/** 沒有撤離點、沒有時限、還沒做的卡共用這一組 */
const LOCKED = {
  objective: '', convoyCount: 0, convoyPriority: 1,
  targetDistance: 0, targetRadius: 0, seconds: Infinity,
  entry: 'headOn', playable: false,
} as const

/**
 * 殲滅：沒有撤離點也沒有時限，贏的條件就是敵方歸零。
 *
 * 【起始值，待掃描】藍 8／紅 6 是 2 星。見 spec §8。
 */
const KILL = {
  objective: '擊落全部敵機',
  convoyCount: 0, convoyPriority: 1, targetDistance: 0, targetRadius: 0, seconds: Infinity,
  entry: 'headOn', playable: true,
} as const

/**
 * 撤離的共用幾何。**由 `test/tools/evacuate.probe.ts` 實測定值**（spec §8）。
 *
 * ── ⚠ 【暫時關閉：`playable: false`】專案負責人 2026-08-16 ──────────
 *
 * 試飛兩輪之後的裁定：**「我發現，根本追不到，撤退這個任務先 DISABLED。」**
 *
 * ```
 *   第一版  後方 800 m、高 1,000 m  →  斜距 1,281 m、俯角 51°  →  追不到
 *   第二版  後方 400 m、高   200 m  →  斜距   447 m、俯角 27°  →  還是追不到
 * ```
 *
 * 【關掉的是卡片，不是機制】撤離的判定、圓環、目標列、時限全部留著，而且
 * 仍然由 `test/unit/mission.test.ts` 與 `test/integration/mission-evacuate.test.ts`
 * 守著 —— 那三支測試不讀 `playable`，所以這面旗子翻下來它們一條都不會少。
 * **這一張卡缺的不是判定，是一個玩得起來的追逐。**
 *
 * 【真正的缺口】把敵機擺在身後只是把「追不上」推遲了幾秒 —— 開局幾何管
 * 得了第一次接觸，管不了之後。要讓追逐成立，缺的是**AI 的撤離行為**
 * （`docs/backlog.md` §2.12）：目前紅隊只會照一般空戰邏輯纏鬥，沒有人負責
 * 「壓在逃跑者的能量線上不放」。**這件事沒補上之前，調 `gap` 與 `climb`
 * 只是在換一個追不到的距離。**
 *
 * 【要翻回來的條件】§2.12 補上之後重跑 `evacuate.probe.ts`，再由試飛裁定。
 *
 * ```
 *   撤離點 −20,000 m ── 玩家起點 z≈+5,000（entryRange/2），直線 25 km。
 *                       表一實測直飛 12/16/20/25/30 km 各要 84.0/104.8/125.5/
 *                       151.3/177.0 s —— 線性，沒有結構，所以維持 20 km
 *   抵達半徑  1,000 m ── 表三：四個候選的判定都是精確的（判到達時的距離
 *                       等於半徑，差 0~1 m），沒有跨步漏判。挑 1,000 是
 *                       因為它在 20 km 外佔螢幕高度 8.8%：500 只有 4.4%
 *                       （太小），2,000 有 17.6%（大到擋視野）
 * ```
 *
 * 【為什麼撤離點在敵人後方】藍隊開局朝 −Z，紅隊在 −Z。所以玩家必須打穿
 * 出去 —— 撤離點若在背後，最佳打法是開局轉頭直線飛，那不是一場仗。
 *
 * 【時限不在這裡】它逐卡不同，見下面兩張撤離卡。
 */
const EVAC = {
  objective: '飛抵撤離點',
  convoyCount: 0, convoyPriority: 1, targetDistance: 20000, targetRadius: 1000,
  // 【追兵在正後方 400 m、高 200 m】理由與數字的推導見 `entry.ts` 的 `PURSUIT`
  entry: 'pursuit', playable: false,
} as const

/**
 * 時限的餘裕倍率。**這是難度的旋鈕**，起始值 1.4（四成的機動預算）。
 *
 * 表一實測（直飛、不迴避、WEP）給的是路徑時間的**下限**；乘上餘裕才是
 * 「一邊閃一邊走」的預算。1.2 = 兩成，緊到完全不能停下來打；1.6 = 六成，
 * 寬到時限形同虛設。
 *
 * 【為什麼兩張卡的秒數不一樣】表四：同盟國玩家開 P-51（全場最快），
 * 對頭交錯之後 16 架 Bf109 追不上，125.5 s 到；軸心國玩家開 Bf109，
 * 被更快的 P-51 追，168.2 s 到而且掉一架僚機。**同一個秒數會讓一張卡
 * 太鬆、另一張幾乎不可能。**
 */
const EVAC_MARGIN = 1.4

/**
 * 直飛到撤離點的實測秒數（`evacuate.probe.ts` 表四，20 km、WEP、不迴避）。
 *
 * 【為什麼把它們寫成常數再乘】時限**是推導出來的**，不是挑出來的。
 * 直接寫 175 與 235 的話，下一次量出不同的路徑時間時，沒有人知道要
 * 怎麼重算。
 */
const EVAC_STRAIGHT_ALLIES = 125.5
const EVAC_STRAIGHT_AXIS = 168.2

/** 同盟國「且戰且走」：125.5 × 1.4 = 175.70 → 176 */
const EVAC_SECONDS_ALLIES = Math.round(EVAC_STRAIGHT_ALLIES * EVAC_MARGIN)
/**
 * 軸心國「撤出包圍」：168.2 × 1.4 = 235.48 → **235**。
 *
 * 【這裡原本寫 236】我心算成 235.5 才進位。實際是 235.48，`Math.round`
 * 給 235（Codex 審查 2026-08-16）。**程式一直是對的，錯的是註解** ——
 * 這正是「把推導寫進程式而不是寫死結果」的價值：算式不會算錯，只有
 * 註解會。兩個秒數現在由 `test/unit/missions.test.ts` 逐值釘住。
 */
const EVAC_SECONDS_AXIS = Math.round(EVAC_STRAIGHT_AXIS * EVAC_MARGIN)

/**
 * 護送／攔截的終點離出發線多遠，m。**四張卡共用。**
 *
 * 【起始值 12,000，待掃描】藍隊由 z ≈ +5,000（`entryRange / 2`）出發，
 * 所以全程 17 km。B-17G 的臨界高度極速 462 km/h = 128 m/s，直飛約 133 s
 * （2.2 分鐘）—— 護航機打完一輪還追得上，而攔截方有第二次機會。
 *
 * 【為什麼不沿用撤離的 20 km】那個數字是照 P-51 的速度訂的。轟炸機慢四成，
 * 同樣距離會把一場仗拖成三分半。
 */
const CONVOY_DISTANCE = 12000
/**
 * 抵達半徑，m。**沿用撤離掃描出來的 1,000**（見 `EVAC` 的表三）。
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
 *
 * 【它不是「只打轟炸機」】乘法偏置仍然會被幾何否決：一架在正後方三公里外
 * 的轟炸機，乘上去之後照樣輸給眼前這架咬著我的護航機。要的正是這個 ——
 * 「優先」不是「無視戰場」。
 *
 * 【每張卡都可以自己覆寫】值住在 `MissionCard.convoyPriority`；這裡只是
 * 四張卡目前共用的那一個。
 */
const CONVOY_PRIORITY = 5

/** 護送與攔截共用的幾何。差別只有目標列的文字 */
const CONVOY = {
  convoyCount: 4, convoyPriority: CONVOY_PRIORITY,
  targetDistance: CONVOY_DISTANCE, targetRadius: CONVOY_RADIUS,
  // 【無時限】專案負責人 2026-08-21 給的兩組勝負條件裡沒有時間 —— 護送
  // 敗北只有「全部被擊落」，攔截敗北只有「任一台抵達」
  seconds: Infinity,
  // 【對頭】護送要打穿出去（理由同 `EVAC`），攔截則是迎向轟炸機流 ——
  // 同一個擺法對兩邊都成立，因為它們本來就是同一個局面的兩側
  entry: 'headOn', playable: true,
} as const

/** 護送：把自己那幾架帶到終點 */
const ESCORT = { ...CONVOY, objective: '護送轟炸機抵達集合點' } as const
/** 攔截：在對方那幾架抵達之前打光 */
const INTERCEPT = { ...CONVOY, objective: '在轟炸機抵達前擊落' } as const

/**
 * 兩個陣營的任務。
 *
 * 【還沒開的是打擊與撤離】
 *
 * ```
 *   打擊  缺對地武器與地面目標 —— 兩者都不存在
 *   撤離  判定做好了，缺一個追得到的追兵（見上面 EVAC 的 ⚠）
 * ```
 *
 * 【攔截與護航 2026-08-21 開放】兩者共用 `mission.ts` 的 convoy 一條規則、
 * `order.ts` 的 `convoyLine` 一支生成器。轟炸機兩台早就落地了
 * （`specs/b17g.ts`、`specs/he111.ts`），缺的一直是「永遠往終點飛」這個
 * 行為與那條勝負條件。
 *
 * 剩下兩張的架數照填，補上前置時只要把 `playable` 翻成 true。
 */
export const MISSIONS: Record<FactionChoice, readonly MissionCard[]> = {
  allies: [
    {
      id: 'allies-sweep', title: '諾曼第上空掃蕩', type: '殲滅', difficulty: 2,
      summary: '清空灘頭上空的攔截機。',
      blueCount: 8, redCount: 6, ...KILL,
    },
    {
      id: 'allies-intercept', title: '攔截 He 111 轟炸群', type: '攔截', difficulty: 3,
      summary: '在轟炸機投彈前擊落它們。',
      blueCount: 10, redCount: 4, ...INTERCEPT,
    },
    {
      id: 'allies-strike', title: '打擊魯爾鐵路', type: '打擊', difficulty: 3,
      summary: '切斷補給線上的列車與調車場。',
      blueCount: 4, redCount: 6, ...LOCKED,
    },
    {
      id: 'allies-escort', title: '護送 B-17 至集合點', type: '護航', difficulty: 4,
      // 【文案由「每一架」改成「轟炸機」】勝利條件是**任一架**抵達，不是
      // 全部。卡片上的字若與判定相反，玩家會照錯的目標去打
      summary: '把轟炸機帶到集合點。',
      blueCount: 4, redCount: 10, ...ESCORT,
    },
    {
      id: 'allies-evac', title: '且戰且走', type: '撤離', difficulty: 5,
      summary: '頂著數量劣勢活著退出戰區。',
      blueCount: 4, redCount: 16, ...EVAC, seconds: EVAC_SECONDS_ALLIES,
    },
  ],
  axis: [
    {
      // 【第一張有波次的卡】為什麼是這一張：殲滅**非把敵人全打光不可**，
      // 所以「敵方剩不多」這個條件一定會成立。攔截那一張不行 ——
      // `convoyPriority: 5` 讓我方一心衝轟炸機，護航機幾乎不會死（實測
      // 145 s 一架都沒掉），條件永遠只能靠兜底時限，那就等於一個時鐘。
      //
      // 難度 2 → 3：多了一支四架的敵方戰鬥機
      id: 'axis-patrol', title: '帝國防空巡邏', type: '殲滅', difficulty: 3,
      summary: '驅離侵入本土空域的護航機。第二批會從同一個方向進來。',
      blueCount: 8, redCount: 6, ...KILL,
      waves: [{
        // 【兩個數字都是起始值，待試飛】離線探針把 AI 放在玩家座位上跑，
        // 400 s 只打掉 2 架紅機（雙方一路爬高的拉鋸），所以那條路上兜底
        // 時限才是實際生效的那一個。人打起來快得多 —— 而這正是 `byLatest`
        // 存在的理由：打得快的人早點遇到第二批，打得慢的人不會空等。
        when: { kind: 'alive', side: 'theirs', role: 'fighter', atMost: 2, byLatest: 120 },
        warn: '警告：第二批敵機進入空域',
        // 【4 秒】夠玩家抬頭找、還來得及先脫離再迎擊
        warnLead: 4,
        side: 'theirs', role: 'fighter', count: 4,
      }],
    },
    {
      id: 'axis-intercept', title: '攔截 B-17 轟炸群', type: '攔截', difficulty: 3,
      summary: '突破護航網，打掉重轟炸機。',
      blueCount: 10, redCount: 4, ...INTERCEPT,
    },
    {
      id: 'axis-strike', title: '打擊登陸艦隊', type: '打擊', difficulty: 4,
      summary: '在灘頭上空掩護，攻擊登陸艦艇。',
      blueCount: 4, redCount: 8, ...LOCKED,
    },
    {
      // 【標題由「護送運輸機」改成 He 111】專案沒有運輸機，被護送的實際上
      // 是 He 111（`specsFor('axis')[1]`）。標題與畫面上飛的東西不一致，
      // 是那種每個人都會看到、卻沒有任何測試會抓到的錯
      id: 'axis-escort', title: '護送 He 111 編隊', type: '護航', difficulty: 3,
      summary: '掩護轟炸機穿越敵方巡邏區。',
      blueCount: 4, redCount: 8, ...ESCORT,
    },
    {
      id: 'axis-evac', title: '撤出包圍', type: '撤離', difficulty: 5,
      summary: '在補給斷絕的機場起飛並脫離。',
      blueCount: 4, redCount: 16, ...EVAC, seconds: EVAC_SECONDS_AXIS,
    },
  ],
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
  card: MissionCard, altitude: number, lateralOffset: number,
): MissionRules {
  if (card.type === '撤離') {
    return {
      kind: 'evacuate',
      point: new Vector3(0, altitude, -card.targetDistance),
      radius: card.targetRadius,
      seconds: card.seconds,
    }
  }
  if (card.type === '護航' || card.type === '攔截') {
    // 【護航是我方的轟炸機、攔截是敵方的】這一行就是兩張卡的**全部**差別，
    // 判定那一側是同一條規則（見 `mission.ts` 的 convoy）
    const owner: Team = card.type === '護航' ? 'blue' : 'red'
    // 【方向跟著那一隊的機首】藍隊開局朝 −Z、紅隊朝 +Z。所以護送的終點在
    // 敵人後方（要打穿出去，理由同撤離），而攔截的終點在**我方**後方 ——
    // 那正是「別讓它飛過去」的意思
    const z = owner === 'blue' ? -card.targetDistance : card.targetDistance
    // 【圈要放在那一隊自己的航道上，不是 x = 0】兩隊對頭時各自橫向偏
    // `across × lateralOffset`（起始值 ∓750 m，見 `entry.ts` 的 `HEAD_ON`
    // 與 `BattleConfig.lateralOffset`）—— 那是為了不對撞。判定圈釘在 0 的話，
    // 最外側那一架到圈心是 750 + 300 = 1,050 m，**永遠判不到**，而症狀是
    // 「轟炸機從圈旁邊飛過去，任務永遠不結束」（2026-08-21 由
    // `test/tools/convoy.probe.ts` 表三抓到）。
    //
    // 【撤離刻意不跟著改】那一組座標是實測定值（見 `EVAC`），而且撤離是
    // 玩家自己操縱著飛過去 —— 他看得到圈在哪裡。這裡不行，飛的是 AI。
    const x = ENTRY_PLANS[card.entry][owner].across * lateralOffset
    return { kind: 'convoy', owner, point: new Vector3(x, altitude, z), radius: card.targetRadius }
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
 * 【為什麼架數不夾制】`battleConfigFrom` 要夾是因為那些數字從 DOM 讀進來；
 * 這裡的來源是本檔的常數表，夾制只會把一個寫錯的關卡藏起來。
 *
 * 【但「寫錯就會炸」只對一半】`blueCount` 為 0 時 `createBattle` 確實會拋
 * 「玩家沒有被建立」；**大於 `MAX_SIDE` 不會拋**，只會建一個超出特效池容量
 * 假設的超大戰場（Codex 審查 2026-08-16）。所以那道保險由
 * `test/unit/missions.test.ts` 的「架數落在 1~MAX_SIDE 的整數」補上。
 */
export function missionConfigFrom(card: MissionCard, faction: FactionChoice): BattleConfig {
  const mine = specsFor(faction)
  const theirs = specsFor(faction === 'allies' ? 'axis' : 'allies')
  const rules = missionRules(card, DEFAULT_BATTLE.altitude, DEFAULT_BATTLE.lateralOffset)
  // 【擺法是生成器的第一個參數】`card.entry` 仍然是 `ENTRY_PLANS` 的鍵，
  // 那張表一個字不動
  const plan = ENTRY_PLANS[card.entry]
  // 【`[1]` 是那個陣營的轟炸機】`specsFor` 的第一台是戰鬥機、第二台是
  // 轟炸機（見 `skirmish.ts` 的 `SPECS`）。第三台加進去時這一行不必動 ——
  // 它取的是「那個陣營的轟炸機」而不是「最後一台」
  const bomber = (side: readonly AircraftSpec[]): AircraftSpec => {
    const b = side[1]
    if (b === undefined) throw new Error('這個陣營沒有第二台機體，護送／攔截無法生成')
    return b
  }
  const units = rules.kind === 'convoy'
    ? convoyLine(plan, {
      fighter: mine[0]!,
      fighters: card.blueCount,
      bomber: rules.owner === 'blue' ? bomber(mine) : null,
      bombers: card.convoyCount,
    }, {
      fighter: theirs[0]!,
      fighters: card.redCount,
      bomber: rules.owner === 'red' ? bomber(theirs) : null,
      bombers: card.convoyCount,
    })
    : lineAbreast(plan, mine[0]!, card.blueCount, theirs[0]!, card.redCount)
  const beats = card.waves?.map((w, i) => waveBeat(w, i, plan, mine, theirs, bomber))
  return {
    ...DEFAULT_BATTLE,
    units,
    aiProfile: VETERAN,
    rules,
    // 【只有護送／攔截會偏離中性值】其餘卡片的 `convoyPriority` 是 1，
    // 那時這一份與 `NEUTRAL_TUNING` 的行為逐字相同
    tuning: { convoyPriority: card.convoyPriority },
    // 【沒有波次的卡連這一格都不長出來】`beats` 是 undefined 時
    // `createBattle` 不推導 `reserve`、`stepBeats` 第一行就早退 ——
    // 既有 10 張卡走的是與波次上線之前逐位元相同的那條路
    ...(beats === undefined ? {} : { beats }),
  }
}

/**
 * 一個波次 → 一個增援節拍。**卡片的相對描述在這裡解析成實際的隊伍與機種。**
 *
 * 【橫向槽位逐波次 +1，而且從 `WAVE_LANE` 起跳】出生點是
 * `lane × schwarmSpacing + across × lateralOffset`（`unitFrame`），而高度那一軸
 * 的鋸齒**週期只有 5**（`altitudeOffset`）—— 光靠 `tier` 的話第 1 與第 6 個
 * 波次會生在完全相同的一點上。橫向槽位每支差 1，任何兩支就至少差一個
 * `schwarmSpacing`（Codex 審查 2026-09-03 P1）。
 */
function waveBeat(
  w: MissionWave, index: number, plan: EntryPlan,
  mine: readonly AircraftSpec[], theirs: readonly AircraftSpec[],
  bomber: (side: readonly AircraftSpec[]) => AircraftSpec,
): ReinforceBeat {
  if (!Number.isInteger(w.count) || w.count < 1 || w.count > SCHWARM_SIZE) {
    throw new Error(`波次的架數要是 1…${SCHWARM_SIZE} 的整數，收到 ${w.count}`)
  }
  const ours = w.side === 'mine'
  const side = ours ? mine : theirs
  const spec = w.role === 'bomber' ? bomber(side) : side[0]!
  return {
    kind: 'reinforce',
    when: triggerToCondition(w.when),
    warn: w.warn,
    warnLead: w.warnLead,
    flight: {
      team: ours ? 'blue' : 'red',
      members: Array.from({ length: w.count }, () => spec),
      // 【沿用那一邊開局的擺法】也就是它們原本來的方向。觸發時仗已經飄到
      // 中間了，所以波次自然出現在遠方
      entry: ours ? plan.blue : plan.red,
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
