import type { BufferGeometry } from 'three'
import { assemble, box, cyl, HUE } from './parts'

/**
 * 機場的三種目標：油桶堆、彈藥堆、探照燈座。程序化 —— 桶與彈是圓柱，
 * 探照燈座這一版是一個方塊（模型之後再換）。
 *
 * 油桶堆有 `FUEL_DUMP_LAYOUTS.length` 種擺法，全部填在同一個命中盒裡：
 * `ground-units.test.ts` 對 `real*` 的容差是 5%，每一種都要撐到盒子的四邊與頂、不能伸出去。
 */
const DRUM_R = 0.3
const DRUM_H = 0.9
/** 直立並排的中心距：桶身 0.6 加滾箍碰在一起的那一點縫 */
const DRUM_PITCH = 0.62
/** 躺著疊的那一堆，前後兩排之間的中心距 */
const DRUM_LYING_DEPTH = 0.95
const BOMB_R = 0.3
const BOMB_LEN = 1.6
const BOMB_GAP = 2.2
const BOMB_PER_ROW = 10
const BOMB_ROW_GAP = 4

export const DUMP_SIZE = {
  bombDump: {
    x: (BOMB_PER_ROW - 1) * BOMB_GAP + BOMB_R * 2,
    y: 0.5 + BOMB_R,
    z: 2 * BOMB_ROW_GAP + BOMB_LEN,
  },
  searchlight: { x: 3, y: 2, z: 3 },
} as const

const DRUM_OLIVE = 0x3d4a3a
const DRUM_DARK = 0x2f3330
const DRUM_FADED = 0x5a5f4c
const DRUM_RUST = 0x6a4a34
const BOMB = 0x4b4f4a
const SLAB = 0x8a8578

/**
 * 直立並排的一小堆：`cols` 沿堆的 x、`rows` 沿堆的 z，中心在 (`x`, `z`)、
 * 整堆繞 Y 轉 `ry` 度。第二層只鋪 `topFill` 那麼多（0…1）。`hex` 是這一堆的主色。
 */
interface UprightStack {
  x: number
  z: number
  ry: number
  cols: number
  rows: number
  layers: 1 | 2
  topFill: number
  hex: number
}

/** 躺著疊的金字塔：底層 `base` 顆，往上每層少一顆、共三層，前後兩排 */
interface LyingStack {
  x: number
  z: number
  ry: number
  base: number
  hex: number
}

/** 堆外零星的一顆：`lying` 的躺著、軸繞 Y 轉 `ry` 度 */
interface LooseDrum {
  x: number
  z: number
  ry: number
  lying: boolean
}

/** 一種擺法。`seed` 讓每一種的缺角、上層與配色各自不同 */
interface FuelDumpLayout {
  seed: number
  stacks: readonly UprightStack[]
  pyramids: readonly LyingStack[]
  loose: readonly LooseDrum[]
}

