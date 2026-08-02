import { DEG } from '../../core/math'
import { createHull, type AircraftModel, type Blister, type FinParams } from './assembly'
import { BF109E_HULL } from './bf109e.hull'
import type { CanopyStation } from './canopy'
import { prepareRings } from './hull'
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
 *
 * 【座標是機體座標，不是造型座標】機身外殼的環直接量自參考模型，量到的
 * 就是對齊後的機體座標，所以這一台的 offsetZ 是 0，其餘零件也一律用機體
 * 座標寫（機首約 −2.48、機尾約 6.17）。P-51D 仍是造型座標 + 位移。
 */

/**
 * 座艙 —— 側視四段輪廓量自參考模型的正交剪影：
 *
 *     後 \‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾\ 前     ← 機首在右
 *         \______________|
 *
 *   風擋   自 z = 0.355 的機背高度斜升到 0.525 的 0.965
 *   罩頂   0.965 → 0.925，1.04 m 只降 0.040，側面看就是水平
 *   艙緣   固定 0.520
 *   尾斜切 艙緣自 z = 1.395 抬到 1.595 的 0.720（正好 45°），再往後高過
 *          罩頂，輪廓自己收成一點
 *
 * 正視是梯形（窄平頂 0.21 + 平側玻璃），參考模型實測如此，不是圓拱。
 *
 * 【艙緣是唯一量不出來的一條線】參考模型在座艙段的最外側就是玻璃本身，
 * 機身開口的邊緣被擋住了。0.520 是人工定的，其餘全部照量測值。
 */
const CANOPY: readonly CanopyStation[] = [
  { z: 0.355, sill: 0.520, roof: 0.829 },   // 風擋底框，齊機背
  { z: 0.525, sill: 0.520, roof: 0.965 },   // 風擋頂
  { z: 0.975, sill: 0.520, roof: 0.945 },
  { z: 1.395, sill: 0.520, roof: 0.925 },   // 滑動罩尾端，尾斜切自此起
  { z: 1.595, sill: 0.720, roof: 0.915 },
  { z: 1.795, sill: 0.910, roof: 0.907 },   // 艙緣高過罩頂 → 收成一點
]
const CANOPY_SHAPE = { topWidth: 0.21 }

const RINGS = prepareRings(BF109E_HULL, CANOPY.map((s) => s.z))

const WING: WingParams = {
  // E 型是**方翼尖**（F 型才改圓），所以沒有 tipRound。
  // 真機 NACA 2R1：翼根 14.2% × 2.22 = 0.315、翼尖 11.35% × 1.01 = 0.115。
  rootChord: 2.22, tipChord: 1.01, halfSpan: 4.935,
  sweep: 3 * DEG, dihedral: 6.5 * DEG, thickness: 0.315, tipThickness: 0.115,
  rootZ: -0.555, rootY: -0.37,
}

const TAILPLANE: WingParams = {
  rootChord: 1.06, tipChord: 0.56, halfSpan: 1.65,
  sweep: 10 * DEG, dihedral: 0, thickness: 0.12, tipThickness: 0.055,
  rootZ: 5.005, rootY: 0.55, tipRound: 0.35,
}

const FIN: FinParams = {
  chordRoot: 1.50, chordTip: 0.68, height: 1.05, sweep: 30 * DEG, z: 4.625, rootY: 0.40,
}

/**
 * DB 601 的排氣管：**每側 6 根**（倒立 V12，每側 6 缸），沿引擎罩下側排成
 * 一列。用產生器而不是手打六筆，是因為間距與尺寸要一致才會讀成鋸齒狀；
 * 手打很容易在某一根上打錯一個位數而不自覺。
 */
function exhaustStubs(startZ: number, pitch: number, count: number): Blister[] {
  return Array.from({ length: count }, (_, i) => ({
    x: 0.44, y: 0.15, z: startZ + i * pitch,
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
  { x: -0.46, y: 0.35, z: -0.445, width: 0.22, height: 0.28, length: 0.58, round: true },

  ...exhaustStubs(-1.075, 0.193, 6),

  // 機首下方滑油冷卻器
  { x: 0, y: -0.30, z: -0.595, width: 0.40, height: 0.20, length: 0.87 },
  // 翼下冷卻液散熱器
  { x: 1.50, y: -0.41, z: 0.745, width: 0.55, height: 0.22, length: 0.97, mirror: true },
  /**
   * 水平尾翼斜撐桿 —— **E 型有**（F 型起改懸臂式取消）。自機身下緣
   * 拉到平尾下表面，長 0.722、仰角 42.8°。
   */
  {
    x: 0.355, y: 0.245, z: 5.225, width: 0.722, height: 0.05, length: 0.10,
    rotZ: 42.8 * DEG, mirror: true, bodyColor: true,
  },
]

export function buildBf109E(): AircraftModel {
  const h = createHull({
    bodyColor: 0x7e8a73,
    accentColor: 0x33403a,
    realLength: 8.64,
    offsetZ: 0,
  })

  h.cockpit(RINGS, CANOPY, CANOPY_SHAPE)

  h.wingPair(WING)
  h.wingPair(TAILPLANE)

  h.upright(FIN, 0.12, 0.35)   // 垂尾頂端是圓的

  h.blisters(BLISTERS)
  h.propeller({
    // 底徑實測 0.0827 L；y 與機首環中心一致
    spinnerRadius: 0.35, spinnerLength: 0.34, spinnerY: 0.36,
    blades: 3, propZ: -2.255, propRadius: 1.55,   // 真機 VDM 螺旋槳直徑 3.10 m
  }, RINGS[0]!.z)

  return h.finish()
}
