import type { BufferGeometry } from 'three'
import { DEG } from '../../../core/math'
import { box, cyl } from './parts'

/**
 * # 廠區的中階零件
 *
 * `parts.ts` 給的是盒子與圓柱；這裡是由它們堆出來的廠房、槽、塔、軌道、
 * 管線橋 —— 填充器（`plantFill.ts`）只認這一層。
 *
 * 【圓管一律三角柱】`cyl(…, 3)`。一根管子從投彈高度看只是一條線，三個面
 * 與十二個面在畫面上分不出來，而管子是廠區裡數量最多的東西。直立的槽與
 * 筒用八邊 —— 它們的頂面正對著鏡頭，三角形會被看成三角形。
 *
 * 【三角形成本】`box` = 12、`cyl(seg)` = `seg × 4`。整片廠區的預算是 40 萬，
 * 而街廓有 24 個 —— 一個零件多 12 個三角形，全場就多幾千。
 *
 * ## 呼叫端要遵守的約定
 *
 * - 回的是**零件陣列**，不是合併好的幾何。呼叫端 push 進自己的 parts 之後
 *   由 `assemble` 一次吃掉。
 * - 每一種零件的**底面在 y = 0**，`x`／`z` 是它的中心。整顆網格的最低點
 *   有護欄守著。
 * - `ry` 是**度**，繞零件自己的中心轉；轉完不得超出標稱的腳印。
 */

/**
 * 髒舊色盤。廠區不共用 `HUE` —— 那一組是給載具用的乾淨色，整片廠區塗上去
 * 像剛出廠。
 */
export const PLANT_PALETTE = [
  0x6e5a4a, // 鏽紅
  0x3c3a37, // 煤灰黑
  0x6b6d68, // 髒鋼灰
  0x554a3c, // 油污棕
  0x8a5a3c, // 褪色的鉛丹橘
] as const

/**
 * 序號進、顏色出。同一排的東西因此深淺不一，而且每次建都一樣。
 *
 * 【明度要量化成階】連續的抖動在平面著色下看起來是雜訊；分成 16 階之後
 * 才像不同批補漆的鋼。
 *
 * 【取高位元】這個 LCG 的低位元週期短 —— 直接拿 `s % 5` 配 `s & 0xf`，
 * 連續的序號只走得出十幾種組合，整排槽會兩三個一循環。
 */
export function grime(seed: number): number {
  const s = (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0
  const base = PLANT_PALETTE[(s >>> 27) % PLANT_PALETTE.length]!
  const f = 1 + (((s >>> 20) & 0xf) / 15 - 0.5) * 0.12
  const r = Math.min(255, Math.round(((base >> 16) & 0xff) * f))
  const g = Math.min(255, Math.round(((base >> 8) & 0xff) * f))
  const b = Math.min(255, Math.round((base & 0xff) * f))
  return (r << 16) | (g << 8) | b
}

/** 鋼構的深色。桁架、欄杆、鞍座用它，不進色盤 —— 全廠的鋼骨是同一個調 */
const FRAME = 0x33383d

/** 桁架塔的層高，m */
const FLOOR_H = 5

/**
 * 開放式桁架塔：四根角柱、每層一片平台與兩道欄杆、層間一片斜梯，頂上
 * 一片平台與兩根排氣管。塔高 = `layers × FLOOR_H`。
 *
 * 三角形：48 + layers × 48 + 12 + 24。
 */
export function trussTower(
  x: number, z: number, size: number, layers: number, seed: number,
): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const h = size / 2
  const top = layers * FLOOR_H
  const steel = grime(seed)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      out.push(box(0.7, top, 0.7, FRAME, { x: x + sx * (h - 0.35), y: top / 2, z: z + sz * (h - 0.35) }))
    }
  }
  for (let f = 1; f <= layers; f++) {
    const y = f * FLOOR_H
    out.push(box(size, 0.3, size, steel, { x, y, z }))
    out.push(box(size, 1.0, 0.15, FRAME, { x, y: y + 0.65, z: z - h }))
    out.push(box(size, 1.0, 0.15, FRAME, { x, y: y + 0.65, z: z + h }))
    // 斜梯的下角抬 0.3 m —— 少了它整顆網格的最低點會是負的
    const dir = f % 2 === 0 ? 1 : -1
    out.push(box(1.2, 0.2, FLOOR_H * 1.4, FRAME, {
      x: x + dir * (h - 1), y: y - FLOOR_H / 2 + 0.3, z, rx: dir * 45,
    }))
  }
  out.push(box(size * 0.8, 0.4, size * 0.8, steel, { x, y: top + 0.2, z }))
  out.push(cyl(0.5, top * 0.25, grime(seed + 1), { x: x + h * 0.5, y: top + top * 0.125, z }, 3))
  out.push(cyl(0.4, top * 0.18, grime(seed + 2), { x: x - h * 0.5, y: top + top * 0.09, z: z + h * 0.4 }, 3))
  return out
}

