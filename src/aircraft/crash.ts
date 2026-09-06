import type { Vector3 } from 'three'

/**
 * 撞海餘裕，公尺。機體幾何（Task 21）尚未存在，故先以一個保守的
 * 半機身高度代替；有了真正的機體尺寸後應改為由 spec 推導。
 */
export const CRASH_CLEARANCE = 2

/** 波高場：(x, z, time) → 海面高度，公尺。 */
export type HeightField = (x: number, z: number, time: number) => number

/**
 * 是否撞海。
 *
 * 【為什麼吃一個 HeightField 而不是寫死 y ≤ 0】高度場裡有**山**。
 *
 * 【海面那一項是平的】海面碰撞體是平面，海浪只是視覺高低。浪的振幅和是
 * 4.5 m，而下面那個 CRASH_CLEARANCE
 * 是 2 m 的**估計值** —— 用波高判定等於在一個猜出來的餘裕上疊精確度。
 * 遊戲那一條線走 world/seaCrash.ts 的 flatSeaCrashPolicy，海面恆為 0。
 *
 * 這支函式本身不知道那件事：它吃什麼高度場就判什麼，所以拿真正的浪高餵它
 * 仍然成立（`aircraft.test.ts` 就是那樣測的）。
 *
 * 【為什麼獨立成一個函式】main.ts 是 DOM 進入點，測試碰不到；
 * 判定邏輯留在裡面就等於沒有測試覆蓋。抽出後 main.ts 與測試呼叫的
 * 是同一份程式碼，不是兩份長得很像的複製品。
 */
export function isCrashed(position: Vector3, heightAt: HeightField, time: number): boolean {
  return position.y <= heightAt(position.x, position.z, time) + CRASH_CLEARANCE
}
