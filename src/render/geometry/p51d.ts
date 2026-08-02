import { DEG } from '../../core/math'
import { createHull, type AircraftModel, type Blister, type FinParams, type LoftPart } from './assembly'
import type { CanopyStation } from './canopy'
import { prepareRings } from './hull'
import { P51D_HULL } from './p51d.hull'
import type { WingParams } from './wing'

/**
 * P-51D Mustang 的程序化外型 —— 真機全長 9.83 m、翼展 11.286 m、
 * 螺旋槳直徑 3.40 m。
 *
 * 照片上最能認出它的四件事，全部有對應幾何：
 *   1. 機首**下方**緊接整流罩的化油器進氣口（Merlin 型；上置進氣口是
 *      Allison 型的 P-51A／A-36）。已烘進機身外殼，見 p51d.hull。
 *   2. 機翼後緣下方那條又長又深的散熱器導管，進氣唇與機腹之間有段落差
 *   3. 淚滴形氣泡座艙罩，最寬處在駕駛座**後方**，往後收進薄背脊
 *   4. 垂直尾翼前方的背鰭延伸（dorsal fillet）
 *
 * 【全部座標量自參考模型】機身、座艙、導管、機翼、尾翼都是三軸切片量出來
 * 的，量測系再整體 +0.885 換成機體座標（見 p51d.hull 的說明）。原本機身與
 * 機翼是各自手訂的，兩者的縱向關係因此錯了 0.85 m。
 */

/**
 * 氣泡座艙罩 —— 座艙開口上的一頂圓罩。罩頂線量自參考模型：把射線原點放進
 * 罩子裡（y = 0.72）再往上射，就不會被機身干擾。
 *
 *     量測系 z   −0.80  −0.50  −0.20   0.10   0.50   0.90   1.30   1.60
 *     罩頂       0.658  0.862  1.029  1.066  1.036  0.952  0.780  ~0.66
 *
 * 最高點在量測系 z = 0.10（機體 0.985），正好是翼弦的 63%——氣泡罩最寬處
 * 在駕駛座後方，這個位置對得上。
 *
 * 【艙緣 0.52 是唯一人工定的線】參考模型在座艙段的最外側就是玻璃本身，
 * 機身開口的邊緣被擋住（skill 坑 15）。0.52 是這樣定的：機身在該高度的
 * 半寬是 0.289，而實測罩子最寬處是 0.30——玻璃下緣接在開口邊緣上（見
 * buildCanopy），所以艙緣選在哪，玻璃就多寬。
 *
 * 【roundness 2.0 是量出來的，不是調的】實測罩子在 z = 0.05 的側剖面：
 *
 *     高度 u（艙緣→罩頂）  0.42   0.63   0.84   0.96
 *     實測半寬 / 艙緣半寬  0.879  0.758  0.567  0.301
 *     正圓弧（n = 2.0）    0.909  0.773  0.539  0.274
 *
 * 原本用 2.6，那讓罩子在腰部胖了 8%。真的就是一個橢圓。
 */
const CANOPY: readonly CanopyStation[] = [
  { z: 0.085, sill: 0.52, roof: 0.658 },   // 風擋底框，齊機背
  { z: 0.385, sill: 0.52, roof: 0.862 },
  { z: 0.685, sill: 0.52, roof: 1.029 },
  { z: 0.985, sill: 0.52, roof: 1.066 },   // 泡罩最高
  { z: 1.385, sill: 0.52, roof: 1.036 },
  { z: 1.785, sill: 0.52, roof: 0.952 },
  { z: 2.185, sill: 0.60, roof: 0.780 },   // 往後收進薄背脊
  { z: 2.485, sill: 0.66, roof: 0.655 },   // 艙緣高過罩頂 → 收成一點
]
const CANOPY_SHAPE = { topWidth: 0.05, roundness: 2.0, arcSegments: 4 }

/**
 * 座艙段補上加密的環。開口前後各補一個相距 0.01 m 的環，前後壁才是垂直的
 * 隔板而不是長斜坡（skill 坑 10：109 曾因此在機首後方看起來塌了一塊）。
 */
const CANOPY_EXTRA_Z = [0.075, 0.235, 0.535, 0.835, 1.135, 1.585, 1.985, 2.335, 2.495]

const RINGS = prepareRings(P51D_HULL, [...CANOPY.map((c) => c.z), ...CANOPY_EXTRA_Z])

