import type { ShipClassId } from '../world/ships'
import type { ShipLiveryLayout, ShipPartKind } from './shipLivery'

/**
 * # 各艦級的塗裝
 *
 * 版面、材質角色、細部顏色與零件種類表。套用的程式在 `ships.ts` 的
 * `applyShipLivery`，版面與零件的算法在 `shipLivery.ts`，貼圖由
 * `tools/livery/ship_<艦級>.py` 畫。
 *
 * **零件的色階在 0.6 … 1.4 之間（±40%，畫面亮度），起始值，由截圖裁定。**
 * 上層結構偏亮、砲械偏暗：大塊的淺面墊底，砲、機砲、桅這些細件壓深，疊在上面
 * 才讀得出輪廓。
 *
 * 零件種類的框是零件重心的範圍（遊戲座標：X 橫向、Y 上、艦首 −Z；`x` 比 |x|）。
 * 位置來自各艦的建模腳本 `tools/blender/build_<艦級>.py`（腳本的 +Y 艦首 = 這裡
 * 的 −Z，腳本的 Z = 這裡的 Y）。依順序取第一個符合的。
 */

/** GLB 材質在塗裝裡的角色：船身與甲板吃貼圖，細部換成單色 */
export type ShipMaterialKind = 'body' | 'deck' | 'accent'

export interface ShipLiveryDef {
  readonly layout: ShipLiveryLayout
  /** GLB 材質名 → 角色。沒列到的材質照 GLB 原樣 */
  readonly kinds: Readonly<Record<string, ShipMaterialKind>>
  /** 細部的顏色（sRGB） */
  readonly accentColor: number
  /**
   * 網格名 → 那個網格的零件種類表（見 `shipLivery.ts` 的 `partTones`）。列到的網格
   * 每一塊零件都要認得出種類；同材質沒列到的網格（船殼）維持原色。
   *
   * 【一個網格一張表】砲桶與坐在桶裡的 20 mm 重心幾乎重合，混成一張表的話先列的
   * 那一種會把兩者都吃掉。
   */
  readonly parts: Readonly<Record<string, readonly ShipPartKind[]>>
}

// ── Fletcher ────────────────────────────────────────────

const FLETCHER_SUPER_PARTS: readonly ShipPartKind[] = [
  // 艦橋、駕駛室、舷側翼台
  { name: 'bridge', tone: 1.3, boxes: [{ x: [0, 1], y: [8, 13], z: [-22, -19] }] },
  // 20 mm 環（艦橋前平台、翼台）與艦尾 40 mm 的桶
  { name: 'tub', tone: 1.25, boxes: [
    { x: [3, 5], y: [6, 11], z: [-27, -17] },
    { x: [0, 1], y: [6.5, 11], z: [25.5, 27] },
  ] },
  { name: 'boat', tone: 1.4, boxes: [{ x: [4, 5], z: [-16, -10] }] },
  { name: 'funnel', tone: 0.75, boxes: [
    { x: [0, 1], y: [9, 11], z: [-11, -7] },
    { x: [0, 1], y: [9, 11], z: [3, 7] },
  ] },
  // 五段甲板室、前甲板室、艦橋前平台
  { name: 'house', tone: 1.15, boxes: [{ x: [0, 1], y: [3.5, 7], z: [-35, 35] }] },
]

const FLETCHER_GUN_PARTS: readonly ShipPartKind[] = [
  // 五座 5 吋砲塔與砲管。y 上限擋掉坐在更高處的 40 mm
  { name: 'gun', tone: 0.85, boxes: [
    { x: [0, 1], y: [2, 9.6], z: [-44, -28] },
    { x: [0, 1], y: [2, 9.6], z: [14, 44] },
  ] },
  // 四座 20 mm（砲身、砲管）與 40 mm（砲架、兩根砲管）
  { name: 'aa', tone: 0.6, boxes: [
    { x: [3, 6], z: [-27, -18] },
    { x: [0, 1], y: [9.6, 12], z: [23, 28] },
  ] },
  // Mk37 射控台與雷達板
  { name: 'director', tone: 1.0, boxes: [{ x: [0, 1], y: [13, 19], z: [-22, -19] }] },
  // 前桅與桁
  { name: 'mast', tone: 0.65, boxes: [{ x: [0, 5], y: [17, 28], z: [-17, -14] }] },
  { name: 'torpedo', tone: 0.7, boxes: [
    { x: [0, 1], y: [5, 7.5], z: [-8, 0] },
    { x: [0, 1], y: [5, 7.5], z: [8, 14.5] },
  ] },
  // 艦尾兩條深水炸彈軌
  { name: 'rack', tone: 0.6, boxes: [{ z: [46, 58] }] },
]

/**
 * Fletcher：Measure 21（立面一律 5-N 海軍藍、水平面 20-B 甲板藍）。細部是立面，
 * 所以也是 5-N：規範的孟塞爾 5PB 3.4/3 換成 sRGB 是 (70, 81, 103)。
 * 範圍包住整個船身與甲板：船殼 z −57.0 … 56.9、y −4.0 … 6.4，上層結構頂到 14.8，
 * 甲板半寬 6.0。17 px/m 是約 6 cm 一格。
 */
