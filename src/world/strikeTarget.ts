import type { Quaternion, Vector3 } from 'three'
import type { Box } from './hit'
import type { Team } from './World'

/**
 * # 打擊目標的視圖
 *
 * AI 的攻擊航路（`ai/strikeRun.ts`）與投放判斷（`ai/bombRun.ts`、
 * `ai/torpedoRun.ts`）只讀這幾格。`Ship` 與 `GroundTarget` 都直接滿足它，
 * 沒有轉接物件：船的 `hull`／`impactY`／`value` 是艦級資料的複本，建船時
 * 填一次（`ships.ts`）。
 *
 * 【`orientation` 直接透傳，不從 heading 重算】三角函數與四元數的浮點
 * 結果不保證逐位元相同，而船那條路的基準是逐位元的
 * （`test/unit/strike-replay-baseline.test.ts`）。
 *
 * 【`impactY` 是世界高度】落點求解的平面：`position.y + 盒頂`。船的
 * `position.y` 恆為 0，所以就是甲板高；建築的也是 0（墊面），所以就是
 * 構件的頂。
 *
 * 【`hull[0]` 是主體】投放窗用第一個盒的半長半寬（`bombRun.ts` 的
 * `releaseWindowOf`）。
 */
export interface StrikeTarget {
  readonly kind: 'ship' | 'ground'
  /** 在各自清單裡的位置。10 Hz 決策拍之間用它複查 */
  readonly index: number
  readonly team: Team
  /** 世界座標 */
  readonly position: Vector3
  readonly orientation: Quaternion
  /** 沿 −Z 的速率，m/s。地面目標恆 0 */
  readonly speed: number
  /** 自身座標 */
  readonly hull: readonly Box[]
  readonly impactY: number
  /** 選目標用：船是艦級血量，地面是構件血量 */
  readonly value: number
  readonly alive: boolean
}
