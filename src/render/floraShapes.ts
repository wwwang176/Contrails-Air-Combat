import { BufferAttribute, BufferGeometry, Color } from 'three'

/**
 * 植被與建築的幾何。**每一個都是一堆三角形，不共用頂點。**
 *
 * 【為什麼不共用頂點】材質是 `flatShading`，而不共用頂點時
 * `computeVertexNormals` 直接給出面法線 —— low-poly 的面因此是硬的。
 *
 * 【為什麼底面在 y = 0】實例的 `y` 直接放地面高度。底面不在 0 的話整批浮空
 * 或陷地，而那在空中一眼看得出來。`flora-shapes.test.ts` 逐項守著。
 *
 * 【顏色走頂點色 × 逐實例色】幾何自己帶「樹幹／樹冠」與「牆／屋頂」的分野，
 * 逐實例色只做小幅抖動。three 在 `color_vertex` 裡先乘 geometry 的 `color`
 * 再乘 `instanceColor`，所以**一種形狀一個 draw call，顏色仍然有變化** ——
 * 但材質的 `vertexColors` 必須是 `true`，否則 `USE_COLOR` 不定義，
 * 樹幹會跟樹冠同色。
 *
 * 【尺寸的基準】縮放 1.0 時喬木高 15 m。放置那一側在 0.8～1.2 之間抖。
 */

/** 縮放 1.0 的喬木高度，m */
export const TREE_HEIGHT = 15

export type PoolName =
  | 'broadL0' | 'coneL0' | 'treeMid' | 'treeFar'
  | 'bush' | 'house' | 'barn' | 'church'

const TRUNK = 0x4a3b2a
const BROAD_LEAF = 0x3f5233
const CONIFER = 0x2f4530
const BUSH_LEAF = 0x33452c
const WALL = 0xbfb49b
const ROOF = 0xa8503a
const BARN_WALL = 0x8b6b4a
const BARN_ROOF = 0x8a6a4e
const CHURCH_WALL = 0xcfc7b2
const SPIRE = 0x55605c

/** 建構中的三角形湯 */
interface Soup {
  pos: number[]
  col: number[]
}

const C = new Color()

function tri(
  s: Soup, hex: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): void {
  s.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz)
  C.setHex(hex)
  for (let i = 0; i < 3; i++) s.col.push(C.r, C.g, C.b)
}

/** 四邊形，逆時針。兩個三角形 */
function quad(
  s: Soup, hex: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  dx: number, dy: number, dz: number,
): void {
  tri(s, hex, ax, ay, az, bx, by, bz, cx, cy, cz)
  tri(s, hex, ax, ay, az, cx, cy, cz, dx, dy, dz)
}

/** 直立的柱面，無蓋。`sides × 2` 個三角形 */
function cylinder(
  s: Soup, hex: number, sides: number, r: number, y0: number, y1: number,
): void {
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2
    const b = ((i + 1) / sides) * Math.PI * 2
    const ax = Math.cos(a) * r
    const az = Math.sin(a) * r
    const bx = Math.cos(b) * r
    const bz = Math.sin(b) * r
    quad(s, hex, ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az)
  }
}

/** 直立的錐面，**無底**。`sides` 個三角形 */
function cone(
  s: Soup, hex: number, sides: number, r: number, y0: number, y1: number,
): void {
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2
    const b = ((i + 1) / sides) * Math.PI * 2
    tri(s, hex,
      Math.cos(a) * r, y0, Math.sin(a) * r,
      Math.cos(b) * r, y0, Math.sin(b) * r,
      0, y1, 0)
  }
}

/**
 * 八面體，八個三角形。**不細分** —— `OctahedronGeometry(detail = 1)` 是
 * 32 個三角形，那對一棵 450 m 外的樹是四倍的浪費。
 */
function octa(s: Soup, hex: number, rx: number, ry: number, cy: number): void {
  const top = cy + ry
  const bot = cy - ry
  const p = [[rx, 0], [0, rx], [-rx, 0], [0, -rx]] as const
  for (let i = 0; i < 4; i++) {
    const a = p[i]!
    const b = p[(i + 1) % 4]!
    tri(s, hex, a[0], cy, a[1], b[0], cy, b[1], 0, top, 0)
    tri(s, hex, b[0], cy, b[1], a[0], cy, a[1], 0, bot, 0)
  }
}

