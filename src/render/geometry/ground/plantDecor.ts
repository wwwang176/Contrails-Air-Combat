import type { BufferGeometry } from 'three'
import { assemble, box, cyl, HUE } from './parts'

/**
 * 廠區的佈景建築：廠房、倉庫、辦公樓、管架、小槽組。**沒有命中盒、不是目標** ——
 * 只是讓廠區看起來夠大、夠密。呼叫端把整批合併成一顆網格（一個繪製呼叫），
 * 所以件數可以上百。
 *
 * 約定與 `parts.ts` 相同：底面在 y = 0、長邊沿 Z、左右對稱於 x = 0。
 */
export type DecorKind = 'hall' | 'warehouse' | 'office' | 'pipeRack' | 'tanks'

const BRICK = 0x6b4a3c
const BRICK_LIGHT = 0x7d5a48
const CONCRETE = 0x8f8c84
const ROOF = 0x4a4d4a
const ROOF_LIGHT = 0x5c5e5a
const PIPE = 0x7a7a72

/**
 * 廠房：磚牆、鋸齒屋頂（一排朝北的天窗）、側牆一條窗帶。
 * `w` 寬、`d` 長（沿 Z）、`h` 簷高，m
 */
function hall(w: number, d: number, h: number): BufferGeometry {
  const parts: BufferGeometry[] = [box(w, h, d, BRICK, { y: h / 2 })]
  // 鋸齒：每一齒一塊斜板加一塊直立的天窗，齒距 8 m 左右
  const teeth = Math.max(2, Math.round(d / 8))
  const pitch = d / teeth
  const rise = Math.min(4, pitch * 0.45)
  const slope = Math.atan2(rise, pitch) * (180 / Math.PI)
  for (let k = 0; k < teeth; k++) {
    const z = -d / 2 + pitch * (k + 0.5)
    parts.push(box(w, 0.4, Math.hypot(pitch, rise), ROOF, { y: h + rise / 2, z, rx: slope }))
    parts.push(box(w * 0.96, rise, 0.3, HUE.glass, { y: h + rise / 2, z: z - pitch / 2 + 0.2 }))
  }
  for (const sx of [-1, 1]) {
    parts.push(box(0.3, h * 0.28, d * 0.9, HUE.glass, { x: sx * (w / 2 + 0.05), y: h * 0.6 }))
  }
  return assemble(parts)
}

/** 倉庫：混凝土牆、兩坡屋頂、兩端各一扇大門 */
function warehouse(w: number, d: number, h: number): BufferGeometry {
  const rise = w * 0.18
  const slope = Math.atan2(rise, w / 2) * (180 / Math.PI)
  const half = Math.hypot(w / 2, rise)
  const parts: BufferGeometry[] = [
    box(w, h, d, CONCRETE, { y: h / 2 }),
    box(half + 0.4, 0.4, d + 0.6, ROOF_LIGHT, { x: -w / 4, y: h + rise / 2, rz: slope }),
    box(half + 0.4, 0.4, d + 0.6, ROOF_LIGHT, { x: w / 4, y: h + rise / 2, rz: -slope }),
  ]
  for (const sz of [-1, 1]) {
    parts.push(box(w * 0.4, h * 0.7, 0.3, HUE.steelDark, { y: h * 0.35, z: sz * (d / 2 + 0.05) }))
  }
  return assemble(parts)
}

/** 辦公樓：平頂、幾層窗帶、屋頂上一座水箱 */
function office(w: number, d: number, h: number): BufferGeometry {
  const parts: BufferGeometry[] = [
    box(w, h, d, BRICK_LIGHT, { y: h / 2 }),
    box(w + 0.6, 0.5, d + 0.6, ROOF, { y: h + 0.25 }),
    cyl(1.6, 3, HUE.steel, { x: w * 0.25, y: h + 2, z: d * 0.2 }, 8),
  ]
  const floors = Math.max(1, Math.floor(h / 4))
  for (let k = 0; k < floors; k++) {
    const y = 2.2 + k * 4
    for (const sx of [-1, 1]) parts.push(box(0.3, 1.4, d * 0.86, HUE.glass, { x: sx * (w / 2 + 0.05), y }))
    for (const sz of [-1, 1]) parts.push(box(w * 0.86, 1.4, 0.3, HUE.glass, { y, z: sz * (d / 2 + 0.05) }))
  }
  return assemble(parts)
}

/**
 * 管架：每 6 m 一座門形支架，上下兩層橫樑，架上沿 Z 走三根管。`d` 是長度，
 * `w` 是寬、`h` 是上層高
 */
function pipeRack(w: number, d: number, h: number): BufferGeometry {
  const parts: BufferGeometry[] = []
  const bents = Math.max(2, Math.round(d / 6) + 1)
  for (let k = 0; k < bents; k++) {
    const z = -d / 2 + (d * k) / (bents - 1)
    for (const sx of [-1, 1]) parts.push(box(0.5, h, 0.5, HUE.steelDark, { x: sx * (w / 2 - 0.25), y: h / 2, z }))
    parts.push(box(w, 0.4, 0.5, HUE.steelDark, { y: h, z }))
    parts.push(box(w, 0.4, 0.5, HUE.steelDark, { y: h * 0.6, z }))
  }
  for (let k = 0; k < 3; k++) {
    const x = -w / 2 + (w * (k + 0.5)) / 3
    parts.push(cyl(0.45, d, PIPE, { x, y: h + 0.65, rx: 90 }, 6))
    parts.push(cyl(0.35, d, PIPE, { x, y: h * 0.6 + 0.55, rx: 90 }, 6))
  }
  return assemble(parts)
}

/** 小槽組：兩排各兩三座的立式小槽，`w × d` 的腳印裡排滿，`h` 是槽高 */
function tanks(w: number, d: number, h: number): BufferGeometry {
  const r = Math.min(w / 4, d / 6, 5)
  const parts: BufferGeometry[] = []
  const cols = Math.max(1, Math.floor(w / (r * 2.4)))
  const rows = Math.max(1, Math.floor(d / (r * 2.4)))
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = -w / 2 + (w * (i + 0.5)) / cols
      const z = -d / 2 + (d * (j + 0.5)) / rows
      parts.push(cyl(r, h, 0x8a8a80, { x, y: h / 2, z }, 12))
      parts.push(cyl(r * 0.15, r * 0.35, 0x8a8a80, { x, y: h + r * 0.17, z }, 12, r))
    }
  }
  return assemble(parts)
}

const BUILDERS: Record<DecorKind, (w: number, d: number, h: number) => BufferGeometry> = {
  hall, warehouse, office, pipeRack, tanks,
}

/** 沒給尺寸時的預設：寬 × 長 × 高，m */
export const DECOR_DEFAULT: Readonly<Record<DecorKind, { w: number, d: number, h: number }>> = {
  hall: { w: 30, d: 60, h: 12 },
  warehouse: { w: 24, d: 50, h: 9 },
  office: { w: 16, d: 30, h: 12 },
  pipeRack: { w: 6, d: 120, h: 7 },
  tanks: { w: 30, d: 40, h: 10 },
}

/** 一件佈景建築的幾何（底面 y = 0、長邊沿 Z）。呼叫端擁有它，合併後自己 dispose */
export function buildDecor(kind: DecorKind, w?: number, d?: number, h?: number): BufferGeometry {
  const def = DECOR_DEFAULT[kind]
  return BUILDERS[kind](w ?? def.w, d ?? def.d, h ?? def.h)
}
