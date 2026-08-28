import { CRASH_CLEARANCE } from '../aircraft/crash'
import type { Combatant, CrashPolicy } from './World'

/**
 * 撞地判定的政策工廠：**海面是平的，陸地讀高度場。**
 *
 * ── 【為什麼海面不吃浪高】────────────────────────────────────
 *
 * 專案負責人 2026-08-28：「海面碰撞體就平面就好，海浪只是視覺高低而已。」
 *
 * 而數字也站在這一邊：低多邊形的海只有三道長波、振幅和 4.5 m，而
 * `CRASH_CLEARANCE` 是 2 m —— 那是一個自承的估計值（機體幾何還不存在，
 * 先用半個機身高度代替）。用波高判定等於在一個 2 m 的猜測上疊 1~4 m 的
 * 精確度，換不到任何玩家分辨得出來的東西。
 *
 * 【視覺放置仍然吃浪高】水柱、殘骸、碎片入水走的是 `Terrain.heightAt`，
 * 那一條**一個字都不改** —— 殘骸會在水面停留一段時間，釘在 y = 0 會一下
 * 半沉、一下浮在空中。
 *
 * ── 【為什麼是一支工廠而不是寫在 main.ts 裡】──────────────────
 *
 * `main.ts` 是 DOM 進入點，測試碰不到。判定留在裡面就等於沒有測試覆蓋 ——
 * 而「`Terrain.collisionHeightAt` 完全正確，但 main 忘了接過去」這個失效
 * 模式會讓所有單元測試照樣全綠。
 *
 * @param landHeightAt 陸地高度，m。海上回 0。**不吃時間** —— 陸地是靜態的。
 */
export function flatSeaCrashPolicy(
  landHeightAt: (x: number, z: number) => number,
): CrashPolicy {
  return (c: Combatant): boolean => {
    const p = c.aircraft.state.position
    return p.y <= landHeightAt(p.x, p.z) + CRASH_CLEARANCE
  }
}
