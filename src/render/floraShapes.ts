import { BufferAttribute, BufferGeometry, Color } from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { FIELD_COLORS, FLORA_COLORS, type Season } from './season'
import { BROAD_CROWN_R, BUSH_R, CONE_CROWN_R, TREE_HEIGHT } from '../specs/flora'
import { floraModel, floraModelGeometry, type FloraLevel, type FloraSpecies } from './floraModels'

/**
 * 植被與建築的幾何。**池幾何一律有索引、共用頂點** —— 程序幾何在這裡併（`shared`），
 * 近距離兩級的模型在 `floraModelGeometry` 併。
 *
 * 【為什麼共用頂點】一個池同時畫幾千到幾萬份，頂點運算乘上實例數：900 m 外的
 * 闊葉八面體不共用是 24 個頂點、共用是 6 個，雷伊泰同時有約五萬份。外觀不變 ——
 * 材質開了 `flatShading`，面法線在片段著色器由螢幕導數算，`normal` 屬性不參與光照。
 * 併的是位置與顏色都相同的頂點：樹幹與樹冠、牆與屋頂不同色，不會被併在一起。
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
 * 植被與建築的池。樹與灌木由近到遠：`High`（高模）、`Near`（中模）、`Mid`、`Point`。
 * 闊葉與針葉的 `Mid` 是只有樹冠的八面體與錐；灌木的 `Mid` 是八面體。
 */
export type PoolName =
  | 'broadHigh' | 'broadNear' | 'broadMid' | 'broadPoint'
  | 'coneHigh' | 'coneNear' | 'coneMid' | 'conePoint'
  | 'bushHigh' | 'bushNear' | 'bushMid' | 'bushPoint'
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
const BROAD_CROWN_RY = 10
const BROAD_CROWN_CY = 20
const CONE_CROWN_Y0 = 8
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

/** 一種建築的牆色與屋頂色 */
export interface BuildingColor {
  readonly wall: number
  readonly roof: number
}

/** 四個建築池各自的牆與屋頂。**季節換的是這一張表**（`buildingColors`） */
export interface BuildingColors {
  readonly house: BuildingColor
  readonly houseSlate: BuildingColor
  readonly barn: BuildingColor
  readonly barnTar: BuildingColor
}

const CENTRAL_EUROPE: BuildingColors = {
  house: { wall: WALL, roof: ROOF },
  houseSlate: { wall: WALL, roof: SLATE },
  barn: { wall: BRICK_WALL, roof: OLD_ROOF },
  barnTar: { wall: BRICK_WALL, roof: TAR_ROOF },
}

/**
 * 冬季的俄國農村：石灰刷白的泥牆、覆雪的草頂（屋頂是白的）；附屬的棚子牆是灰褐、屋頂也覆雪但
 * 比住屋髒一點。**`houseSlate` 在草原村是燒毀的房子**：牆與屋頂都燒成焦黑，在雪上最顯眼。池的名字
 * 沿用 —— 池只認顏色表，形狀都一樣
 */
const STEPPE_VILLAGE: BuildingColors = {
  house: { wall: 0xe8e4da, roof: 0xeef1f3 },
  houseSlate: { wall: 0x2b2722, roof: 0x1a1816 },
  barn: { wall: 0x8f8571, roof: 0xdfe4e8 },
  barnTar: { wall: 0x6e6454, roof: 0xcfd6db },
}

/** 這個季節的建築顏色。夏季與晚秋是德國中部那一套（原本的常數） */
export function buildingColors(season: Season): BuildingColors {
  return FIELD_COLORS[season].layout === 'steppe' ? STEPPE_VILLAGE : CENTRAL_EUROPE
}
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

/** 只有 position／color 的非索引幾何，三角形的次序就是擺進去的次序 */
function soup(fn: (s: Soup) => void): BufferGeometry {
  const s: Soup = { pos: [], col: [] }
  fn(s)
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(s.pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(s.col), 3))
  return geo
}

