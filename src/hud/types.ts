import { createDamageMarks, type DamageMark } from './damageMarks'

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
  /** 世界平面座標，供小地圖使用 */
  worldX: number
  worldZ: number
  aircraftName: string
  /** 接觸點池。只有前 contactCount 格有效 */
  contacts: HudContact[]
  contactCount: number
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
   * 【為什麼只顯示自機、不顯示敵機】M2 §8 的裁決不變：你看不出對方的
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
   * 是否在上帝視角（`G`）。
   *
   * 為真時 `worldX` / `worldZ` / `heading` 填的是**鏡頭**的，不是自機的 ——
   * 小地圖因此一行都不用改就變成以鏡頭為中心。
   */
  godView: boolean
  /**
   * 雙方存活架數。
   *
   * 【為什麼顯示數量而不顯示各機血量】與 §8 的裁決一致：你看不出對方的
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
  /** 計量。殲滅＝剩餘敵機數，撤離與護送＝到終點的距離 m */
  objectiveMetric: number
  /** 計量的種類，決定 widget 怎麼格式化 */
  objectiveMetricKind: 'count' | 'distance'
  /**
   * **第二個**計量：護送／攔截還剩幾架。**−1 = 不畫**（其餘每一種任務）。
   *
   * 【為什麼護送要兩個數字】它們回答兩個不同的問題：距離說「還要撐多久」，
   * 架數說「還剩多少籌碼」。護送的敗北條件是全部被擊落 —— 那件事在距離上
   * 完全看不出來。專案負責人 2026-08-21 裁定兩個都顯示。
   */
  objectiveRemaining: number
  /** 剩餘秒數。`Infinity` 時不畫倒數 */
  objectiveSeconds: number
  /** 撤離點的世界平面座標，供小地圖。false 時下面兩格無意義 */
  objectiveHasTarget: boolean
  objectiveWorldX: number
  objectiveWorldZ: number
}

export function createHudFrame(): HudFrame {
  return {
    tas: 0, ias: 0, mach: 0, altitude: 0, verticalSpeed: 0,
    heading: 0, roll: 0, pitch: 0,
    loadFactor: 1, alpha: 0, alphaCrit: 1,
    ps: 0, es: 0, throttle: 0, powerW: 0,
    aimX: 0, aimY: 0, aimVisible: true,
    noseX: 0, noseY: 0, noseVisible: true,
    worldX: 0, worldZ: 0, aircraftName: '',
    contacts: Array.from({ length: HUD_MAX_CONTACTS }, createHudContact),
    contactCount: 0,
    hitFlash: 0,
    damageMarks: createDamageMarks(),
    hp: 1000, hpMax: 1000,
    aiFlying: false,
    aiIntent: '',
    aiMode: '',
    aiPhase: '',
    godView: false,
    controlAuthority: 1,
    blueAlive: 0, redAlive: 0, flightAlive: 0, flightSize: 0,
    objectiveActive: false,
    objectiveText: '',
    objectiveMetric: 0,
    objectiveMetricKind: 'count',
    objectiveRemaining: -1,
    // 【為什麼是 0 而不是 Infinity】既有護欄「初始值不含 NaN」實際斷言的是
    // `Number.isFinite`（`test/unit/hud.test.ts:71-78`），而 `Infinity` 過不了。
    // 那條護欄不歸這一輪動。
    //
    // 這個 0 不會被看見：`objectiveActive` 預設 false，整組欄位不畫；任務模式
    // 下 `main.ts` 每一幀從 `MissionState.secondsLeft` 抄真值進來 —— **執行期
    // 這一格確實會是 `Infinity`**（無時限的任務），`formatCountdown` 為此
    // 回空字串。護欄管的只有開局那一格。
    objectiveSeconds: 0,
    objectiveHasTarget: false,
    objectiveWorldX: 0,
    objectiveWorldZ: 0,
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
