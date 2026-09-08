import type { BufferGeometry } from 'three'
import { HUE, assemble, box, cyl } from './parts'

/**
 * 火車 —— 蒸汽機車、煤水車、棚車、平板車。
 *
 * 【為什麼是這四件】盟 M3「諾曼第斷軌」（`docs/roadmap.md` 的地面目標表）
 * 打的是德軍的補給列車。一列車最少要有「動力 + 燃料 + 貨」才讀得出是列車
 * 而不是一排箱子，平板車則是給列車防空砲用的載台。
 *
 * 【軌距是所有車共用的】車輪橫向位置全部由 `GAUGE_X` 推出來。各車各寫一個
 * 數字的話，接成一列時輪子會左右錯開，而那在俯視掃射的角度上一眼看得出來。
 */

/** 車輪中心到中線的距離，m（標準軌 1.435 m）。 */
const GAUGE_X = 0.72
/** 車鉤面的高度，m。緩衝器與車鉤都掛在這個高度。 */
const COUPLER_Y = 1.05

/** 一對車輪加車軸。`r` 是輪半徑。 */
function wheelPair(z: number, r: number, out: BufferGeometry[]): void {
  for (const s of [-1, 1]) {
    out.push(cyl(r, 0.14, HUE.steelDark, { x: s * GAUGE_X, y: r, z, rz: 90 }, 10))
  }
  out.push(cyl(0.07, GAUGE_X * 2, HUE.steelDark, { y: r, z, rz: 90 }, 6))
}

/** 兩顆緩衝器加中央車鉤，掛在車體某一端。`s` 為 −1（車頭端）或 +1。 */
function buffers(z: number, s: number, out: BufferGeometry[]): void {
  for (const sx of [-1, 1]) {
    out.push(cyl(0.22, 0.34, HUE.markRed, {
      x: sx * 0.85, y: COUPLER_Y, z: z + s * 0.17, rx: 90,
    }, 8))
  }
  out.push(box(0.20, 0.18, 0.40, HUE.steelDark, { y: COUPLER_Y - 0.12, z: z + s * 0.20 }))
}

/**
 * BR 52 型戰時機車（Kriegslok）。車體長 13.0 m、寬 3.10 m、高 4.45 m。
 *
 * 【煙囪與汽包不能省】從空中俯衝下來時，機車與煤水車的側剪影都是一個長方
 * 塊。頂上那兩根圓柱是唯一分得出「這一節是車頭」的特徵。
 */
export function buildLocomotive(): BufferGeometry {
  const p: BufferGeometry[] = []

  // 走行台（底架）與踏板。
  p.push(box(2.70, 0.34, 12.20, HUE.steelDark, { y: 0.98 }))
  p.push(box(3.06, 0.10, 12.00, HUE.locoBlack, { y: 1.58 }))

  // 鍋爐與煙箱。
  p.push(cyl(0.88, 7.60, HUE.locoBlack, { y: 2.42, z: 0.70, rx: 90 }, 14))
  p.push(cyl(0.94, 1.50, HUE.locoBlack, { y: 2.42, z: -4.05, rx: 90 }, 14))
  // 煙箱門：正面那個圓盤，是機車正臉的重點。
  p.push(cyl(0.80, 0.14, HUE.steelDark, { y: 2.42, z: -4.82, rx: 90 }, 14))
  // 煙囪。
  p.push(cyl(0.30, 0.85, HUE.locoBlack, { y: 3.62, z: -3.90 }, 10, 0.36))
  // 汽包與砂箱。
  p.push(cyl(0.42, 1.05, HUE.locoBlack, { y: 3.28, z: 0.20, rx: 90 }, 10))
  p.push(box(0.90, 0.55, 0.90, HUE.locoBlack, { y: 3.42, z: 1.90 }))

  // 駕駛室：車身、窗、車頂。
  p.push(box(3.00, 2.40, 2.60, HUE.locoBlack, { y: 3.10, z: 4.80 }))
  for (const s of [-1, 1]) {
    p.push(box(0.06, 0.62, 0.70, HUE.glass, { x: s * 1.52, y: 3.72, z: 4.10 }))
  }
  p.push(box(3.14, 0.14, 2.80, HUE.steelDark, { y: 4.37, z: 4.80 }))

  // 動輪五對加導輪一對。動輪比導輪大，這是蒸汽機車的側剪影。
  for (const z of [-2.60, -1.30, 0, 1.30, 2.60]) wheelPair(z, 0.75, p)
  wheelPair(-4.40, 0.45, p)
  // 連桿：把五對動輪連起來，少了它輪子讀起來像各自獨立的圓盤。
  for (const s of [-1, 1]) {
    p.push(box(0.08, 0.14, 5.40, HUE.markRed, { x: s * (GAUGE_X + 0.12), y: 0.75 }))
  }
  // 汽缸：走行台前端外側那兩個方塊。
  for (const s of [-1, 1]) {
    p.push(box(0.52, 0.60, 1.60, HUE.locoBlack, { x: s * 1.15, y: 1.05, z: -3.40 }))
  }

  buffers(-6.10, -1, p)
  buffers(6.10, 1, p)
  return assemble(p)
}

