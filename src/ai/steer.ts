import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { NO_INTERCEPT, solveLead } from '../world/lead'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Situation } from './assess'

const FWD = new Vector3(0, 0, -1)
const UP = new Vector3(0, 1, 0)
const S = makeScratch(6)

/**
 * 交戰基底：把「瞄準點該放在目標的哪一側」拆成兩個正交方向。
 *
 * 所有向量都是**世界座標**。`leadAxis` 與 `verticalAxis` 都已扣除沿
 * `losAxis` 的分量——沿視線移動瞄準點只會改變距離，不會改變指向。
 */
export interface EngageBasis {
  /** 由我指向目標的單位向量 */
  losAxis: Vector3
  /** 目標的運動方向在垂直於視線的平面上的投影 */
  leadAxis: Vector3
  /** 我的升力方向在垂直於視線的平面上的投影 */
  verticalAxis: Vector3
  /** 由我到彈道預瞄點的向量（相對座標，非單位向量） */
  leadPoint: Vector3
  /** 預瞄點離目標當前位置多遠，m */
  leadScale: number
  /** 攔截時間，s。`NO_INTERCEPT` 表示無解 */
  interceptTime: number
  /** 目標運動方向 ∥ 視線，前置／後置沒有意義 */
  leadDegenerate: boolean
  /** 升力方向 ∥ 視線，「上方」沒有唯一解 */
  verticalDegenerate: boolean
}

export function createEngageBasis(): EngageBasis {
  return {
    losAxis: new Vector3(0, 0, -1),
    leadAxis: new Vector3(1, 0, 0),
    verticalAxis: new Vector3(0, 1, 0),
    leadPoint: new Vector3(0, 0, -1),
    leadScale: 0,
    interceptTime: NO_INTERCEPT,
    leadDegenerate: true,
    verticalDegenerate: true,
  }
}

/** 投影出垂直於 axis 的分量並正規化。回傳原始模長，供退化判定。 */
function perpendicular(v: Vector3, axis: Vector3, out: Vector3): number {
  out.copy(v).addScaledVector(axis, -v.dot(axis))
  const len = out.length()
  if (len > 1e-6) out.divideScalar(len)
  return len
}

/** 退化判定的模長下限。低於此值方向由浮點雜訊主導。 */
const AXIS_EPSILON = 0.15

/**
 * 建立交戰基底。不修改 self 與 target。
 */
export function buildEngageBasis(self: Aircraft, target: Aircraft, out: EngageBasis): void {
  const p = S.v[0]!.copy(target.state.position).sub(self.state.position)
  const range = p.length()
  if (range > 1e-3) out.losAxis.copy(p).divideScalar(range)
  else out.losAxis.copy(FWD).applyQuaternion(self.state.orientation)

  // 彈道預瞄點：在射手座標系是 P + V·t
  const v = S.v[1]!.copy(target.state.velocity).sub(self.state.velocity)
  const dir = S.v[2]!
  const t = solveLead(p, v, self.spec.battery.sight.muzzleVelocity, dir)
  out.interceptTime = t
  if (t === NO_INTERCEPT) {
    out.leadPoint.copy(p)
    out.leadScale = 0
  } else {
    out.leadPoint.copy(p).addScaledVector(v, t)
    out.leadScale = v.length() * t
  }

  // 【leadAxis 取目標的運動方向，不是相對速度】前置／後置追擊的「前」與
  // 「後」是沿**目標的航跡**定義的。用相對速度的話，共速尾追時它會退化，
  // 但那時候「瞄他後方」仍然是有意義的動作。
  const targetDir = S.v[3]!.copy(target.state.velocity)
  const targetSpeed = targetDir.length()
  if (targetSpeed > 1e-6) targetDir.divideScalar(targetSpeed)
  else targetDir.copy(FWD).applyQuaternion(target.state.orientation)
  out.leadDegenerate = perpendicular(targetDir, out.losAxis, out.leadAxis) < AXIS_EPSILON

  // 【verticalAxis 取自身升力方向而非世界上方】yo-yo 的「拉高」在物理上
  // 就是「多拉一點桿」，那個方向永遠是自己的升力方向。指揮儀是
  // bank-to-turn，大坡度時命令「世界正上方」會要求飛機先滾平再拉——那是
  // 一個做不到的指令，而且滾平的過程中什麼都沒發生。
  const lift = S.v[4]!.copy(UP).applyQuaternion(self.state.orientation)
  out.verticalDegenerate = perpendicular(lift, out.losAxis, out.verticalAxis) < AXIS_EPSILON
}

export type SteerMode = 'normal' | 'overshoot' | 'stallGuard' | 'planeDegenerate'

export interface SteerConfig {
  /** 超前閘門的距離門檻，m */
  overshootRange: number
  /** 失速裕度低於此值才可能觸發吊機首閘門 */
  stallGuardMargin: number
  /** 目標仰角高於此值才算「要吊上去」，rad */
  stallGuardElevation: number
  /** 瞄準點相對目標的最大角位移，rad */
  maxOffsetAngle: number
}

/**
 * **全部都是起始值，待 Task 14 由對戰矩陣量測後回填。**
 */
export const DEFAULT_STEER: SteerConfig = {
  overshootRange: 120,
  stallGuardMargin: 1.25,
  stallGuardElevation: 45 * (Math.PI / 180),
  maxOffsetAngle: 20 * (Math.PI / 180),
}

/**
 * 幾何有效性閘門（spec §7.1）。在算 yo-yo 平面之前先過。
 *
 * 【優先序：超前 > 吊機首 > 平面退化】撞上去比失速嚴重，失速比瞄不準嚴重。
 */
export function geometryGate(
  sit: Situation,
  basis: EngageBasis,
  cfg: SteerConfig = DEFAULT_STEER,
): SteerMode {
  // 極近距離時預瞄點會產生指揮儀兌現不了的角速度需求：100 m 外、橫向
  // 200 m/s 的目標，視線角速度是 2 rad/s = 115°/s，而 P-51 的最大滾轉率
  // 只有約 100°/s——瞄準點每格劇烈跳動而飛機跟不上。
  if (sit.range < cfg.overshootRange && sit.closureRate > 0) return 'overshoot'

  // 【吊機首與平面奇異是兩件事】平飛時目標在正上方，速度與視線互相垂直，
  // 平面定義得非常好——壞的是能量不是幾何。所以這一條用失速裕度判，
  // 不用平面模長判。
  const elevation = Math.asin(Math.max(-1, Math.min(1, basis.losAxis.y)))
  if (elevation > cfg.stallGuardElevation && sit.stallMargin < cfg.stallGuardMargin) {
    return 'stallGuard'
  }

  // 真正的幾何奇異：升力方向 ∥ 視線，「上方」沒有唯一解
  if (basis.verticalDegenerate) return 'planeDegenerate'

  return 'normal'
}
