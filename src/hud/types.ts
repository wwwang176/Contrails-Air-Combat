export interface HudFrame {
  /** 真空速，m/s */
  tas: number
  /** 指示空速，m/s */
  ias: number
  mach: number
  /** m */
  altitude: number
  /** 升降率，m/s */
  verticalSpeed: number
  /** 航向，rad（0 = −Z 方向，順時針為正） */
  heading: number
  /** 滾轉角，rad（右滾為正） */
  roll: number
  /** 俯仰角，rad（上仰為正） */
  pitch: number
  loadFactor: number
  alpha: number
  alphaCrit: number
  /** 比超量功率，m/s */
  ps: number
  /** 比能量，m */
  es: number
  throttle: number
  powerW: number
  /**
   * 滑鼠準星位置，**單位為螢幕半高**。
   *
   * 瞄準點是世界方向而不是螢幕座標（見 input/InputState 的 aimWorld），
   * 所以這兩個值由 main.ts 投影而來，不是輸入層直接給的。相機跟著瞄準點
   * 走，因此正常情況下這兩個值都貼近 0。
   */
  aimX: number
  aimY: number
  aimVisible: boolean
  /** 機首方向投影至螢幕的正規化座標（NDC），visible 為 false 時位於背後 */
  noseX: number
  noseY: number
  noseVisible: boolean
  /** 世界平面座標，供小地圖使用 */
  worldX: number
  worldZ: number
  aircraftName: string
}

export function createHudFrame(): HudFrame {
  return {
    tas: 0, ias: 0, mach: 0, altitude: 0, verticalSpeed: 0,
    heading: 0, roll: 0, pitch: 0,
    loadFactor: 1, alpha: 0, alphaCrit: 1,
    ps: 0, es: 0, throttle: 0, powerW: 0,
    aimX: 0, aimY: 0, aimVisible: true,
    noseX: 0, noseY: 0, noseVisible: true,
    worldX: 0, worldZ: 0, aircraftName: '',
  }
}

/** 指示空速 = 真空速 × √(密度比)。 */
export function indicatedAirspeed(tas: number, sigma: number): number {
  return tas * Math.sqrt(Math.max(sigma, 0))
}

export interface HudLayout {
  width: number
  height: number
  cx: number
  cy: number
  /** 螢幕半高，準星座標的單位長度 */
  unit: number
  scale: number
}

export const HUD_COLORS = {
  primary: '#7dfba8',
  dim: 'rgba(125, 251, 168, 0.45)',
  warn: '#ffcc44',
  danger: '#ff5a4d',
  friendly: '#5aa9ff',
  panel: 'rgba(0, 0, 0, 0.35)',
} as const

/** HUD 統一字型。字級由呼叫端乘上 L.scale。 */
export function hudFont(px: number, bold = false): string {
  return `${bold ? 'bold ' : ''}${px}px ui-monospace, Consolas, monospace`
}
