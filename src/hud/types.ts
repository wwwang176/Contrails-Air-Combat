import { createDamageMarks, type DamageMark } from './damageMarks'
import { ARENA_COUNTDOWN } from '../world/arena'
import type { OrdnanceKind } from '../weapons/stores'
import type { ReleaseEnvelope } from '../weapons/releaseEnvelope'
import { TORPEDO_RUN_SAMPLES } from '../world/torpedo'

/**
 * 一個接觸點（畫面上的一架他機）。
 *
 * 【為什麼沒有「是不是當前目標」這個欄位】M2 沒有目標選取。血量在二戰
 * 題材上說不通——你看不出對方的結構完整度——所以不顯示；而「要顯示誰的
 * 血」這個問題一消失，整套目標選取狀態（選中誰、目標死了怎麼換、被遮擋
 * 怎麼辦）也就不必存在。目標框、畫面外指示、小地圖符號本來就是**畫全部**，
 * 預瞄環則是射程內每架各一個（spec §8）。
 */
export interface HudContact {
  /** 這一格有沒有在用。contacts 是固定長度的池，用 contactCount 界定範圍 */
  active: boolean
  /** 螢幕座標，單位為**螢幕半高**（與 aimX/aimY 同一套） */
  x: number
  y: number
  /** 在相機背後。目標框不畫，只畫畫面外指示 */
  behind: boolean
  /** 目標框半徑，螢幕半高單位 */
  radius: number
  hostile: boolean
  /**
   * 這是**玩家自己分隊的同伴**（同一個 Schwarm）。
   *
   * 【為什麼標整個分隊而不是只標 `members[1]`】掩護對象與站位參考機是
   * 同一架，而 `STATION_REFERENCE = [-1, 0, 0, 2]` —— `members[1]` 與
   * `members[2]` **都**掩護玩家，`members[3]` 掩護 `members[2]`。只標
   * `members[1]` 的話，分界線不對應任何實際的行為差異：另外兩架同樣會
   * 在你被咬時回頭，卻與陌生友機同色（M6 spec §10）。
   */
  flightMate: boolean
  /** 相對高度差，m（正 = 比我高）。小地圖符號依它選三角／方／倒三角 */
  deltaY: number
  worldX: number
  worldZ: number
  /** 距離，m */
  range: number
  /**
   * 預瞄環的螢幕座標。`leadValid` 為 false 時不畫。
   *
   * 【M5 起只有敵機會有】彈丸直接穿過友機，所以友機的預瞄環指的是一個
   * 打不到的點 —— 畫出來是「往這裡開槍」的錯誤暗示。`hostile` 為 false 時
   * `leadValid` 恆為 false。
   */
  leadX: number
  leadY: number
  leadValid: boolean
  leadBehind: boolean
  /**
   * 這一架是不是自己分隊的長機（`members[0]`）。上帝視角的分隊標示只認它。
   *
   * 【玩家那一架恆為 true】玩家釘死在 `members[0]`（`FlightIndex.pinned`），
   * 所以他永遠是長機 —— 這是既有設計的直接後果，不是新特例。
   */
  flightLeader: boolean
  /** 它那個分隊還活著幾架。`flightLeader` 為 false 時無意義 */
  flightAlive: number
  /** 它那個分隊的編制員額。`flightAlive` 的分母 */
  flightSize: number
}

/**
 * 接觸點池的容量。M5 的 40 架 + 餘裕。
 *
 * 【為什麼是固定長度的池】HUD 每幀都會跑，而每幀 new 一個陣列就是每幀
 * 一次配置——沿用 M1 §15 的紀律。
 */
export const HUD_MAX_CONTACTS = 48

export function createHudContact(): HudContact {
  return {
    active: false, x: 0, y: 0, behind: false, radius: 0, hostile: true, flightMate: false,
    deltaY: 0, worldX: 0, worldZ: 0, range: 0,
    leadX: 0, leadY: 0, leadValid: false, leadBehind: false,
    flightLeader: false, flightAlive: 0, flightSize: 0,
  }
}

/**
 * 一個標記（畫面上的一顆彈、一枚雷、一艘船）。
 *
 * 【為什麼不併進 `HudContact`】接觸點帶著十六個欄位 —— 預瞄環、分隊、
 * 目標框半徑、小地圖用的世界座標。這三種東西一個都用不到：炸彈不屬於
 * 任何 Schwarm、不需要預瞄解、也不進小地圖。併進去等於每顆彈都拖著
 * 十三格死資料，而池子是 48 格的固定長度 —— 64 顆彈就把接觸點擠掉了。
 */
