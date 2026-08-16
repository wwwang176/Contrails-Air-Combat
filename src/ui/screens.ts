/** 五個畫面。`battle` 之上另有暫停與結算兩種 overlay，它們不是畫面 */
export type Screen = 'landing' | 'menu' | 'mission' | 'skirmish' | 'battle'

export type ScreenEvent =
  | 'start'      // landing 的開始按鈕
  | 'mission'    // 主選單：任務模式
  | 'skirmish'   // 主選單：遭遇戰
  | 'back'       // 子畫面的返回
  | 'fight'      // 開始戰鬥／再打一場
  | 'toMenu'     // 暫停選單：回主選單
  | 'toSetup'    // 結算：回設定頁（遭遇戰）
  | 'toMission'  // 結算：回任務列表（任務模式）

/**
 * 轉移表。**不合法的組合回傳 `current`。**
 *
 * 【為什麼不丟例外】選單上一個按不到的按鈕不該讓整個遊戲當掉 —— 而在
 * DOM 那一層，一個沒有被正確隱藏的按鈕就會送出這種事件。
 *
 * 【為什麼回不去 landing】它是一次性的開場。玩家按過開始之後再回到標題
 * 畫面沒有任何意義 —— 主選單已經是那個角色。
 */
const TABLE: Record<Screen, Partial<Record<ScreenEvent, Screen>>> = {
  landing: { start: 'menu' },
  menu: { mission: 'mission', skirmish: 'skirmish' },
  // 【M10 時這裡只有 back】那時卡片全部 disabled，任務列表是一個看得到
  // 打不了的櫥窗。殲滅與撤離做出來之後它才是一個入口。
  mission: { back: 'menu', fight: 'battle' },
  skirmish: { back: 'menu', fight: 'battle' },
  // 【`fight` 從 battle 回到 battle】結算的「再打一場」。畫面沒變，
  // 但呼叫端會重建戰鬥 —— 那是兩件事（M10 spec §4）
  //
  // 【兩個回頭的出口】遭遇戰回設定頁、任務回任務列表。**用兩個事件而不是
  // 一個「回上一頁」**：狀態機不該記得歷史，那會讓同一個轉移在不同的來路
  // 下有不同的結果 —— 也就不再是一張表。
  battle: { fight: 'battle', toMenu: 'menu', toSetup: 'skirmish', toMission: 'mission' },
}

export function nextScreen(current: Screen, event: ScreenEvent): Screen {
  return TABLE[current][event] ?? current
}
