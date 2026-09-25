import { BufferAttribute, BufferGeometry, Color } from 'three'
import { FLORA_COLORS, type Season } from './season'

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
 * 【尺寸的基準】縮放 1.0 時喬木高 30 m、灌木高 8 m。放置那一側在
 * 0.5～1.0 之間抖，所以場上是 15～30 m 的樹與 4～8 m 的灌木。
 */

/**
 * 縮放 1.0 的喬木高度，m。
 *
 * 放置那一側在 0.5～1.0 之間抖（`TREE_SCALE`），所以場上的樹是 15～30 m。
 */
export const TREE_HEIGHT = 30

export type PoolName =
  | 'broadNear' | 'broadMid' | 'broadPoint'
  | 'coneNear' | 'coneMid' | 'conePoint'
  | 'bushNear' | 'bushPoint'
  | 'house' | 'barn' | 'church' | 'houseSlate' | 'barnTar'

/**
 * 遠處那三個池。**它們是 `gl.POINTS`，不是網格** —— 沒有幾何、走另一顆
 * 材質、亮度烘在頂點色裡。見 `render/vegetation.ts` 的 `createPointMaterial`。
 */
export const POINT_POOLS: readonly PoolName[] = ['broadPoint', 'conePoint', 'bushPoint']

/**
 * 樹冠的位置與大小。**三級共用同一組** —— 換級只掉樹幹與面數，樹冠一動
 * 都不動。分開寫死的話，改了一級忘了另一級，症狀就是過門檻時樹冠跳位置。
 */
const BROAD_CROWN_Y0 = 10
/** 【匯出是給 `flora.ts` 算雷伊泰的樹冠覆蓋率的】 */
export const BROAD_CROWN_R = 10
const BROAD_CROWN_RY = 10
const BROAD_CROWN_CY = 20
const CONE_CROWN_Y0 = 8
/** 【匯出是給 `flora.ts` 算樹冠覆蓋率的】地色要按它上色 */
export const CONE_CROWN_R = 7

/**
 * 灌木的半徑。**要比樹籬的間距寬** —— 相鄰兩叢交疊才成一條連續的堤，
 * 見 `HEDGE_BUSH_SPACING`。
 *
 * 【匯出是給 `flora.ts` 算樹冠覆蓋率的】
 */
export const BUSH_R = 6
const BUSH_RY = 4
const BUSH_CY = 4
const BUSH_CARD_TOP = 8

const TRUNK = 0x4a3b2a
// 樹冠色由季節決定（`season.ts`）；房子的顏色不換季
export const WALL = 0xbfb49b
/**
 * 黏土瓦。**是用了幾十年的老瓦**：風化、長青苔、被煤煙燻過，從空中看是暗紅褐，
 * 不是新瓦的磚紅。德國中部 1944 年的屋頂七八成是它
 */
export const ROOF = 0x8c4e3b
/** 石板瓦：深灰偏藍。教堂、鎮中心、公家建築 */
export const SLATE = 0x4f555b
/** 磚木牆：穀倉、倉庫、老屋 */
export const BRICK_WALL = 0x8b6b4a
/** 老黏土瓦：比 `ROOF` 更暗、更髒，少翻修的老屋與穀倉 */
export const OLD_ROOF = 0x7a4636
/** 油毛氈：穀倉、倉庫、戰時搭的棚子 */
export const TAR_ROOF = 0x4a4946
/**
 * 建築在縮放 1、倍率 1 時的尺寸，m：牆的面寬（x）、進深（z）、牆高、屋頂高。
 * 一層樓的房子；樓高倍率 2 是兩層半左右的街屋，屋頂跟著變陡
 *
 * 【比真實的農舍大一號】600 m 外一棟 8 m 的房子只有幾個像素，村子讀不出來
 */
export const BUILDING_WIDTH = 11
export const BUILDING_DEPTH = 8
export const BUILDING_WALL = 5
export const BUILDING_ROOF = 4
export const CHURCH_WALL = 0xcfc7b2
const SPIRE = 0x55605c

/**
 * 遠處那三個池的點邊長，m。
 *
 * 【取「面積相等」而不是「寬度相等」】點是螢幕對齊的實心方塊，而它取代的
 * 那一級是八面體或錐 —— 側影是菱形（面積 `R × 高`）或三角形（`底 × 高 / 2`）。
 * 同寬的話方塊的面積是兩倍，3 km 那條門檻上林相會突然變厚。
 *
 * 【由樹冠常數算，不寫死】改樹冠尺寸時這裡自動跟上。
 * `flora-shapes.test.ts` 逐池比對它與**它取代的那一級**的側影面積。
 */
export type PointPool = 'broadPoint' | 'conePoint' | 'bushPoint'

/**
 * 點池的樹冠色。`gl.POINTS` 沒有幾何、也就沒有頂點色 —— 顏色要由 CPU 端寫進
 * 屬性，所以這裡要看得到。**與它取代的那一級的樹冠色相同**，換級不得換樹種。
 */
export function pointColorOf(pool: PointPool, season: Season): number {
  const c = FLORA_COLORS[season]
  return pool === 'broadPoint' ? c.broadLeaf : pool === 'conePoint' ? c.conifer : c.bushLeaf
}

/**
 * 點的中心該放在株的座標上方多少，m。
 *
 * 【為什麼不是 0】株的座標在地面上，而點是以自己為中心畫的方塊 —— 直接放
 * 地面的話樹會有一半埋在土裡。這裡取它取代的那一級的樹冠**垂直中心**。
 */
