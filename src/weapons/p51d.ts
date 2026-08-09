import { Vector3 } from 'three'
import type { Battery, Mount, WeaponSpec } from './types'

export const M2_BROWNING: WeaponSpec = {
  id: 'm2-50cal',
  name: 'M2 Browning .50 cal',
  muzzleVelocity: 887,
  roundsPerMinute: 800,
  damage: 18,
}

/**
 * 六挺翼槍的槍口位置，**機體座標**。
 *
 * 【怎麼來的】不是配的，是從 M1 量出來的主翼幾何算的（見
 * `src/render/geometry/p51d.ts` 的 WING）：翼根前緣 z = −0.645、前緣後掠
 * 3.5°、中厚線 y = −0.6375、上反 5°。於是在翼展站位 x 處
 *
 *     前緣 z(x) = −0.645 + tan(3.5°)·x = −0.645 + 0.06116·x
 *     中厚 y(x) = −0.6375 + tan(5°)·x  = −0.6375 + 0.08749·x
 *
 * 槍管伸出前緣約 0.35 m。三個站位取 1.30 / 1.68 / 2.06 m（真機三對槍位
 * 在翼展 1.2～2.1 m 之間），左右鏡像。
 *
 * 【為什麼寫死而不是 import 造型檔】`weapons/` 不該相依 `render/`。
 * 數字寫在這裡，推導過程寫在註解裡——這與專案裡其他量測值的做法一致。
 * 另有一條跨模組測試守住「每個槍口都在自己的機翼命中盒內」，見
 * `test/unit/hitbox.test.ts`。
 */
const STATIONS: readonly (readonly [number, number, number])[] = [
  [1.30, -0.52, -0.92],
  [1.68, -0.49, -0.89],
  [2.06, -0.46, -0.87],
]

const MOUNTS: Mount[] = []
for (const [x, y, z] of STATIONS) {
  MOUNTS.push({ weapon: M2_BROWNING, position: new Vector3(x, y, z) })
  MOUNTS.push({ weapon: M2_BROWNING, position: new Vector3(-x, y, z) })
}

export const P51D_BATTERY: Battery = {
  mounts: MOUNTS,
  // spec §2 裁決：固定值，不提供玩家調整。專案負責人於 M10 驗收時由
  // 300 m 改為 1,000 m
  convergence: 1000,
  sight: M2_BROWNING,
}
