import { villageSite, type FloraSource } from './flora'
import { regionAt, regionSeed, trackGap, trackWidthAt, REGION_SPACING, type RegionSample } from './fields'
import { settlementLayout } from './settlements'
import type { Place } from '../world/landFeatures'

/**
 * # 程序生成的內陸地圖的村與小聚落
 *
 * 村的站址是區塊格的站址（`flora.ts` 的 `villageSite`），田圍著它們長
 * （`fields.ts` 的 `FIELD_REACH`）。每一個站址用洛伊納那一套生成器
 * （`settlements.ts`）蓋成一個 1944 年德國中部的村：三合院農莊、教堂、果園，團狀村
 * 與綠地村各半。每個村旁邊的田裡再撒零到兩個兩三座農莊的小聚落。
 *
 * 【位置只由區塊格決定】名字（生成器的種子）由格的索引組成，與畫到哪一格無關。
 */

/** 小聚落離村的站址多遠，m。田最窄也伸到 840 m（`FIELD_REACH` × 0.7 × 0.8），落在田裡 */
const HAMLET_RING = [500, 820] as const
/** 一個村旁邊最多幾個小聚落 */
const HAMLETS_MAX = 2
/** 村的人口（決定村的大小，`settlementRadius`） */
const VILLAGE_POP = [150, 900] as const
/**
 * 房子離凹路的邊至少多遠，用 `trackGap` 表示：它是離路心的兩倍（`flora.ts` 的
 * `LANE_BAND`），所以 16 是 8 m
 */
const LANE_CLEAR = 16
/** 村心離凹路的中心多遠，m。教堂連留地要整個在路旁 */
const CENTRE_OFFSET = 45

function mix(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
}

/** `half` 見方的半邊以內的村與小聚落 */
export function farmPlaces(half: number): Place[] {
  const out: Place[] = []
  const site = { x: 0, z: 0 }
  const seed = { x: 0, z: 0 }
  const n = Math.ceil(half / REGION_SPACING) + 1
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      if (!villageSite(i, j, site)) continue
      if (Math.abs(site.x) > half || Math.abs(site.z) > half) continue
      // 【村心挪到路旁】站址在凹路正中間（兩顆種子的垂直平分線上），教堂放在那裡會
      // 被「不蓋在路上」擋掉。往這一格的種子挪 —— 那個方向正好垂直於路
      regionSeed(i, j, seed)
      const dl = Math.hypot(seed.x - site.x, seed.z - site.z) || 1
      const cx = site.x + ((seed.x - site.x) / dl) * CENTRE_OFFSET
      const cz = site.z + ((seed.z - site.z) / dl) * CENTRE_OFFSET
      const h = mix((i * 73856093) ^ (j * 19349663))
      const pop = VILLAGE_POP[0] + ((h & 0xffff) / 65536) * (VILLAGE_POP[1] - VILLAGE_POP[0])
      out.push({ name: `v${i},${j}`, kind: 'village', x: cx, z: cz, pop: Math.round(pop) })
      const hamlets = (h >>> 16) % (HAMLETS_MAX + 1)
      for (let k = 0; k < hamlets; k++) {
        const g = mix(h ^ (k * 0x9e3779b1))
        const a = ((g & 0xffff) / 65536) * Math.PI * 2
        const d = HAMLET_RING[0] + ((g >>> 16) / 65536) * (HAMLET_RING[1] - HAMLET_RING[0])
        out.push({ name: `h${i},${j},${k}`, kind: 'hamlet', x: site.x + Math.cos(a) * d, z: site.z + Math.sin(a) * d })
      }
    }
  }
  return out
}

const REG: RegionSample = { r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0 }

/**
 * 村與小聚落的建築與樹，當成一個散佈器。**建地形時跑一次**（`settlementLayout` 預先
 * 算好、依 tile 分桶）。房子不蓋在凹路上
 */
export function farmSettlementFlora(half: number): FloraSource {
  const onLane = (x: number, z: number): boolean => {
    regionAt(x, z, REG)
    return trackGap(x, z, REG) < trackWidthAt(x, z) + LANE_CLEAR
  }
  // 團狀村與綠地村各半：由站址座標的雜湊挑（`eastOfSaale` 在這裡只是村形的開關）
  const angerdorf = (x: number, z: number): boolean => (mix(Math.imul(Math.round(x), 73856093) ^ Math.round(z)) & 1) === 0
  return settlementLayout(farmPlaces(half), onLane, angerdorf).flora
}
