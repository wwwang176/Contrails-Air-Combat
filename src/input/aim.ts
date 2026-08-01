import type { Vector3 } from 'three'

/**
 * 由準星的螢幕位置產生機體座標的瞄準方向。
 *
 * 不經過相機——這使得右鍵自由視角自然不會影響飛行指令，
 * 且準星偏離中心時飛機會建立穩定轉彎率（滑鼠瞄準模式的正確行為）。
 */
export function aimDirectionBody(
  aimX: number,
  aimY: number,
  fovYRad: number,
  out: Vector3,
): Vector3 {
  const t = Math.tan(fovYRad / 2)
  return out.set(aimX * t, aimY * t, -1).normalize()
}

/**
 * 將 (x, y) 夾制在半徑 radius 的圓內。
 *
 * 圓內的點原樣不變；圓外的點沿原方向縮放投影到圓周上（角度不變）。
 * 必須是圓而不是方形——方形夾制會讓對角線方向的操縱量比軸向多出 √2 倍，
 * 使準星在斜向移動時「跑得更快」，操縱手感不對稱。
 */
export function clampToCircle(x: number, y: number, radius: number): { x: number; y: number } {
  const r = Math.hypot(x, y)
  if (r <= radius) return { x, y }
  const scale = radius / r
  return { x: x * scale, y: y * scale }
}