export interface HudMarker {
  /** 這一格有沒有在用。markers 是固定長度的池，用 markerCount 界定範圍 */
  active: boolean
  /** 螢幕座標，單位為**螢幕半高**（與 contacts 同一套） */
  x: number
  y: number
  /** 在相機背後 —— 不畫。標記沒有畫面外指示 */
  behind: boolean
  hostile: boolean
}

/**
 * 標記池的容量。地面目標 ＋ 艦隊 ＋ 空中的炸彈與魚雷，加餘裕。
 *
 * 【地面目標是持續佔用的那一半】洛伊納一關就有 12 座構件加 48 個砲位 ——
 * `fillMarkers` 依「船 → 地面目標 → 彈」的次序填，滿了就截斷，所以池太小的
 * 症狀是**玩家自己投的炸彈沒有標記**（排在最後），而且不報錯。
 *
 * 【為什麼是固定長度的池】與 `HUD_MAX_CONTACTS` 逐字同一條：每幀 new 一個
 * 陣列就是每幀一次配置。
 */
export const HUD_MAX_MARKERS = 200

export function createHudMarker(): HudMarker {
  return { active: false, x: 0, y: 0, behind: false, hostile: true }
}

/** 命中 X 標記的顯示時間，秒（spec §8）。 */
export const HIT_FLASH_SECONDS = 0.15

/**
 * 命中回饋計時器的下一個值。
 *
 * 【為什麼抽成純函數而不是寫在 main.ts 的迴圈裡】「期間再命中則重新計時」
 * 這條規則有實際行為（重置而不是累加、不會變成負數），而 main.ts 進不了
 * 單元測試。放在這裡才測得到。
 */
export function nextHitFlash(previous: number, hitsThisFrame: number, dt: number): number {
  if (hitsThisFrame > 0) return HIT_FLASH_SECONDS
  return Math.max(0, previous - dt)
}