/**
 * 立式槽：八邊筒加淺錐頂。外廓正好是 `2r × h × 2r`。
 *
 * 三角形：64。
 */
export function uprightTank(
  x: number, z: number, r: number, h: number, seed: number,
): BufferGeometry[] {
  const hue = grime(seed)
  return [
    cyl(r, h * 0.92, hue, { x, y: h * 0.46, z }, 8),
    cyl(r, h * 0.08, hue, { x, y: h * 0.96, z }, 8, r * 0.25),
  ]
}

/**
 * 臥式槽：躺著的八邊筒加兩座鞍座。`ry` 轉向，長軸未轉時沿 Z。
 *
 * 三角形：56。
 */
export function horizTank(
  x: number, z: number, r: number, len: number, ry: number, seed: number,
): BufferGeometry[] {
  const hue = grime(seed)
  const saddle = 0.6
  const c = Math.cos(ry * DEG)
  const s = Math.sin(ry * DEG)
  const off = len * 0.3
  return [
    cyl(r, len, hue, { x, y: saddle + r, z, rx: 90, ry }, 8),
    box(r * 1.6, saddle, r * 0.8, FRAME, { x: x + off * s, y: saddle / 2, z: z + off * c, ry }),
    box(r * 1.6, saddle, r * 0.8, FRAME, { x: x - off * s, y: saddle / 2, z: z - off * c, ry }),
  ]
}

/**
 * 球罐：兩個對扣的截錐。真球在投彈高度看不出來，這樣省五倍三角形。
 * 總高 `2r`。
 *
 * 三角形：64。
 */
export function sphereTank(x: number, z: number, r: number, seed: number): BufferGeometry[] {
  const hue = grime(seed)
  return [
    cyl(r * 0.5, r, hue, { x, y: r * 0.5, z }, 8, r),
    cyl(r, r, hue, { x, y: r * 1.5, z }, 8, r * 0.5),
  ]
}

/**
 * 冷卻風扇筒：八邊筒加頂上一片十字扇葉。
 *
 * 三角形：44。
 */
export function fanStack(
  x: number, z: number, r: number, h: number, seed: number,
): BufferGeometry[] {
  return [
    cyl(r, h, grime(seed), { x, y: h / 2, z }, 8),
    box(r * 1.8, 0.3, r * 0.4, FRAME, { x, y: h + 0.15, z, ry: 30 }),
  ]
}

/**
 * 儲槽區的環形土堤，**一段**。四邊各自呼叫，中間可以斷開 ——
 * 整條矩形的版本會從卡車與構件的禁區上輾過去。
 *
 * 三角形：12。
 */
export function bundRun(
  ax: number, az: number, bx: number, bz: number, height: number,
): BufferGeometry[] {
  const dx = bx - ax
  const dz = bz - az
  const len = Math.hypot(dx, dz)
  if (len < 1) return []
  const ry = Math.atan2(dx, dz) / DEG
  return [box(2.5, height, len, 0x6b5f4e, {
    x: (ax + bx) / 2, y: height / 2, z: (az + bz) / 2, ry,
  })]
}

/**
 * 鋸齒天窗的長條廠房。未轉時 `w` 沿 X、`d` 沿 Z，鋸齒沿 Z 排。
 *
 * 【鋸齒是俯視最好認的東西】空拍照上的廠房區就是一排排斜脊。斜板轉了
 * 20° 之後仍要在 `w × d` 的腳印內，所以板長先縮。
 *
 * 三角形：12 + teeth × 24。
 */
export function sawtoothHall(
  x: number, z: number, w: number, d: number, h: number, teeth: number, ry: number,
  seed: number,
): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const wall = grime(seed)
  const roof = grime(seed + 1)
  const c = Math.cos(ry * DEG)
  const s = Math.sin(ry * DEG)
  /** 建物本地座標 → 世界座標 */
  const at = (lx: number, lz: number): { x: number; z: number } =>
    ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c })
  out.push(box(w, h, d, wall, { x, y: h / 2, z, ry }))
  const pitch = d / teeth
  const slab = pitch * 0.94
  for (let k = 0; k < teeth; k++) {
    const lz = -d / 2 + pitch * (k + 0.5)
    const p = at(0, lz)
    // 斜板：繞 X 轉 20°，轉完的 Z 投影是 slab × cos20 < pitch
    out.push(box(w * 0.98, 0.3, slab, roof, { x: p.x, y: h + 0.9, z: p.z, rx: 20, ry }))
    // 天窗：每齒的高側一片直立板
    const q = at(0, lz - pitch * 0.4)
    out.push(box(w * 0.98, 1.6, 0.25, 0x2c3a44, { x: q.x, y: h + 1.5, z: q.z, ry }))
  }
  return out
}

