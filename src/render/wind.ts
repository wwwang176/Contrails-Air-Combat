import { hash01 } from './scatter'

/**
 * # 煙的風
 *
 * 每一場戰鬥一陣很輕的水平風，只吹煙與塵（`ParticleConfig.wind`）。不影響雲、模擬、
 * 彈道與判定 —— 所以住在渲染層，而且只是一個畫面參數。
 *
 * `SMOKE_WIND` 是模組層一個可變的值：開風的粒子池每幀讀它。`main.ts` 建地圖時換成
 * 這一張地圖的風、選單期間換成短片的風（`REEL_WIND`）；展示區不設，沒有風。
 */

export interface Wind {
  x: number
  z: number
}

/** 風速範圍，m/s。煙 30 秒飄 30～90 m：煙柱斜向一邊，不會整片被吹走 */
export const WIND_MIN = 1
export const WIND_MAX = 3

/** 這一刻的風，m/s。開風的粒子池每幀讀它 */
export const SMOKE_WIND: Wind = { x: 0, z: 0 }

/**
 * 主選單短片的風，m/s：每一段都是這一陣（世界座標往東偏北）。短片的取景各自轉了
 * 方位，畫面上的風向因此每段不同，但同一段每次播都一樣
 */
export const REEL_WIND: Readonly<Wind> = { x: 1.6, z: -0.6 }

/** 種子 → 風（純函數）：方向 0～360°、大小 `WIND_MIN`～`WIND_MAX`，寫進 `out` */
export function windOf(seed: number, out: Wind): Wind {
  const a = hash01(seed * 0x2c1b3c6d + 1) * Math.PI * 2
  const s = WIND_MIN + hash01(seed * 0x297a2d39 + 2) * (WIND_MAX - WIND_MIN)
  out.x = Math.cos(a) * s
  out.z = Math.sin(a) * s
  return out
}
