import type { BufferGeometry } from 'three'
import { assemble, cyl } from './parts'

/**
 * 步兵一個班：五根圓柱，左右對稱散開。程序化，不做人形 —— 從投彈高度看
 * 只是幾個點，認得出來靠的是他們在開火（`render/groundBattle.ts`）。
 *
 * 尺寸是**幾何算出來的**，`ground-units.test.ts` 對 `real*` 的容差是 5%。
 */
const MAN_R = 0.25
const MAN_H = 1.8
/** 每一個人在班裡的位置，m。x 成對對稱 */
const SPOTS = [
  { x: -3, z: 0 }, { x: 3, z: 0 },
  { x: -1.5, z: -1.2 }, { x: 1.5, z: -1.2 },
  { x: 0, z: 0.8 },
] as const

export const INFANTRY_SIZE = {
  x: 6 + MAN_R * 2,
  y: MAN_H,
  z: 2 + MAN_R * 2,
} as const

/** 野戰灰與土黃之間，兩邊的步兵共用一份幾何 */
const UNIFORM = 0x5c5a48

export function buildInfantrySquad(): BufferGeometry {
  return assemble(SPOTS.map((p) => cyl(MAN_R, MAN_H, UNIFORM, { x: p.x, y: MAN_H / 2, z: p.z }, 6)))
}
