import type { Vector3 } from 'three'

/**
 * 選單期間的相機高度，m。
 *
 * 【為什麼是低空而不是戰鬥的 4,000 m】海面網格只有 10 km 見方（`ocean.ts`
 * 的 `OCEAN_SIZE`），而且以相機為中心捲動 —— 那塊平面的邊落在
 * `atan(高度 / 5000)` 的俯角上。900 m 時那是 10°，正好在視線附近，畫面上
 * 看得到一條方形的邊甚至一個角。150 m 壓到 1.7°，那條邊於是躲進地平線裡，
 * 讀起來才是「海與天」（M10 spec §9.4）。
 */
export const MENU_CAMERA_ALTITUDE = 150
/** 繞行半徑，m */
export const MENU_CAMERA_RADIUS = 1200
/**
 * 偏航角速度，rad/s。
 *
 * 【為什麼這麼慢】一圈約 105 秒。背景要有「活著」的感覺，但玩家在讀選單，
 * 轉得看得出來就會變成干擾。
 */
export const MENU_CAMERA_YAW_RATE = 0.06

/**
 * 選單期間的鏡頭：定高繞著原點慢慢轉，看向前方的地平線。
 *
 * 【為什麼是純函數】它是時間的函數，沒有狀態。抽出來之後「會不會掉到
 * 海面下」「轉起來連不連續」就是普通的單元測試（M10 spec §9.4）。
 *
 * 【為什麼不用 `CameraRig`】那一整套是為了追一架飛機而存在的（彈簧、
 * 自由視角、FOV 隨速度變化）。選單期間沒有飛機。
 */
export function menuCameraPose(
  elapsed: number, out: { position: Vector3; target: Vector3 },
): void {
  const yaw = elapsed * MENU_CAMERA_YAW_RATE
  out.position.set(
    Math.cos(yaw) * MENU_CAMERA_RADIUS,
    MENU_CAMERA_ALTITUDE,
    Math.sin(yaw) * MENU_CAMERA_RADIUS,
  )
  // 【注視點在切線方向的遠處】看向圓心的話畫面中央永遠是同一片海；
  // 看切線則像是一架飛機在平飛巡航
  const ahead = yaw + Math.PI / 2
  out.target.set(
    out.position.x + Math.cos(ahead) * 8000,
    // 【看向海平面而不是水平】8,000 m 外的海面 = 1.1° 俯角，地平線因此
    // 落在畫面中線略上方，海佔的比例大一點
    0,
    out.position.z + Math.sin(ahead) * 8000,
  )
}
