import type { BufferGeometry } from 'three'
import { assemble, box, HUE } from './parts'

/**
 * 迫擊砲（暫代：一個立方體）。82／120 mm 與德軍 8 cm 共用一個單位 id，補正式模型時只改
 * 登錄表那一格。尺寸是幾何本身，`ground-units.test.ts` 對 `real*` 的容差是 5%。
 */
export const MORTAR_SIZE = { x: 1.4, y: 1.2, z: 1.4 } as const

export function buildMortar(): BufferGeometry {
  return assemble([box(MORTAR_SIZE.x, MORTAR_SIZE.y, MORTAR_SIZE.z, HUE.armyGreen, { y: MORTAR_SIZE.y / 2 })])
}
