/**
 * 開局的擺法。**一張表，不是一個列舉。**
 *
 * 【為什麼是資料而不是分支】專案負責人 2026-08-16：「任務的擺位不一定只有
 * 對頭 OR 追我，應該要把擺位、面向、初始狀態都寫成陣列，讓每個任務有不同
 * 的擺法。」初版寫成 `'headOn' | 'pursuit'` 的聯集，那是把「這一輪只需要
 * 兩種」誤當成「結構上只有兩種」。
 *
 * 加一種擺法 = 這張表多一個字面值。不必動 `createBattle` 一個字。
 */

/**
 * 一隊的開局擺法。
 *
 * 【為什麼是係數而不是絕對座標】`entryRange` 與 `lateralOffset` 是
 * `BattleConfig` 的欄位，而 `stall-loop.probe.ts`、`turn-shrink.probe.ts`、
 * `ai-command-decision.test.ts` 都靠覆寫它們來換場景。擺法若寫死絕對座標，
 * 那些覆寫會**靜靜失效** —— 探針照跑、數字照印，只是量的不是它宣稱的東西。
 *
 * 所以沿用同一套慣例：`along` / `across` 是那兩個尺標的倍數，
 * `gap` / `climb` 才是絕對公尺（它們沒有對應的尺標）。
 */
export interface SideEntry {
  /**
   * 沿 Z 的位置，以 `entryRange` 為單位。
   *
   * 【正負的意思】藍隊機首朝 −Z，所以 **+0.5 = 藍隊那一側**、−0.5 = 敵方那一側。
   */
  along: number
  /** 橫向位置，以 `lateralOffset` 為單位 */
  across: number
  /**
   * 沿 Z 的**額外**偏移，m。正 = 更靠藍隊那一側（也就是更後方）。
   *
   * 【為什麼要與 `along` 分開】追擊的「後方 800 m」是一個絕對距離 ——
   * 它由機槍的有效射程決定（匯聚點 300 m），與兩隊的開局間距無關。
   * 折進 `along` 的話它會跟著 `entryRange` 一起被縮放。
   */
  gap: number
  /** 相對 `BattleConfig.altitude` 的高度加成，m */
  climb: number
  /** 機首朝向，rad（繞 Y）。**0 = 朝 −Z** */
  heading: number
  /** 相對 `BattleConfig.tas` 的空速倍率 */
  speed: number
}

export interface EntryPlan {
  /** 給日誌與測試用。與 `ENTRY_PLANS` 的鍵相同 */
  readonly id: string
  readonly blue: SideEntry
  readonly red: SideEntry
}

/** 沒有偏移、朝 −Z、標稱速度。每一種擺法從它展開，只寫真的不一樣的那幾格 */
const NEUTRAL: SideEntry = { along: 0, across: 0, gap: 0, climb: 0, heading: 0, speed: 1 }

/**
 * 對頭。**M5 以來的既有排列，全部既有護欄都建立在它上面。**
 *
 * 藍隊在 +Z 朝 −Z、紅隊在 −Z 朝 +Z，兩隊橫向對稱錯開 —— 錯開是為了解
 * 匯聚問題（M5 實測：兩隊正對時 300 m 的匯聚點讓一邊有效命中率 97%、
 * 另一邊 34%），推導見 `BattleConfig.lateralOffset`。
 *
 * **這一份的數字一個都不能動。** 動了等於同時移動 `ai-command-channel`、
 * `ai-withdraw-anchor`、`multi-battle`、`ai-targeting` 的全部基準。
 */
export const HEAD_ON: EntryPlan = {
  id: 'headOn',
  blue: { ...NEUTRAL, along: 0.5, across: -0.5 },
  red: { ...NEUTRAL, along: -0.5, across: 0.5, heading: Math.PI },
}

/**
 * 追擊：敵機在**正後方、而且比較高**，兩隊同向。
 *
 * 【專案負責人 2026-08-16 指定】撤離任務直飛就過關（任務框架 spec §8.6），
 * 成因是對頭交錯之後追兵得反轉再追，而玩家開的又是全場最快的東西。從身後
 * 撲下來，追兵**開局就在射擊位置的方向上**。
 *
 * 【800 m 後方】機槍的有效距離在 600 m 以內（匯聚點 300 m、
 * `DEFAULT_FIRE.minRange` 60 m）。
 *
 * 【+1,000 m 高】高度就是能量：1,000 m 的位能理想俯衝可換約 140 m/s
 * （`√(2gh)`），那是慢的飛機追得上快的飛機的唯一辦法。
 *
 * 【合起來】開局斜距 `√(800² + 1000²) = 1,281 m`，在射程之外 ——
 * 他們**必須俯衝加速才咬得到你**。
 *
 * 【橫向歸零】`lateralOffset` 是為了解**對頭**的匯聚問題。追擊沒有對頭，
 * 而 1,500 m 的橫向錯開會把「後方 800 m」變成「側後方 62°」—— 那不是被咬，
 * 是並排飛。
 *
 * 【藍隊的位置一個字都不動】撤離的時限是由「直飛到撤離點要多久」推出來的
 * （`missions.ts` 的 `EVAC_STRAIGHT_*`）。動了藍隊的出生點，那兩個數字就要
 * 重新量。
 *
 * **這三個數字是專案負責人指定的起始值，由試飛裁定。**
 */
export const PURSUIT: EntryPlan = {
  id: 'pursuit',
  blue: { ...NEUTRAL, along: 0.5 },
  red: { ...NEUTRAL, along: 0.5, gap: 800, climb: 1000 },
}

/**
 * 全部的擺法。**每一張任務卡指定一個鍵。**
 *
 * 加一種擺法：這裡多一個字面值，卡片改一個字串。`createBattle` 不用動。
 */
export const ENTRY_PLANS = {
  headOn: HEAD_ON,
  pursuit: PURSUIT,
} as const

export type EntryPlanId = keyof typeof ENTRY_PLANS
