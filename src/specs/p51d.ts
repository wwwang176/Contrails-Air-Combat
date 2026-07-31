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

  wing: { area: 21.83, span: 11.28, chord: 1.98, oswald: 0.75 },

  lift: {
    clAlpha: 4.4,
    alphaZero: -2.5 * DEG,
    alphaCrit: 15.5 * DEG,
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
    ramEfficiency: 0.8,
  },

  prop: { diameter: 3.4, etaMax: 0.85, vRef: 55, figureOfMerit: 0.7 },

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
