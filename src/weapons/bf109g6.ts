import { Vector3 } from 'three'
import type { Battery, WeaponSpec } from './types'

export const MG151_20: WeaponSpec = {
  id: 'mg151-20',
  name: 'MG 151/20',
  muzzleVelocity: 705,
  roundsPerMinute: 700,
  damage: 28,
}

export const MG131: WeaponSpec = {
  id: 'mg131',
  name: 'MG 131',
  muzzleVelocity: 750,
  roundsPerMinute: 900,
  damage: 10,
}

/**
 * 109 的武裝全部在中軸線附近，任何距離都不必修正匯聚——這個史實優勢
 * 從資料自然落出來，不需要另外設計（spec §5.3）。
 *
 * 【位置怎麼來的】取自 M1 量出來的造型（`src/render/geometry/bf109e.ts`）：
 *   MG 151/20  穿槳轂，所以在整流罩軸心上。整流罩軸心 y = 0.36，
 *              錐尖在 z = −2.575；槍口取 −2.58（錐尖處）。
 *   MG 131 ×2  機首上方，G-6 的 Beulen 底下。引擎罩在 z = −1.6 附近的
 *              背線約 y = 0.81，兩挺分置 x = ±0.20、y = 0.72。
 *
 * 【外型是 E-4、武裝是 G-6】專案負責人裁決：飛行模型用 G-6、參考模型是
 * E-4（見 bf109e.ts 檔頭）。武裝跟著飛行模型走，所以是 G-6 的。E-4 的
 * 機首是兩挺 MG 17，不是 MG 131。
 */
export const BF109G6_BATTERY: Battery = {
  mounts: [
    { weapon: MG151_20, position: new Vector3(0, 0.36, -2.58) },
    { weapon: MG131, position: new Vector3(0.20, 0.72, -1.60) },
    { weapon: MG131, position: new Vector3(-0.20, 0.72, -1.60) },
  ],
  convergence: 300,
  // 傷害最高也最慢的那一挺，提前量取它最保守
  sight: MG151_20,
}
