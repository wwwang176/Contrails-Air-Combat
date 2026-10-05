/**
 * 戰場邊界。**圓柱，不是正方體。**
 *
 * 【為什麼是圓柱】正方體的角落比面心遠 41%，玩家看到的「離界多遠」會隨
 * 方位跳。圓柱只有一個半徑、HUD 一個數字，而返場也只是「朝圓心轉」。
 *
 * 【為什麼只對玩家】AI 沒有任何絕對的牽引 —— 實測 8v8 對頭 900 秒打不完、
 * 中位數飛到 44 km 外，成因是「沒有目標就平飛」。那一側不處理，見
 * `docs/backlog.md` §10.2。界若對 AI 生效，整隊會在開打前先自爆。
 *
 * 【遭遇戰與任務都有界】遭遇戰用 `SKIRMISH_ARENA`；任務的圓心與半徑寫在卡片上
 * （`MissionBattle.arena`），要把開場站位、目標點與地面目標全部圈進去
 * （護欄在 `mission-arena.test.ts`）。
 *
 * 【為什麼住在 `world/` 而不是 `main.ts`】它是規則，要 headless 測得到。
 * `main.ts` 只負責接線與畫面。
 */

/** 一場的界：水平圓心與半徑，m */
export interface ArenaBounds {
  readonly x: number
  readonly z: number
  readonly radius: number
}

/** 遭遇戰的界。開場最遠的一架在 5,945 m，餘裕一倍 */
export const SKIRMISH_ARENA: ArenaBounds = { x: 0, z: 0, radius: 12000 }

/** 任務的界最小半徑，m。再小的話追逐一兩個迴旋就碰到界 */
export const ARENA_MIN_RADIUS = 10000

/** 高度上限，m。P-51D 的升限是 12,770，所以這一條是飛得到的 */
export const ARENA_CEILING = 10000

/** 界外到爆炸的秒數。 */
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
  s: ArenaState, b: ArenaBounds, x: number, y: number, z: number, dt: number,
): void {
  if (s.expired) return
  const dx = x - b.x
  const dz = z - b.z
  const outside = dx * dx + dz * dz > b.radius * b.radius || y > ARENA_CEILING
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
