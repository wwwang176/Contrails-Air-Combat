import { BufferAttribute, BufferGeometry, Color } from 'three'
import { createFloraBuffer, FLORA_STRIDE, FloraKind, SHAPE_ONE, type FloraSource } from './flora'
import {
  BRICK_WALL, BUILDING_DEPTH, BUILDING_WIDTH, CHURCH_WALL, OLD_ROOF, ROOF, SLATE, TAR_ROOF, WALL,
} from './floraShapes'
import { TINT_RANGE } from './vegetation'

/**
 * # 建築的屋頂色塊：烘進遠處的地面
 *
 * 建築只有完整模型一級，植被圈外整棟不畫。這裡把每一棟的屋頂外框畫成平的
 * 四邊形，由田色 clipmap 烘進遠圖（`fieldClipmap.ts` 的 `addOverlay`）——
 * 模型不畫了，地上還是一片屋頂的顏色，與遠處的林子同一個道理。
 *
 * 【與模型同一套座標】中心 `(x, z)`、x 軸 `(cos θ, −sin θ)`、z 軸
 * `(sin θ, cos θ)`（`vegetation.ts` 寫矩陣的方式）。外框取屋頂的（比牆各寬
 * 1 m），近處真的模型整個蓋住它。
 */

/** 教堂本堂屋頂的外框，m（`floraShapes.ts` 的 `church`） */
const CHURCH_ROOF_W = 10
const CHURCH_ROOF_D = 19

/**
 * 色塊裡牆色佔幾成。遠處是斜著看的，一棟房子露出來的牆面與屋頂差不多大；
 * 只用屋頂色的話，烘出來的鎮比真的房子暗一截，拉近時一整片變亮
 */
export const WALL_SHARE = 0.4

/** 屋頂色與牆色照 `WALL_SHARE` 混 */
function splatColor(roof: number, wall: number): Color {
  return new Color(roof).lerp(new Color(wall), WALL_SHARE)
}

/** 屋頂的外框（縮放 1、面寬倍率 1）與色塊的顏色。不在表上的種類不畫 */
const ROOFS: ReadonlyMap<FloraKind, { readonly w: number; readonly d: number; readonly color: Color }> = new Map([
  [FloraKind.House, { w: BUILDING_WIDTH + 1, d: BUILDING_DEPTH + 1, color: splatColor(ROOF, WALL) }],
  [FloraKind.Barn, { w: BUILDING_WIDTH + 1, d: BUILDING_DEPTH + 1, color: splatColor(OLD_ROOF, BRICK_WALL) }],
  [FloraKind.SlateHouse, { w: BUILDING_WIDTH + 1, d: BUILDING_DEPTH + 1, color: splatColor(SLATE, WALL) }],
  [FloraKind.TarBarn, { w: BUILDING_WIDTH + 1, d: BUILDING_DEPTH + 1, color: splatColor(TAR_ROOF, BRICK_WALL) }],
  [FloraKind.Church, { w: CHURCH_ROOF_W, d: CHURCH_ROOF_D, color: splatColor(SLATE, CHURCH_WALL) }],
])

/** 第一次試的容量；不夠就加倍重跑 */
const FIRST_CAPACITY = 65536

/**
 * 跑一次散佈器，範圍內每一棟建築一個四邊形。`position` 的 y 是 0（烘圖只讀 xz），
 * `color` 是線性值，與頂點色相同。
 *
 * **建地形時跑一次**，會配置。
 */
export function roofSplats(
  sources: readonly FloraSource[], x0: number, z0: number, x1: number, z1: number,
): BufferGeometry {
  let cap = FIRST_CAPACITY
  let buf = createFloraBuffer(cap)
  for (;;) {
    for (const s of sources) s(x0, z0, x1, z1, () => 0, buf)
    if (buf.dropped === 0) break
    cap *= 2
    buf = createFloraBuffer(cap)
  }
  let n = 0
  for (let i = 0; i < buf.count; i++) if (ROOFS.has(buf.kind[i]!)) n++
  const pos = new Float32Array(n * 12)
  const col = new Float32Array(n * 12)
  const idx = new Uint32Array(n * 6)
  const [t0, t1] = TINT_RANGE.building
  let q = 0
  for (let i = 0; i < buf.count; i++) {
    const r = ROOFS.get(buf.kind[i]!)
    if (r === undefined) continue
    const o = i * FLORA_STRIDE
    const x = buf.data[o]!
    const z = buf.data[o + 2]!
    const rot = buf.data[o + 3]!
    const scale = buf.data[o + 4]!
    const k = t0 + (t1 - t0) * buf.data[o + 5]!
    const hw = (r.w * scale * (buf.shape[i * 2]! / SHAPE_ONE)) / 2
    const hd = (r.d * scale) / 2
    const cs = Math.cos(rot)
    const sn = Math.sin(rot)
    // 四個角依序 (−,−) (+,−) (+,+) (−,+)：u 沿 x 軸、v 沿 z 軸
    for (let c = 0; c < 4; c++) {
      const u = c === 1 || c === 2 ? hw : -hw
      const v = c >= 2 ? hd : -hd
      const p = (q * 4 + c) * 3
      pos[p] = x + cs * u + sn * v
      pos[p + 1] = 0
      pos[p + 2] = z - sn * u + cs * v
      col[p] = r.color.r * k
      col[p + 1] = r.color.g * k
      col[p + 2] = r.color.b * k
    }
    const b = q * 4
    idx.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6)
    q++
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('color', new BufferAttribute(col, 3))
  g.setIndex(new BufferAttribute(idx, 1))
  return g
}