export const FUEL_DUMP_LAYOUTS: readonly FuelDumpLayout[] = [
  {
    seed: 0,
    stacks: [
      { x: -3.2, z: -1.8, ry: 3, cols: 6, rows: 5, layers: 2, topFill: 0.8, hex: DRUM_OLIVE },
      { x: 2.4, z: -2.6, ry: -7, cols: 6, rows: 4, layers: 1, topFill: 0, hex: DRUM_DARK },
      { x: -2.6, z: 2.4, ry: -4, cols: 7, rows: 4, layers: 2, topFill: 0.6, hex: DRUM_OLIVE },
      { x: 5.4, z: -0.2, ry: 12, cols: 3, rows: 3, layers: 1, topFill: 0, hex: DRUM_FADED },
    ],
    pyramids: [{ x: 2.9, z: 1.9, ry: 9, base: 5, hex: DRUM_DARK }],
    loose: [
      { x: -6.3, z: 0.5, ry: 0, lying: false },
      { x: 0.4, z: -4.4, ry: 30, lying: true },
      { x: 6.3, z: 3.4, ry: 0, lying: false },
      { x: -0.3, z: 4.5, ry: -70, lying: true },
      { x: 0.2, z: -0.3, ry: 0, lying: false },
      { x: 0.8, z: 0.2, ry: 0, lying: false },
    ],
  },
  {
    seed: 1,
    stacks: [
      { x: -2.2, z: 1.6, ry: -3, cols: 8, rows: 5, layers: 2, topFill: 0.5, hex: DRUM_OLIVE },
      { x: 3.4, z: 2.2, ry: 8, cols: 5, rows: 5, layers: 1, topFill: 0, hex: DRUM_FADED },
      { x: 2.0, z: -2.4, ry: 5, cols: 4, rows: 6, layers: 2, topFill: 0.7, hex: DRUM_OLIVE },
      { x: 5.3, z: -2.4, ry: -15, cols: 2, rows: 3, layers: 1, topFill: 0, hex: DRUM_DARK },
    ],
    pyramids: [{ x: -3.4, z: -2.6, ry: -12, base: 6, hex: DRUM_DARK }],
    loose: [
      { x: -6.3, z: -0.4, ry: 0, lying: false },
      { x: 6.3, z: 0.6, ry: 0, lying: false },
      { x: -0.6, z: -4.57, ry: 80, lying: true },
      { x: 5.6, z: 4.6, ry: 0, lying: false },
      { x: -0.2, z: -1.0, ry: 0, lying: false },
      { x: -5.9, z: 4.4, ry: 35, lying: true },
    ],
  },
  {
    seed: 2,
    stacks: [
      { x: 0.2, z: -3.3, ry: 2, cols: 10, rows: 3, layers: 2, topFill: 0.4, hex: DRUM_OLIVE },
      { x: -3.6, z: 1.0, ry: -6, cols: 5, rows: 4, layers: 2, topFill: 0.9, hex: DRUM_DARK },
      { x: 4.4, z: 1.6, ry: 10, cols: 4, rows: 4, layers: 1, topFill: 0, hex: DRUM_OLIVE },
      { x: -0.9, z: 3.8, ry: 0, cols: 3, rows: 2, layers: 1, topFill: 0, hex: DRUM_FADED },
    ],
    pyramids: [{ x: 0.9, z: 0.9, ry: 78, base: 4, hex: DRUM_OLIVE }],
    loose: [
      { x: -6.3, z: -1.6, ry: 0, lying: false },
      { x: 6.16, z: -1.7, ry: -20, lying: true },
      { x: 3.6, z: 4.64, ry: 0, lying: false },
      { x: -3.4, z: -4.64, ry: 0, lying: false },
      { x: -4.7, z: 4.3, ry: 60, lying: true },
      { x: 2.4, z: -0.9, ry: 0, lying: false },
    ],
  },
  {
    seed: 3,
    stacks: [
      { x: -4.4, z: -2.5, ry: 6, cols: 4, rows: 4, layers: 2, topFill: 0.7, hex: DRUM_OLIVE },
      { x: -0.6, z: -3.3, ry: -10, cols: 5, rows: 3, layers: 1, topFill: 0, hex: DRUM_FADED },
      { x: 3.8, z: -1.8, ry: 3, cols: 4, rows: 5, layers: 2, topFill: 0.5, hex: DRUM_DARK },
      { x: 1.4, z: 2.9, ry: 7, cols: 6, rows: 3, layers: 1, topFill: 0, hex: DRUM_OLIVE },
      { x: 5.5, z: 2.9, ry: -4, cols: 2, rows: 2, layers: 2, topFill: 1, hex: DRUM_OLIVE },
    ],
    pyramids: [{ x: -3.6, z: 2.4, ry: -5, base: 5, hex: DRUM_OLIVE }],
    loose: [
      { x: -6.3, z: 0.1, ry: 0, lying: false },
      { x: 6.3, z: 0.4, ry: 0, lying: false },
      { x: 1.6, z: -4.64, ry: 0, lying: false },
      { x: -1.2, z: 4.43, ry: 15, lying: true },
      { x: 0.6, z: 0.0, ry: 50, lying: true },
    ],
  },
]

