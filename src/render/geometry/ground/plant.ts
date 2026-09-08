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
} as const

/** 圓柱的分段。塔身 12、大桶 16 */
const SLIM = 12
const WIDE = 16

/** 鋼骨架、樓梯、欄杆的深色。與佈景的桁架同一個調 */
const FRAME = 0x33383d

/**
 * 氫化塔：細塔身外掛四根角柱與五層平台，側面兩根爬管，頂上一座小附屬槽。
 * 塔身讓出半徑給外圍的鋼骨架 —— 外掛的東西全部要在 8 × 8 的腳印裡。
 */
export function buildHydroTower(): BufferGeometry {
  const { x, y } = PLANT_SIZE.hydroTower
  const r = x / 2
  const parts: BufferGeometry[] = [
    cyl(r * 0.5, y * 0.34, PLANT_HUE.steel, { y: y * 0.17 }, SLIM),
    cyl(r * 0.45, y * 0.34, PLANT_HUE.steel, { y: y * 0.51 }, SLIM),
    cyl(r * 0.38, y * 0.22, PLANT_HUE.steel, { y: y * 0.79 }, SLIM),
  ]
  // 角柱要**撐滿腳印**：命中盒是由腳印撐起來的，幾何縮在裡面的話子彈會
  // 打在看不見的空氣上（`ground-units` 那條 5 cm 的護欄守著）
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(box(0.5, y * 0.9, 0.5, FRAME, { x: sx * (r - 0.25), y: y * 0.45, z: sz * (r - 0.25) }))
    }
  }
  for (let k = 1; k <= 5; k++) {
    parts.push(cyl(r * 0.95, 0.25, FRAME, { y: (y * 0.9 * k) / 5 }, SLIM))
  }
  parts.push(cyl(0.35, y * 0.86, PLANT_HUE.tank, { x: r * 0.72, y: y * 0.43 }, 3))
  parts.push(cyl(0.3, y * 0.7, PLANT_HUE.tank, { x: -r * 0.7, y: y * 0.35, z: r * 0.3 }, 3))
  parts.push(cyl(r * 0.3, y * 0.08, PLANT_HUE.tank, { x: r * 0.4, y: y * 0.96, z: -r * 0.3 }, 8))
  return assemble(parts)
}

/** 煙囪：錐形磚身、四圈箍、一道從底爬到頂的檢修梯。廠區最高的東西 */
export function buildChimney(): BufferGeometry {
  const { x, y } = PLANT_SIZE.chimney
  const r = x / 2
  const parts: BufferGeometry[] = [cyl(r, y, PLANT_HUE.brick, { y: y / 2 }, SLIM, r * 0.7)]
  for (let k = 1; k <= 4; k++) {
    const t = k / 5
    parts.push(cyl(r * (1 - t * 0.3) + 0.15, 0.5, FRAME, { y: y * t }, SLIM))
  }
  // 檢修梯：每 5 m 一段，貼著漸縮的外壁往內收 —— 貼在壁外會撐出腳印
  for (let k = 0; k < 19; k++) {
    const t = (k + 0.5) / 19
    parts.push(box(0.5, 4.4, 0.3, FRAME, { x: r * (1 - t * 0.3) - 0.3, y: y * t }))
  }
  return assemble(parts)
}

/**
 * 鍋爐房：磚牆、階梯屋頂、屋頂上四座通風筒、南牆外一排臥式槽與側管。
 *
 * 【屋頂不用斜板】斜板旋轉之後會超出腳印，而命中盒是由腳印撐起來的。
 */
export function buildBoilerHouse(): BufferGeometry {
  const { x, y, z } = PLANT_SIZE.boilerHouse
  // 牆與屋頂讓出高度給通風筒 —— 整棟連筒都要在 18 m 的命中盒裡
  const wall = y * 0.64
  const slab = y * 0.08
  const parts: BufferGeometry[] = [
    box(x, wall, z, PLANT_HUE.brick, { y: wall / 2 }),
    box(x, slab, z, PLANT_HUE.roof, { y: wall + slab / 2 }),
    box(x, slab, z * 0.4, PLANT_HUE.roof, { y: wall + slab * 1.5 }),
  ]
  // 通風筒的頂就是命中盒的頂
  for (let k = 0; k < 4; k++) {
    parts.push(cyl(1.4, y - wall - slab * 2, FRAME, {
      x: -x * 0.36 + (x * 0.72 * k) / 3, y: (y + wall + slab * 2) / 2,
    }, 8))
  }
  // 南牆外的臥式槽與爬牆的管
  for (let k = 0; k < 3; k++) {
    parts.push(cyl(1.8, 10, PLANT_HUE.tank, {
      x: -x * 0.3 + k * x * 0.3, y: 2.2, z: z * 0.42, rx: 90, ry: 90,
    }, 8))
  }
  for (let k = 0; k < 6; k++) {
    parts.push(cyl(0.35, wall, PLANT_HUE.tank, { x: -x * 0.42 + k * x * 0.17, y: wall / 2, z: -z * 0.48 }, 3))
  }
  // 窗帶與側梯
  for (let k = 0; k < 8; k++) {
    parts.push(box(x * 0.09, 2.4, 0.4, HUE.glass, {
      x: -x * 0.42 + k * x * 0.12, y: wall * 0.62, z: z * 0.5 - 0.25,
    }))
  }
  for (let k = 0; k < 4; k++) {
    parts.push(box(1.2, 0.3, 3.2, FRAME, { x: x * 0.45, y: wall * 0.25 + k * 2.4, z: -z * 0.3 + k * 1.4 }))
  }
  return assemble(parts)
}

