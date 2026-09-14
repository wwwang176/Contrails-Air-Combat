import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { recoveryClearance } from './safety'
import { WEP_THROTTLE } from '../physics/propulsion'
import { THROTTLE_FLOOR } from '../input/throttle'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'

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
 * 高度夾在 `seaHeight + recoveryClearance(reference.spec)` 之上 —— 不夾的話僚機會
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

  const floor = seaHeight + recoveryClearance(reference.spec)
  if (out.y < floor) out.y = floor
}

export interface StationConfig {
  /** 遠近混合的特徵長度，m。誤差小於它就開始轉為平行飛 */
  blendRange: number
  /** 前置補償的時間，s */
  leadTime: number
  /** 縱向位置誤差 → 速度指令的增益，1/s */
  speedGain: number
  /** 速度差多少算「差滿了」，m/s。油門與減速板都用它當標度 */
  speedBand: number
}

/**
 * **全部都是起始值，待 Task 13 由人工驗收與實測回填。**
 *
 * 【`blendRange` = 100 m】半個站位間距 ——「誤差小於半格就算在隊上」，
 * 該平行飛了。
 *
 * 【`leadTime` = 1.0 s】指揮儀把大角度瞄準誤差收斂的時間量級。
 *
 * 【`speedGain` = 0.2 s⁻¹】100 m 的縱向誤差命令 +20 m/s，約 5 秒補完；
 * 而 20 m/s 大約是巡航油門到 WEP 的速度餘裕。
 *
 * 【`speedBand` = 20 m/s】同上那個餘裕。速度差滿一個 band 就開到 WEP、
 * 反向滿一個 band 才開始踩減速板。
 */
export const DEFAULT_STATION: StationConfig = {
  blendRange: 100,
  leadTime: 1.0,
  speedGain: 0.2,
  speedBand: 20,
}

/**
 * 站位保持的基準油門。
 *
 * 【0.7 從哪來】`AiController` 的「沒有目標」分支與測試用的 Idle 控制器
 * 都用 0.7 當平飛油門。維持一致，站位控制器在誤差為 0 時給的就是同一個
 * 巡航狀態。
 */
const CRUISE_THROTTLE = 0.7

const C = makeScratch(4)

/**
 * 飛向站位。寫滿整個 `Command`（含 `firing = false`）。
 *
 * 【近距離不能瞄站位點】誤差趨近 0 時方向由浮點雜訊主導，瞄準向量會劇烈
 * 擺動而指揮儀會忠實地追上去。近距離改成瞄參考機的航跡方向（平行飛）。
 * 用**連續混合**而不是門檻，因為它不需要遲滯 —— 權重本身是連續的，不會
 * 在邊界上切換（與 `engageKnobs` 同一個理由）。
 *
 * 它同時解決視覺重疊：瞄著站位點飛會**直直朝長機收斂**，平行飛不會。
 * M6 沒有飛機互撞，所以那純粹是顯示問題 —— 但兩架機模穿模是看得見的。
 *
 * 【前置補償用相對速度，不是參考機的絕對速度】純追蹤一個移動點永遠落後；
 * 但若用絕對速度外推，共速且已在站位上時外推點仍在前方 `leadTime × 速度`
 * ≈ 200 m，混合權重永遠是 1，「近距離平行飛」那一段**永遠不會生效**。
 * 相對速度在共速時歸零，正是要的。
 *
 * 【油門是連續的，不是開關】站位保持是一個要**維持**的狀態而不是一次
 * 機動。bang-bang 會在目標速度附近來回，畫面上就是僚機一頓一頓。
 *
 * **呼叫端仍然要在之後套 `applySafety`** —— 站位控制器不是它的例外。
 *
 * 熱路徑：不配置。不修改 `self` 與 `reference`。
 */
export function stationCommand(
  self: Aircraft,
  reference: Aircraft,
  offset: StationOffset,
  seaHeight: number,
  out: Command,
  cfg: StationConfig = DEFAULT_STATION,
): void {
  const station = C.v[0]!
  stationPoint(reference, offset, seaHeight, station)

  const err = C.v[1]!.copy(station).sub(self.state.position)
  const dist = err.length()

  // 參考機的航跡方向。退化時用機首 —— 與 stationPoint 同一套階梯
  const track = C.v[2]!.copy(reference.state.velocity)
  const refSpeed = track.length()
  if (refSpeed > MIN_GROUND_SPEED) track.divideScalar(refSpeed)
  else track.copy(FWD).applyQuaternion(reference.state.orientation)

  // 追蹤方向 = 位置誤差 + 相對速度 × leadTime
  const aim = C.v[3]!.copy(err)
    .addScaledVector(reference.state.velocity, cfg.leadTime)
    .addScaledVector(self.state.velocity, -cfg.leadTime)
  const aimLen = aim.length()
  if (aimLen > 1e-6) aim.divideScalar(aimLen)
  else aim.copy(track)

  // 遠 → 追站位點；近 → 平行飛。連續混合，不需要遲滯
  const w = dist < cfg.blendRange ? dist / cfg.blendRange : 1
  aim.multiplyScalar(w).addScaledVector(track, 1 - w)
  const len = aim.length()
  if (len > 1e-6) out.aimWorld.copy(aim).divideScalar(len)
  else out.aimWorld.copy(track)

  // 目標速度 = 參考機速度 + 縱向誤差 × 增益
  const along = err.dot(track)
  const wanted = refSpeed + along * cfg.speedGain
  const deficit = wanted - self.state.velocity.length()

  let throttle = CRUISE_THROTTLE + (deficit / cfg.speedBand) * (WEP_THROTTLE - CRUISE_THROTTLE)
  if (throttle < THROTTLE_FLOOR) throttle = THROTTLE_FLOOR
  else if (throttle > WEP_THROTTLE) throttle = WEP_THROTTLE
  out.throttle = throttle

  // 【減速板要等油門先收到底】兩者同時作用會過度減速，然後又要加回來。
  // 超速滿一個 band 之後才開始踩，滿兩個 band 踩到底。
  out.brake = deficit < -cfg.speedBand
    ? Math.min(1, -deficit / cfg.speedBand - 1)
    : 0

  // 開火紀律是獨立的一層（fire.ts）。歸隊途中不開槍
  out.firing = false
}
