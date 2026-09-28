import { Quaternion, Vector3 } from 'three'
import { PARKED_TAIL_DOWN } from '../render/geometry/ground/parked'
import { GEAR_CLEARANCE } from '../control/takeoffRoll'
import type { AircraftSpec } from '../specs/types'
import type { GroundTarget } from './groundTargets'

/**
 * # 地上的飛機：機體座標怎麼擺
 *
 * 停著、滑行中的飛機是地面目標（`GroundTarget.airframe`），但命中照飛機的部位
 * 盒算。部位盒在**機體座標**（原點在重心、機身水平），地面目標的座標是**腳印
 * 中心、底面在地面**。這一支給出兩者之間的轉換。
 *
 * - **停著、滑行**：與停放模型的烘焙同一套（`render/geometry/ground/parked.ts`）
 *   —— 繞 X 下沉 `PARKED_TAIL_DOWN`，再平移到底面貼地、前後置中。平移量由
 *   部位盒算（模型的網格不在這一層），與網格差幾十公分。
 * - **滾行**：機身水平，原點在地面上 `GEAR_CLEARANCE` —— 與離地之後那一架
 *   飛機同一個姿態，交接時接得上。
 */

const TAIL_DOWN = /* @__PURE__ */ new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), PARKED_TAIL_DOWN)
const offsets = new WeakMap<AircraftSpec, Vector3>()
const CORNER = /* @__PURE__ */ new Vector3()

/**
 * 停放姿態下，機體原點相對腳印中心的位移，**本體座標**（還沒套航向）。
 * 每一份規格算一次。
 */
export function parkedOffset(spec: AircraftSpec): Vector3 {
  const hit = offsets.get(spec)
  if (hit !== undefined) return hit
  let minY = Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const b of spec.hitBoxes) {
    for (let k = 0; k < 8; k++) {
      CORNER.set(
        b.center.x + (k & 1 ? b.half.x : -b.half.x),
        b.center.y + (k & 2 ? b.half.y : -b.half.y),
        b.center.z + (k & 4 ? b.half.z : -b.half.z),
      ).applyQuaternion(TAIL_DOWN)
      if (CORNER.y < minY) minY = CORNER.y
      if (CORNER.z < minZ) minZ = CORNER.z
      if (CORNER.z > maxZ) maxZ = CORNER.z
    }
  }
  const out = new Vector3(0, -minY, -(minZ + maxZ) / 2)
  offsets.set(spec, out)
  return out
}

/**
 * 這一台地上飛機的機體原點與姿態，寫進 `pos`、`quat`（世界座標）。
 * `t.airframe` 必須不是 null。熱路徑，不配置。
 */
export function airframePose(t: GroundTarget, pos: Vector3, quat: Quaternion): void {
  if (t.rolling) {
    quat.copy(t.orientation)
    pos.copy(t.position)
    pos.y += GEAR_CLEARANCE
    return
  }
  quat.copy(t.orientation).multiply(TAIL_DOWN)
  pos.copy(parkedOffset(t.airframe!)).applyQuaternion(t.orientation).add(t.position)
}
