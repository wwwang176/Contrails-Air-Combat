import type { BufferGeometry } from 'three'
import { assemble, box, cyl, HUE } from './parts'

/**
 * 洛伊納合成油廠的六種構件。**程序化，沒有參考模型** —— 化工廠是圓柱與
 * 方盒的集合，`parts.ts` 的積木剛好夠。
 *
 * 尺寸在 `PLANT_SIZE`：腳印 × 高（m）。命中盒（`index.ts`）與護欄測試都對
 * 著同一份數字，幾何不得超出它。
 *
 * 【殘骸】每一種都有一個矮一截的殘骸版：腳印不變、高度四分之一、焦黑。
 * 炸毀之後命中盒不再擋炸彈（`World.onBombBlocked`），畫面也要跟著矮下去，
 * 否則炸彈會穿過一根還站著的煙囪在地上爆。
 */
export const PLANT_SIZE = {
  hydroTower: { x: 8, y: 40, z: 8 },
  chimney: { x: 8, y: 100, z: 8 },
  boilerHouse: { x: 60, y: 18, z: 30 },
  oilTank: { x: 25, y: 12, z: 25 },
  gasHolder: { x: 40, y: 35, z: 40 },
  coolingTower: { x: 30, y: 40, z: 30 },
} as const

export type PlantKind = keyof typeof PLANT_SIZE

const PLANT_HUE = {
  /** 鋼構：塔、氣櫃 */
  steel: HUE.steel,
  /** 磚：煙囪、鍋爐房 */
  brick: 0x6b4a3c,
  /** 油槽的淺灰 */
  tank: 0x8a8a80,
  /** 混凝土：冷卻塔 */
  concrete: 0x9a978c,
  /** 屋頂 */
  roof: 0x4a4d4a,
  /** 殘骸的焦黑。純黑是一團洞，所以是很深的褐 */
  ruin: 0x2e2a26,
} as const

/** 圓柱的分段。塔身 12、大桶 16 */
const SLIM = 12
const WIDE = 16

export function buildHydroTower(): BufferGeometry {
  const { x, y } = PLANT_SIZE.hydroTower
  const r = x / 2
  return assemble([
    // 塔身，外加頂上一圈平台與一根細管
    cyl(r * 0.85, y * 0.9, PLANT_HUE.steel, { y: y * 0.45 }, SLIM),
    cyl(r, y * 0.04, PLANT_HUE.steel, { y: y * 0.9 }, SLIM),
    cyl(r * 0.25, y * 0.1, PLANT_HUE.brick, { y: y * 0.95 }, 8),
  ])
}

export function buildChimney(): BufferGeometry {
  const { x, y } = PLANT_SIZE.chimney
  // 底寬頂窄；外廓寬度由底決定
  return assemble([
    cyl(x / 2, y, PLANT_HUE.brick, { y: y / 2 }, SLIM, x / 2 * 0.7),
  ])
}

export function buildBoilerHouse(): BufferGeometry {
  const { x, y, z } = PLANT_SIZE.boilerHouse
  const wall = y * 0.8
  const slab = y * 0.1
  return assemble([
    box(x, wall, z, PLANT_HUE.brick, { y: wall / 2 }),
    // 階梯式屋頂：全幅的平板加一條屋脊。斜板旋轉之後會超出腳印，而命中盒
    // 是由腳印撐起來的
    box(x, slab, z, PLANT_HUE.roof, { y: wall + slab / 2 }),
    box(x, slab, z * 0.4, PLANT_HUE.roof, { y: wall + slab * 1.5 }),
  ])
}

export function buildOilTank(): BufferGeometry {
  const { x, y } = PLANT_SIZE.oilTank
  return assemble([
    cyl(x / 2, y * 0.94, PLANT_HUE.tank, { y: y * 0.47 }, WIDE),
    // 淺錐頂
    cyl(x / 2, y * 0.06, PLANT_HUE.tank, { y: y * 0.97 }, WIDE, x / 2 * 0.2),
  ])
}

export function buildGasHolder(): BufferGeometry {
  const { x, y } = PLANT_SIZE.gasHolder
  return assemble([
    cyl(x / 2, y * 0.92, PLANT_HUE.steel, { y: y * 0.46 }, WIDE),
    cyl(x / 2, y * 0.08, PLANT_HUE.steel, { y: y * 0.96 }, WIDE, x / 2 * 0.3),
  ])
}

export function buildCoolingTower(): BufferGeometry {
  const { x, y } = PLANT_SIZE.coolingTower
  // 雙曲面簡化成底寬頂窄的截錐
  return assemble([
    cyl(x / 2, y, PLANT_HUE.concrete, { y: y / 2 }, WIDE, x / 2 * 0.65),
  ])
}

/** 殘骸：腳印不變、高度四分之一、焦黑。與活著的那一版共用同一份尺寸 */
export function buildPlantRuin(kind: PlantKind): BufferGeometry {
  const { x, y, z } = PLANT_SIZE[kind]
  const h = y * 0.25
  return assemble([box(x, h, z, PLANT_HUE.ruin, { y: h / 2 })])
}

export const PLANT_BUILDERS: Readonly<Record<PlantKind, () => BufferGeometry>> = {
  hydroTower: buildHydroTower,
  chimney: buildChimney,
  boilerHouse: buildBoilerHouse,
  oilTank: buildOilTank,
  gasHolder: buildGasHolder,
  coolingTower: buildCoolingTower,
}
