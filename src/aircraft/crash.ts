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
 * 【為什麼吃一個 HeightField 而不是寫死 y ≤ 0】海面是 Gerstner 波，
 * 振幅合計約 ±2.15 m，而且 CPU 的 gerstnerHeight 與 GPU 頂點著色器共用
 * 同一份 WAVES 常數（見 render/ocean.ts）。判定必須走同一個函式，
 * 玩家看到的浪頭才會就是撞得到的浪頭；用平面 y=0 判定會出現
 * 「明明穿過浪峰卻沒事」與「離水面還有一段就爆」兩種相反的錯覺。
 *
 * 【為什麼獨立成一個函式】main.ts 是 DOM 進入點，測試碰不到；
 * 判定邏輯留在裡面就等於沒有測試覆蓋。抽出後 main.ts 與測試呼叫的
 * 是同一份程式碼，不是兩份長得很像的複製品。
 */
export function isCrashed(position: Vector3, heightAt: HeightField, time: number): boolean {
  return position.y <= heightAt(position.x, position.z, time) + CRASH_CLEARANCE
}