/**
 * 煤水車。長 7.9 m、寬 2.90 m、高 3.35 m。
 *
 * 【煤堆是斜的】水櫃是方的，但煤堆在前端向駕駛室那一側倒。畫成平的會讓
 * 這一節跟棚車在俯視下完全一樣。
 */
export function buildTender(): BufferGeometry {
  const p: BufferGeometry[] = []

  p.push(box(2.80, 0.40, 7.60, HUE.steelDark, { y: 1.00 }))
  // 水櫃。
  p.push(box(2.86, 1.85, 7.20, HUE.locoBlack, { y: 2.12 }))
  // 煤堆：前端（朝駕駛室那一側）的斜面。
  // 傾斜之後半高會變成 0.52（板厚一半加板長投影），全高 3.35 是照它定的。
  p.push(box(2.40, 0.55, 3.20, HUE.rubber, { y: 2.82, z: -1.90, rx: -9 }))

  for (const z of [-2.30, 0, 2.30]) wheelPair(z, 0.50, p)
  buffers(-3.90, -1, p)
  buffers(3.90, 1, p)
  return assemble(p)
}

/**
 * 棚車（G 型有蓋貨車）。長 9.1 m、寬 2.90 m、高 3.85 m。
 */
export function buildBoxcar(): BufferGeometry {
  const p: BufferGeometry[] = []

  p.push(box(2.82, 0.34, 8.60, HUE.steelDark, { y: 1.03 }))
  p.push(box(2.80, 2.20, 8.20, HUE.wood, { y: 2.30 }))
  // 拱頂：主頂板加一片略窄的脊，屋頂因此不是一片死板。
  p.push(box(2.92, 0.16, 8.40, HUE.steelDark, { y: 3.48 }))
  p.push(box(2.10, 0.16, 8.40, HUE.steelDark, { y: 3.62 }))
  // 側門與門軌。
  for (const s of [-1, 1]) {
    p.push(box(0.08, 1.80, 1.90, HUE.locoBlack, { x: s * 1.42, y: 2.30 }))
    p.push(box(0.08, 0.10, 8.20, HUE.locoBlack, { x: s * 1.42, y: 3.30 }))
  }

  for (const z of [-2.60, 2.60]) wheelPair(z, 0.48, p)
  // 緩衝器面就是「車鉤間全長 9.10 m」的兩端，比車架還外側。
  buffers(-4.15, -1, p)
  buffers(4.15, 1, p)
  return assemble(p)
}

/**
 * 平板車。長 10.3 m、寬 2.90 m、高 1.35 m。
 *
 * 【側柱要留著】沒有側柱時它就是一塊浮在輪子上的板，從空中看不出是車廂。
 */
export function buildFlatcar(): BufferGeometry {
  const p: BufferGeometry[] = []

  p.push(box(2.82, 0.34, 9.40, HUE.steelDark, { y: 1.03 }))
  p.push(box(2.88, 0.12, 9.40, HUE.wood, { y: 1.26 }))
  for (const s of [-1, 1]) {
    for (const z of [-3.50, -1.15, 1.15, 3.50]) {
      p.push(box(0.12, 0.40, 0.14, HUE.steelDark, { x: s * 1.40, y: 1.52, z }))
    }
  }

  for (const z of [-3.20, 3.20]) wheelPair(z, 0.48, p)
  buffers(-4.75, -1, p)
  buffers(4.75, 1, p)
  return assemble(p)
}
