import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { DEFAULT_SAFETY } from './safety'
import type { Aircraft } from '../aircraft/Aircraft'

/**
 * 一個站位相對參考機的三個偏置量，m。全部定義在**參考機航跡的水平框**裡。
 *
 * 【為什麼不是機體框】站位在側方 200 m、長機以最大滾轉率 100°/s
 * （1.75 rad/s）滾轉時，機體框的站位點會以 `1.75 × 200 = 349 m/s` 掃過去
 * —— 比飛機的整個 TAS（巡航 200 m/s）還快。僚機不是跟不好，是**物理上
 * 追不到**。水平框的站位點只跟著**轉彎**移動：最佳持續轉彎率 0.23 rad/s
 * 給 `0.23 × 200 = 46 m/s`，在速度餘裕之內（M6 spec §6.1）。
 *
 * 代價：長機倒飛時僚機不跟著倒。一個追不到的站位點，比一個不夠帥的站位點
 * 糟得多。
 */
export interface StationOffset {
  /** 沿參考機的水平航跡方向。**負 = 後方** */
  along: number
  /** 垂直於水平航跡、在水平面內。正 = 右 */
  across: number
  /** **世界**垂直 */
  up: number
}

/**
 * 依成員位置給站位偏置（M6 spec §6.2）。索引即壓縮後的 position。
 *
 * ```
 *   position 1  參考 members[0]   across +200  along  −60  up   0
 *   position 2  參考 members[0]   across −250  along −120  up +50
 *   position 3  參考 members[2]   across −200  along  −60  up   0
 * ```
 *
 * 相對 `members[0]` 的橫向分布是 `0 / +200 / −250 / −450`，全隊跨度 650 m。
 *
 * 【200 m 從哪來】史實 Rotte 的間距就是這個量級，而寬間距**正是** Rotte
 * 勝過 RAF 密集 vic 的原因 —— 兩架都能四處張望，而不是盯著長機翼尖。它
 * 同時通過兩個下界：遠大於翼展 11 m（不會讀起來像要相撞），也遠大於
 * `fire.ts` 的 `trackingCone`（3°）在近距離的寬度。
 *
 * 【第二個 Rotte 抬高 50 m】同高的話從正後方看會疊成一條線。
 *
 * **起始值，待 Task 13 由人工驗收與實測回填。**
 *
 * position 0 沒有站位，那一格永遠不會被讀到；填 0 只是讓陣列長度與
 * `SCHWARM_SIZE` 一致，索引才能直接用 position。
 */
export const STATION_OFFSETS: readonly StationOffset[] = [
  { along: 0, across: 0, up: 0 },
  { along: -60, across: 200, up: 0 },
  { along: -120, across: -250, up: 50 },
  { along: -60, across: -200, up: 0 },
]

const FWD = new Vector3(0, 0, -1)
const S = makeScratch(1)
/** 水平分量退化的下限，m/s。低於此值方向由浮點雜訊主導 */
const MIN_GROUND_SPEED = 1e-3

/**
 * 算出站位點的世界座標，寫進 `out`。不修改 `reference`。
 *
 * 高度夾在 `seaHeight + DEFAULT_SAFETY.clearance` 之上 —— 不夾的話僚機會
 * 與自己的安全層打架：站位控制器命令下降、安全層命令拉起，每一格互相
 * 抵銷（M6 spec §6.3）。
 *
 * 熱路徑：不配置。
 */
export function stationPoint(
  reference: Aircraft, offset: StationOffset, seaHeight: number, out: Vector3,
): void {
  const v = reference.state.velocity
  let fx = v.x
  let fz = v.z
  let len = Math.hypot(fx, fz)

  if (len < MIN_GROUND_SPEED) {
    // 垂直俯衝／爬升：水平航跡沒有定義，改用機首的水平投影。
    // 與 `unloadAim`、`applySafety` 用同一套退化階梯。
    const nose = S.v[0]!.copy(FWD).applyQuaternion(reference.state.orientation)
    fx = nose.x
    fz = nose.z
    len = Math.hypot(fx, fz)
    if (len < MIN_GROUND_SPEED) {
      // 機首也垂直：任何固定方向都可以，重點是不要產生 NaN —— NaN 一旦
      // 進入站位誤差，所有比較都變成 false，僚機會靜靜地永遠不歸隊而且
      // 完全不報錯（與 assess.ts 的防護同一個理由）。
      fx = 0
      fz = -1
      len = 1
    }
  }
  fx /= len
  fz /= len

  // 右手側：three 是 +X 右、+Y 上、−Z 前，所以航跡 (fx, fz) 的右邊是
  // (−fz, fx)。驗算：朝 −Z（fx=0, fz=−1）時右邊是 (1, 0) = +X。
  const rx = -fz
  const rz = fx

  const p = reference.state.position
  out.set(
    p.x + fx * offset.along + rx * offset.across,
    p.y + offset.up,
    p.z + fz * offset.along + rz * offset.across,
  )

  const floor = seaHeight + DEFAULT_SAFETY.clearance
  if (out.y < floor) out.y = floor
}
