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
  | 'broadNear' | 'broadMid' | 'broadCard'
  | 'coneNear' | 'coneMid' | 'coneCard'
  | 'bushNear' | 'bushCard'
  | 'house' | 'barn' | 'church'

/** 公告板那三個。它們走另一顆材質 —— 見 `render/vegetation.ts` */
export const CARD_POOLS: readonly PoolName[] = ['broadCard', 'coneCard', 'bushCard']

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

/**
 * 直立的柱面，無蓋。`sides × 2` 個三角形。
 *
 * 【角度大的先擺】材質是 `FrontSide`，繞序決定面朝哪一邊。`(cos θ, sin θ)`
 * 在 xz 平面上隨 θ 遞增，而 three 的面法線是 `(C − B) × (A − B)` ——
 * 先擺 θ 小的那一邊會讓法線指向軸心。`flora-shapes.test.ts` 逐面守著。
 */
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
    quad(s, hex, bx, y0, bz, ax, y0, az, ax, y1, az, bx, y1, bz)
  }
}

/** 直立的錐面，**無底**。`sides` 個三角形。繞序見 `cylinder` */
function cone(
  s: Soup, hex: number, sides: number, r: number, y0: number, y1: number,
): void {
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2
    const b = ((i + 1) / sides) * Math.PI * 2
    tri(s, hex,
      Math.cos(b) * r, y0, Math.sin(b) * r,
      Math.cos(a) * r, y0, Math.sin(a) * r,
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
    tri(s, hex, b[0], cy, b[1], a[0], cy, a[1], 0, top, 0)
    tri(s, hex, a[0], cy, a[1], b[0], cy, b[1], 0, bot, 0)
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

/**
 * 公告板的一片。**在 xy 平面上逆時針繞** —— 頂點著色器把 x 映到「水平上
 * 垂直於視線的方向」、y 維持向上，於是 `right × up` 指向鏡頭，繞序在螢幕上
 * 就永遠是正面。順時針的話鏡頭一繞到另一邊整批會被背面剔除掉。
 *
 * 【菱形不是矩形】它取代的是八面體，而 15 m 的樹在 3 km 還有 4.6 px ——
 * 那個尺度看得出剪影。矩形會在門檻上跳一下。
 */
function cardDiamond(s: Soup, hex: number, halfW: number, h: number): void {
  tri(s, hex, 0, 0, 0, halfW, h / 2, 0, 0, h, 0)
  tri(s, hex, 0, 0, 0, 0, h, 0, -halfW, h / 2, 0)
}

/** 針葉的公告板：一個等腰三角形，那正好是錐的側影。1 tri */
function cardCone(s: Soup, hex: number, halfW: number, h: number): void {
  tri(s, hex, -halfW, 0, 0, halfW, 0, 0, 0, h, 0)
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
 * 公告板的幾何。**法線固定向上，不用 `computeVertexNormals`。**
 *
 * 【為什麼是 (0, 1, 0)】卡片的面永遠朝著鏡頭，用面法線的話亮度會隨鏡頭
 * 方位變，整片遠方樹林轉個向就明暗跳動，而且門檻上會出現光照環。
 * 一片樹冠的平均法線接近向上 —— 這樣卡片與它取代的那一級亮度接得上。
 *
 * 【所以卡片的材質不能開 flatShading】那會讓 fragment shader 由螢幕導數
 * 自己算面法線，這裡設的頂點法線完全被忽略。見 `render/vegetation.ts`。
 */
function buildCard(fn: (s: Soup) => void): BufferGeometry {
  const s: Soup = { pos: [], col: [] }
  fn(s)
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(s.pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(s.col), 3))
  const n = new Float32Array(s.pos.length)
  for (let i = 1; i < n.length; i += 3) n[i] = 1
  geo.setAttribute('normal', new BufferAttribute(n, 3))
  geo.computeBoundingSphere()
  return geo
}

/**
 * 八個幾何。名字與 `render/vegetation.ts` 的池一一對應 —— 一個
 * `InstancedMesh` 只綁得住一個 geometry，所以八個形狀就是八個池。
 */
export function createFloraGeometries(): Record<PoolName, BufferGeometry> {
  return {
    // 闊葉近：圓柱樹幹 12 ＋ 八面體樹冠 8 = 20
    broadNear: build((s) => {
      cylinder(s, TRUNK, 6, 0.5, 0, 5)
      octa(s, BROAD_LEAF, 5, 5, 10)
    }),
    // 【中級不是簡化版，是同一個剪影的便宜版】掉的只有樹幹；顏色、寬度、
    // 「圓」這件事都留著。換級只該讓樹變簡單，不該讓它變成另一種樹 ——
    // 900 m 外樹幹不足 1 px，那才是這一級唯一該省的東西。
    broadMid: build((s) => { octa(s, BROAD_LEAF, 5, TREE_HEIGHT / 2, TREE_HEIGHT / 2) }),
    // 闊葉遠：菱形公告板，寬高與 broadMid 逐項對齊
    broadCard: buildCard((s) => { cardDiamond(s, BROAD_LEAF, 5, TREE_HEIGHT) }),
    // 針葉近：圓柱樹幹 12 ＋ 七邊錐 7 = 19
    coneNear: build((s) => {
      cylinder(s, TRUNK, 6, 0.45, 0, 4)
      cone(s, CONIFER, 7, 3.5, 4, TREE_HEIGHT)
    }),
    // 針葉中：六邊錐，底落地。仍然是深綠的尖
    coneMid: build((s) => { cone(s, CONIFER, 6, 3.2, 0, TREE_HEIGHT) }),
    // 針葉遠：一個等腰三角形 —— 錐的側影就是這個形狀
    coneCard: buildCard((s) => { cardCone(s, CONIFER, 3.2, TREE_HEIGHT) }),
    // 【要比間距寬】相鄰兩叢交疊才成一條連續的堤 —— 見 HEDGE_BUSH_SPACING
    bushNear: build((s) => { octa(s, BUSH_LEAF, 3, 2, 2) }),
    bushCard: buildCard((s) => { cardDiamond(s, BUSH_LEAF, 3, 4) }),
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
