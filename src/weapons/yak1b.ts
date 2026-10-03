import { Vector3 } from 'three'
import type { Battery, Mount, WeaponSpec } from './types'

/**
 * ShVAK 20 mm 機砲（20×99R）。Yak-1B 是**發動機砲**：由槳轂的空心軸射出，位置在機鼻尖端。
 *
 * ```
 *   彈頭      HE 91 g、API 96 g
 *   初速      750–790 m/s     取中間 770
 *   射速      700–800 發/分   發動機砲不與螺旋槳同調，取中間 750
 * ```
 *
 * 【傷害 90】照動能對本專案已有的兩個錨點內插：
 *
 * ```
 *              彈頭 g   初速 m/s   動能 kJ   傷害
 *   MG 151/20    92      705       22.9      84
 *   ShVAK        96      770       28.5      90   ← 這裡
 *   九九式二号四型 128     750       36.0     100
 * ```
 */
export const SHVAK: WeaponSpec = {
  id: 'shvak',
  name: 'ShVAK 20mm',
  muzzleVelocity: 770,
  caliber: 20,
  roundsPerMinute: 750,
  damage: 90,
}

/**
 * UBS 12.7 mm 機槍（12.7×108）。機首上方、與螺旋槳同調。
 *
 * ```
 *   彈頭      B-32 API 48.3 g
 *   初速      814 m/s
 *   射速      700–800 發/分（同調型）  取 800
 * ```
 *
 * 【傷害 16】與 M2 白朗寧（45.9 g @ 887 m/s ＝ 18.1 kJ、傷害 18）同比例：
 * 0.5 × 0.0483 × 814² ＝ 16.0 kJ → 16。
 */
export const UBS: WeaponSpec = {
  id: 'ubs',
  name: 'UBS 12.7mm',
  muzzleVelocity: 814,
  caliber: 12.7,
  roundsPerMinute: 800,
  damage: 16,
}

/**
 * Yak-1B 的兩個槍口，**機體座標**（原點在主翼翼根四分之一弦線，y 0 是推力線，機鼻朝 −z）。
 *
 * ```
 *   ShVAK   x 0       y 0       z −2.50   槳轂軸心，在整流罩尖端內側
 *   UBS     x 0.12    y 0.34    z −1.62   引擎罩上緣（罩頂 0.38）、略偏右
 * ```
 *
 * 位置是照造型檔的量測：整流罩尖端在 z −2.618、引擎罩上緣在機鼻後 1.0 m 處是 0.38。
 * `weapons/` 不該相依 `render/`，所以寫死；`test/unit/hitbox.test.ts` 有一條跨模組測試守住
 * 「每個槍口都落在至少一個命中盒內」。
 */
const MOUNTS: Mount[] = [
  { weapon: SHVAK, position: new Vector3(0, 0, -2.50) },
  { weapon: UBS, position: new Vector3(0.12, 0.34, -1.62) },
]

export const YAK1B_BATTERY: Battery = {
  mounts: MOUNTS,
  /** 兩門都在機首中線附近，匯聚距離與其他戰鬥機一致 */
  convergence: 1000,
  /** 預瞄環取初速較快的那一門（UBS 814 對 ShVAK 770） */
  sight: MOUNTS.reduce((a, b) => (b.weapon.muzzleVelocity > a.weapon.muzzleVelocity ? b : a)).weapon,
}
