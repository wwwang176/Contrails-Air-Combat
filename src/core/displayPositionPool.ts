/**
 * 顯示端共用的位置池：有效槽位、世界座標與隊別。
 * 渲染與 HUD 只依賴這份資料契約，不需要知道物理池或彼此的實作。
 * 陣列由資料提供者就地更新；消費端只讀取 active 為 1 的槽位。
 */
export interface DisplayPositionPool {
  readonly capacity: number
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
  readonly team: Int8Array
  readonly active: Uint8Array
}