/**
 * 機腹散熱器導管 —— P-51D 的招牌。底線量自參考模型的中線最低點（量測系）：
 *
 *     z   0.05   0.20   0.50   0.80   1.10   1.40   1.70   2.00   2.15
 *     底 −0.847 −1.015 −1.024 −1.022 −0.974 −0.899 −0.822 −0.743  結束
 *
 * 平底段在 z 0.2–0.9（−1.02），之後線性抬升到 2.0 的 −0.74，出風口一結束
 * 就跳回機腹（2.15 量到 −0.473，那已經是機身）。
 *
 * 【上緣改成貼著機腹走，不再是固定值】機身腹線在翼根段依量測值下修到
 * −0.80（那一段真機本來就與翼根下表面齊平），原本固定 −0.52 的上緣會整條
 * 埋進機身裡看不見。現在每一站的上緣都訂在該站機腹線上方 0.06 m。
 */
const SCOOP: LoftPart = {
  roundness: 3.0,   // 導管是方的，不是圓的
  segments: 8,
  sections: [
    { z: 0.985, halfWidth: 0.24, halfHeight: 0.080, centerY: -0.820 },  // 進氣唇
    { z: 1.335, halfWidth: 0.36, halfHeight: 0.147, centerY: -0.877 },
    { z: 1.785, halfWidth: 0.38, halfHeight: 0.148, centerY: -0.878 },  // 最深
    { z: 2.335, halfWidth: 0.34, halfHeight: 0.118, centerY: -0.768 },
    { z: 2.885, halfWidth: 0.26, halfHeight: 0.132, centerY: -0.612 },  // 出風斜板
    { z: 3.035, halfWidth: 0.14, halfHeight: 0.040, centerY: -0.500 },  // 併回機腹
  ],
}

/**
 * 主翼 —— 平面形量自 X 軸切片（每個翼展站位的前後緣與厚度）。
 *
 * 【翼根弦長與位置是這次量測改動最大的一項】對 x = 2.2…5.2 的前後緣各配
 * 一條直線再外推到 x = 0：前緣落在量測系 −1.531、後緣 1.052，弦長 2.583。
 * 原本手訂的是 2.75，而且前緣訂在機體 −0.6875——換算成同一個座標系，
 * **機翼掛得比參考模型後 0.85 m**。風擋原本落在翼弦的 3.6%（等於騎在
 * 前緣上），量測值是 36.5%，照片上也是這樣。
 *
 * 兩個獨立佐證：量測的梯形算出來 MAC = 1.981，而 spec.wing.chord 是 1.98；
 * 翼面積 11.28 × (2.58+1.22)/2 = 21.4，spec 是 21.83（差額是翼根整流罩）。
 * 原本的 2.75／1.30 給的是 MAC 2.11、面積 22.8，兩項都對不上飛行模型。
 *
 * 其餘量測值：前緣後掠 3.5°（x 2.2→5.2 前緣移後 0.183 m）、上反 5.01°
 * （中厚線由 −0.4445 升到 −0.1815）、翼根中厚線 −0.6375。
 */
const WING: WingParams = {
  // rootZ = −rootChord/4：四分之一弦線必須壓在原點（原點是重心）
  rootChord: 2.58, tipChord: 1.22, halfSpan: 5.64, rootZ: -0.645,
  sweep: 3.5 * DEG, dihedral: 5 * DEG, rootY: -0.6375,
  // 厚弦比由翼根 16.0% 收到翼尖 8.6%（實測 x=2.2 時 14.3%、x=5.2 時 9.8%）
  thickness: 0.414, tipThickness: 0.105,
  tipRound: 0.40,
}

/**
 * 水平尾翼 —— 同樣量自 X 軸切片，但視窗限在 z > 2.5 才不會混到主翼。
 * x = 0.4…1.9 全段乾淨（0.1–0.3 被機身佔住、2.0 以外已是翼尖之外）。
 *
 * 前緣 3.601 → 3.899（後掠 11.2°）、後緣 4.781 → 4.550、弦長 1.180 → 0.651，
 * 中厚線 0.4835 → 0.4855（上反 0，符合真機）。翼展終止在 x ≈ 1.97，
 * 真機 3.96 m 的一半。
 */
const TAILPLANE: WingParams = {
  rootChord: 1.31, tipChord: 0.69, halfSpan: 1.97,
  sweep: 11.2 * DEG, dihedral: 0, thickness: 0.116, tipThickness: 0.088,
  rootZ: 4.407, rootY: 0.483, tipRound: 0.75,
}

