import { Vector3 } from 'three'
import type { Aircraft } from '../aircraft/Aircraft'

/**
 * 一架飛機這個物理步的操作指令。
 *
 * 【為什麼玩家與靶機共用同一組欄位】`Aircraft.update(aimWorld, throttle, dt)`
 * 的介面不動（spec §4.1），靶機只是 aimWorld 的來源不同。共用之後 M4 的
 * AI 只要再寫一個 Controller，World 那一層一個字都不用改。
 */
export interface Command {
  /** 世界座標的瞄準方向，單位向量 */
  aimWorld: Vector3
  /** 0 ~ 1.1，1.1 為 WEP */
  throttle: number
  /** 減速，0 ~ 1。玩家的按鍵給 0 或 1；AI 可以只踩一部分（M4 spec §2.1） */
  brake: number
  firing: boolean
}

export function createCommand(): Command {
  return { aimWorld: new Vector3(0, 0, -1), throttle: 0, brake: 0, firing: false }
}

export interface Controller {
  /**
   * 每個物理步更新一次指令。
   *
   * `out` 由呼叫端持有並重複使用——熱路徑禁止配置，所以這裡只能寫入，
   * 不能回傳新物件。
   */
  update(self: Aircraft, dt: number, out: Command): void
}
