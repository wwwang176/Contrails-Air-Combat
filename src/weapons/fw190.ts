import { Vector3 } from 'three'
import type { Battery, Mount, WeaponSpec } from './types'
import { MG131 } from './sharedGuns'

/**
 * MG 151/20 20 mm。**翼根兩門，與螺旋槳同調，每門 250 發**（Rechlin 諸元表）。
 *
 * 【初速 705】曳光榴彈與穿甲彈的初速；薄殼榴彈（M-Geschoss）較輕、約 805 m/s。
 * 【射速 700】自由射擊 700–750 發/分取下緣；本模型沒有同調折減。
 * 【傷害 84】與 `weapons/ki84.ts` 對照 ホ5 時用的 MG 151/20 同一格。
 */
export const MG151: WeaponSpec = {
  id: 'mg151',
  name: 'MG 151/20',
  muzzleVelocity: 705,
  caliber: 20,
  roundsPerMinute: 700,
  damage: 84,
}

/**
 * Fw 190 D-9 的四個槍口，**機體座標**。四挺都與螺旋槳同調、都在離中軸 1 m 以內。
 *
 * ```
 *   2 × MG 131      機首上方、引擎罩背線的槍槽裡   每挺 475 發
 *   2 × MG 151/20   翼根，起落架艙內側             每門 250 發
 * ```
 *
 * 機首兩挺：槍管在機鼻頂部槍槽（z −0.49…−1.42）的**後端**，槍口在 z −0.63、貼著
 * 該處的背線（y 約 0.61）。子彈從槍管射出，所以槍口不在槍槽前端。
 *
 * 翼根兩門：槍管水平、從翼根前緣（z 約 −0.48）伸出約 0.30 m，槍口在 x ±0.954、
 * y −0.442、z −0.78。模型沒有槍管，槍口火光出現在前緣前方的空中，與真機槍管伸出的位置一致。
 *
 * 【為什麼寫死而不是 import 造型檔】`weapons/` 不相依 `render/`；`hitbox.test.ts` 守住
 * 「每個槍口都落在至少一個命中盒內」。
 */
const MOUNTS: Mount[] = [
  { weapon: MG131, position: new Vector3(0.128, 0.607, -0.63) },
  { weapon: MG131, position: new Vector3(-0.128, 0.607, -0.63) },
  { weapon: MG151, position: new Vector3(0.954, -0.442, -0.78) },
  { weapon: MG151, position: new Vector3(-0.954, -0.442, -0.78) },
]

export const FW190_BATTERY: Battery = {
  mounts: MOUNTS,
  /** 四挺都在中軸附近，匯聚距離幾乎不影響彈著；取與 K-4 相同的 300 m */
  convergence: 300,
  /** 【5 秒】混裝機砲，與 Ki-84 同一檔 */
  overheatSeconds: 5,
  /** 預瞄環取**初速最快**的那挺（MG 131，750 對 MG 151/20 的 705），與 `weapons/bf109k4.ts` 同一個做法 */
  sight: MOUNTS.reduce((a, b) =>
    (b.weapon.muzzleVelocity > a.weapon.muzzleVelocity ? b : a)).weapon,
}