/** 儲油槽：十六邊筒、淺錐頂、外圍一圈螺旋梯與立柱、頂上的中央柱與輻射樑 */
export function buildOilTank(): BufferGeometry {
  const { x, y } = PLANT_SIZE.oilTank
  const r = x / 2
  const parts: BufferGeometry[] = [
    cyl(r, y * 0.94, PLANT_HUE.tank, { y: y * 0.47 }, WIDE),
    cyl(r, y * 0.06, PLANT_HUE.tank, { y: y * 0.97 }, WIDE, r * 0.2),
    cyl(r * 0.99, 0.5, FRAME, { y: 0.25 }, WIDE),
  ]
  // 螺旋梯：八段繞上去。**半徑要留給板的對角** —— 轉了 45° 的板，角會
  // 伸出腳印，而腳印就是命中盒
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    const rad = r * 0.91
    parts.push(box(1.2, 0.25, 1.6, FRAME, {
      x: Math.cos(a) * rad, y: 1.2 + (y * 0.8 * k) / 8, z: Math.sin(a) * rad,
      ry: (-a * 180) / Math.PI,
    }))
    parts.push(box(0.35, y * 0.9, 0.35, FRAME, {
      x: Math.cos(a) * rad, y: y * 0.45, z: Math.sin(a) * rad,
    }))
  }
  parts.push(cyl(0.6, y * 0.2, FRAME, { y: y * 1.0 - y * 0.1 }, 6))
  for (let k = 0; k < 4; k++) {
    parts.push(box(r * 0.9, 0.25, 0.4, FRAME, {
      x: Math.cos((k / 4) * Math.PI * 2) * r * 0.45, y: y * 0.99,
      z: Math.sin((k / 4) * Math.PI * 2) * r * 0.45, ry: -(k / 4) * 360,
    }))
  }
  return assemble(parts)
}

/** 氣櫃：乾式的大圓桶，外圍八根導柱與兩圈環樑 */
export function buildGasHolder(): BufferGeometry {
  const { x, y } = PLANT_SIZE.gasHolder
  const r = x / 2
  const parts: BufferGeometry[] = [
    cyl(r * 0.94, y * 0.92, PLANT_HUE.steel, { y: y * 0.46 }, WIDE),
    cyl(r * 0.94, y * 0.08, PLANT_HUE.steel, { y: y * 0.96 }, WIDE, r * 0.3),
  ]
  // 導柱撐滿腳印
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    parts.push(box(0.7, y, 0.7, FRAME, { x: Math.cos(a) * (r - 0.35), y: y / 2, z: Math.sin(a) * (r - 0.35) }))
  }
  // 兩圈環樑：八段弦接成環。**弦要坐在內接半徑上** —— 擺在外接半徑上的話
  // 弦的兩端會伸出腳印，而腳印就是命中盒
  const ring = r - 0.5
  const chordR = ring * Math.cos(Math.PI / 8)
  const chord = 2 * ring * Math.sin(Math.PI / 8)
  for (const band of [0.35, 0.75]) {
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8) * Math.PI * 2
      parts.push(box(chord, 0.5, 0.4, FRAME, {
        x: Math.cos(a) * chordR, y: y * band, z: Math.sin(a) * chordR,
        ry: (-a * 180) / Math.PI + 90,
      }))
    }
  }
  for (let k = 0; k < 4; k++) {
    parts.push(box(1.2, 0.3, 3.0, FRAME, { x: r * 0.6, y: y * 0.2 + k * 6, z: -r * 0.3 + k * 1.2 }))
  }
  return assemble(parts)
}

/** 冷卻塔：雙曲面簡化成兩段截錐，底部一圈進風百葉，頂緣一圈環 */
export function buildCoolingTower(): BufferGeometry {
  const { x, y } = PLANT_SIZE.coolingTower
  const r = x / 2
  const waist = r * 0.62
  const parts: BufferGeometry[] = [
    cyl(r, y * 0.55, PLANT_HUE.concrete, { y: y * 0.275 }, WIDE, waist),
    cyl(waist, y * 0.45, PLANT_HUE.concrete, { y: y * 0.775 }, WIDE, r * 0.72),
    cyl(r * 0.73, 0.6, FRAME, { y: y - 0.3 }, WIDE),
  ]
  // 進風百葉：底部一圈斜板
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2
    parts.push(box(r * 0.5, 3.2, 0.5, FRAME, {
      x: Math.cos(a) * r * 0.95, y: 1.8, z: Math.sin(a) * r * 0.95,
      ry: (-a * 180) / Math.PI + 90,
    }))
  }
  for (let k = 0; k < 4; k++) {
    const a = ((k + 0.5) / 4) * Math.PI * 2
    parts.push(box(0.6, y * 0.5, 0.6, FRAME, {
      x: Math.cos(a) * r * 0.88, y: y * 0.25, z: Math.sin(a) * r * 0.88,
    }))
  }
  return assemble(parts)
}

export const PLANT_BUILDERS: Readonly<Record<PlantKind, () => BufferGeometry>> = {
  hydroTower: buildHydroTower,
  chimney: buildChimney,
  boilerHouse: buildBoilerHouse,
  oilTank: buildOilTank,
  gasHolder: buildGasHolder,
  coolingTower: buildCoolingTower,
}