export interface HudFrame {
  /** 真空速，m/s */
  tas: number
  /** 指示空速，m/s */
  ias: number
  /** IAS / vne。0.85 起操縱面變重、速度錶變黃；0.95 變紅。見 `redlineEffectiveness` */
  vneRatio: number
  mach: number
  /** m */
  altitude: number
  /** 升降率，m/s */
  verticalSpeed: number
  /** 航向，rad（0 = −Z 方向，順時針為正） */
  heading: number
  /** 滾轉角，rad（右滾為正） */
  roll: number
  /** 俯仰角，rad（上仰為正） */
  pitch: number
  loadFactor: number
  alpha: number
  alphaCrit: number
  /** 比超量功率，m/s */
  ps: number
  /** 比能量，m */
  es: number
  throttle: number
  powerW: number
  /**
   * 滑鼠準星位置，**單位為螢幕半高**。
   *
   * 瞄準點是世界方向而不是螢幕座標（見 input/InputState 的 aimWorld），
   * 所以這兩個值由 main.ts 投影而來，不是輸入層直接給的。相機跟著瞄準點
   * 走，因此正常情況下這兩個值都貼近 0。
   */
  aimX: number
  aimY: number
  aimVisible: boolean
  /** 機首方向投影至螢幕的正規化座標（NDC），visible 為 false 時位於背後 */
  noseX: number
  noseY: number
  noseVisible: boolean
  /**
   * 投彈落點在畫面上的位置，**NDC（−1…1）**，慣例同 `noseX` / `noseY`。
   *
   * 【為什麼不是恆在畫面中央】相機自動盯落點，所以解穩定時圓圈會回到中心；
   * 飛機一機動、速度一變、圓錐一夾制，視線的 LERP 就讓它漂開。那個分離量
   * 就是「投彈解還沒收斂」—— 與滑鼠準星／機首十字的分離量是同一個語言。
   */
  bombX: number
  bombY: number
  /** 落點在相機前方且投影落在畫面內 */
  bombVisible: boolean
  /**
   * `off` = 這一幀沒解落點（不是轟炸機，或在上帝視角）；`solved` = 有落點；
   * `none` = 90 秒內解不出來。
   *
   * 【沒有「被圓錐夾住」這一格】夾制不改變圓圈的正確性 —— 圈畫的恆是真
   * 落點，被夾住的是相機；而且夾制觸發時落點方向與相機軸差 0°，圈就在正
   * 中央。有後果的是圈滑出畫面，那由 `bombVisible` 管。
   */
  bombState: 'off' | 'solved' | 'none'
  /**
   * 在投彈模式（按 B）。**與 `bombState` 是兩件事** —— 落點在一般飛行時
   * 照樣解算，只是相機不去追它、圈用暗色、滑出畫面就不畫。
   */
  bombing: boolean
  /** 這一台掛得了東西。彈艙讀數的顯示條件 */
  bombCapable: boolean
  /**
   * 掛的是什麼。`null` = 這一台掛不了東西。
   *
   * 【它決定包絡與讀數的樣子】魚雷的投放包絡比炸彈嚴得多，而彈艙只有一格。
   */
  ordnance: OrdnanceKind | null
  /**
   * **這一幀投得出去嗎。** 準星的顏色看它：可投綠、不可投紅。
   *
   * 【為什麼是一個布林而不是「哪一條不過」】畫面上只有兩種顏色。要告訴
   * 玩家是坡度還是高度不對的話，那是另一個儀表的工作。
   */
  releaseOk: boolean
  /**
   * 這一幀 `canRelease` 吃的**那一個**包絡物件。`null` = 這一台掛不了東西。
   *
   * 【為什麼是物件而不是四個數字，也不是讓 widget 自己查】
   * `envelopeFor(kind)` 今天回的是依彈種分的模組常數，**每一台飛機共用同
   * 一份**。widget 自己呼叫它，拿到的是「HUD 沒寫死」，但拿不到「每台飛機
   * 不同」—— 哪天包絡變成逐機的，widget 還得再改一次。由 `main.ts` 把它
   * 實際用的那一個放進來，HUD 這一側就永遠不用動。
   *
   * 它是模組常數的參考，不是複本 —— 不配置。
   */
  releaseEnv: ReleaseEnvelope | null
  /**
   * 這一幀 `canRelease` 吃的**那一個**離地高度，m。
   *
   * 【為什麼不能用 `altitude`】那一格是 `renderPos.y`（海拔），而包絡吃的是
   * `renderPos.y − collisionHeightAt(x, z)`。海上兩者相同，飛過島上空就分家
   * —— 症狀是投放閘門與高度弧說可以投，而扳機沒有反應。
   */
  releaseAgl: number
  /**
   * 魚雷航跡線的取樣點，**NDC**，慣例同 `bombX` / `bombY`。
   * 第 0 點是入水點（＝落點圈的圓心），最後一點是射程末端。
   *
   * 【固定長度、預先配置】每幀生一個陣列就是每幀一次配置 —— 與 `contacts`
   * ／`markers` 逐字同一個做法。**長度恆為 `TORPEDO_RUN_SAMPLES`。**
   */
  runX: Float64Array
  runY: Float64Array
  /**
   * 從第 0 點起**連續**落在相機前方的點數。`< 2` = 不畫。
   *
   * 【為什麼是「連續」而不是「總數」】相機後面的點投影出來是穿過中心鏡射
   * 的 —— 它落在畫面上、方向剛好相反，canvas 再乾乾淨淨把它裁到邊緣。
   * 只數總數的話會畫出一條線條漂亮、方向錯 180° 的瞄準線。
   *
   * 【落點在陸地時也是 0】`bombState === 'solved'` 不代表落在水上，而真雷
   * 遇到陸地是立刻結束、根本沒有水中段。判準在 `main.ts`（與 `stepAir`
   * 同一條）。
   */
  runCount: number
  /** 這一台的滿艙是幾枚。**讀數畫幾格就看它** */
  bombBayCapacity: number
  /** 彈艙裡還剩幾枚 */
  bombLoad: number
  /**
   * 正在回補。
   *
   * 【為什麼一定要畫出來】彈艙空了之後扳機沒有反應。看不到「正在補彈」的話，
   * 那與「壞了」在畫面上是同一件事 —— 而玩家會當成後者。
   */
  bombReloading: boolean
  /** 補完還要幾秒。`bombReloading` 為 false 時為 0 */
  bombReloadLeft: number
  /**
   * 這一場有沒有戰場邊界。**遭遇戰有，任務卡沒有** —— 撤離點在 −20 km、
   * 護航的集合點 12 km，兩者都在界外。沒有這一格的話，任務裡飛去撤離點會
   * 一路閃警告。
   */
  arenaShow: boolean
  /** 這一刻在界外嗎 */
  arenaOutside: boolean
  /** 還剩幾秒 */
  arenaRemaining: number
  /** 世界平面座標，供小地圖使用 */
  worldX: number
  worldZ: number
  aircraftName: string
  /** 接觸點池。只有前 contactCount 格有效 */
  contacts: HudContact[]
  contactCount: number
  /** 標記池（彈、雷、船）。只有前 markerCount 格有效 */
  markers: HudMarker[]
  markerCount: number
  /** 命中回饋的剩餘秒數。> 0 時機首十字周圍畫 X（spec §8：0.15 s） */
  hitFlash: number
  /**
   * 受擊方向痕跡。`main.ts` 推入與步進，widget 只讀。
   *
   * 【為什麼與 `hitFlash` 分開】那個是**我打中人**（讀 `player.hitsDealt`），
   * 方向相反 —— 沿用它就是把兩個相反的意思塞進同一個數字
   * （受擊方向指示器 spec §1）。
   */
  damageMarks: DamageMark[]
  /**
   * 自機血量與上限。
   *
   * 【為什麼只顯示自機、不顯示敵機】M2 §8：你看不出對方的
   * 結構完整度，那在二戰題材上說不通。自機則不同——你感覺得到自己的
   * 飛機被打成什麼樣。
   */
  hp: number
  hpMax: number
  /**
   * 低速舵面效力，0..1。< 1 時 HUD 顯示 `LOW SPEED`。
   *
   * 由 `StepDiagnostics.controlAuthority` 抄過來——物理與畫面共用同一份
   * 數字，不會出現第二套會漂掉的判斷邏輯。
   */
  controlAuthority: number
  /** 自機是否交給 AI 駕駛（`I`）。純觀測模式的指示燈 */
  aiFlying: boolean
  /**
   * 代飛時 AI 當下的意圖／轉向模式／戰術相位。**只在 `aiFlying` 時有意義。**
   *
   * 【為什麼要顯示在畫面上】人工驗收看得到飛機在做什麼，看不到 AI **以為**
   * 自己在做什麼。少了這三個字，「它抬頭又低頭」這種回報沒辦法對回任何一條
   * 規則 —— 只能靠無頭探針重跑一次去猜是哪一段。這三個欄位就是把探針看得到
   * 的東西搬到座艙裡。
   */
  aiIntent: string
  aiMode: string
  aiPhase: string
  /**
   * 意圖是 `extend` 時，**是哪一個閂鎖把它推過去的**：能量／迴旋／見底。
   * 其餘意圖時是空字串。
   *
   * 【為什麼要分到這個細度】三個理由要修的東西完全不同 ——「比他弱」是相對
   * 的戰術判斷、「轉不贏他」是機體，「我飛不動了」是絕對的自保。人工回報
   * 「它又直直飛了」在畫面上長得一模一樣，但那三種各自對應到不同的一段程式。
   * 這一格是把「只有人看得到的現象」接上「只有程式知道的成因」的唯一途徑。
   */
  aiExtendWhy: string
  /**
   * 是否在上帝視角（`G`）。
   *
   * 為真時 `worldX` / `worldZ` / `heading` 填的是**鏡頭**的，不是自機的 ——
   * 小地圖因此一行都不用改就變成以鏡頭為中心。
   */
  godView: boolean
  /**
   * 雙方存活架數。
   *
   * 【為什麼顯示數量而不顯示各機血量】與 §8 一致：你看不出對方的
   * 結構完整度。但「還有幾架在天上」是看得出來的 —— 那是一個真實可觀察
   * 的量。
   */
  blueAlive: number
  redAlive: number
  /** 玩家分隊還活著幾架（含玩家自己）。0 = 玩家已退場 */
  flightAlive: number
  /** 玩家分隊的編制員額。`flightAlive` 的分母 */
  flightSize: number
  /**
   * 這一場有沒有任務目標。false 時**下面整組欄位無意義**。
   *
   * 【為什麼不由 `rules` 推導】遭遇戰與殲滅任務的 `rules` **完全相同**
   * （任務框架 spec §5），差別只在「這一場是不是從任務列表進來的」——
   * 那是畫面模式，不是規則。所以由 `main.ts` 給。
   */
  objectiveActive: boolean
  /**
   * 目標文字，例如「飛抵撤離點」。
   *
   * 【逐幀指派同一個字串參考，不組字串】它是 `MissionCard.objective` 這個
   * 常數 —— 組字串的是 widget，而 widget 走畫面頻率不是物理步。
   */
  objectiveText: string
  /**
   * 進場橫幅的文字：卡片上那一句好懂的短句（沒有就是 `objectiveText`）。
   * 目標文字改變的那一刻放大到畫面中央，打字機印出、停一下、再滑進目標列。
   */
  objectiveBanner: string
  /** 橫幅出現到現在幾秒；−1 = 沒有橫幅。時序見 `widgets/objective.ts` */
  objectiveBannerAge: number
  /** 計量。殲滅＝剩餘敵機數，撤離與護送＝到終點的距離 m */
  objectiveMetric: number
  /** 計量的種類，決定 widget 怎麼格式化。`percent` 是 0～1 的比例 */
  objectiveMetricKind: 'count' | 'distance' | 'percent'
  /** 計量的分母。**−1 = 沒有分母**，就印裸數字。擊沉印成 `(已沉/總數)` */
  objectiveMetricTotal: number
  /**
   * **第二個**計量：護送／攔截還剩幾架。**−1 = 不畫**（其餘每一種任務）。
   *
   * 【為什麼護送要兩個數字】它們回答兩個不同的問題：距離說「還要撐多久」，
   * 架數說「還剩多少籌碼」。護送的敗北條件是全部被擊落 —— 那件事在距離上
   * 完全看不出來，所以兩個都畫。
   */
  objectiveRemaining: number
  /** 護送已經送到幾架。**−1 = 這一關沒有門檻**，目標列不畫進度 */
  objectiveArrived: number
  /** 護送的門檻，進度的分母。只在 `objectiveArrived ≥ 0` 時讀 */
  objectiveNeed: number
  /** 剩餘秒數。`Infinity` 時不畫倒數 */
  objectiveSeconds: number
  /** 撤離點的世界平面座標，供小地圖。false 時下面兩格無意義 */
  objectiveHasTarget: boolean
  objectiveWorldX: number
  objectiveWorldZ: number
  /**
   * 畫面中心的訊息。空字串 = 不畫。
   *
   * 【單一訊息槽，不排隊】節拍的預警是「現在馬上要發生的事」。排隊的話，
   * 第二則會等第一則播完才出現 —— 那時它講的事早就發生了。後來者覆蓋。
   *
   * 【逐幀由 `main.ts` 依 `Battle.messageUntil` 決定要不要給】過期與否是
   * **物理時間**的問題（與倒數同一套），widget 不持有任何計時狀態。
   */
  message: string
  /** 訊息出現到現在幾秒，打字機用；−1 = 整句直接印 */
  messageAge: number
}

