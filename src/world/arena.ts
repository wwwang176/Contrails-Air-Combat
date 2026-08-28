/**
 * 戰場邊界。**圓柱，不是正方體。**
 *
 * 【為什麼是圓柱】正方體的角落比面心遠 41%，玩家看到的「離界多遠」會隨
 * 方位跳。圓柱只有一個半徑、HUD 一個數字，而返場也只是「朝原點轉」。
 *
 * 【為什麼只對玩家】AI 沒有任何絕對的牽引 —— 實測 8v8 對頭 900 秒打不完、
 * 中位數飛到 44 km 外，成因是「沒有目標就平飛」。專案負責人 2026-08-28
 * 裁定這一輪不處理那一側，見 `docs/backlog.md` §10.2。界若對 AI 生效，
 * 整隊會在開打前先自爆。
 *
 * 【為什麼只在遭遇戰】任務卡的幾何直接與它衝突：撤離點在 −20,000 m
 * （玩家起點 z ≈ +5,000，直線 25 km），護航的集合點 12,000 m。
 *
 * 【為什麼住在 `world/` 而不是 `main.ts`】它是規則，要 headless 測得到。
 * `main.ts` 只負責接線與畫面。
 */

/** 水平半徑，m。開場最遠的一架在 5,945 m，餘裕一倍 */
export const ARENA_RADIUS = 12000

/** 高度上限，m。P-51D 的升限是 12,770，所以這一條是飛得到的 */
export const ARENA_CEILING = 10000

/** 界外到爆炸的秒數。專案負責人 2026-08-28 定值 */
export const ARENA_COUNTDOWN = 15

export interface ArenaState {
  /** 這一刻在界外嗎 */
  outside: boolean
  /** 還剩幾秒。界內恆為 `ARENA_COUNTDOWN` */
  remaining: number
  /** 倒數已經歸零。**單向** —— 飛機已經爆了，回到界內也不會復活 */
  expired: boolean
}

export function createArenaState(): ArenaState {
  return { outside: false, remaining: ARENA_COUNTDOWN, expired: false }
}

/**
 * 推進一步。就地寫 `s`。
 *
 * 熱路徑（240 Hz，一架），不配置。
 */
export function stepArena(
  s: ArenaState, x: number, y: number, z: number, dt: number,
): void {
  if (s.expired) return
  const outside = x * x + z * z > ARENA_RADIUS * ARENA_RADIUS || y > ARENA_CEILING
  s.outside = outside
  if (!outside) {
    s.remaining = ARENA_COUNTDOWN
    return
  }
  s.remaining -= dt
  if (s.remaining <= 0) {
    s.remaining = 0
    s.expired = true
  }
}

/**
 * 這一格要不要殺。**只殺玩家。**
 *
 * 【為什麼不是在 `main.ts` 裡寫一行判斷】那一行測不到，而它正好是
 * 「AI 全隊在開打前自爆」與「玩家出界不會死」兩種相反災難的分界。
 */
export function arenaKills(s: ArenaState, isPlayer: boolean): boolean {
  return isPlayer && s.expired
}
