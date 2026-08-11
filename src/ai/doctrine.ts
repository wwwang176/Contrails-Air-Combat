/**
 * 機體對這場仗的偏好。兩個彼此獨立的量：
 *
 *   energyPull      絕對，不需要對手 —— 不要把自己拉到掉出可用包絡
 *   sweetSpotPitch  相對，需要對手   —— 把航跡角偏向自己佔優的高度／速度
 *
 * 【為什麼分開】鏡像對戰（同機種）時甜蜜區處處為 0。若把紀律綁在甜蜜區上，
 * 同機種對打會完全失去紀律 —— 而 `ai-duel-matrix` 留紅的那一場正是
 * P-51 對 P-51。見 spec §3.3。
 *
 * 本模組**不 import 任何 AI 狀態**，只吃 spec 與純量，所以整支可以在單元
 * 測試裡直接算。
 */

export interface DoctrineConfig {
  /**
   * `cornerRatio` 高於此值時拉桿完全放行。1.0 = 角落速度。
   *
   * 【為什麼放行點就是角落速度】高於它時拉滿是**對的** —— 那正是這台飛機
   * 能拉出最大轉彎率的區域，而且是它贏的地方。拉桿紀律要擋的不是「用力
   * 轉彎」，是「在已經沒有速度的地方繼續用力」。
   */
  energyFreeRatio: number
  /** `cornerRatio` 低於此值時夾到 `energyMinPull` */
  energyFloorRatio: number
  /**
   * 見底時仍然允許的拉桿係數。**不得為 0** —— 完全鬆桿的 AI 是靶子。
   */
  energyMinPull: number
}

/**
 * 出貨值。**三個都是 Task 7 掃描前的起手值**，掃描後回填並在此記錄掃描表。
 *
 * 起手值的來歷：`energyFreeRatio` 取 1.0（角落速度本身）；`energyFloorRatio`
 * 取 0.70，比 `DEFAULT_STEER.cornerEnter`（0.75，`extend` 的觸發點）再低一點
 * —— 意思是「已經低到該脫離了，還要再低一截才動用強制卸載」，兩層不搶戲；
 * `energyMinPull` 取 0.35。
 */
export const DEFAULT_DOCTRINE: DoctrineConfig = {
  energyFreeRatio: 1.0,
  energyFloorRatio: 0.70,
  energyMinPull: 0.35,
}

/**
 * 能量見底時的拉桿係數，0..1。1 = 照原樣拉、0 = 完全鬆桿。
 *
 * 【與 `steer.ts` 的 `unloadPull` 是同一族】兩者都回傳拉桿係數、都由
 * `shrinkTowardNose` 消費（方位不動）。差別只在觸發的物理：
 *
 *   unloadPull   看 stallMargin —— 防的是**失速**（迎角太大）
 *   energyPull   看 cornerRatio —— 防的是**能量見底**（速度太低）
 *
 * 消費端取兩者的較小值，所以兩層自然是「誰先擋住算誰的」。
 *
 * 【為什麼門檻退化時回傳 1 而不是 0】回傳 0 = 完全鬆桿。設定寫錯時讓 AI
 * 完全不能拉桿是災難性的失敗模式，而回傳 1 只是讓本層失效、退回既有行為。
 * 安全的方向是「這一層不生效」，不是「這一層把飛機鎖死」。
 *
 * @param cornerRatio `Situation.cornerRatio` = TAS ÷ 角落速度
 */
export function energyPull(cornerRatio: number, cfg: DoctrineConfig): number {
  const span = cfg.energyFreeRatio - cfg.energyFloorRatio
  if (!(span > 0)) return 1
  const t = (cornerRatio - cfg.energyFloorRatio) / span
  if (t >= 1) return 1
  if (t <= 0) return cfg.energyMinPull
  return cfg.energyMinPull + (1 - cfg.energyMinPull) * t
}
