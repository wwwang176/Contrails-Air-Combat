import { DEG } from '../core/math'
import type { AircraftSpec, HistoricalReference } from './types'

const HP = 745.7
const KMH = 1 / 3.6

export const P51D: AircraftSpec = {
  id: 'p51d',
  name: 'P-51D Mustang',
  faction: 'allied',

  mass: 4300,
  inertia: { pitch: 11000, yaw: 20000, roll: 8800 },

  // oswald 0.75 → 0.88（Task 14 調參）。
  // 【以下數字一律以「僅退回本項、其餘全為出貨值」實測，非規劃期估算】
  //   oswald 0.75：實用升限 11,800.5 m（史實 12,770，−7.59%，超出 ±5%）、
  //                海平面爬升率 882.4 m/min、L/D_max 14.51
  //   oswald 0.88：實用升限 12,197.6 m（−4.48%）、爬升率 906.8 m/min（+2.8%）、
  //                L/D_max 15.72
  // 實用升限受誘導阻力主導，0.88 是讓升限進入 ±5% 的必要條件。
  // 【誠實揭露】0.88 高於層流翼 Oswald 因子的教科書區間 0.70~0.85，是本次
  // 調參中最弱的一項；L/D_max 因此由 14.51 升到 15.72，較史實約 14.6 高 7.7%。
  // 接受的理由是本模型的 cd0 為常數、不含 CL 相依的黏性項，此處的 oswald
  // 比教科書的 Oswald 因子更接近純展向效率。上界已寫成 specs.test.ts 的斷言。
  wing: { area: 21.83, span: 11.28, chord: 1.98, oswald: 0.88 },

  lift: {
    clAlpha: 4.4,
    alphaZero: -2.5 * DEG,
    // 15.5° → 17.0°（Task 14 調參）。CL_max 為推導值 clAlpha·(alphaCrit − alphaZero)。
    // 【僅退回本項、其餘全為出貨值的實測】
    //   15.5°：CL_max 1.3823（史實 1.45，−4.67%）、失速 171.95 km/h（+7.47%，超出 ±5%）
    //   17.0°：CL_max 1.4975（+3.28%，仍在 specs 測試的 ±8% 內）、失速 165.21 km/h（+3.26%）
    alphaCrit: 17 * DEG,
    stallBlend: 8 * DEG,
    postStallFactor: 0.6,
    slatAlphaBonus: 0,
    slatDeployAlpha: Infinity, // 無縫翼，永不展開
    slatRetractAlpha: Infinity,
  },

  drag: { cd0: 0.0163, cdBeta: 0.6, machCrit: 0.72, machDragFactor: 60 },

  side: { cyBeta: -0.7 },

  moments: {
    cm0: 0.02, cmAlpha: -0.8, cmQ: -12, cmDe: 1.2,
    clBeta: -0.08, clP: -0.45, clDa: 0.033,
    cnBeta: 0.1, cnR: -0.12, cnDr: 0.07,
  },

  // qRef 對應 480 km/h 海平面動壓，該速度下副翼權限為滿（滾轉率約 100°/s）
  controlStiffening: { qRef: 10884, aileronK: 0.35, elevatorK: 0.25, rudderK: 0.25 },

  engine: {
    // V-1650-7 二級二速增壓，67"Hg WEP
    gears: [
      { powerSeaLevel: 1490 * HP, powerCritical: 1720 * HP, altCritical: 1900 },
      { powerSeaLevel: 1290 * HP, powerCritical: 1370 * HP, altCritical: 5900 },
    ],
    // 0.8 → 0.95（Task 14 調參）。**這一項是為了實用升限，不是為了極速峰值高度。**
    // 【僅退回本項、其餘全為出貨值的實測】
    //   ram 0.80：升限 12,083.7 m（−5.37%，超出 ±5%）
    //   ram 0.90：升限 12,159.1 m（−4.78%）
    //   ram 0.95：升限 12,197.6 m（−4.48%）  ← 出貨值
    // 物理動機：P-51D 的機腹進氣道總壓恢復極佳；史實極速峰值在 7,600 m 而
    // 高檔臨界高度僅 5,900 m，這 1,700 m 的抬升正是 ram 的效果。
    // 【誠實揭露】模型並未把峰值放在 7,600 m：ram 0.95 下模型自己的極速峰值
    // 落在 8,550 m（757.0 km/h），比史實高約 950 m；模型只是在 7,600 m 這個
    // 取樣點上把速度值對準（729.9 km/h，+3.83%）。「極速在臨界高度附近達到
    // 峰值」測試因此只剩 13.5 km/h 餘裕（10,600 m 的 716.4 對 7,600 m 的 729.9）；
    // ram 若再升到 1.0，餘裕會縮到 5.8 km/h。這是升限與峰值位置之間的取捨，
    // 0.95 是兩者都還通過的位置。
    ramEfficiency: 0.95,
  },

  // Task 14 調參。etaMax 0.85 → 0.90（1940 年代定速螺旋槳的物理上限）、
  // vRef 55 → 42、figureOfMerit 0.7 → 0.80。
  //
  // 真實定速槳在最佳爬升速度處的效率約 0.75~0.80，原值遠低於此：
  //   調參前的原始 spec（etaMax 0.85 / vRef 55）：η = 0.673 @ 86.3 m/s
  //   僅退回 vRef（etaMax 0.90 / vRef 55，其餘出貨值）：η = 0.713 @ 86.4 m/s，
  //                                                    海平面爬升率 791.2 m/min
  //   出貨值（etaMax 0.90 / vRef 42）：η = 0.775 @ 83.0 m/s，爬升率 906.8 m/min
  //
  // vRef 不能再低。T = η(V)·P/V 在 V→0 的極限為 etaMax·P/vRef，vRef = 42 時
  // 為 23.809 kN，而 figureOfMerit 0.80 下的動量理論靜推力上限是 24.136 kN
  // ——**只剩 1.37% 餘裕**。figureOfMerit 0.7 → 0.80 正是為了撐開這個上限
  // （0.80 是螺旋槳靜推力效率的合理上緣）。夾制若被觸發，propulsion.test.ts
  // 的 V→0 解析極限測試會由 0.12% 誤差跳到約 1.4% 而轉紅——那是調參的後果，
  // 不是 propThrust 的迴歸；該情況已由 propulsion.test.ts 的專屬測試守住。
  prop: { diameter: 3.4, etaMax: 0.9, vRef: 42, figureOfMerit: 0.8 },

  limits: { gPositive: 8, gNegative: -4, vne: 810 * KMH },
}

export const P51D_HISTORICAL: HistoricalReference = {
  vmaxAtCritical: { speed: 703 * KMH, altitude: 7600 },
  vmaxSeaLevel: 595 * KMH,
  climbRateSeaLevel: 1060 / 60,
  stallSpeed: 160 * KMH,
  serviceCeiling: 12770,
  clMax: 1.45,
}
