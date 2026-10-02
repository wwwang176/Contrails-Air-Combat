/**
 * # 迫擊砲的拋物線
 *
 * 位置是時間的**解析函數**，不積分：發射點、三個初速分量、飛行時間存起來，任何時刻的位置
 * 直接算。幀率再低、暫停再久，彈頭都落在同一個點、同一個時刻；尾流的每一環也是從這裡取。
 *
 * 純數學，沒有 three。熱路徑：結果寫進呼叫端給的物件，不配置。
 */

/** 重力加速度，m/s² */
export const ARC_GRAVITY = 9.81

/** 一發的彈道。`flight` 是從發射到落地的秒數 */
export interface ArcShot {
  x0: number
  y0: number
  z0: number
  vx: number
  vy: number
  vz: number
  flight: number
}

export interface ArcPoint {
  x: number
  y: number
  z: number
}

/**
 * 由發射點、落點與仰角反解彈道。回傳 `false` 表示打不到（太近，或目標比仰角線還高），
 * 這時 `out` 不可用。
 *
 * 水平位移 `d`、仰角 `θ`、高度差 `dy` 之下，水平速度 `vh` 滿足
 * `dy = d·tanθ − g·d² / (2·vh²)`，所以 `vh² = g·d² / (2·(d·tanθ − dy))`；
 * 飛行時間 `d / vh`，垂直初速 `vh·tanθ`。
 */
export function solveArc(
  x0: number, y0: number, z0: number,
  dx: number, dy: number, dz: number,
  elevation: number, out: ArcShot,
): boolean {
  // 【先驗再寫】NaN 與 Infinity 在每個比較裡都是 false 或溢位，會讓尾流的頂點壞掉、
  // 而且那一發永遠不落地也不到期
  if (!Number.isFinite(x0 + y0 + z0 + dx + dy + dz + elevation)) return false
  const d = Math.sqrt(dx * dx + dz * dz)
  if (d < 1) return false
  const tan = Math.tan(elevation)
  const room = d * tan - dy
  if (!(room > 0)) return false
  const vh = Math.sqrt((ARC_GRAVITY * d * d) / (2 * room))
  const flight = d / vh
  if (!(vh > 0) || !Number.isFinite(vh * tan) || !Number.isFinite(flight)) return false
  out.x0 = x0
  out.y0 = y0
  out.z0 = z0
  out.vx = (dx / d) * vh
  out.vz = (dz / d) * vh
  out.vy = vh * tan
  out.flight = flight
  return true
}

/** 飛行 `t` 秒之後的位置。`t` 不夾：呼叫端自己決定要不要超過 `flight` */
export function arcAt(s: ArcShot, t: number, out: ArcPoint): void {
  out.x = s.x0 + s.vx * t
  out.y = s.y0 + s.vy * t - 0.5 * ARC_GRAVITY * t * t
  out.z = s.z0 + s.vz * t
}