const FLETCHER: ShipLiveryDef = {
  layout: {
    url: '/textures/ship_fletcher.png', scale: 17,
    zMin: -57.5, zMax: 57.5, yMin: -4.2, yMax: 15, halfBeam: 6.2,
  },
  kinds: { FLETCHER_Body: 'body', FLETCHER_Deck: 'deck', FLETCHER_Accent: 'accent' },
  accentColor: 0x465167,
  parts: { FLETCHER_Super: FLETCHER_SUPER_PARTS, FLETCHER_Guns: FLETCHER_GUN_PARTS },
}

// ── Wichita ─────────────────────────────────────────────

const WICHITA_SUPER_PARTS: readonly ShipPartKind[] = [
  // 艏樓 20 mm 的環、艦橋翼台 40 mm 的桶、舯部小艇甲板 20 mm 的八個環
  { name: 'tub', tone: 1.25, boxes: [
    { x: [1, 2], y: [7, 8.5], z: [-86, -84] },
    { x: [5.5, 7], y: [10, 11.5], z: [-14, -10] },
    { x: [4, 5.5], y: [7.5, 9], z: [-5, 5] },
  ] },
  { name: 'boat', tone: 1.4, boxes: [{ x: [7, 9], y: [6, 8], z: [9, 25] }] },
  { name: 'funnel', tone: 0.75, boxes: [
    { x: [0, 1], y: [15, 17], z: [-6, -4] },
    { x: [0, 1], y: [15, 17], z: [5, 7.5] },
  ] },
  // 三座主砲塔的砲座與艦尾吊車的基座
  { name: 'barbette', tone: 1.05, boxes: [
    { x: [0, 1], y: [5.5, 8], z: [-51, -48] },
    { x: [0, 1], y: [7, 8.5], z: [-39, -36.5] },
    { x: [0, 1], y: [5.5, 7], z: [48, 50] },
    { x: [0, 1], y: [6, 7.5], z: [86, 88.5] },
  ] },
  // 艦橋兩層與翼台；艦尾射控塔與後塔
  { name: 'bridge', tone: 1.3, boxes: [
    { x: [0, 1], y: [10, 19], z: [-18, -11] },
    { x: [0, 1], y: [11.5, 13.5], z: [30, 32] },
    { x: [0, 1], y: [11, 12.5], z: [36.5, 38] },
  ] },
  // 防浪板、墊高甲板、三段 01 甲板、艦橋前與艦尾的甲板室、機艙罩、水上機甲板
  { name: 'house', tone: 1.15, boxes: [{ x: [0, 1], y: [5.5, 11], z: [-56, 85] }] },
]

const WICHITA_GUN_PARTS: readonly ShipPartKind[] = [
  // 三座 8 吋三聯裝：砲塔與各三根砲管
  { name: 'turret', tone: 0.85, boxes: [
    { x: [0, 4], y: [6, 12], z: [-62, -33] },
    { x: [0, 4], y: [6, 10], z: [44, 62] },
  ] },
  // 八座 5 吋單裝（一舷四座）：砲身與砲管
  { name: 'secondary', tone: 0.8, boxes: [
    { x: [4.5, 10], y: [6, 11], z: [-34, -17] },
    { x: [4.5, 10], y: [6, 11], z: [29, 33] },
    { x: [4.5, 10], y: [6, 10], z: [85, 90] },
  ] },
  // 翼台的四聯裝 40 mm、舯部與艏樓的 20 mm
  { name: 'aa', tone: 0.6, boxes: [
    { x: [5, 8], y: [10.5, 13], z: [-14, -10] },
    { x: [4, 6.5], y: [7.5, 9.5], z: [-5, 5] },
    { x: [1, 3.5], y: [7, 9], z: [-87, -84] },
  ] },
  // 前桅與兩根桁、主桅與桁
  { name: 'mast', tone: 0.65, boxes: [
    { x: [0, 5], y: [20, 40], z: [-13, -9] },
    { x: [0, 4], y: [19, 26], z: [28, 30] },
  ] },
  // 艦橋頂的 Mk34 射控
  { name: 'director', tone: 1.0, boxes: [{ x: [0, 1], y: [15, 18], z: [-24, -21] }] },
  { name: 'catapult', tone: 0.7, boxes: [{ x: [5, 7], z: [70, 76] }] },
  // 艦尾吊車：立柱、吊臂、背拉桿
  { name: 'crane', tone: 0.7, boxes: [{ x: [0, 1], y: [10, 15], z: [82, 90] }] },
]

/**
 * Wichita：Measure 22（1943–45 年的照片）。一條水平分界線，線下 5-N 海軍藍、線上
 * 5-H 霧灰；水平面 20-B 甲板藍。細部都在線上，所以是霧灰：孟塞爾 5PB 6/2 換成
 * sRGB 是 (141, 148, 159)。
 * 範圍：船殼 z −91.9 … 90.2、y −7.5 … 7.6，上層結構頂到 21.3，甲板半寬 9.4。
 * 11 px/m 是約 9 cm 一格。
 */
