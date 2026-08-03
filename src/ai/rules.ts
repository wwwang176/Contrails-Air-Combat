import type { Situation } from './assess'

export type Intent = 'defend' | 'merge' | 'extend' | 'engage' | 'approach'

export const INTENTS: readonly Intent[] = ['defend', 'merge', 'extend', 'engage', 'approach']

/**
 * 遲滯閂鎖。**方向由 enter 與 exit 的大小關係推得**：
 *
 *   enter > exit  →「高於 enter 才觸發、低於 exit 才解除」
 *   enter < exit  →「低於 enter 才觸發、高於 exit 才解除」
 *
 * 【為什麼要遲滯】沒有它，述詞在門檻附近抖動時 AI 會一秒切換數十次，
 * 飛機看起來像在抽搐。M1 的前緣縫翼用的是同一招（展開與收回兩個不同的
 * 迎角 + 一個布林閂鎖）。
 *
 * 【為什麼不寫成兩個函數】兩個函數就有兩個要記住的名字，而呼叫端每次都
 * 要想「這個述詞是高於觸發還是低於觸發」。從門檻的大小關係推導，等於讓
 * 資料自己說明方向；寫錯的話兩個門檻會長得很怪，一眼看得出來。
 */
export function latch(active: boolean, value: number, enter: number, exit: number): boolean {
  if (enter > exit) return active ? value > exit : value > enter
  return active ? value < exit : value < enter
}

export interface RuleConfig {
  /** defend：威脅評分的進入／離開門檻 */
  threatEnter: number
  threatExit: number
  /** merge：對頭匯合的 timeToMerge 上限，s */
  mergeTime: number
  /** merge：雙方機首互指的角度上限，rad */
  mergeAspect: number
  /** extend：能量差的進入／離開門檻，m */
  energyEnter: number
  energyExit: number
  /**
   * extend：**機體**轉彎劣勢的進入／離開門檻，rad/s。**負值。**
   * 判的是 `airframeTurnAdvantage`，不是 `turnAdvantage`。
   *
   * 【數值怎麼來的】4,000 m 的最佳持續轉彎率約 0.23 rad/s（13°/s）。取它的
   * 一成當作「這台飛機真的轉不贏他」的界線 —— 0.023，向下取整到 0.02
   * （1.15°/s），離開門檻取一半。
   *
   * 【對目前兩台等於休眠，這是預期中的】實測 P-51 與 Bf 109 的最佳持續轉彎率
   * 只差 −0.006 ~ +0.017 rad/s（±2%），一律低於門檻。這兩台本來就旗鼓相當，
   * 「因為轉不贏而放棄纏鬥」不該對它們成立。門檻是為了**日後加的機種**而存在
   * —— 若某天加進一台真的轉贏一截的飛機，AI 會自動用對的標準判斷。
   */
  turnEnter: number
  turnExit: number
  /**
   * extend：**絕對**能量底線的進入／離開門檻，m。判的是 `energyReserve`
   * （比能量減去還打得動的最低比能量），所以 0 就是「剛好見底」。
   *
   * 【為什麼進入是 0】底線本身已經由 `ENERGY_FLOOR_ALTITUDE` 的推導定義好了，
   * 這裡不需要第二個任意數字。離開取 +300 m 是遲滯：跨回底線就馬上重新投入
   * 會在門檻附近抖，而 300 m 的比能量大約是一次淺俯衝或幾秒 WEP 爬升
   * ——「真的補回一點東西了」的最小量。
   */
  floorEnter: number
  floorExit: number
  /** extend：拉開超過這個距離就結束脫離，m */
  extendRange: number
  /** engage：timeToMerge 的進入／離開門檻，s */
  engageTimeEnter: number
  engageTimeExit: number
  /** 意圖切換後的最小停留時間，s。defend 不受此限 */
  minDwell: number
}

/**
 * **全部都是起始值，待 Task 14 由對戰矩陣量測後回填。**
 *
 * 這與 M2 的做法一致：命中盒座標與 L4 曲率界都是先跑再定，不接受
 * 「配一個看起來合理的數字」。
 */
