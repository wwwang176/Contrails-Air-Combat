/**
 * 中文文字表。**鍵的型別由這一張推導**（`MessageKey`），英文表必須有同一組鍵。
 *
 * 句型是 ICU MessageFormat（`intl-messageformat`）：參數寫成 `{name}`，英文的單複數用
 * `{n, plural, one {…} other {…}}`。字面的大括號要用單引號包起來（`'{'`）。
 *
 * 【數字參數】`{n}` 會套千分位；年份這種不該有逗號的，呼叫端傳字串。
 */
export const zh = {
  'common.ok': '確定',

  'format.month': '{year} 年 {month} 月',

  'menu.stage': '第 {n} 關',

  'mission.type.annihilate': '殲滅',
  'mission.type.intercept': '攔截',
  'mission.type.strike': '打擊',
  'mission.type.escort': '護航',
  'mission.type.withdraw': '撤離',

  'unit.planes': '{n} 架',
} as const

export type MessageKey = keyof typeof zh
