import { BufferAttribute, BufferGeometry, Color } from 'three'
import { createFloraBuffer, FLORA_STRIDE, FloraKind, SHAPE_ONE, type FloraSource } from './flora'
import {
  BRICK_WALL, BROAD_CROWN_R, BUILDING_DEPTH, BUILDING_WIDTH, BUSH_R, CHURCH_WALL, CONE_CROWN_R, OLD_ROOF, ROOF,
  SLATE, TAR_ROOF, WALL,
} from './floraShapes'
import { FLORA_COLORS, type Season } from './season'
import { TINT_RANGE } from './vegetation'

/**
 * # 建築與樹的色塊：烘進遠處的地面
 *
 * 植被圈外建築與樹都不畫。這裡把每一棟的屋頂、每一株的樹冠畫成平的四邊形，
 * 由田色 clipmap 烘進遠圖（`fieldClipmap.ts` 的 `addOverlay`）—— 模型不畫了，
 * 地上還是一片屋頂與林冠的顏色。田裡的樹林、樹籬、空地的林子已經在田色的
 * 算式裡，這裡只收散佈器另外撒的（村鎮裡的樹、河岸林）。
 *
 * 【與模型同一套座標】中心 `(x, z)`、x 軸 `(cos θ, −sin θ)`、z 軸
 * `(sin θ, cos θ)`（`vegetation.ts` 寫矩陣的方式）。
 */

/**
 * 屋頂色塊比屋頂外框放大幾倍。遠處斜著看，一棟房子露出來的牆面與陰影讓它在
 * 畫面上比屋頂外框大；照外框畫的話烘出來的鎮只剩稀疏的小點，遠看像沒有房子
 */
export const ROOF_GROW = 1.7

/** 教堂本堂屋頂的外框，m（`floraShapes.ts` 的 `church`） */
const CHURCH_ROOF_W = 10
const CHURCH_ROOF_D = 19

/**
 * 色塊裡牆色佔幾成。遠處斜著看，一棟房子露出一點牆面；牆色很淡，佔多了烘出來
 * 的鎮是灰褐的，比真的房子（屋頂的紅佔大半）彩度低一截
 */
export const WALL_SHARE = 0.3

/**
 * 林子從空中看的顏色 = 樹冠色 × 這個倍率（線性值；畫面上約 0.85 倍）：樹冠的
 * 側面在陰影裡，整株看下去比樹冠色暗。同一片林子有模型與只剩烘圖時，畫面的
 * 平均色在這個倍率對得上
 */
export const CANOPY_SHADE = 0.9

/** 樹冠色乘 `CANOPY_SHADE` */
export function canopyColor(hex: number): Color {
  return new Color(hex).multiplyScalar(CANOPY_SHADE)
}

/** 屋頂色與牆色照 `WALL_SHARE` 混 */
function splatColor(roof: number, wall: number): Color {
  return new Color(roof).lerp(new Color(wall), WALL_SHARE)
}

/**
 * 色塊的外框（縮放 1、面寬倍率 1）、顏色、明度抖動與面寬倍率吃不吃。不在表上
 * 的種類不畫
 */
interface Splat {
  readonly w: number
  readonly d: number
  readonly color: Color
  readonly tint: readonly [number, number]
  readonly wide: boolean
}

/** 屋頂 */
const roof = (w: number, d: number, color: Color): Splat =>
  ({ w: w * ROOF_GROW, d: d * ROOF_GROW, color, tint: TINT_RANGE.building, wide: true })

const ROOFS: ReadonlyMap<FloraKind, Splat> = new Map([
  [FloraKind.House, roof(BUILDING_WIDTH + 1, BUILDING_DEPTH + 1, splatColor(ROOF, WALL))],
  [FloraKind.Barn, roof(BUILDING_WIDTH + 1, BUILDING_DEPTH + 1, splatColor(OLD_ROOF, BRICK_WALL))],
  [FloraKind.SlateHouse, roof(BUILDING_WIDTH + 1, BUILDING_DEPTH + 1, splatColor(SLATE, WALL))],
  [FloraKind.TarBarn, roof(BUILDING_WIDTH + 1, BUILDING_DEPTH + 1, splatColor(TAR_ROOF, BRICK_WALL))],
  [FloraKind.Church, roof(CHURCH_ROOF_W, CHURCH_ROOF_D, splatColor(SLATE, CHURCH_WALL))],
])

/** 屋頂加上這個季節的樹冠：外框是樹冠的直徑 */
function splatsFor(season: Season): ReadonlyMap<FloraKind, Splat> {
  const c = FLORA_COLORS[season]
  const crown = (r: number, hex: number): Splat =>
    ({ w: 2 * r, d: 2 * r, color: canopyColor(hex), tint: TINT_RANGE.plant, wide: false })
  return new Map([
    ...ROOFS,
    [FloraKind.BroadTree, crown(BROAD_CROWN_R, c.broadLeaf)],
    [FloraKind.ConeTree, crown(CONE_CROWN_R, c.conifer)],
    [FloraKind.Bush, crown(BUSH_R, c.bushLeaf)],
  ])
}

/** 第一次試的容量；不夠就加倍重跑 */
const FIRST_CAPACITY = 65536

/**
 * 跑一次散佈器，範圍內每一棟建築、每一株樹一個四邊形。`position` 的 y 是 0
 * （烘圖只讀 xz），`color` 是線性值，與頂點色相同。
 *
 * **建地形時跑一次**，會配置。
 */
export function floraSplats(
  sources: readonly FloraSource[], x0: number, z0: number, x1: number, z1: number, season: Season = 'summer',
): BufferGeometry {
  const splats = splatsFor(season)
  let cap = FIRST_CAPACITY
  let buf = createFloraBuffer(cap)
  for (;;) {
    for (const s of sources) s(x0, z0, x1, z1, () => 0, buf)
    if (buf.dropped === 0) break
    cap *= 2
    buf = createFloraBuffer(cap)
  }
  let n = 0
  for (let i = 0; i < buf.count; i++) if (splats.has(buf.kind[i]!)) n++
  const pos = new Float32Array(n * 12)
  const col = new Float32Array(n * 12)
  const idx = new Uint32Array(n * 6)
  let q = 0
  for (let i = 0; i < buf.count; i++) {
    const r = splats.get(buf.kind[i]!)
    if (r === undefined) continue
    const o = i * FLORA_STRIDE
    const x = buf.data[o]!
    const z = buf.data[o + 2]!
    const rot = buf.data[o + 3]!
    const scale = buf.data[o + 4]!
    const k = r.tint[0] + (r.tint[1] - r.tint[0]) * buf.data[o + 5]!
    const hw = (r.w * scale * (r.wide ? buf.shape[i * 2]! / SHAPE_ONE : 1)) / 2
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
