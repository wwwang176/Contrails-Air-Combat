/**
 * 一場戰鬥的時段。
 *
 * 【為什麼住在 `world/` 而不是 `render/`】遭遇戰的設定要帶它
 * （`battle/skirmish.ts` 的 `SkirmishSetup`）、任務卡也要
 * （`battle/missions.ts`），而 battle 層不相依渲染層。與
 * `world/terrainKind.ts` 同一個理由與同一個位置。
 *
 * 它本身是一個領域概念 —— 「這一場打在什麼時候」，與怎麼畫無關。**怎麼畫
 * 在 `render/timeOfDay.ts` 的 `DAY_PALETTES`。**
 *
 * 【加一個要動的地方】這個聯集、`DAY_PALETTES`，以及 `TIME_OF_DAY_IDS`
 * （那一份決定展示頁與遭遇戰選單的按鈕順序）。
 */
export type TimeOfDay = 'dawn' | 'noon' | 'dusk' | 'night' | 'novemberNoon' | 'storm'
