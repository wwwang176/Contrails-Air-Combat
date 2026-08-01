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
