/**
 * ISO 9613-1:1993 的均勻大氣吸收；不包含球面擴散、地面反射或遮蔽。
 * https://www.iso.org/standard/17426.html
 * 濕度以百分比輸入（70，而非 0.7），壓力單位 kPa。
 */
export interface Atmosphere {
  temperatureC: number
  humidityPercent: number
  pressureKPa: number
}

/** 尚未模擬沿傳播路徑的天氣；全場採用明確的固定條件。 */
export const STANDARD_ATMOSPHERE: Readonly<Atmosphere> = {
  temperatureC: 20, humidityPercent: 70, pressureKPa: 101.325,
}

/** 回傳每公尺的吸收 dB；常數只在建立模型時算一次。 */
export function createAtmosphericAbsorption(atmosphere: Readonly<Atmosphere> = STANDARD_ATMOSPHERE) {
  const t = atmosphere.temperatureC + 273.15
  const pr = atmosphere.pressureKPa / 101.325
  if (!Number.isFinite(t) || t < 200 || t > 350 || !Number.isFinite(pr) || pr <= 0
    || !Number.isFinite(atmosphere.humidityPercent) || atmosphere.humidityPercent < 0
    || atmosphere.humidityPercent > 100) throw new Error('大氣條件超出支援範圍')
  const tr = t / 293.15
  const h = atmosphere.humidityPercent * 10 ** (-6.8346 * (273.16 / t) ** 1.261 + 4.6151) / pr
  const oxygen = pr * (24 + 4.04e4 * h * (0.02 + h) / (0.391 + h))
  const nitrogen = pr * tr ** -0.5 * (9 + 280 * h * Math.exp(-4.17 * (tr ** (-1 / 3) - 1)))
  const classical = 1.84e-11 / pr * Math.sqrt(tr)
  const oxygenWeight = tr ** -2.5 * 0.01275 * Math.exp(-2239.1 / t)
  const nitrogenWeight = tr ** -2.5 * 0.1068 * Math.exp(-3352 / t)
  return (frequencyHz: number): number => {
    const f2 = frequencyHz * frequencyHz
    return 8.686 * f2 * (classical + oxygenWeight / (oxygen + f2 / oxygen)
      + nitrogenWeight / (nitrogen + f2 / nitrogen))
  }
}

export const atmosphericAbsorption = createAtmosphericAbsorption()