export const DEFAULT_RULES: RuleConfig = {
  threatEnter: 0.35,
  threatExit: 0.15,
  mergeTime: 2.5,
  mergeAspect: 30 * (Math.PI / 180),
  energyEnter: -300,
  energyExit: 100,
  turnEnter: -0.02,
  turnExit: -0.01,
  floorEnter: 0,
  floorExit: 300,
  extendRange: 1500,
  engageTimeEnter: 8,
  engageTimeExit: 12,
  minDwell: 0.8,
}

export interface RuleState {
  intent: Intent
  /** 目前意圖已維持的秒數 */
  dwell: number
  defendLatch: boolean
  /** 能量劣勢的閂鎖。與轉彎劣勢分開，見 `stepRules` 的註解 */
  extendEnergyLatch: boolean
  /** 轉彎率劣勢的閂鎖 */
  extendTurnLatch: boolean
  /** 絕對能量見底的閂鎖 */
  extendFloorLatch: boolean
  /** 上面兩者的或。**由 `stepRules` 寫入，不要回寫** */
  extendLatch: boolean
  engageLatch: boolean
}

export function createRuleState(): RuleState {
  return {
    intent: 'approach',
    // 【為什麼是 Infinity 而不是 0】`dwell` 量的是「現在這個意圖已經穩定
    // 多久」，最小停留時間拿它決定能不能換。剛出生的 AI 並沒有「剛剛才
    // 切到 approach」——approach 只是還沒做出任何決定時的預設值。設成 0
    // 會讓它在重生後的第一個 minDwell 秒內無法離開 approach，也就是無論
    // 態勢多危急都得先直直飛 0.8 秒。
    dwell: Infinity,
    defendLatch: false,
    extendEnergyLatch: false, extendTurnLatch: false, extendFloorLatch: false,
    extendLatch: false,
    engageLatch: false,
  }
}

/**
 * 優先序仲裁：由上而下，**第一個成立的就採用**。
 *
 * @param threat 已乘上持續跟蹤權重的威脅值（見計畫的偏離 2）。
 *               `sit.threatInstant` 只是瞬時值，不要直接傳它。
 *
 * 【為什麼是優先序而不是狀態機】五個狀態的狀態機最多有 20 條轉換要維護，
 * 而且很容易漏掉某個組合（例如忘了寫「求生怎麼回到纏鬥」，AI 就會永遠
 * 卡在拉升）。優先序只有五條規則，而且「安全永遠第一」是**排在最上面**
 * 這件事本身保證的，不是另外一條規則。
 */
export function stepRules(
  s: RuleState,
  sit: Situation,
  threat: number,
  dt: number,
  cfg: RuleConfig = DEFAULT_RULES,
): Intent {
  s.dwell += dt

  // 【三個閂鎖每一步都要更新，即使最後沒選到它】否則閂鎖會停在切換前的
  // 舊值，下次輪到它時反應會慢一整個週期——而且那個延遲只在特定的意圖
  // 順序下出現，極難重現。
  s.defendLatch = latch(s.defendLatch, threat, cfg.threatEnter, cfg.threatExit)

  // 【能量與轉彎是兩個獨立的閂鎖，不能 OR 進同一個】原本寫成
  //
  //   s.extendLatch = latch(s.extendLatch, energyAdvantage, −300, 100) || turnAdvantage < 0
  //
  // `||` 的結果被寫回閂鎖**自己的記憶**，於是遲滯被毒化：只要有任何一格
  // `turnAdvantage < 0`，下一格 `latch(active = true, …)` 走的就是維持條件
  // `energyAdvantage < 100` —— 勢均力敵時那幾乎恆真，閂鎖再也關不掉。
  //
  // 人工驗收實測：正面對頭時 `turnAdvantage` 曾短暫落到 −0.005 rad/s
  // （0.29°/s，戰術上毫無意義），就足以讓 AI 在距離跌破 `extendRange` 時
  // 轉為脫離 —— 而當下 `turnAdvantage` 早已回到 +0.007。
  //
  // 分成兩個閂鎖之後，各自維護各自的遲滯，OR 只發生在讀取端。
  s.extendEnergyLatch = latch(
    s.extendEnergyLatch, sit.energyAdvantage, cfg.energyEnter, cfg.energyExit,
  )
  // 【判機體不判當下】`turnAdvantage` 被速度差主導：對手拉桿掉速——那正是
  // 他快撐不住的訊號——會讓它讀出「他轉得比我好」。投入／退出的決定要問
  // 「這場迴旋戰打到最後誰贏」，那由機體決定（見 Situation 的欄位註解）。
  s.extendTurnLatch = latch(
    s.extendTurnLatch, sit.airframeTurnAdvantage, cfg.turnEnter, cfg.turnExit,
  )
  // 【第三個理由是絕對的】上面兩個都是「跟他比」，兩台一起磨下去時都看不見。
  // 這一個問「我還飛得動嗎」，與對手無關。
  s.extendFloorLatch = latch(
    s.extendFloorLatch, sit.energyReserve, cfg.floorEnter, cfg.floorExit,
  )
  s.extendLatch = s.extendEnergyLatch || s.extendTurnLatch || s.extendFloorLatch
  s.engageLatch = latch(
    s.engageLatch, sit.timeToMerge, cfg.engageTimeEnter, cfg.engageTimeExit,
  )

  const next = arbitrate(s, sit, cfg)

  // 【最小停留：defend 是例外】停留時間是為了行為穩定，但「有人正在打我」
  // 不能等 0.8 秒才反應。安全層對此也有同樣的豁免（spec §9）。
  if (next !== s.intent && (next === 'defend' || s.dwell >= cfg.minDwell)) {
    s.intent = next
    s.dwell = 0
  }
  return s.intent
}

