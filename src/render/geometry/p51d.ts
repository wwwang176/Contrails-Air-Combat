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
 *   1. 機首**上方**緊接整流罩的化油器進氣口（Merlin 型的標誌，Allison 型沒有）
 *   2. 機翼後緣下方那條又長又深的散熱器導管，進氣唇與機腹之間有段落差
 *   3. 淚滴形氣泡座艙罩，最寬處在駕駛座**後方**，往後收進薄背脊
 *   4. 垂直尾翼前方的背鰭延伸（dorsal fillet）
 */

/**
 * 氣泡座艙罩 —— 座艙開口上的一頂圓罩。
 *
 * 【為什麼也要挖洞】機身依量測值收窄之後，泡罩（最寬 0.43）反而比同站位
 * 機身（0.404）**寬**了，埋在機身裡的半透明下半截會整片透出來——正是 109
 * 先前那個「側面浮著一團淡色楔形」的毛病。改成跟 109 同一套：機身在座艙段
 * 挖開，泡罩蓋在開口上，下緣直接接在開口邊緣。
 *
 * 【截面用圓弧不是梯形】P-51D 的泡罩是真的圓的；用 109 那種平板梯形做出來
 * 像個雞籠。roundness 2.6 讓它到接近頂端才收窄，這正是氣泡罩的樣子。
 */
const CANOPY: readonly CanopyStation[] = [
  { z: -0.5875, sill: 0.36, roof: 0.640 },   // 風擋底框，齊機背
  { z: -0.1375, sill: 0.36, roof: 0.860 },   // 風擋頂
  { z: 0.6125, sill: 0.36, roof: 0.920 },    // 泡罩最高
  { z: 1.3625, sill: 0.36, roof: 0.880 },
  { z: 1.8125, sill: 0.52, roof: 0.780 },    // 往後收進薄背脊
  { z: 2.1125, sill: 0.62, roof: 0.600 },    // 艙緣高過罩頂 → 收成一點
]
const CANOPY_SHAPE = { topWidth: 0.10, roundness: 2.6, arcSegments: 4 }

const RINGS = prepareRings(P51D_HULL, CANOPY.map((c) => c.z))

/**
 * 機腹散熱器導管 —— P-51D 的招牌。剖面**量自參考模型**的中線最低點：
 *
 *     z   0.2    0.6    1.0    1.4    1.8    2.0    2.2
 *     底 −1.015 −1.026 −0.996 −0.899 −0.796 −0.743  −0.471 ← 導管結束
 *
 * 平底段在 z 0.2–0.9（−1.02），之後線性抬升到 2.0 的 −0.74，然後出風口一結束
 * 就跳回機腹。
 *
 * 【原本錯三件事】太淺（底 −0.92 對 −1.026）、最深處太後（z 1.11 對 0.5）、
 * 太長（尾端 3.51 對 2.1）。三件都是機翼位置修正後才量得出來——導管掛在
 * 機翼中央翼段下面，機翼站錯位置時導管的量測基準也跟著錯。
 *
 * 上緣一律訂在 −0.52，埋進機身腹線（−0.60～−0.66）之內，避免露出接縫。
 */
const SCOOP: LoftPart = {
  roundness: 3.0,   // 導管是方的，不是圓的
  segments: 8,
  sections: [
    { z: 0.10, halfWidth: 0.24, halfHeight: 0.205, centerY: -0.725 },  // 進氣唇
    { z: 0.45, halfWidth: 0.36, halfHeight: 0.251, centerY: -0.771 },
    { z: 0.90, halfWidth: 0.38, halfHeight: 0.248, centerY: -0.768 },  // 最深
    { z: 1.45, halfWidth: 0.34, halfHeight: 0.184, centerY: -0.704 },
    { z: 2.00, halfWidth: 0.24, halfHeight: 0.112, centerY: -0.632 },  // 出風斜板
    { z: 2.30, halfWidth: 0.10, halfHeight: 0.025, centerY: -0.525 },  // 併回機腹
  ],
}

const WING: WingParams = {
  // 厚度為**翼根**值：0.40 / 2.75 = 14.5% 厚弦比，真機 NAA/NACA 45-100
  // 層流翼根部 15.1%。翼尖由 buildWingPanel 按弦長比例收到 0.19 m。
  rootChord: 2.75, tipChord: 1.30, halfSpan: 5.64,
  // rootY 由 −0.28 下修：以機首（推力線）對齊參考模型後，機翼整段低 0.36 m。
  // 佐證：參考模型在 z −0.6～−0.2 的中線最低點是 −0.81，本模型翼根下表面
  // 在 −0.64−0.20 = −0.84，差 0.03。
  sweep: 4 * DEG, dihedral: 5 * DEG, thickness: 0.40, rootZ: -0.6875, rootY: -0.64,
  tipRound: 0.30,
}

const TAILPLANE: WingParams = {
  rootChord: 1.35, tipChord: 0.70, halfSpan: 2.10,
  sweep: 8 * DEG, dihedral: 0, thickness: 0.14, rootZ: 4.1125, rootY: 0.10, tipRound: 0.35,
}

const FIN: FinParams = {
  chordRoot: 1.80, chordTip: 0.80, height: 1.40, sweep: 34 * DEG, z: 3.6125, rootY: 0.35,
}

/**
 * 背鰭（dorsal fillet）：翼根坐在背線上（0.57），頂端要**恰好**落在垂尾
 * 前緣線上——解 1.45 + tan(sw)·h = 2.8 + tan(34°)·(0.57 + h − 0.35)，
 * 取 h=0.30 得 sw=80°，交會於 (z=3.15, y=0.87)。後掠角這麼大時，翼根只要
 * 埋進機身幾公分，可見根部就會被帶往機尾好幾十公分，所以 rootY 必須齊平。
 */
const FIN_FILLET: FinParams = {
  chordRoot: 1.55, chordTip: 0.30, height: 0.30, sweep: 80 * DEG, z: 2.2625, rootY: 0.57,
}

const BLISTERS: readonly Blister[] = [
  // 化油器進氣口，機首**上方**
  { x: 0, y: 0.56, z: -2.8875, width: 0.32, height: 0.24, length: 1.00 },
]

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
  h.upright(FIN, 0.12, 0.35)
  h.upright(FIN_FILLET, 0.22)

  h.blisters(BLISTERS)
  h.propeller({
    spinnerRadius: 0.30, spinnerLength: 0.55, spinnerY: 0,
    blades: 4, propZ: -3.9875, propRadius: 1.70,
  }, RINGS[0]!.z)

  return h.finish()
}
