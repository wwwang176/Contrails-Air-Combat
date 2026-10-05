import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { NO_INTERCEPT, solveLead } from '../world/lead'
import type { Aircraft } from '../aircraft/Aircraft'

const FWD = new Vector3(0, 0, -1)
const UP = new Vector3(0, 1, 0)
const S = makeScratch(5)
const E = makeScratch(1)

/**
 * 由**當前航向**轉到 `toTarget` 的水平方位要轉多少，rad，值域 (−π, π]。
 * `toTarget` 是**指向錨點的方向**（不必單位化），不是它的世界座標。
 * 正 = 繞 +Y 的正向（左）。與 `unloadAim` 的 `yaw` 同一個約定。
 *
 * 航向取**速度向量**的水平投影而不是機首：脫離時要問的是「我正在往哪裡
 * 走」，而機首在有側滑或大迎角時與航跡差一個角度。速度鉛直時水平投影
 * 退化，改用機首的水平投影（與 `unloadAim` 走同一條退化階梯）。
 *
 * 熱路徑（240 Hz），不配置。
 */
export function headingErrorTo(self: Aircraft, toTarget: Vector3): number {
  const v = self.state.velocity
  let ax = v.x
  let az = v.z
  let ah = Math.hypot(ax, az)
  if (ah < 1e-6) {
    const nose = E.v[0]!.copy(FWD).applyQuaternion(self.state.orientation)
    ax = nose.x
    az = nose.z
    ah = Math.hypot(ax, az)
    if (ah < 1e-6) return 0
  }
  ax /= ah
  az /= ah

  let bx = toTarget.x
  let bz = toTarget.z
  const bh = Math.hypot(bx, bz)
  // 【正上／正下方】水平方位沒有定義。回 0 = 不轉，那是安全的方向 ——
  // 目標就在頭頂時「往哪邊繞」本來就沒有答案，交給俯仰去處理。
  if (bh < 1e-6) return 0
  bx /= bh
  bz /= bh

  return Math.atan2(az * bx - ax * bz, ax * bx + az * bz)
}

/** 視線、目標運動與自身升力構成的交戰基底，所有向量使用世界座標。 */
export interface EngageBasis {
  /** 由我指向目標的單位向量 */
  losAxis: Vector3
  /** 目標運動方向在垂直於視線平面上的投影 */
  leadAxis: Vector3
  /** 自身升力方向在垂直於視線平面上的投影 */
  verticalAxis: Vector3
  /** 由我到彈道預瞄點的相對向量，非單位向量 */
  leadPoint: Vector3
  /** 預瞄點離目標當前位置多遠，m */
  leadScale: number
  /** 攔截時間，s。NO_INTERCEPT 表示無解。 */
  interceptTime: number
  /** 目標運動方向與視線平行，前置／後置沒有唯一方向。 */
  leadDegenerate: boolean
  /** 升力方向與視線平行，上方沒有唯一方向。 */
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
export function perpendicular(v: Vector3, axis: Vector3, out: Vector3): number {
  out.copy(v).addScaledVector(axis, -v.dot(axis))
  const len = out.length()
  if (len > 1e-6) out.divideScalar(len)
  return len
}

/** 低於此模長時方向由浮點雜訊主導。 */
export const AXIS_EPSILON = 0.15

/** 建立交戰基底，不修改輸入飛機。暫存與輸出向量均重用，熱路徑不配置。 */
export function buildEngageBasis(self: Aircraft, target: Aircraft, out: EngageBasis): void {
  const p = S.v[0]!.copy(target.state.position).sub(self.state.position)
  const range = p.length()
  if (range > 1e-3) out.losAxis.copy(p).divideScalar(range)
  else out.losAxis.copy(FWD).applyQuaternion(self.state.orientation)

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

  // 前置／後置沿目標航跡定義，使用目標速度，避免共速尾追時相對速度退化。
  const targetDir = S.v[3]!.copy(target.state.velocity)
  const targetSpeed = targetDir.length()
  if (targetSpeed > 1e-6) targetDir.divideScalar(targetSpeed)
  else targetDir.copy(FWD).applyQuaternion(target.state.orientation)
  out.leadDegenerate = perpendicular(targetDir, out.losAxis, out.leadAxis) < AXIS_EPSILON

  // 拉高沿自身升力方向；大坡度時世界上方會要求先滾平，無法直接拉桿到達。
  const lift = S.v[4]!.copy(UP).applyQuaternion(self.state.orientation)
  out.verticalDegenerate = perpendicular(lift, out.losAxis, out.verticalAxis) < AXIS_EPSILON
}
