import type { Projectiles } from '../world/Projectiles'

/**
 * 這一幀有沒有敵彈從 (px,py,pz) 身邊 radius 公尺內掠過。回那一發的索引，沒有回 −1。
 *
 * 【回索引不回布林】呼叫端要拿它的位置做左右定位 —— 玩家才聽得出子彈從哪一邊來。
 *
 * 【看「現在在旁邊、正在遠離」，不看最後一段線段】一幀可能跑好幾個物理子步，
 * 彈丸的上一位置只記最後一步 —— 在前幾步擦過的，最後一段已經在遠離，
 * 用線段最近點判定會漏掉。遠離＝速度方向背對自己：v · (自己 − 彈) < 0。
 *
 * 【每幀一次、不配置】彈丸池約 4000 格，與曳光彈更新同一個量級。
 */
export function nearMiss(p: Projectiles, myTeam: number, px: number, py: number, pz: number, radius: number): number {
  const r2 = radius * radius
  for (let i = 0; i < p.capacity; i++) {
    if (p.owner[i] === -1 || p.team[i] === myTeam) continue
    const wx = px - p.x[i]!, wy = py - p.y[i]!, wz = pz - p.z[i]!
    if (wx * wx + wy * wy + wz * wz >= r2) continue
    if (p.vx[i]! * wx + p.vy[i]! * wy + p.vz[i]! * wz < 0) return i
  }
  return -1
}