/** 每顆桶的固定雜訊（0…1）：同一個 `n` 每次都是同一個值，堆的形狀每次載入都一樣 */
function noise(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

/** 主色占多數，其餘是鏽、褪色與深灰 */
function drumHex(main: number, n: number): number {
  const h = noise(n * 3.1 + 0.7)
  if (h < 0.08) return DRUM_RUST
  if (h < 0.18) return DRUM_FADED
  if (h < 0.26) return DRUM_DARK
  return main
}

/** 堆內座標 (u, v) 繞 Y 轉 `ry` 度後加上堆的中心 —— 與 `Place.ry` 同一個方向 */
function stackPoint(s: { x: number; z: number; ry: number }, u: number, v: number): { x: number; z: number } {
  const a = s.ry * Math.PI / 180
  return { x: s.x + u * Math.cos(a) + v * Math.sin(a), z: s.z - u * Math.sin(a) + v * Math.cos(a) }
}

/**
 * 55 加侖油桶：直徑 0.6、高 0.9。貼在一起分成幾小堆，每堆方向略有不同；
 * 每顆位置抖幾公分、邊角缺幾顆，第二層不鋪滿，堆外散著幾顆。繞原點置中。
 * `variant` 是 `FUEL_DUMP_LAYOUTS` 的第幾種，超出範圍就繞回來
 */
export function buildFuelDump(variant = 0): BufferGeometry {
  const layout = FUEL_DUMP_LAYOUTS[variant % FUEL_DUMP_LAYOUTS.length]!
  const parts: BufferGeometry[] = []
  let n = layout.seed * 7919
  for (const s of layout.stacks) {
    for (let layer = 0; layer < s.layers; layer++) {
      for (let i = 0; i < s.cols; i++) {
        for (let j = 0; j < s.rows; j++) {
          n++
          const edge = i === 0 || j === 0 || i === s.cols - 1 || j === s.rows - 1
          if (layer === 0 && edge && noise(n) < 0.12) continue
          if (layer === 1 && noise(n) > s.topFill) continue
          const u = (i - (s.cols - 1) / 2) * DRUM_PITCH + (noise(n + 0.31) - 0.5) * 0.06
          const v = (j - (s.rows - 1) / 2) * DRUM_PITCH + (noise(n + 0.57) - 0.5) * 0.06
          const p = stackPoint(s, u, v)
          parts.push(cyl(DRUM_R, DRUM_H, drumHex(s.hex, n), { ...p, y: DRUM_H / 2 + layer * DRUM_H }, 8))
        }
      }
    }
  }
  for (const s of layout.pyramids) {
    for (let level = 0; level < 3; level++) {
      const count = s.base - level
      for (let i = 0; i < count; i++) {
        for (const v of [-DRUM_LYING_DEPTH / 2, DRUM_LYING_DEPTH / 2]) {
          n++
          const p = stackPoint(s, (i - (count - 1) / 2) * DRUM_PITCH, v)
          const y = DRUM_R + level * DRUM_R * Math.sqrt(3)
          parts.push(cyl(DRUM_R, DRUM_H, drumHex(s.hex, n), { ...p, y, rx: 90, ry: s.ry }, 8))
        }
      }
    }
  }
  for (const d of layout.loose) {
    n++
    const hex = drumHex(DRUM_OLIVE, n)
    parts.push(d.lying
      ? cyl(DRUM_R, DRUM_H, hex, { x: d.x, y: DRUM_R, z: d.z, rx: 90, ry: d.ry }, 8)
      : cyl(DRUM_R, DRUM_H, hex, { x: d.x, y: DRUM_H / 2, z: d.z }, 8))
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