export function createHudFrame(): HudFrame {
  return {
    tas: 0, ias: 0, vneRatio: 0, mach: 0, altitude: 0, verticalSpeed: 0,
    heading: 0, roll: 0, pitch: 0,
    loadFactor: 1, alpha: 0, alphaCrit: 1,
    ps: 0, es: 0, throttle: 0, powerW: 0,
    aimX: 0, aimY: 0, aimVisible: true,
    noseX: 0, noseY: 0, noseVisible: true,
    bombX: 0, bombY: 0, bombVisible: false, bombState: 'off',
    bombing: false, bombCapable: false, ordnance: null, releaseOk: false,
    releaseEnv: null, releaseAgl: 0,
    runX: new Float64Array(TORPEDO_RUN_SAMPLES),
    runY: new Float64Array(TORPEDO_RUN_SAMPLES),
    runCount: 0,
    bombBayCapacity: 0,
    bombLoad: 0, bombReloading: false, bombReloadLeft: 0,
    worldX: 0, worldZ: 0, aircraftName: '',
    contacts: Array.from({ length: HUD_MAX_CONTACTS }, createHudContact),
    contactCount: 0,
    markers: Array.from({ length: HUD_MAX_MARKERS }, createHudMarker),
    markerCount: 0,
    hitFlash: 0,
    damageMarks: createDamageMarks(),
    hp: 1000, hpMax: 1000,
    aiFlying: false,
    aiIntent: '',
    aiMode: '',
    aiPhase: '',
    aiExtendWhy: '',
    godView: false,
    arenaShow: false,
    arenaOutside: false,
    arenaRemaining: ARENA_COUNTDOWN,
    controlAuthority: 1,
    blueAlive: 0, redAlive: 0, flightAlive: 0, flightSize: 0,
    objectiveActive: false,
    objectiveText: '',
    objectiveBanner: '',
    objectiveBannerAge: -1,
    objectiveMetric: 0,
    objectiveMetricKind: 'count',
    objectiveMetricTotal: -1,
    objectiveRemaining: -1,
    objectiveArrived: -1,
    objectiveNeed: -1,
    // 【為什麼是 0 而不是 Infinity】既有護欄「初始值不含 NaN」實際斷言的是
    // `Number.isFinite`（`test/unit/hud.test.ts:71-78`），而 `Infinity` 過不了。
    // 重新定值那條護欄是負責人的決定。
    //
    // 這個 0 不會被看見：`objectiveActive` 預設 false，整組欄位不畫；任務模式
    // 下 `main.ts` 每一幀從 `MissionState.secondsLeft` 抄真值進來 —— **執行期
    // 這一格確實會是 `Infinity`**（無時限的任務），`formatCountdown` 為此
    // 回空字串。護欄管的只有開局那一格。
    objectiveSeconds: 0,
    objectiveHasTarget: false,
    objectiveWorldX: 0,
    objectiveWorldZ: 0,
    message: '',
    messageAge: -1,
  }
}

