/**
 * # 定位：方位角、equal-power 左右矩陣、反比距離衰減
 *
 * 取代瀏覽器的 `PannerNode`。公式照 Web Audio 規格的 equalpower 與 inverse
 * 兩節，**單聲道與立體聲是兩套** —— 立體聲在正中間是原樣通過，單聲道是兩邊
 * 各 √½。算錯的話聲音的左右與遠近會悄悄走樣，不報錯。
 *
 * 【為什麼自己算】`PannerNode` 的位置只要一動，那一段就逐取樣重算方位與距離；
 * 這裡每幀在主執行緒算一次，交給四個增益節點平滑過去，增益的漸變幾乎不花錢。
 */

/** 聽者的位置與朝向。`forward`、`up` 不必是單位向量 */
export interface ListenerPose {
  px: number; py: number; pz: number
  fx: number; fy: number; fz: number
  ux: number; uy: number; uz: number
}

/**
 * 聲源相對聽者的方位角，度：0 = 正前、+90 = 右、−90 = 左、±180 = 正後。
 * 聲源與聽者重合、或正上正下時是 0。
 */
export function azimuthDeg(sx: number, sy: number, sz: number, l: ListenerPose): number {
  let dx = sx - l.px
  let dy = sy - l.py
  let dz = sz - l.pz
  const len = Math.hypot(dx, dy, dz)
  if (!(len > 0)) return 0
  dx /= len; dy /= len; dz /= len
  // 右 = 前 × 上
  let rx = l.fy * l.uz - l.fz * l.uy
  let ry = l.fz * l.ux - l.fx * l.uz
  let rz = l.fx * l.uy - l.fy * l.ux
  const rl = Math.hypot(rx, ry, rz)
  const fl = Math.hypot(l.fx, l.fy, l.fz)
  if (!(rl > 0) || !(fl > 0)) return 0
  rx /= rl; ry /= rl; rz /= rl
  const fx = l.fx / fl, fy = l.fy / fl, fz = l.fz / fl
  // 真正的上 = 右 × 前（與前正交）
  const ux = ry * fz - rz * fy
  const uy = rz * fx - rx * fz
  const uz = rx * fy - ry * fx
  const up = dx * ux + dy * uy + dz * uz
  let px = dx - up * ux
  let py = dy - up * uy
  let pz = dz - up * uz
  const pl = Math.hypot(px, py, pz)
  if (!(pl > 1e-9)) return 0
  px /= pl; py /= pl; pz /= pl
  const cos = px * rx + py * ry + pz * rz
  let az = (180 / Math.PI) * Math.acos(cos > 1 ? 1 : cos < -1 ? -1 : cos)
  if (px * fx + py * fy + pz * fz < 0) az = 360 - az
  return az >= 0 && az <= 270 ? 90 - az : 450 - az
}

/**
 * equal-power 的左右矩陣，乘上 `gain`，寫進 `out`：
 * `[左←左, 左←右, 右←左, 右←右]`。單聲道只用得到前後兩個「←左」。
 */
export function equalPowerMatrix(azimuth: number, stereo: boolean, gain: number, out: Float32Array): void {
  let az = azimuth > 180 ? 180 : azimuth < -180 ? -180 : azimuth
  // 前後對折：equal-power 分不出前後
  if (az < -90) az = -180 - az
  else if (az > 90) az = 180 - az
  if (!stereo) {
    const x = (az + 90) / 180
    out[0] = gain * Math.cos((x * Math.PI) / 2)
    out[1] = 0
    out[2] = gain * Math.sin((x * Math.PI) / 2)
    out[3] = 0
    return
  }
  const x = az <= 0 ? (az + 90) / 90 : az / 90
  const gl = Math.cos((x * Math.PI) / 2)
  const gr = Math.sin((x * Math.PI) / 2)
  if (az <= 0) {
    out[0] = gain
    out[1] = gain * gl
    out[2] = 0
    out[3] = gain * gr
  } else {
    out[0] = gain * gl
    out[1] = 0
    out[2] = gain * gr
    out[3] = gain
  }
}

/** 反比距離衰減（規格的 inverse 模型）。`ref` 以內不衰減；`rolloff` 0 = 不衰減 */
export function inverseDistanceGain(distance: number, ref: number, rolloff: number): number {
  if (!(ref > 0)) return 1
  const d = distance > ref ? distance : ref
  return ref / (ref + rolloff * (d - ref))
}