/**
 * 垂直尾翼 —— 由「正上方射線」掃出來的側視上緣線讀出（量測系）：
 *
 *     z    2.90   3.20   3.60   4.10   4.30   4.60   4.90   5.30   5.60
 *     上緣 0.627  0.676  0.773  0.922  1.234  1.848  1.912  1.862  0.505
 *
 * 2.90–4.10 是背鰭（斜率 13.8°），4.10 起才是垂尾本體（前緣後掠 28.4°），
 * 頂端 1.92，5.30 之後是方向舵後緣。把前緣線往下延伸到 y = 0.10 得虛擬
 * 翼根，後緣線同樣外推——這樣做出來的可見輪廓才與量測線重合。
 *
 * 【rootY 必須低於整段機尾的背線，不是低於前端那一點】第一版取 0.60，
 * 那是垂尾前緣所在站位的背線；但背線一路降到尾錐的 0.215，於是垂尾後半
 * 整個懸空——側視看得到垂尾底下透出背景。0.10 讓虛擬翼根低於最後一個
 * 機身環（0.215），方向舵後緣仍然照真機那樣伸出尾錐之外。
 *
 * 【翼尖圓化只能收兩成】upright 的第三個參數是 tipRound。原本沿用機翼的
 * 0.35，那把最頂端的弦長收到 0.23——疊圖上垂尾頂端整個缺一塊。實測頂端
 * （y = 1.92）的弦長是 4.75→5.35 共 0.60，等於 tipRound 0.8 出頭；真機的
 * 垂尾頂只是小圓角，不是橢圓收尖。
 */
const FIN: FinParams = {
  chordRoot: 2.03, chordTip: 0.67, height: 1.82, sweep: 28.4 * DEG, z: 4.541, rootY: 0.10,
}

/**
 * 背鰭（dorsal fillet）：自量測到的起點（機體 3.785、背線 0.627）升到
 * 0.927，頂端**恰好**落在垂尾前緣線上——0.30 的高度配 76° 後掠，
 * 3.785 + 0.30·tan76° = 4.988，而垂尾前緣在 y = 0.927 處是
 * 4.811 + 0.327·tan28.4° = 4.988。後掠角這麼大時，翼根只要埋進機身幾公分，
 * 可見根部就會被帶往機尾好幾十公分，所以 rootY 必須貼齊背線。
 */
const FIN_FILLET: FinParams = {
  chordRoot: 1.55, chordTip: 0.30, height: 0.30, sweep: 76 * DEG, z: 3.785, rootY: 0.627,
}

/**
 * Packard V-1650 的排氣管：**每側 6 根**，沿引擎罩側下方排成一列。
 *
 * 【依據】機身橫剖在 z = −2.365（機體）的上側 5°–15° 有一道凹槽：量到的
 * 半寬 0.341–0.355，而該站位的剖面應該是 0.40。凹槽就是排氣管座。
 * 用產生器而不是手打六筆，是因為間距與尺寸要一致才會讀成鋸齒狀。
 */
function exhaustStubs(startZ: number, pitch: number, count: number): Blister[] {
  return Array.from({ length: count }, (_, i) => ({
    x: 0.38, y: 0.13, z: startZ + i * pitch,
    width: 0.10, height: 0.11, length: 0.15,
    mirror: true,
  }))
}

const BLISTERS: readonly Blister[] = exhaustStubs(-2.42, 0.185, 6)

export function buildP51D(): AircraftModel {
  const h = createHull({
    bodyColor: 0x9aa7b4,
    accentColor: 0x2f3a46,
    realLength: 9.83,
    offsetZ: 0,
  })

  h.cockpit(RINGS, CANOPY, CANOPY_SHAPE)
  h.loft(SCOOP, h.accent)

  // 主翼與水平尾翼皆為全翼展固定翼面（見 buildAircraft 的「為什麼沒有舵面」）
  h.wingPair(WING)
  h.wingPair(TAILPLANE)

  // 垂尾頂端是圓的；背鰭是整流罩不是翼面，維持方角
  h.upright(FIN, 0.12, 0.80)
  h.upright(FIN_FILLET, 0.22)

  h.blisters(BLISTERS)
  h.propeller({
    // 整流罩底徑與軸心高度取自機身首環（半寬 0.283、中心 0.008）
    spinnerRadius: 0.283, spinnerLength: 0.4375, spinnerY: 0.008,
    blades: 4, propZ: -3.10, propRadius: 1.70,   // 真機螺旋槳直徑 3.40 m
  }, RINGS[0]!.z)

  return h.finish()
}
