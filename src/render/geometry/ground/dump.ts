import type { BufferGeometry } from 'three'
import { assemble, box, cyl, HUE } from './parts'

/**
 * 機場的三種目標：油桶堆、彈藥堆、探照燈座。程序化 —— 桶與彈是圓柱，
 * 探照燈座這一版是一個方塊（模型之後再換）。
 *
 * 尺寸是**幾何算出來的**：桶 12 × 8 顆、間距 2.5、半徑 0.3 → x 半寬 13.75 + 0.3。
 * `ground-units.test.ts` 對 `real*` 的容差是 5%，登記的數字必須跟排列一致。
 */
const DRUM_R = 0.3
const DRUM_H = 0.9
const DRUM_GAP = 2.5
const DRUM_COLS = 12
const DRUM_ROWS = 8
const BOMB_R = 0.3
const BOMB_LEN = 1.6
const BOMB_GAP = 2.2
const BOMB_PER_ROW = 10
const BOMB_ROW_GAP = 4

export const DUMP_SIZE = {
  fuelDump: {
    x: (DRUM_COLS - 1) * DRUM_GAP + DRUM_R * 2,
    y: DRUM_H * 2,
    z: (DRUM_ROWS - 1) * DRUM_GAP + DRUM_R * 2,
  },
  bombDump: {
    x: (BOMB_PER_ROW - 1) * BOMB_GAP + BOMB_R * 2,
    y: 0.5 + BOMB_R,
    z: 2 * BOMB_ROW_GAP + BOMB_LEN,
  },
  searchlight: { x: 3, y: 2, z: 3 },
} as const

const DRUM = 0x3d4a3a
const DRUM_RUST = 0x6a4a34
const BOMB = 0x4b4f4a
const SLAB = 0x8a8578

/** 55 加侖油桶：直徑 0.6、高 0.9，12 × 8 一層、疊兩層，繞原點置中 */
export function buildFuelDump(): BufferGeometry {
  const parts: BufferGeometry[] = []
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < DRUM_COLS; i++) {
      for (let j = 0; j < DRUM_ROWS; j++) {
        const x = (i - (DRUM_COLS - 1) / 2) * DRUM_GAP
        const z = (j - (DRUM_ROWS - 1) / 2) * DRUM_GAP
        const hex = ((i * 7 + j * 3 + layer) % 5 === 0) ? DRUM_RUST : DRUM
        parts.push(cyl(DRUM_R, DRUM_H, hex, { x, y: DRUM_H / 2 + layer * DRUM_H, z }, 8))
      }
    }
  }
  return assemble(parts)
}

/** 250 磅炸彈躺著排三列，每列十枚，下面墊枕木，繞原點置中 */
export function buildBombDump(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const span = (BOMB_PER_ROW - 1) * BOMB_GAP
  for (let row = 0; row < 3; row++) {
    const z = (row - 1) * BOMB_ROW_GAP
    parts.push(box(span, 0.2, 0.3, HUE.steelDark, { y: 0.1, z: z - 0.6 }))
    parts.push(box(span, 0.2, 0.3, HUE.steelDark, { y: 0.1, z: z + 0.6 }))
    for (let k = 0; k < BOMB_PER_ROW; k++) {
      const x = (k - (BOMB_PER_ROW - 1) / 2) * BOMB_GAP
      parts.push(cyl(BOMB_R, BOMB_LEN, BOMB, { x, y: 0.5, z, rx: 90 }, 8))
    }
  }
  return assemble(parts)
}

/** 探照燈座：先用方塊。光束在 `render/searchlights.ts`，不在幾何裡 */
export function buildSearchlight(): BufferGeometry {
  const s = DUMP_SIZE.searchlight
  return assemble([box(s.x, s.y, s.z, SLAB, { y: s.y / 2 })])
}
