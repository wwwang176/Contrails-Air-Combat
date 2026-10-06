/** 洛伊納離線資料工具共用的座標基準；北為 −Z、東為 +X。 */


/** 廠區中心的真實座標 */
export const PLANT_LAT = 51.3085

export const PLANT_LON = 12.0048

/** 廠區中心在遊戲世界的座標（`world/leuna.ts` 的 `PLANT_CENTER`） */
export const PLANT_Z = -7000

/** 高度場的範圍：376 格 × 80 m，中心在世界原點 */
export const HALF_M = ((376 - 1) / 2) * 80


export const M_PER_DEG_LAT = 111320

export const M_PER_DEG_LON = 111320 * Math.cos((PLANT_LAT * Math.PI) / 180)


/** 遊戲座標 → 真實經緯度。北 = −Z、東 = +X */
export function toLatLon(x, z) {
  const north = -(z - PLANT_Z)
  return [PLANT_LAT + north / M_PER_DEG_LAT, PLANT_LON + x / M_PER_DEG_LON]
}


/** 真實經緯度 → 遊戲座標 */
export function toGame(lat, lon) {
  return [(lon - PLANT_LON) * M_PER_DEG_LON, PLANT_Z - (lat - PLANT_LAT) * M_PER_DEG_LAT]
}
