import type { GroundUnitId } from '../specs/ground'

/**
 * # 補給場的佈景：木箱堆與停著的車
 *
 * 雷伊泰的灘頭與 Y-29 共用這兩種形狀，`render/depot.ts` 把它們合併成一顆
 * 網格。**不是目標、沒有碰撞** —— 子彈與炸彈穿過去落到地面。
 */

/**
 * 一堆補給：一塊長方形的場地，裡面用種子排滿木箱。`heading` 是場地「深」那
 * 一邊的朝向（rad，0 = 朝 −Z），`width` 橫向、`depth` 沿 `heading`，m。
 * `lane` = 中間留一條這麼寬的走道，0 = 不留。
 */
export interface CrateField {
  readonly x: number; readonly z: number; readonly heading: number
  readonly width: number; readonly depth: number; readonly lane: number
  readonly seed: number
}

/** 一台停著不動的車，世界座標。`heading` 0 = 車頭朝 −Z */
export interface ParkedVehicle {
  readonly unit: Extract<GroundUnitId, 'usTruck' | 'usTank' | 'usFlakTrack'>
  readonly x: number; readonly z: number; readonly heading: number
}
