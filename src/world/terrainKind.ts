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
 * 【`leuna`、`autumnFarmland`、`poltava`、`asch` 是任務專用】盟 M2 的洛伊納
 * （`world/leuna.ts`）、德 M1 的晚秋內陸（農地的高度場配洛伊納的晚秋色盤，
 * 沒有廠區）、德 M2 的波爾塔瓦機場（`world/poltava.ts`）、德 M3 的 Y-29 前進
 * 降落場（`world/asch.ts`）：農地的機制、手擺的丘陵。遭遇戰選單不列它們。
 *
 * 【`leyte` 也是任務專用】日 M2 的雷伊泰海岸線（`world/leyte.ts`）：半邊是海、
 * 半邊是平坦的大島，群島的畫法加上公路。
 */
export type TerrainKind =
  | 'sea' | 'archipelago' | 'farmland' | 'autumnFarmland' | 'leuna' | 'poltava' | 'asch' | 'leyte'
