import { G0 } from '../core/math'
import type { AirData } from './types'

export const T0 = 288.15
export const P0 = 101325
const LAPSE = 0.0065
const R = 287.05
/**
 * 海平面標準密度。由 P0 / (R · T0) 推導而非寫死 1.225，
 * 確保 σ = ρ / RHO0 在海平面恰好等於 1。
 * ICAO ISA 的 1.225 kg/m³ 是這個推導值的四捨五入顯示值；
 * 兩者相差 1.0e-5（0.001%），物理上無意義，但自洽性對
 * 後續增壓器臨界高度的 σ 比較很重要。
 */
export const RHO0 = P0 / (R * T0)
const GAMMA = 1.4
const H_TROP = 11000
const T_TROP = 216.65
const P_TROP = 22632.06

/**
 * ISA 標準大氣。純函數：寫入 out 並回傳，熱路徑零配置。
 *
 * 對流層 (h < 11 km) 使用線性溫度遞減；平流層使用等溫指數律。
 * P-51D 升限 12.8 km 會進入平流層，因此兩段都必須實作。
 */
export function atmosphere(altitude: number, out: AirData): AirData {
  let temperature: number
  let pressure: number

  if (altitude < H_TROP) {
    temperature = T0 - LAPSE * altitude
    pressure = P0 * Math.pow(temperature / T0, G0 / (LAPSE * R))
  } else {
    temperature = T_TROP
    pressure = P_TROP * Math.exp((-G0 * (altitude - H_TROP)) / (R * T_TROP))
  }

  const density = pressure / (R * temperature)

  out.temperature = temperature
  out.pressure = pressure
  out.density = density
  out.soundSpeed = Math.sqrt(GAMMA * R * temperature)
  out.sigma = density / RHO0
  return out
}
