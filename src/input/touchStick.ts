import { clamp } from '../core/math'

/**
 * # 觸控搖桿
 *
 * 設定是滑鼠搖桿、觸控層顯示時，左半邊拖曳推搖桿：手指按下的那一點是搖桿中心，手指相對它的
 * 位移除以 R 是搖桿位置。手指停住桿量不變，放開立刻回中（`releaseTouchGrip`）。
 *
 * 位置是手指給的絕對值，**不經過滑鼠搖桿的累積與回中衰減**（`stepStick`）——套衰減的話
 * 「回中：快」會把按住不動的手指吃掉。之後一樣過死區與曲線（`shapeStick`）。
 */

/** 滿桿的位移，視窗高度的比例。起始值，由試玩裁定 */
export const TOUCH_STICK_RADIUS = 0.12

export interface TouchStick {
  x: number
  y: number
}

/**
 * 手指相對按下點的位移（像素，畫面 y 往下）→ 搖桿位置（−1…1，右、上為正）。
 * 每軸各自夾在 ±1：斜拖到底是 (1, 1)，與滑鼠搖桿一樣是方形。寫進 `out` 並回傳它，不配置
 */
export function touchStickPosition(dxPx: number, dyPx: number, radiusPx: number, out: TouchStick): TouchStick {
  out.x = clamp(dxPx / radiusPx, -1, 1)
  out.y = clamp(-dyPx / radiusPx, -1, 1)
  return out
}
