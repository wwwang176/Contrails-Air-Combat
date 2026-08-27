/**
 * 地形的種類。
 *
 * 【為什麼住在 `world/` 而不是 `render/`】遭遇戰的設定要帶它
 * （`battle/skirmish.ts` 的 `SkirmishSetup`），而 battle 層不相依渲染層。
 * 它本身是一個領域概念 —— 「這一場打在什麼地方」，與怎麼畫無關。
 *
 * 【加一種要動的地方】這個聯集、`render/terrain.ts` 的 `createTerrain`
 * 分支，以及生成器。拆除與重建的路徑每一場都在走，不是一條等著被第一次
 * 使用的死碼。
 *
 * 【還沒做的兩種】大島海岸線與內陸（沒有海）。資料結構長得到 —— 它們只是
 * 不同的 heightmap —— 但還沒生成。
 */
export type TerrainKind = 'sea' | 'archipelago'
