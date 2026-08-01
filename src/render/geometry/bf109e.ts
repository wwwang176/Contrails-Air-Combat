import { DEG } from '../../core/math'
import { createHull, type AircraftModel, type Blister, type FinParams, type LoftPart } from './assembly'
import type { GlazingPart } from './glazing'
import type { WingParams } from './wing'

/**
 * Bf 109 E-4 的程序化外型 —— 真機全長 8.64 m、翼展 9.87 m、
 * 螺旋槳直徑 3.10 m。
 *
 * 【為什麼是 E 不是 G】專案負責人提供的參考模型是 E-4，並指定目標型號同為
 * E。飛行模型仍沿用 G-6 的動力與重量（負責人裁決保留），只有外型是 E。
 *
 * E 與 G 在外觀上的關鍵差異，四項都已對應：
 *
 *   方翼尖    F 型才改成圓翼尖，E 是方的（因此沒有 tipRound）
 *   尾翼支柱  F 型起改懸臂式取消支柱，E 有
 *   無 Beulen 13 mm MG 131 的鼓包是 G-6 的特徵；E 的 MG 17 是埋進引擎罩的，
 *             外面只有凹槽，沒有任何凸出物
 *   機首較短  8.64 對 8.95 m
 */

const FUSELAGE: LoftPart = {
  roundness: 2.8,
  segments: 14,
  sections: [
    // 側視骨架量自 E-4 參考模型的正交剪影。背線明顯下降、腹線小幅抬升，
    // 中心線幾乎水平——機尾錐收在機身中間高度。
    { z: -4.51, halfWidth: 0.340, halfHeight: 0.360, centerY: 0.374, roundness: 2.2 },
    { z: -4.03, halfWidth: 0.420, halfHeight: 0.465, centerY: 0.326, roundness: 2.3 },
    { z: -3.55, halfWidth: 0.480, halfHeight: 0.546, centerY: 0.268, roundness: 2.4 },
    // 引擎罩上緣壓低 0.025：實測本模型 0.828／0.829，參考模型是平的
    // 0.795–0.802。這 0.03 本來無傷大雅，但風擋是從這裡往上斜的——
    // 罩頂固定時，起點高 0.03 就讓斜率從 42° 掉到 30°，風擋變得太緩。
    { z: -2.97, halfWidth: 0.490, halfHeight: 0.558, centerY: 0.247, roundness: 2.5 },
    { z: -2.20, halfWidth: 0.460, halfHeight: 0.580, centerY: 0.220, roundness: 2.6 },
    { z: -1.19, halfWidth: 0.420, halfHeight: 0.655, centerY: 0.215 },  // 最大深度
    { z: -0.10, halfWidth: 0.370, halfHeight: 0.601, centerY: 0.265, roundness: 2.9 },
    { z: 1.20, halfWidth: 0.280, halfHeight: 0.472, centerY: 0.224, roundness: 3.2 },
    { z: 2.55, halfWidth: 0.165, halfHeight: 0.284, centerY: 0.201, roundness: 3.4 },
    { z: 3.79, halfWidth: 0.060, halfHeight: 0.100, centerY: 0.250, roundness: 3.4 },
  ],
}

/**
 * 座艙玻璃 —— 側視四段輪廓全部量自參考模型的正交側視圖：
 *
 *     後 \‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾\ 前     ← 機首在右
 *         \______________|
 *
 *   風擋   42° 斜切，自 z = −2.02 的 0.815（機背高度）升到 −1.85 的 0.965
 *   罩頂   0.965 → 0.915，0.87 m 只降 0.050 = 3.3°，側面看就是水平
 *   艙緣   固定 0.52，四個站位都一樣
 *   尾斜切 艙緣自 z = −0.98 的 0.52 抬到 −0.78 的 0.72（正好 45°），
 *          再往後高過罩頂，輪廓自己收成一點
 *
 * 正視圖是梯形（見 GlazingPart.topWidth）：窄平頂、直側玻璃、寬艙緣。
 * 玻璃前後端落在全長 32.8% 與 49.6%，與參考模型一致。
 *
 * 【roof 取自剪影而不是面線】曾把罩頂配到 0.935，那是從參考模型的**近側**
 * 框線量的——機身是圓的，近側那條線本來就低於中線。側視圖上看到的是中線，
 * 該用剪影頂緣（0.969→0.889），兩者差了 0.03。
 */
