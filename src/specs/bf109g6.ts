import { DEG } from '../core/math'
import type { AircraftSpec, HistoricalReference } from './types'

const PS = 735.5
const KMH = 1 / 3.6

export const BF109G6: AircraftSpec = {
  id: 'bf109g6',
  name: 'Bf 109 G-6',
  faction: 'axis',

  mass: 3150,
  inertia: { pitch: 6200, yaw: 10500, roll: 4200 },

  wing: { area: 16.05, span: 9.92, chord: 1.68, oswald: 0.78 },

  lift: {
    clAlpha: 4.45,
    alphaZero: -2.0 * DEG,
    alphaCrit: 15.5 * DEG,
    // 縫翼展開後失速較溫和，過渡寬度大於 P-51
    stallBlend: 10 * DEG,
    postStallFactor: 0.65,
    slatAlphaBonus: 2.5 * DEG,
    slatDeployAlpha: 8 * DEG,
    slatRetractAlpha: 6 * DEG,
  },

  drag: { cd0: 0.023, cdBeta: 0.7, machCrit: 0.68, machDragFactor: 60 },

  side: { cyBeta: -0.68 },

  moments: {
    cm0: 0.02, cmAlpha: -0.75, cmQ: -10, cmDe: 1.15,
    clBeta: -0.075, clP: -0.45, clDa: 0.028,
    cnBeta: 0.09, cnR: -0.1, cnDr: 0.065,
  },

  // qRef 對應 400 km/h 海平面動壓。aileronK 遠大於 P-51，
  // 使 650 km/h 時滾轉率衰減至約 30°/s——109 的關鍵弱點。
  controlStiffening: { qRef: 7560, aileronK: 1.5, elevatorK: 0.6, rudderK: 0.4 },

  engine: {
    // DB 605A 單級無段變速增壓
    gears: [{ powerSeaLevel: 1475 * PS, powerCritical: 1355 * PS, altCritical: 5700 }],
    ramEfficiency: 0.8,
  },

  prop: { diameter: 3.0, etaMax: 0.83, vRef: 52, figureOfMerit: 0.7 },

  limits: { gPositive: 7.5, gNegative: -3.5, vne: 750 * KMH },
}

export const BF109G6_HISTORICAL: HistoricalReference = {
  vmaxAtCritical: { speed: 640 * KMH, altitude: 6300 },
  vmaxSeaLevel: 530 * KMH,
  climbRateSeaLevel: 1150 / 60,
  stallSpeed: 170 * KMH,
  serviceCeiling: 11550,
  clMax: 1.4,
}