/**
 * 一股軌道：一整條薄板。枕木不做 —— 俯視看不見，只吃三角形。
 *
 * 三角形：12。
 */
export function railTrack(ax: number, az: number, bx: number, bz: number): BufferGeometry[] {
  const dx = bx - ax
  const dz = bz - az
  const len = Math.hypot(dx, dz)
  const ry = Math.atan2(dx, dz) / DEG
  return [box(3, 0.4, len, 0x4a4f55, { x: (ax + bx) / 2, y: 0.2, z: (az + bz) / 2, ry })]
}

/**
 * 車廂：底架、車身（罐車是六邊臥筒、敞車是盒子）、一條轉向架。未轉時
 * 長軸沿 Z。
 *
 * 三角形：48。
 */
export function railCar(
  x: number, z: number, ry: number, tank: boolean, seed: number,
): BufferGeometry[] {
  const hue = grime(seed)
  const out: BufferGeometry[] = [
    box(3.0, 0.5, 12, FRAME, { x, y: 1.05, z, ry }),
    box(2.2, 0.7, 10, 0x24282c, { x, y: 0.35, z, ry }),
  ]
  out.push(tank
    ? cyl(1.5, 10.5, hue, { x, y: 2.8, z, rx: 90, ry }, 6)
    : box(3.0, 2.4, 11, hue, { x, y: 2.5, z, ry }))
  return out
}

/**
 * 佈景煙囪：錐形磚身加兩圈箍。頂端是 `world/leuna.ts` 的 `PLANT_STACKS`
 * 發白煙的地方 —— 幾何與那份座標表不同步的話，煙會從空中冒出來。
 *
 * 三角形：72。
 */
export function smokeStack(x: number, z: number, height: number, seed: number): BufferGeometry[] {
  const r = height * 0.045
  return [
    cyl(r, height, 0x6b4a3c, { x, y: height / 2, z }, 6, r * 0.62),
    cyl(r * 0.92, 0.8, FRAME, { x, y: height * 0.42, z }, 6),
    cyl(r * 0.76, 0.8, FRAME, { x, y: height * 0.78, z }, 6),
    cyl(r * 0.6, height * 0.03, grime(seed), { x, y: height * 0.985, z }, 6),
  ]
}

/** 管線橋的門型鋼架間距，m */
const RACK_BAY = 12
/** 管徑，m。並排時大小交錯 */
const PIPE_DIAMETERS = [1.2, 0.8, 1.0, 0.6, 0.9] as const

/**
 * 架高的管線橋：沿 a→b 每 `RACK_BAY` 一個門型鋼架，樑上並排 `pipes` 根
 * 三角柱的管。
 *
 * 三角形：(bays + 1) × 36 + pipes × 12。
 */
export function pipeBridge(
  ax: number, az: number, bx: number, bz: number, height: number, pipes: number, seed: number,
): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const dx = bx - ax
  const dz = bz - az
  const len = Math.hypot(dx, dz)
  if (len < 1) return out
  const ry = Math.atan2(dx, dz) / DEG
  const side = Math.cos(ry * DEG)
  const fwd = Math.sin(ry * DEG)
  const width = pipes * 1.4 + 1
  const bays = Math.max(1, Math.floor(len / RACK_BAY))
  for (let k = 0; k <= bays; k++) {
    const t = k / bays
    const px = ax + dx * t
    const pz = az + dz * t
    const ox = (width / 2) * side
    const oz = -(width / 2) * fwd
    out.push(box(0.4, height, 0.4, FRAME, { x: px + ox, y: height / 2, z: pz + oz }))
    out.push(box(0.4, height, 0.4, FRAME, { x: px - ox, y: height / 2, z: pz - oz }))
    out.push(box(width + 0.6, 0.4, 0.4, FRAME, { x: px, y: height - 0.2, z: pz, ry }))
  }
  const mx = (ax + bx) / 2
  const mz = (az + bz) / 2
  for (let p = 0; p < pipes; p++) {
    const d = PIPE_DIAMETERS[p % PIPE_DIAMETERS.length]!
    const off = (p - (pipes - 1) / 2) * 1.4
    out.push(cyl(d / 2, len, grime(seed + p), {
      x: mx + off * side, y: height + d / 2, z: mz - off * fwd, rx: 90, ry,
    }, 3))
  }
  return out
}
