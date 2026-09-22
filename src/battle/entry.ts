/**
 * 開局的擺法。**一張表，不是一個列舉。**
 *
 * 【為什麼是資料而不是分支】任務的擺位不只有對頭與追我兩種，擺位、面向、
 * 初始狀態都要能逐關給。寫成 `'headOn' | 'pursuit'` 那種聯集，是把「目前
 * 只需要兩種」誤當成「結構上只有兩種」。
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
 * 追擊：敵機**咬在六點鐘**，兩隊同向。
 *
 * 【為什麼有這一種】對頭開局的撤離任務直飛就過關（任務框架 spec §8.6）：
 * 交錯之後追兵得反轉再追，而玩家開的又是全場最快的東西。所以敵機放身後。
 *
 * ── 【高度差不可以給太多】────────────────────────────────
 *
 * 後方 800 m、高 1,000 m 那一組**根本追不到**。
 *
 * 成因是那 1,000 m 高度差：斜距 `√(800² + 1000²) = 1,281 m` 幾乎全被**高度**
 * 吃掉（俯角 51°），追兵開場在**俯衝**而不是在**接近**，而玩家同時在平飛
 * 加速跑掉。等他們把高度換成速度，橫向距離已經拉開了。
 *
 * 「高度就是能量」沒有錯，錯的是**在這個場景裡能量不是瓶頸，位置才是** ——
 * 追不上的原因不是他們沒力氣，是他們一開始就不在後面。
 *
 * ── 【所以是後方 400 m、高 200 m】──────────────────────────
 *
 * ```
 *   斜距 √(400² + 200²) = 447 m   ← 進得了槍（匯聚點 300 m）
 *   俯角 atan(200/400)  = 26.6°   ← 大致在六點鐘，不是在頭頂
 * ```
 *
 * **設計意圖不是讓他們「追上來」，是讓他們開局就已經在射擊位置上**。玩家
 * 必須閃，而閃就是掉速度、掉速度就是掉時間 —— 壓力來自倒數，不是來自被
 * 追上。跑掉本來就是撤離該有的結局。
 *
 * 【高度只留 200 m】足以讓他們有一點位能（≈63 m/s）與俯視角，又不會大到
 * 讓開場變成一段俯衝。
 *
 * 【要再調的話】兩個數字的效果：
 *
 * ```
 *   gap 小 → 一開局就在挨打；gap 大 → 有喘息但可能永遠咬不到
 *   climb 大 → 俯角大、開場變俯衝；climb 小 → 更像純粹的尾追
 * ```
 *
 * ── 【兩個不動的東西】──────────────────────────────────────
 *
 * 【橫向歸零】`lateralOffset` 是為了解**對頭**的匯聚問題。追擊沒有對頭，
 * 而 1,500 m 的橫向錯開會把「後方 400 m」變成「側後方 75°」—— 那不是被咬，
 * 是並排飛。
 *
 * 【藍隊的位置一個字都不動】撤離的時限是由「直飛到撤離點要多久」推出來的
 * （`missions.ts` 的 `EVAC_STRAIGHT_*`）。動了藍隊的出生點，那兩個數字就要
 * 重新量。
 *
 * **這兩個數字仍然是起始值，由試飛裁定。**
 */
export const PURSUIT: EntryPlan = {
  id: 'pursuit',
  blue: { ...NEUTRAL, along: 0.5 },
  red: { ...NEUTRAL, along: 0.5, gap: 400, climb: 200 },
}

/**
 * 高度劣勢的對頭：擺位與 `HEAD_ON` 相同，紅隊高 1,000 m。
 *
 * 斜距的大部分是高度，紅隊開場就能俯衝換速度 —— `PURSUIT` 註解裡要避開的
 * 那個效果，這裡正是要它，只是方向反過來。
 *
 * 藍隊一格都不動：高度差只加在紅隊，任務的 `altitude` 仍然是玩家開場的
 * 高度。**1,000 m 是起始值，由試飛裁定。**
 */
export const BOUNCE: EntryPlan = {
  id: 'bounce',
  blue: { ...NEUTRAL, along: 0.5, across: -0.5 },
  red: { ...NEUTRAL, along: -0.5, across: 0.5, heading: Math.PI, climb: 1000 },
}

/**
 * 護住艦隊：擺位與 `HEAD_ON` 相同，但藍隊貼在艦隊上空、低空待命。
 *
 * 【為什麼藍隊要靠過去】被守的是原點的艦隊，不是藍隊自己。開局擺在 5 km
 * 外的話，掛彈的敵機投完彈玩家才趕到 —— 攔截這件事在那之前就結束了。
 *
 * 【低空】貼海的雷擊機走 150 m，從 2,000 m 追下去要花掉整段接敵時間。
 * `climb` 是相對任務高度的加成，所以這一格跟著任務高度走。
 *
 * 紅隊一格都不動。**兩個數字都是起始值，由試飛裁定。**
 */
export const CARRIER_GUARD: EntryPlan = {
  id: 'carrierGuard',
  blue: { ...NEUTRAL, along: 0.15, across: -0.5, climb: -1500 },
  red: { ...NEUTRAL, along: -0.5, across: 0.5, heading: Math.PI },
}

/**
 * 全部的擺法。**每一張任務卡指定一個鍵。**
 *
 * 加一種擺法：這裡多一個字面值，卡片改一個字串。`createBattle` 不用動。
 */
export const ENTRY_PLANS = {
  headOn: HEAD_ON,
  pursuit: PURSUIT,
  bounce: BOUNCE,
  carrierGuard: CARRIER_GUARD,
} as const

export type EntryPlanId = keyof typeof ENTRY_PLANS
