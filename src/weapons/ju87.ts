import { Vector3 } from 'three'
import type { Battery, Mount, WeaponSpec } from './types'
import type { Turret } from './turret'
import { muzzleAt } from './turret'
import { MG15 } from './sharedGuns'
import { DEG } from '../core/math'

/**
 * MG 17，7.92 mm。與 `MG15` 同一顆彈（7.92×57），所以傷害也是 5。
 *
 * 【與 MG 15 不同的兩個數】固定式、由駕駛員扣發：
 *   初速 855 m/s（MG 15 是 765）：槍管較長
 *   射速 1,150 發/分（MG 15 是 1,050）：Ju 87 的兩挺裝在機翼，**不必與螺旋槳
 *   同步**，打的是自由射速
 */
export const MG17: WeaponSpec = {
  id: 'mg17',
  name: 'MG 17',
  muzzleVelocity: 855,
  caliber: 7.92,
  roundsPerMinute: 1150,
  damage: 5,
}

/**
 * 兩挺翼內 MG 17 的槍口，**機體座標**：槍管最前端在 (±2.015, −0.333, −0.796)，
 * 就在倒鷗翼折點外側、前緣前 0.1 m。
 */
const STATIONS: readonly (readonly [number, number, number])[] = [
  [2.015, -0.333, -0.796],
]

const MOUNTS: Mount[] = []
for (const [x, y, z] of STATIONS) {
  MOUNTS.push({ weapon: MG17, position: new Vector3(x, y, z) })
  MOUNTS.push({ weapon: MG17, position: new Vector3(-x, y, z) })
}

/**
 * Ju 87 B-2 的前射武裝：兩挺翼內 MG 17，各 500 發。匯聚距離 300 m：俯衝
 * 轟炸機的機槍是拿來掃地面與追擊的，不是遠距空戰。
 */
export const JU87_BATTERY: Battery = {
  mounts: MOUNTS,
  convergence: 300,
  sight: MG17,
}

/**
 * 後座的 MG 15，由無線電兼射手操作的手持活動槍，**一座、單管**。id 用
 * `dorsal`：裝在座艙罩後段、朝機尾，與 He 111 的機背槍座同一種位置。
 *
 * 【位置】收起的槍管底座在 (0.01, 0.66, 2.11)，
 * 也就是後座玻璃罩後段的環座上。槍口推到罩頂的高度 0.85、往後指。
 *
 * 【射界】後座的環座只能向後、向上、向兩側打，機身與垂尾擋掉正後下方：
 * 半角 50°，軸線朝後上方 15°。**半角與旋轉速率是設計值**，與 `he111.ts`
 * 的各座同一個處境 —— 由試飛裁定。
 */
export const JU87_TURRETS: readonly Turret[] = [
  { id: 'dorsal', weapon: MG15, position: muzzleAt(new Vector3(0, 0.85, 2.15),
      new Vector3(0, 0.26, 0.97).normalize()),
    axis: new Vector3(0, 0.26, 0.97).normalize(),
    halfAngle: 50 * DEG, rotationRate: 90 * DEG, guns: 1 },
]