export const POINT_Y: Record<PointPool, number> = {
  broadPoint: (BROAD_CROWN_Y0 + TREE_HEIGHT) / 2,
  conePoint: (CONE_CROWN_Y0 + TREE_HEIGHT) / 2,
  bushPoint: BUSH_CARD_TOP / 2,
}

export const POINT_SIZE: Record<PointPool, number> = {
  // 菱形：對角線 2·R 與 (TREE_HEIGHT − Y0)，面積 = R × 高
  broadPoint: Math.sqrt(BROAD_CROWN_R * (TREE_HEIGHT - BROAD_CROWN_Y0)),
  // 三角形：底 2·R、高 (TREE_HEIGHT − Y0)
  conePoint: Math.sqrt(CONE_CROWN_R * (TREE_HEIGHT - CONE_CROWN_Y0)),
  bushPoint: Math.sqrt(BUSH_R * BUSH_CARD_TOP),
}

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
 * 建築：牆 `BUILDING_WIDTH × BUILDING_DEPTH`、高 `BUILDING_WALL`，上面一個人字屋頂
 * （屋脊沿 z，四邊各出簷半公尺）。牆 12 ＋ 屋頂 6 = 18 個三角形
 */
function building(s: Soup, wall: number, roof: number): void {
  box(s, wall, BUILDING_WIDTH, BUILDING_DEPTH, 0, BUILDING_WALL)
  gable(s, roof, BUILDING_WIDTH + 1, BUILDING_DEPTH + 1, BUILDING_WALL, BUILDING_WALL + BUILDING_ROOF)
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

/** 有幾何的那八個池。遠處那三個走 `gl.POINTS`，沒有幾何 */
export type MeshPool = Exclude<PoolName, PointPool>

/**
 * 八個幾何。名字與 `render/vegetation.ts` 的池一一對應 —— 一個
 * `InstancedMesh` 只綁得住一個 geometry，所以八個形狀就是八個池。
 *
 * 【遠處那三個池不在這裡】它們是 `Points`，一株一個頂點、大小由
 * `POINT_SIZE` 給 —— 沒有幾何可以綁。
 */
export function createFloraGeometries(season: Season = 'summer'): Record<MeshPool, BufferGeometry> {
  const c = FLORA_COLORS[season]
  return {
    // 闊葉近：圓柱樹幹 12 ＋ 八面體樹冠 8 = 20
    broadNear: build((s) => {
      cylinder(s, TRUNK, 6, 1, 0, BROAD_CROWN_Y0)
      octa(s, c.broadLeaf, BROAD_CROWN_R, BROAD_CROWN_RY, BROAD_CROWN_CY)
    }),
    // 【中級掉的只有樹幹，樹冠一動都不動】樹冠仍然在 BROAD_CROWN_Y0 到
    // TREE_HEIGHT 之間、寬度也一樣 —— 把它拉到地面（`octa(…, H/2, H/2)`）
    // 的話，過門檻的瞬間樹冠會往下掉一截又變胖，那比少一根樹幹明顯得多。
    // 900 m 外樹幹不足 1 px，那才是這一級唯一該省的東西。
    broadMid: build((s) => { octa(s, c.broadLeaf, BROAD_CROWN_R, BROAD_CROWN_RY, BROAD_CROWN_CY) }),
    // 針葉近：圓柱樹幹 12 ＋ 七邊錐 7 = 19
    coneNear: build((s) => {
      cylinder(s, TRUNK, 6, 0.9, 0, CONE_CROWN_Y0)
      cone(s, c.conifer, 7, CONE_CROWN_R, CONE_CROWN_Y0, TREE_HEIGHT)
    }),
    // 針葉中：六邊錐，底仍然在 CONE_CROWN_Y0，不落地 —— 與闊葉同一個理由
    coneMid: build((s) => { cone(s, c.conifer, 6, CONE_CROWN_R, CONE_CROWN_Y0, TREE_HEIGHT) }),
    bushNear: build((s) => { octa(s, c.bushLeaf, BUSH_R, BUSH_RY, BUSH_CY) }),
    // 【建築只有一種形狀】房子、穀倉、倉庫都是它：面寬、樓高、進深由實例各軸
    // 縮放（`pushFlora` 的 `wide`、`tall`），四個池差的只有牆與屋頂的顏色 ——
    // 逐實例色整棟一起乘，換料只能靠另一份頂點色
    house: build((s) => { building(s, WALL, ROOF) }),
    houseSlate: build((s) => { building(s, WALL, SLATE) }),
    barn: build((s) => { building(s, BRICK_WALL, OLD_ROOF) }),
    barnTar: build((s) => { building(s, BRICK_WALL, TAR_ROOF) }),
    // 教堂：本堂 12 ＋ 本堂屋頂 6 ＋ 塔 12 ＋ 尖頂 4 = 34。屋頂是石板瓦
    church: build((s) => {
      box(s, CHURCH_WALL, 9, 18, 0, 6)
      gable(s, SLATE, 10, 19, 6, 9)
      box(s, CHURCH_WALL, 5, 5, 0, 14)
      cone(s, SPIRE, 4, 3.6, 14, 24)
    }),
  }
}

export function disposeFloraGeometries(g: Record<MeshPool, BufferGeometry>): void {
  for (const k of Object.keys(g) as MeshPool[]) g[k].dispose()
}