/** 盒子，六面十二個三角形 */
function box(
  s: Soup, hex: number, w: number, d: number, y0: number, y1: number,
): void {
  const x = w / 2
  const z = d / 2
  quad(s, hex, -x, y0, z, x, y0, z, x, y1, z, -x, y1, z)
  quad(s, hex, x, y0, -z, -x, y0, -z, -x, y1, -z, x, y1, -z)
  quad(s, hex, x, y0, z, x, y0, -z, x, y1, -z, x, y1, z)
  quad(s, hex, -x, y0, -z, -x, y0, z, -x, y1, z, -x, y1, -z)
  quad(s, hex, -x, y1, z, x, y1, z, x, y1, -z, -x, y1, -z)
  quad(s, hex, -x, y0, -z, x, y0, -z, x, y0, z, -x, y0, z)
}

/** 人字屋頂：兩片斜面加兩片山牆。六個三角形。屋脊沿 z 軸 */
function gable(
  s: Soup, hex: number, w: number, d: number, y0: number, y1: number,
): void {
  const x = w / 2
  const z = d / 2
  quad(s, hex, -x, y0, z, 0, y1, z, 0, y1, -z, -x, y0, -z)
  quad(s, hex, x, y0, -z, 0, y1, -z, 0, y1, z, x, y0, z)
  tri(s, hex, -x, y0, z, x, y0, z, 0, y1, z)
  tri(s, hex, x, y0, -z, -x, y0, -z, 0, y1, -z)
}

function finish(s: Soup): BufferGeometry {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(s.pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(s.col), 3))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

function build(fn: (s: Soup) => void): BufferGeometry {
  const s: Soup = { pos: [], col: [] }
  fn(s)
  return finish(s)
}

/**
 * 八個幾何。名字與 `render/vegetation.ts` 的池一一對應 —— 一個
 * `InstancedMesh` 只綁得住一個 geometry，所以八個形狀就是八個池。
 */
export function createFloraGeometries(): Record<PoolName, BufferGeometry> {
  return {
    // 闊葉：圓柱樹幹 12 ＋ 八面體樹冠 8 = 20
    broadL0: build((s) => {
      cylinder(s, TRUNK, 6, 0.5, 0, 5)
      octa(s, BROAD_LEAF, 4.5, 5, 10)
    }),
    // 針葉：圓柱樹幹 12 ＋ 七邊錐 7 = 19
    coneL0: build((s) => {
      cylinder(s, TRUNK, 6, 0.45, 0, 4)
      cone(s, CONIFER, 7, 3.5, 4, TREE_HEIGHT)
    }),
    // 【中距離沒有樹幹】800 m 外樹幹不足 1 px。底落在地面，不是浮在半空。
    //
    // 【形狀是圓的不是尖的】L1／L2 不分樹種，而 450 m 外的地佔了畫面九成 ——
    // 兩級都用尖錐的話，整片 bocage 讀起來像雲杉林。Bocage 是闊葉為主，
    // 所以遠處的輪廓要圓。
    treeMid: build((s) => { octa(s, BROAD_LEAF, 5, TREE_HEIGHT / 2, TREE_HEIGHT / 2) }),
    treeFar: build((s) => { cone(s, BROAD_LEAF, 4, 5.5, 0, TREE_HEIGHT * 0.85) }),
    // 【要比間距寬】相鄰兩叢交疊才成一條連續的堤 —— 見 HEDGE_BUSH_SPACING
    bush: build((s) => { octa(s, BUSH_LEAF, 3, 2, 2) }),
    // 房子：牆 12 ＋ 屋頂 6 = 18
    // 【比真實的農舍大一號】600 m 外一棟 8 m 的房子只有幾個像素，村子讀不
    // 出來。放大到 11 m 之後從空中看得到那一叢屋頂
    house: build((s) => {
      box(s, WALL, 11, 8, 0, 5)
      gable(s, ROOF, 12, 9, 5, 9)
    }),
    barn: build((s) => {
      box(s, BARN_WALL, 18, 10, 0, 6.5)
      gable(s, BARN_ROOF, 19, 11, 6.5, 11.5)
    }),
    // 教堂：本堂 12 ＋ 本堂屋頂 6 ＋ 塔 12 ＋ 尖頂 4 = 34
    church: build((s) => {
      box(s, CHURCH_WALL, 9, 18, 0, 6)
      gable(s, ROOF, 10, 19, 6, 9)
      box(s, CHURCH_WALL, 5, 5, 0, 14)
      cone(s, SPIRE, 4, 3.6, 14, 24)
    }),
  }
}

export function disposeFloraGeometries(g: Record<PoolName, BufferGeometry>): void {
  for (const k of Object.keys(g) as PoolName[]) g[k].dispose()
}