/** 指示空速 = 真空速 × √(密度比)。 */
export function indicatedAirspeed(tas: number, sigma: number): number {
  return tas * Math.sqrt(Math.max(sigma, 0))
}

export interface HudLayout {
  width: number
  height: number
  cx: number
  cy: number
  /** 螢幕半高，準星座標的單位長度 */
  unit: number
  scale: number
}

export const HUD_COLORS = {
  primary: '#7dfba8',
  dim: 'rgba(125, 251, 168, 0.45)',
  warn: '#ffcc44',
  danger: '#ff5a4d',
  friendly: '#5aa9ff',
  panel: 'rgba(0, 0, 0, 0.35)',
} as const

/**
 * 一個接觸點該用什麼顏色。敵紅、友藍、**自己分隊的同伴用第三個顏色**。
 *
 * 【為什麼住在 types.ts 而不是某個 widget 裡】目標框（`contacts.ts`）與
 * 小地圖（`minimap.ts`）都要用它。留在其中一邊就會變成另一邊自己寫一份
 * `c.hostile ? danger : friendly` —— 而那正是 M6 改色時踩到的：目標框
 * 改了，小地圖沒改。
 *
 * 抽成純函數則是因為繪製函數進不了單元測試，而「哪一架該長得不一樣」是
 * 一條有實際行為的規則 —— 與 `minimapSymbol`、`edgeIndicatorPosition`
 * 是同一個做法。
 */
