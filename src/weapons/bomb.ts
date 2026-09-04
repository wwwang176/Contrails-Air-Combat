/**
 * 各機種的載彈量。**沒有列在這裡的機種不能投彈。**
 *
 * 起始值，史實量級。**投完就沒有** —— 這一輪不做補彈，重生時回滿。
 */
export const BOMB_LOAD: Readonly<Record<string, number>> = {
  b17g: 8,
  he111: 8,
  g4m: 4,
}

/**
 * 兩顆之間的最小間隔，秒。**起始值，由試飛裁定。**
 *
 * 單投而不是齊投 —— 可以走棋盤式散布，而且「投一顆、看它落哪、修正、再投」
 * 才是這個瞄具唯一能被玩家驗證的迴圈。
 */
export const BOMB_RELEASE_INTERVAL = 0.25

export function bombLoadFor(specId: string): number {
  return BOMB_LOAD[specId] ?? 0
}
