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
 * 機腹散熱器導管 —— P-51D 的招牌。
 *
 * 【後半段原本是浮在空中的】機腹自機翼後緣起就往上收（boat-tail），導管卻
 * 一路平飛，到 z=2.4 已經離開機身 0.20 m——側面看是一根獨立漂浮的方管。
 *
 * 而且光把它抬高還不夠：機身是超橢圓剖面，導管**兩側**對應的機身表面比
 * 中線高得多，所以上緣兩角照樣懸空（實測在機身表面外 3.69 倍）。導管後段
 * 還一度比機身還寬（z=2.0 處 0.36 對 0.35），整個上蓋暴露。因此後段必須
 * 同時收窄**並**抬高，讓上緣整條都埋進機身裡。
 */
const SCOOP: LoftPart = {
  roundness: 3.0,   // 導管是方的，不是圓的
  segments: 8,
  sections: [
    { z: 0.4625, halfWidth: 0.30, halfHeight: 0.11, centerY: -0.58 }, // 進氣唇
    { z: 1.1125, halfWidth: 0.40, halfHeight: 0.24, centerY: -0.68 },
    { z: 2.0125, halfWidth: 0.36, halfHeight: 0.26, centerY: -0.58 },
    { z: 2.8125, halfWidth: 0.28, halfHeight: 0.22, centerY: -0.44 },  // 出風斜板
    { z: 3.5125, halfWidth: 0.16, halfHeight: 0.12, centerY: -0.22 },  // 併回機腹
  ],
}

const WING: WingParams = {
  // 厚度為**翼根**值：0.40 / 2.75 = 14.5% 厚弦比，真機 NAA/NACA 45-100
  // 層流翼根部 15.1%。翼尖由 buildWingPanel 按弦長比例收到 0.19 m。
  rootChord: 2.75, tipChord: 1.30, halfSpan: 5.64,
  sweep: 4 * DEG, dihedral: 5 * DEG, thickness: 0.40, rootZ: -0.6875, rootY: -0.28,
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
