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

  // oswald 0.75 → 0.88（Task 14 調參）：實用升限受誘導阻力主導，
  // 0.75 時只能到 11.8 km（史實 12.77 km，−7.6%）。層流翼加上接近橢圓的
  // 展向負荷，展向效率 0.88 仍在物理範圍內（代價是 L/D_max 由 14.5 升至 15.7，
  // 較史實約 14.6 高 8%——這是本模型 cd0 不含 CL 相依黏性項所致的已知取捨）。
  wing: { area: 21.83, span: 11.28, chord: 1.98, oswald: 0.88 },

  lift: {
    clAlpha: 4.4,
    alphaZero: -2.5 * DEG,
    // 15.5° → 17.0°（Task 14 調參）：CL_max 為推導值，15.5° 時失速速度
    // 171.9 km/h 較史實 160 高 7.5%（超出 ±5%）。17° 使 CL_max = 1.498
    // （史實 1.45，+3.3%，仍在 specs 測試的 ±8% 內），失速速度 165.2 km/h（+3.3%）。
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
    // 0.8 → 0.95（Task 14 調參）：P-51D 的機腹進氣道總壓恢復極佳，史實極速
    // 峰值出現在 7,600 m 而高檔臨界高度僅 5,900 m，這 1,700 m 的差距正是
    // ram 造成的。高 ram 同時把實用升限由 11.8 km 推到 12.2 km。
    ramEfficiency: 0.95,
  },

  // Task 14 調參。etaMax 0.85 → 0.90（1940 年代定速螺旋槳的物理上限），
  // vRef 55 → 42：原值使最佳爬升速度處的效率只有 0.65，真實定速槳約 0.75~0.80；
  // 42 給出 η(83 m/s) = 0.775。vRef 不能再低——T = η(V)·P/V 在 V→0 的極限為
  // etaMax·P/vRef，vRef = 42 時已達 23.8 kN，逼近 figureOfMerit 0.80 下的
  // 動量理論靜推力上限 24.1 kN（見 propulsion.ts 的 staticMax 與其測試）。
  // figureOfMerit 0.7 → 0.80 即為了撐開這個上限，0.80 是螺旋槳靜推力
  // 效率的合理上緣。
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