const WICHITA: ShipLiveryDef = {
  layout: {
    url: '/textures/ship_wichita.png', scale: 11,
    zMin: -92.4, zMax: 90.7, yMin: -7.7, yMax: 21.5, halfBeam: 9.6,
  },
  kinds: { WICHITA_Body: 'body', WICHITA_Deck: 'deck', WICHITA_Accent: 'accent' },
  accentColor: 0x8d949f,
  parts: { WICHITA_Super: WICHITA_SUPER_PARTS, WICHITA_Guns: WICHITA_GUN_PARTS },
}

// ── Essex ───────────────────────────────────────────────

/**
 * 艦島的八個方塊：主體、艦橋層、上艦橋、羅經艦橋（四層）、煙囪、主桅、SK 雷達板、
 * 前方位儀。煙囪、主桅、雷達板的重心都在 36…40 m 高，靠高度（外框的 dy）分開。
 */
const ESSEX_ISLAND_PARTS: readonly ShipPartKind[] = [
  { name: 'funnel', tone: 0.75, boxes: [{ dy: [11, 12] }] },
  { name: 'mast', tone: 0.65, boxes: [{ dy: [10.4, 10.9] }] },
  { name: 'radar', tone: 0.7, boxes: [{ y: [38, 41], dy: [2.3, 2.9] }] },
  { name: 'director', tone: 1.0, boxes: [{ y: [34, 37], dy: [1.5, 2.1] }] },
  { name: 'bridge', tone: 1.3, boxes: [{ y: [20, 33] }] },
]

/**
 * 砲械散在兩舷走廊與舷台上，位置不規則；五種零件的外框尺寸各不相同，所以認尺寸：
 *
 *   5 吋雙聯裝砲塔  4.4 × 3.3 × 4.4     5 吋單裝砲塔  2.8 × 2.6 × 2.8
 *   5 吋砲管        長 4.7              40 mm 砲座     2.7 × 1.35 × 2.7
 *   40 mm 砲管      長 4.0…4.1          20 mm 砲身     0.84 × 1.75 × 0.84
 *   20 mm 砲管      往舷外 1.45、往上 0.47、往前 0.4
 */
const ESSEX_GUN_PARTS: readonly ShipPartKind[] = [
  { name: 'gun', tone: 0.85, boxes: [
    { dx: [2.5, 4.6], dy: [2.4, 3.5] },
    { dx: [0, 1], dy: [0, 1], dz: [4.5, 5] },
  ] },
  { name: 'aa', tone: 0.6, boxes: [
    { dx: [2.5, 3], dy: [1.2, 1.7] },
    { dx: [0, 1], dy: [0, 1], dz: [3.8, 4.4] },
    { dx: [0.7, 1.1], dy: [1.4, 2], dz: [0.7, 1.1] },
    { dx: [1.2, 1.8], dy: [0.4, 0.8], dz: [0.3, 0.6] },
  ] },
]

/**
 * Essex：Measure 21。1944 年漆的是 Measure 32/6-10D 迷彩，1945 年 3 月之前改漆成
 * Measure 21（NavSource 的照片說明）；太平洋艦隊 1945-01-01 起只准 12、21、22。
 * 立面 5-N 海軍藍、水平面與木飛行甲板 20-B 甲板藍（飛行甲板用的 Flight Deck Stain 21
 * 與 20-B 同色）。細部是立面，所以是 5-N。
 *
 * 範圍：船殼 z −132.0 … 131.5、y −9.4 … 17.9，艦島頂到 45.2；甲板條要包住左舷的
 * 舷側升降機（伸到 x −25.0）。5.9 px/m 是約 17 cm 一格 —— 艦島把側條撐到 55 m 高，
 * 三條要擠進 1024。
 */
const ESSEX: ShipLiveryDef = {
  layout: {
    url: '/textures/ship_essex.png', scale: 5.9,
    zMin: -132.5, zMax: 132, yMin: -9.6, yMax: 45.4, halfBeam: 25.3,
  },
  kinds: { ESSEX_Body: 'body', ESSEX_Deck: 'deck', ESSEX_Accent: 'accent' },
  accentColor: 0x465167,
  parts: {
    ESSEX_Island: ESSEX_ISLAND_PARTS,
    ESSEX_Guns: ESSEX_GUN_PARTS,
    // 走廊是一段段矩形平台、舷台是掛在舷側的砲座平台，各自一種
    ESSEX_Gallery: [{ name: 'gallery', tone: 1.1, boxes: [{}] }],
    ESSEX_Sponsons: [{ name: 'sponson', tone: 1.2, boxes: [{}] }],
  },
}

/** 有塗裝貼圖的艦級。**沒列到的照 GLB 的單色材質。** */
export const SHIP_LIVERIES: Partial<Record<ShipClassId, ShipLiveryDef>> = {
  fletcher: FLETCHER,
  wichita: WICHITA,
  essex: ESSEX,
}
