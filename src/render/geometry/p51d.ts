import { DEG } from '../../core/math'
import { createHull, type AircraftModel, type Blister, type FinParams, type LoftPart } from './assembly'
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

const FUSELAGE: LoftPart = {
  roundness: 2.4,   // 接近橢圓，側面略平
  segments: 14,
  sections: [
    { z: -4.55, halfWidth: 0.30, halfHeight: 0.30, centerY: 0.06 },  // 整流罩接合面
    { z: -4.05, halfWidth: 0.38, halfHeight: 0.45, centerY: 0.04 },
    { z: -3.25, halfWidth: 0.45, halfHeight: 0.58, centerY: 0.02 },
    { z: -2.35, halfWidth: 0.49, halfHeight: 0.66, centerY: 0.00 },  // 防火牆
    { z: -1.20, halfWidth: 0.50, halfHeight: 0.66, centerY: 0.00 },  // 機翼前緣
    { z: 0.00, halfWidth: 0.49, halfHeight: 0.62, centerY: 0.02 },   // 座艙下方
    { z: 1.30, halfWidth: 0.42, halfHeight: 0.50, centerY: 0.08 },   // 背脊起點
    { z: 2.50, halfWidth: 0.30, halfHeight: 0.36, centerY: 0.14 },
    { z: 3.60, halfWidth: 0.19, halfHeight: 0.24, centerY: 0.18 },
    { z: 4.35, halfWidth: 0.07, halfHeight: 0.12, centerY: 0.20 },   // 尾錐
  ],
}

/**
 * 氣泡座艙罩：整個**架在**機背上，本體是一根獨立的管子。
 *
 * 【為什麼 P-51D 用獨立管、109 用貼機身的殼】兩者的構造真的不同。氣泡罩
 * 是扣在機身上的一個獨立殼體，最寬處（0.44）比同站位機身（0.49）窄，下緣
 * 埋進機身 0.40 m 也仍在機身表面內側 0.03 m 以上，不會透出來。109 那種
 * 嵌入式方框罩沒有這個餘裕，必須改用 buildGlazing。
 */
const CANOPY: LoftPart = {
  roundness: 2.2,
  segments: 10,
  sections: [
    { z: -1.40, halfWidth: 0.14, halfHeight: 0.08, centerY: 0.56 },  // 風擋前緣
    { z: -0.95, halfWidth: 0.34, halfHeight: 0.28, centerY: 0.58 },  // 風擋頂
    { z: -0.20, halfWidth: 0.44, halfHeight: 0.34, centerY: 0.58 },  // 泡罩最寬
    { z: 0.55, halfWidth: 0.42, halfHeight: 0.31, centerY: 0.58 },
    { z: 1.30, halfWidth: 0.16, halfHeight: 0.10, centerY: 0.48 },   // 頂 0.58 = 背線
  ],
}

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
    { z: -0.35, halfWidth: 0.30, halfHeight: 0.11, centerY: -0.58 }, // 進氣唇
    { z: 0.30, halfWidth: 0.40, halfHeight: 0.24, centerY: -0.68 },
    { z: 1.20, halfWidth: 0.36, halfHeight: 0.26, centerY: -0.58 },
    { z: 2.00, halfWidth: 0.28, halfHeight: 0.22, centerY: -0.44 },  // 出風斜板
    { z: 2.70, halfWidth: 0.16, halfHeight: 0.12, centerY: -0.22 },  // 併回機腹
  ],
}

const WING: WingParams = {
  // 厚度為**翼根**值：0.40 / 2.75 = 14.5% 厚弦比，真機 NAA/NACA 45-100
  // 層流翼根部 15.1%。翼尖由 buildWingPanel 按弦長比例收到 0.19 m。
  rootChord: 2.75, tipChord: 1.30, halfSpan: 5.64,
  sweep: 4 * DEG, dihedral: 5 * DEG, thickness: 0.40, rootZ: -1.5, rootY: -0.28,
  tipRound: 0.30,
}

const TAILPLANE: WingParams = {
  rootChord: 1.35, tipChord: 0.70, halfSpan: 2.10,
  sweep: 8 * DEG, dihedral: 0, thickness: 0.14, rootZ: 3.3, rootY: 0.10, tipRound: 0.35,
}

const FIN: FinParams = {
  chordRoot: 1.80, chordTip: 0.80, height: 1.40, sweep: 34 * DEG, z: 2.8, rootY: 0.35,
}

/**
 * 背鰭（dorsal fillet）：翼根坐在背線上（0.57），頂端要**恰好**落在垂尾
 * 前緣線上——解 1.45 + tan(sw)·h = 2.8 + tan(34°)·(0.57 + h − 0.35)，
 * 取 h=0.30 得 sw=80°，交會於 (z=3.15, y=0.87)。後掠角這麼大時，翼根只要
 * 埋進機身幾公分，可見根部就會被帶往機尾好幾十公分，所以 rootY 必須齊平。
 */
const FIN_FILLET: FinParams = {
  chordRoot: 1.55, chordTip: 0.30, height: 0.30, sweep: 80 * DEG, z: 1.45, rootY: 0.57,
}

const BLISTERS: readonly Blister[] = [
  // 化油器進氣口，機首**上方**
  { x: 0, y: 0.56, z: -3.70, width: 0.32, height: 0.24, length: 1.00 },
]

export function buildP51D(): AircraftModel {
  const h = createHull({
    bodyColor: 0x9aa7b4,
    accentColor: 0x2f3a46,
    realLength: 9.83,
    offsetZ: -(WING.rootZ + 0.25 * WING.rootChord),
  })

  h.loft(FUSELAGE, h.body)
  h.loft(CANOPY, h.glass)
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
    blades: 4, propZ: -4.80, propRadius: 1.70,
  }, FUSELAGE.sections[0]!.z)

  return h.finish()
}
