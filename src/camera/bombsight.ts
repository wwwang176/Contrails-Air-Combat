/**
 * 投彈視線的角度限制。**純數學，不 import three** —— 與 `world/bomb.ts`
 * 同一個理由：這條規則有實際行為，而繪製與相機進不了單元測試。
 */

/**
 * 投彈視線的圓錐半角，弧度。**專案負責人指定 70°。**
 *
 * 【它是安全網不是常態限制】量測：B-17G 巡航 90 m/s 之下，落點離天底的角度
 * 在 4,000 m 是 29°、1,000 m 是 50°，要到**高度 200 m** 才達到 70°。平飛
 * 投彈時這個錐永遠不作用；它只擋兩種退化情況 —— 貼地投彈（落點跑到地平線
 * 上）、投彈航路上大幅機動（機腹軸被姿態帶歪）。
 *
 * 【軸是機體固定的】負責人裁定。等於「機腹上的一個窗口」：側滾大了看到的
 * 就是天，機動中投不了彈。陀螺穩定的瞄具不會有這個行為。
 */
export const BOMB_CONE_HALF_ANGLE = (70 * Math.PI) / 180

export interface Vec3Like {
  x: number
  y: number
  z: number
}

/**
 * 把單位方向 `d` 夾進以單位向量 `a` 為軸、半角為 `acos(cosHalf)` 的圓錐。
 * 就地寫進 `out`（熱路徑不得配置）。
 *
 * `cosHalf` / `sinHalf` 由呼叫端預先算好 —— 半角是常數，每幀重算兩個三角
 * 函數沒有意義。
 *
 * @returns 有沒有夾制。true 對應 HUD 的 `clamped` 狀態 —— 圓圈不在真正的
 *          落點上，那件事必須看得出來
 */
export function coneClamp(
  dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number,
  cosHalf: number, sinHalf: number,
  out: Vec3Like,
): boolean {
  const dot = dx * ax + dy * ay + dz * az
  if (dot >= cosHalf) {
    out.x = dx; out.y = dy; out.z = dz
    return false
  }

  // d 在垂直於 a 的平面上的分量。正規化後就是「錐面上離 d 最近」的那個方位
  let nx = dx - ax * dot
  let ny = dy - ay * dot
  let nz = dz - az * dot
  let len = Math.sqrt(nx * nx + ny * ny + nz * nz)

  if (len < 1e-9) {
    // 【d 與 a 恰好反向】方位角未定義。取任一與 a 垂直的方向 —— 那個姿態下
    // 畫面上朝哪一側都無所謂，重點是不能吐出 NaN（同 `CameraRig`
    // `baseOrientation` 對天頂的處理）。
    //
    // 【備用向量要避開與 a 平行】軸本身沿 X 時挑 (1,0,0) 會再退化一次
    const px = Math.abs(ax) < 0.9 ? 1 : 0
    const py = Math.abs(ax) < 0.9 ? 0 : 1
    const d2 = px * ax + py * ay
    nx = px - ax * d2
    ny = py - ay * d2
    nz = -az * d2
    len = Math.sqrt(nx * nx + ny * ny + nz * nz)
  }

  nx /= len; ny /= len; nz /= len
  out.x = ax * cosHalf + nx * sinHalf
  out.y = ay * cosHalf + ny * sinHalf
  out.z = az * cosHalf + nz * sinHalf
  return true
}
