/**
 * 難度參數。
 *
 * 【M4 交付的是天花板】兩個欄位都是 0，也就是「零延遲、零瞄準誤差」。
 * 專案負責人的理由：**不可能從一個沒量過的天花板往下調難度**。M5 起以此
 * 為基準把 AI 調鈍（spec §10）。
 *
 * 【視野盲區不在此列】它需要「最後已知位置 + 搜索行為」，是一整套行為而
 * 不是一個參數。明確延後，記在 spec §2 以免被當成遺漏。
 */
export interface DifficultyProfile {
  /** 態勢更新的反應延遲，秒 */
  reactionDelay: number
  /** 瞄準誤差，rad */
  aimError: number
}

/** 王牌：M4 的唯一設定。 */
export const ACE: DifficultyProfile = { reactionDelay: 0, aimError: 0 }
