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
    extendEnergyLatch: false, extendTurnLatch: false, extendLatch: false,
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
  s.extendLatch = s.extendEnergyLatch || s.extendTurnLatch
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

  // 【這裡曾經有一條「有射擊解就不准跑」的護欄，實測後撤掉】它本身是對的
  // ——AI 不該在咬著敵機開火時脫離——但它會把 `extend` 最後的觸發機會也堵掉，
  // 而 `energyAdvantage` 是**相對**量：兩台一起把能量耗光時它一直接近 0，
  // 沒有任何機制看得見「大家都快沒能量了」。實測共速共高開局因此由最低
  // 比能量 3,405 m／最低高度 2,435 m 惡化成 679 m／309 m，整場仗螺旋下沉
  // 到海面附近。
  //
  // 要加回這條護欄，得先有一個**絕對**的能量底線讓 extend 仍然逃得掉。
  // 那是一個新的設計決定，不在本次改動範圍內。
  if (s.extendLatch && sit.range < cfg.extendRange) return 'extend'

  // 【門檻與 extend 對齊，不是 `>= 0`】機體差距可能只有 ±2% 且隨高度換號，
  // 用 `>= 0` 等於擲銅板。要拒絕交戰得是**明顯**轉不贏，那與脫離同一個標準。
  if (sit.airframeTurnAdvantage > cfg.turnEnter && s.engageLatch) return 'engage'
  return 'approach'
}
