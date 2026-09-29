import type { MessageKey } from './zh'

/**
 * 英文文字表。型別是 `Record<MessageKey, string>` —— 中文表加了鍵而這裡漏了，編譯不過。
 * 句型的參數名必須與中文那一句相同（`test/unit/i18n-guard.test.ts` 守著）。
 */
export const en: Record<MessageKey, string> = {
  'common.ok': 'OK',

  'format.month': '{month} {year}',

  'menu.stage': 'Mission {n}',

  'mission.type.annihilate': 'Air Superiority',
  'mission.type.intercept': 'Intercept',
  'mission.type.strike': 'Strike',
  'mission.type.escort': 'Escort',
  'mission.type.withdraw': 'Withdrawal',

  'unit.planes': '{n, plural, one {# plane} other {# planes}}',
}