/** 非索引，法線是面法線 */
function build(fn: (s: Soup) => void): BufferGeometry {
  const geo = soup(fn)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/**
 * 池幾何：有索引，位置與顏色都相同的頂點併成一個，三角形的次序與繞向不變。
 * **法線要在併完之後算** —— 先算的話面法線各不相同，一個頂點都併不掉
 */
function shared(fn: (s: Soup) => void): BufferGeometry {
  const geo = mergeVertices(soup(fn))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/**
 * 村裡那一種建築的形狀，牆與屋頂換成指定的顏色。縮放 1 時的尺寸是
 * `BUILDING_*`，底面中心在原點、面寬沿 x。**非索引**（`buildDepot` 收的零件要
 * 非索引），只有 position／color／normal
 */
export function buildingGeometry(wall: number, roof: number): BufferGeometry {
  return build((s) => { building(s, wall, roof) })
}

/** 有幾何的池。遠處那三個走 `gl.POINTS`，沒有幾何 */
export type MeshPool = Exclude<PoolName, PointPool>

/**
 * 近距離兩級的模型：GLB 已載入就用它（`floraModels.ts`），否則退回程序幾何 ——
 * 樹幹＋八面體、樹幹＋錐、灌木八面體。退路的外框與模型相同（樹高、樹冠半徑），
 * 只是面少。
 */
function nearShape(
  species: FloraSpecies, level: FloraLevel, crownHex: number, fallback: (s: Soup) => void,
): BufferGeometry {
  const m = floraModel(species, level)
  return m === null ? shared(fallback) : floraModelGeometry(m, TRUNK, crownHex)
}

/**
 * 有網格的池各一個幾何。名字與 `render/vegetation.ts` 的池一一對應 —— 一個
 * `InstancedMesh` 只綁得住一個 geometry，所以一個形狀就是一個池。
 *
 * 【遠處那三個池不在這裡】它們是 `Points`，一株一個頂點、大小由
 * `POINT_SIZE` 給 —— 沒有幾何可以綁。
 */
export function createFloraGeometries(season: Season = 'summer'): Record<MeshPool, BufferGeometry> {
  const c = FLORA_COLORS[season]
  const bc = buildingColors(season)
  // 程序幾何：圓柱樹幹 12 ＋ 八面體樹冠 8 = 20；圓柱樹幹 12 ＋ 七邊錐 7 = 19；灌木八面體 8
  const broadProc = (s: Soup): void => {
    cylinder(s, TRUNK, 6, 1, 0, BROAD_CROWN_Y0)
    octa(s, c.broadLeaf, BROAD_CROWN_R, BROAD_CROWN_RY, BROAD_CROWN_CY)
  }
  const coneProc = (s: Soup): void => {
    cylinder(s, TRUNK, 6, 0.9, 0, CONE_CROWN_Y0)
    cone(s, c.conifer, 7, CONE_CROWN_R, CONE_CROWN_Y0, TREE_HEIGHT)
  }
  const bushProc = (s: Soup): void => { octa(s, c.bushLeaf, BUSH_R, BUSH_RY, BUSH_CY) }
  return {
    broadHigh: nearShape('broad', 'high', c.broadLeaf, broadProc),
    broadNear: nearShape('broad', 'mid', c.broadLeaf, broadProc),
    // 【這一級只有樹冠，位置與寬度跟著程序幾何的樹冠】樹冠在 BROAD_CROWN_Y0 到
    // TREE_HEIGHT 之間 —— 把它拉到地面（`octa(…, H/2, H/2)`）的話，過門檻的瞬間
    // 樹冠會往下掉一截又變胖。900 m 外樹幹不足 1 px，那才是這一級該省的東西。
    broadMid: shared((s) => { octa(s, c.broadLeaf, BROAD_CROWN_R, BROAD_CROWN_RY, BROAD_CROWN_CY) }),
    coneHigh: nearShape('cone', 'high', c.conifer, coneProc),
    coneNear: nearShape('cone', 'mid', c.conifer, coneProc),
    // 針葉中：六邊錐，底仍然在 CONE_CROWN_Y0，不落地 —— 與闊葉同一個理由
    coneMid: shared((s) => { cone(s, c.conifer, 6, CONE_CROWN_R, CONE_CROWN_Y0, TREE_HEIGHT) }),
    bushHigh: nearShape('bush', 'high', c.bushLeaf, bushProc),
    bushNear: nearShape('bush', 'mid', c.bushLeaf, bushProc),
    bushMid: shared(bushProc),
    // 【建築只有一種形狀】房子、穀倉、倉庫都是它：面寬、樓高、進深由實例各軸
    // 縮放（`pushFlora` 的 `wide`、`tall`），四個池差的只有牆與屋頂的顏色 ——
    // 逐實例色整棟一起乘，換料只能靠另一份頂點色
    house: shared((s) => { building(s, bc.house.wall, bc.house.roof) }),
    houseSlate: shared((s) => { building(s, bc.houseSlate.wall, bc.houseSlate.roof) }),
    barn: shared((s) => { building(s, bc.barn.wall, bc.barn.roof) }),
    barnTar: shared((s) => { building(s, bc.barnTar.wall, bc.barnTar.roof) }),
    // 教堂：本堂 12 ＋ 本堂屋頂 6 ＋ 塔 12 ＋ 尖頂 4 = 34。屋頂是石板瓦
    church: shared((s) => {
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