const CANOPY: GlazingPart = {
  topWidth: 0.21,
  sideSegments: 3,
  bulge: 0.035,
  stations: [
    { z: -2.02, sill: 0.52, roof: 0.815 },   // 風擋底框，齊機背
    { z: -1.85, sill: 0.52, roof: 0.965 },   // 風擋頂
    { z: -1.40, sill: 0.52, roof: 0.940 },
    { z: -0.98, sill: 0.52, roof: 0.915 },   // 滑動罩尾端，尾斜切自此起
    { z: -0.78, sill: 0.72, roof: 0.900 },
    { z: -0.58, sill: 0.92, roof: 0.889 },   // 艙緣高過罩頂 → 收成一點
  ],
}

const WING: WingParams = {
  // E 型是**方翼尖**（F 型才改圓），所以沒有 tipRound。
  // 真機 NACA 2R1：翼根 14.2% × 2.22 = 0.315、翼尖 11.35% × 1.01 = 0.115。
  rootChord: 2.22, tipChord: 1.01, halfSpan: 4.935,
  sweep: 3 * DEG, dihedral: 6.5 * DEG, thickness: 0.315, tipThickness: 0.115,
  rootZ: -2.93, rootY: -0.37,
}

const TAILPLANE: WingParams = {
  rootChord: 1.06, tipChord: 0.56, halfSpan: 1.65,
  sweep: 10 * DEG, dihedral: 0, thickness: 0.12, tipThickness: 0.055,
  rootZ: 2.63, rootY: 0.55, tipRound: 0.35,
}

const FIN: FinParams = {
  chordRoot: 1.50, chordTip: 0.68, height: 1.05, sweep: 30 * DEG, z: 2.25, rootY: 0.40,
}

/**
 * DB 601 的排氣管：**每側 6 根**（倒立 V12，每側 6 缸），沿引擎罩下側排成
 * 一列。用產生器而不是手打六筆，是因為間距與尺寸要一致才會讀成鋸齒狀；
 * 手打很容易在某一根上打錯一個位數而不自覺。
 */
function exhaustStubs(startZ: number, pitch: number, count: number): Blister[] {
  return Array.from({ length: count }, (_, i) => ({
    x: 0.50, y: 0.15, z: startZ + i * pitch,
    width: 0.10, height: 0.12, length: 0.14,
    mirror: true,
  }))
}

const BLISTERS: readonly Blister[] = [
  /**
   * 增壓器進氣口 —— **只在左舷（−X）**，不鏡像。
   *
   * DB 601 的機械增壓器裝在引擎左側，進氣口因此是單邊的；這是 109 少數
   * 左右不對稱的外觀特徵，從正面或俯視一眼可辨。
   */
  { x: -0.54, y: 0.35, z: -2.82, width: 0.22, height: 0.28, length: 0.58, round: true },

  ...exhaustStubs(-3.45, 0.193, 6),

  // 機首下方滑油冷卻器
  { x: 0, y: -0.26, z: -2.97, width: 0.40, height: 0.20, length: 0.87 },
  // 翼下冷卻液散熱器
  { x: 1.50, y: -0.41, z: -1.63, width: 0.55, height: 0.22, length: 0.97, mirror: true },
  /**
   * 水平尾翼斜撐桿 —— **E 型有**（F 型起改懸臂式取消）。自機身下緣
   * (0.09, 0.00) 拉到平尾下表面 (0.62, 0.49)，長 0.722、仰角 42.8°。
   */
  {
    x: 0.355, y: 0.245, z: 2.85, width: 0.722, height: 0.05, length: 0.10,
    rotZ: 42.8 * DEG, mirror: true, bodyColor: true,
  },
]

export function buildBf109E(): AircraftModel {
  const h = createHull({
    bodyColor: 0x7e8a73,
    accentColor: 0x33403a,
    realLength: 8.64,
    offsetZ: -(WING.rootZ + 0.25 * WING.rootChord),
  })

  h.loft(FUSELAGE, h.body)
  h.glazing(FUSELAGE, CANOPY)

  h.wingPair(WING)
  h.wingPair(TAILPLANE)

  h.upright(FIN, 0.12, 0.35)   // 垂尾頂端是圓的

  h.blisters(BLISTERS)
  h.propeller({
    // 底徑實測 0.0827 L；y 與機首環中心一致
    spinnerRadius: 0.35, spinnerLength: 0.34, spinnerY: 0.374,
    blades: 3, propZ: -4.63, propRadius: 1.55,   // 真機 VDM 螺旋槳直徑 3.10 m
  }, FUSELAGE.sections[0]!.z)

  return h.finish()
}