export function contactColor(hostile: boolean, flightMate: boolean): string {
  if (hostile) return HUD_COLORS.danger
  return flightMate ? HUD_COLORS.warn : HUD_COLORS.friendly
}

/** 目標框在螢幕上的最小／最大半徑，px（**未乘 scale**）。 */
const BOX_MIN = 9
const BOX_MAX = 46

/**
 * 一個接觸點的框半徑，CSS px。
 *
 * 【為什麼住在 types.ts 而不是某個 widget 裡】座艙的目標框（`contacts.ts`）
 * 與上帝視角的分隊標示（`godMarkers.ts`）都要用同一把尺。留在其中一邊就會
 * 變成另一邊自己寫一份 —— 與 `contactColor` 搬來這裡是同一條理由，而那條
 * 註解記的正是 M6 改色時踩到的：目標框改了，小地圖沒改。
 *
 * 【夾制的上下界要先乘 scale 再夾】`radius * unit` 已經是 CSS px，若把夾完
 * 的結果再乘一次 scale，動態尺寸會被二次縮放，而固定的上下界卻只縮放一次
 * —— 兩者在不同視窗高度下對不起來。
 */
export function contactBoxRadius(radius: number, unit: number, scale: number): number {
  return Math.max(BOX_MIN * scale, Math.min(BOX_MAX * scale, radius * unit))
}

/** HUD 統一字型。字級由呼叫端乘上 L.scale。 */
export function hudFont(px: number, bold = false): string {
  return `${bold ? 'bold ' : ''}${px}px ui-monospace, Consolas, monospace`
}
