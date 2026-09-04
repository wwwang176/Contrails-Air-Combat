/**
 * 投彈視線的角度限制。**純數學，不 import three** —— 與 `world/bomb.ts`
 * 同一個理由：這條規則有實際行為，而繪製與相機進不了單元測試。
 */

/**
 * 投彈視線的圓錐半角，弧度。
 *
 * 【45° 的上界是自己的機體】再開下去相機會掃到機身與機翼 —— 那是窗口的
 * 邊緣，不是可以再借的視野。
 *
 * 【它會在低空作用】量測：B-17G 巡航 90 m/s 之下，落點離天底的角度在
 * 4,000 m 是 29°、2,000 m 是 40°，約 **1,500 m** 起達到 45°。低於那個高度
 * 圓圈會離開畫面中心，再低就滑出畫面。
 *
 * 【軸是機體固定的】等於「機腹上的一個窗口」：側滾大了看到的就是天，機動中
 * 投不了彈。陀螺穩定的瞄具不會有這個行為。
 */
export const BOMB_CONE_HALF_ANGLE = (45 * Math.PI) / 180

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
 * @returns 有沒有夾制。**目前只有測試在讀** —— 畫面上不區分，因為夾制不改變
 *          圓圈的正確性（圈畫的恆是真落點，被夾住的是相機）
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

/**
 * 投彈視角的「螢幕上方」：**機首方向**在垂直於視線的平面上的投影。
 * 就地寫進 `out`（熱路徑不得配置）。
 *
 * 【不能改用 `CameraRig.baseOrientation`】那一支投影的是**世界**上方，而且距
 * 垂直 8° 以內就凍結目標。投彈視線恆在那個區域裡，於是它永遠不更新，畫面的
 * 滾轉會停在切進來時的殘值上慢慢漂。
 *
 * 【機首朝上】瞄具是機腹上的一個窗口，要讀的是「落點在航路的前後左右哪一邊」，
 * 機首固定朝畫面上方才有基準。側滾時畫面跟著滾。
 *
 * @param dx,dy,dz 視線，單位向量
 * @param fx,fy,fz 機首方向（機體 −Z 在世界座標），單位向量
 * @param ux,uy,uz 機體上方（機體 +Y 在世界座標），單位向量。備援用
 */
export function sightUp(
  dx: number, dy: number, dz: number,
  fx: number, fy: number, fz: number,
  ux: number, uy: number, uz: number,
  out: Vec3Like,
): void {
  let d = fx * dx + fy * dy + fz * dz
  let px = fx - dx * d
  let py = fy - dy * d
  let pz = fz - dz * d
  let len = Math.sqrt(px * px + py * py + pz * pz)

  if (len < 1e-6) {
    // 【視線與機首平行】垂直俯衝到圓錐邊緣時做得到。退回機體上方 ——
    // 機首與機體上方必定正交，所以這條備援**永遠**解得出來，不會再退化
    d = ux * dx + uy * dy + uz * dz
    px = ux - dx * d
    py = uy - dy * d
    pz = uz - dz * d
    len = Math.sqrt(px * px + py * py + pz * pz)
  }

  out.x = px / len
  out.y = py / len
  out.z = pz / len
}