function arbitrate(s: RuleState, sit: Situation, cfg: RuleConfig): Intent {
  if (s.defendLatch) return 'defend'

  // 對頭匯合：雙方機首互指且即將交錯。angleOffTail 接近 π 代表他正朝我來
  if (
    sit.timeToMerge < cfg.mergeTime
    && sit.aspectAngle < cfg.mergeAspect
    && sit.angleOffTail > Math.PI - cfg.mergeAspect
  ) return 'merge'

  // 【有射擊解時，「比他弱」不是離開的理由；「我飛不動了」仍然是】
  //
  // 人工驗收抓到的缺陷：AI 咬在敵機後方 236 m、瞄準偏離 4°、正在開火時切到
  // extend，瞄準點瞬間甩到 87°，然後直飛 21 秒到 1,484 m。45 秒的交戰只開火
  // 7.1 秒。真實 BFM 是「打不贏才脫離」，不是「打得正順的時候脫離」。
  //
  // 但這條護欄不能無差別地擋掉所有 extend：早期版本這樣做，結果把最後的
  // 觸發機會也堵死，共速共高開局螺旋下沉到離海 309 m。分野在於**理由的性質**：
  //
  //   相對理由（比他弱、轉不贏他）→ 談的是接下來的交換，有槍在手就先開槍
  //   絕對理由（我飛不動了）      → 談的是我還能不能飛，開著槍也得走
  //
  // `shotInstant > 0` 已經包含「距離 900 m 內、有預瞄解、機首在 15° 錐內」，
  // 正是「我正咬著他」的定義。
  //
  // 【`extendRange` 也只約束相對理由】同一條分野再用一次。`extend` 有兩個
  // 出口：跑滿 `extendRange`，或閂鎖釋放。實測絕對理由觸發時**永遠是距離
  // 先到** —— 能量餘裕要爬回 `floorExit`（+300 m）以 Ps ≈ +15 m/s 算要 21 秒，
  // 而拉開到 1,500 m 只要 1.2 秒。AI 於是每次都在餘裕才 +24 m 時回頭，等於
  // 沒補到，很快又見底，形成來回震盪。
  //
  // 相對理由（比他弱、轉不贏他）談的是戰術態勢，「拉開夠遠就安全了」成立；
  // 絕對理由（我飛不動了）與距離無關 —— 跑到天邊也不會讓你變得飛得動。
  const shooting = sit.shotInstant > 0
  if (s.extendFloorLatch) return 'extend'
  if (
    !shooting
    && (s.extendEnergyLatch || s.extendTurnLatch)
    && sit.range < cfg.extendRange
  ) return 'extend'

  // 【門檻與 extend 對齊，不是 `>= 0`】機體差距可能只有 ±2% 且隨高度換號，
  // 用 `>= 0` 等於擲銅板。要拒絕交戰得是**明顯**轉不贏，那與脫離同一個標準。
  if (sit.airframeTurnAdvantage > cfg.turnEnter && s.engageLatch) return 'engage'
  return 'approach'
}
