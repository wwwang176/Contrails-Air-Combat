import { Vector3 } from 'three'
import type { Battery } from './types'
import type { Turret } from './turret'
import { muzzleAt } from './turret'
import { MG131, MG15 } from './sharedGuns'
import { DEG } from '../core/math'

export { MG15 } from './sharedGuns'

/**
 * He 111 H-6 的 `Battery` —— **掛架是空的**。
 *
 * 【為什麼空的】機首那挺 MG 15 是球形槍座上的**手持活動槍**，由投彈手操作，
 * 駕駛員扣不到。**可以轉向的都交給 AI，玩家不控火砲**，所以它在
 * `HE111_TURRETS` 的 `nose` 那一座。
 *
 * 【為什麼還留著這個 Battery】`sight` 仍然被讀：`ai/assess.ts` 與
 * `ai/steer.ts` 共四處用它的 `muzzleVelocity` 解射擊提前量。`convergence`
 * 沒有掛架可以匯聚，留著只是欄位必填。
 */
export const HE111_BATTERY: Battery = {
  mounts: [],
  convergence: 300,
  sight: MG15,
}

/**
 * He 111 的自衛砲塔 —— **五座、槍管合計 6 根**。
 *
 * 真機的槍位編號是 A（機首）／B（機背）／C（機腹吊艙後）／D（兩側腰窗）。
 * 側窗兩挺不是每一架都裝，這裡照最完整的配置。
 *
 * ```
 *   nose     MG 15    7.92 mm 單管
 *   dorsal   MG 131   13 mm 單管      ← H-16 起的配置
 *   ventral  MG 15    7.92 mm 雙聯    ← MG 81Z
 *   beamL/R  MG 15    7.92 mm 單管
 * ```
 *
 * 【它仍然遠弱於 B-17G】那是對的：十三挺 .50 對這六根，He 111 是「會咬人
 * 但咬不死」，B-17 是「不能久留」。兩台的難度差距來自槍的口徑與數量，不是
 * 來自射界 —— 射界反而是 He 111 的機腹那座比較好。
 *
 * ── 位置的來源，逐項標明 ───────────────────────────────────
 *
 * ```
 *   nose     量測  機體 z −2.93（機首尖端 −3.23 之後 0.30）、**偏右 x 0.25**
 *                   —— 真機的機首機槍座就是偏右的，那也是它機首不對稱的
 *                   原因（機首有固定 0.147 的橫向偏心）
 *   dorsal   量測  開口機體 z 1.85…3.05，取中段 2.40；機身背線在該站 1.59，
 *                   槍口取罩子外的 1.72
 *   ventral  量測  吊艙後窗機體 z 4.51…5.51，艙底在 z 4.911 是 −1.077
 *                   （截面中心 −0.732、半高 0.345）；槍口取艙尾 5.30、y −0.85
 *   beam     量測  出貨 GLB（`he111.glb`）兩側側窗的玻璃：x ±0.70…0.82、
 *                   y 0.33…0.69、z 3.01…4.21，蒙皮點取窗的中心 —— 槍管從玻璃
 *                   中間伸出去
 * ```
 *
 * 【半角與旋轉速率是設計值】理由與 `weapons/b17g.ts` 的 `B17G_TURRETS`
 * 完全相同 —— 射界不規則而照片讀不出邊界，一個中心方向 + 一個半角才是
 * 可以被試飛推翻的形式。五挺全是手持槍，所以旋轉速率一律 90 °/s。
 */
export const HE111_TURRETS: readonly Turret[] = [
  { id: 'nose', weapon: MG15, position: muzzleAt(new Vector3(0.25, 0.35, -2.93),
      new Vector3(0, 0, -1)),
    axis: new Vector3(0, 0, -1),
    halfAngle: 40 * DEG, rotationRate: 90 * DEG, guns: 1 },
  // 【機背是 MG 131】H-16 起的實際配置，13 mm 取代原本的 7.92 mm。
  // 與 Bf109 的機首兩挺是**同一份** `MG131` —— 同一款槍就該是同一個物件
  { id: 'dorsal', weapon: MG131, position: muzzleAt(new Vector3(0, 1.72, 2.40),
      new Vector3(0, 0.64, 0.77).normalize()),
    axis: new Vector3(0, 0.64, 0.77).normalize(),
    halfAngle: 70 * DEG, rotationRate: 90 * DEG, guns: 1 },
  // 【腹艙後是雙聯】H-16 起的 MG 81Z（Zwilling）。這裡用 `guns: 2` 表達 ——
  // 乘的是傷害不是射速，理由見 `turret.ts` 的 `Turret.guns`
  { id: 'ventral', weapon: MG15, position: muzzleAt(new Vector3(0, -0.85, 5.30),
      new Vector3(0, -0.64, 0.77).normalize()),
    axis: new Vector3(0, -0.64, 0.77).normalize(),
    halfAngle: 60 * DEG, rotationRate: 90 * DEG, guns: 2 },
  { id: 'beamR', weapon: MG15, position: muzzleAt(new Vector3(0.78, 0.51, 3.61),
      new Vector3(1, 0, 0)),
    axis: new Vector3(1, 0, 0),
    halfAngle: 45 * DEG, rotationRate: 90 * DEG, guns: 1 },
  { id: 'beamL', weapon: MG15, position: muzzleAt(new Vector3(-0.78, 0.51, 3.61),
      new Vector3(-1, 0, 0)),
    axis: new Vector3(-1, 0, 0),
    halfAngle: 45 * DEG, rotationRate: 90 * DEG, guns: 1 },
]
