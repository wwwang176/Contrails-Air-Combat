export type Team = 'blue' | 'red'

/**
 * 隊別的整數編碼。**0 = 藍、1 = 紅。**
 *
 * 【為什麼是一個函數而不是讓呼叫端自己寫 `team === 'blue' ? 0 : 1`】那條
 * 三元式若在兩處各寫一次，其中一處寫反了不會有任何測試紅 —— 症狀只是
 * 「某一隊的東西顏色不對」或「某一隊的護航機從來不緊張」。
 *
 * 【為什麼住在這裡而不是 `ai/target.ts`】它本來在那裡，但彈丸、炸彈、
 * 魚雷這三個池都要用同一個編碼，而 `world/` 不能往上依賴 `ai/`。
 * `ai/target.ts` 現在轉出這一支。
 */
export function teamSlot(team: Team): number {
  return team === 'blue' ? 0 : 1
}
