import { DEG } from '../../core/math'
import type { FuselageSection } from './fuselage'
import type { WingParams } from './wing'

export interface Silhouette {
  bodyColor: number
  accentColor: number
  fuselage: readonly FuselageSection[]
  wing: WingParams
  tailplane: WingParams
  /** 垂直安定面（以 WingParams 描述，dihedral 90° 立起） */
  fin: { chordRoot: number; chordTip: number; height: number; sweep: number; z: number }
  canopy: { z: number; length: number; halfWidth: number; height: number; teardrop: boolean }
  /** 機腹散熱器（P-51）或機首下方進氣口（Bf 109） */
  intake: { z: number; length: number; halfWidth: number; height: number; centerY: number }
  propZ: number
  propRadius: number
}

export const SILHOUETTES: Record<string, Silhouette> = {
  p51d: {
    bodyColor: 0x9aa7b4,
    accentColor: 0x2f3a46,
    fuselage: [
      { z: -4.9, halfWidth: 0.10, halfHeight: 0.10, centerY: 0.05 },
      { z: -4.2, halfWidth: 0.48, halfHeight: 0.52, centerY: 0.02 },
      { z: -2.6, halfWidth: 0.62, halfHeight: 0.72, centerY: 0.00 },
      { z: -0.6, halfWidth: 0.66, halfHeight: 0.78, centerY: 0.02 },
      { z: 1.6, halfWidth: 0.50, halfHeight: 0.60, centerY: 0.06 },
      { z: 3.6, halfWidth: 0.28, halfHeight: 0.36, centerY: 0.12 },
      { z: 4.6, halfWidth: 0.08, halfHeight: 0.14, centerY: 0.16 },
    ],
    wing: {
      rootChord: 2.75, tipChord: 1.30, halfSpan: 5.64,
      sweep: 4 * DEG, dihedral: 5 * DEG, thickness: 0.34, rootZ: -1.5, rootY: -0.28,
    },
    tailplane: {
      rootChord: 1.35, tipChord: 0.70, halfSpan: 2.10,
      sweep: 8 * DEG, dihedral: 0, thickness: 0.14, rootZ: 3.3, rootY: 0.10,
    },
    fin: { chordRoot: 1.90, chordTip: 0.85, height: 1.55, sweep: 34 * DEG, z: 2.9 },
    canopy: { z: -0.6, length: 2.10, halfWidth: 0.42, height: 0.46, teardrop: true },
    intake: { z: 0.2, length: 2.30, halfWidth: 0.44, height: 0.42, centerY: -0.72 },
    propZ: -4.95,
    propRadius: 1.70,
  },

  bf109g6: {
    bodyColor: 0x7e8a73,
    accentColor: 0x33403a,
    fuselage: [
      { z: -4.4, halfWidth: 0.13, halfHeight: 0.13, centerY: 0.04 },
      { z: -3.7, halfWidth: 0.44, halfHeight: 0.50, centerY: 0.02 },
      { z: -2.3, halfWidth: 0.56, halfHeight: 0.68, centerY: 0.00 },
      { z: -0.4, halfWidth: 0.58, halfHeight: 0.70, centerY: 0.02 },
      { z: 1.5, halfWidth: 0.42, halfHeight: 0.52, centerY: 0.06 },
      { z: 3.2, halfWidth: 0.22, halfHeight: 0.30, centerY: 0.10 },
      { z: 4.1, halfWidth: 0.07, halfHeight: 0.12, centerY: 0.13 },
    ],
    wing: {
      rootChord: 2.30, tipChord: 1.05, halfSpan: 4.96,
      sweep: 6 * DEG, dihedral: 6.5 * DEG, thickness: 0.28, rootZ: -1.2, rootY: -0.26,
    },
    tailplane: {
      rootChord: 1.10, tipChord: 0.58, halfSpan: 1.65,
      sweep: 10 * DEG, dihedral: 0, thickness: 0.12, rootZ: 2.9, rootY: 0.18,
    },
    fin: { chordRoot: 1.55, chordTip: 0.70, height: 1.25, sweep: 30 * DEG, z: 2.5 },
    canopy: { z: -0.5, length: 1.55, halfWidth: 0.36, height: 0.42, teardrop: false },
    intake: { z: -2.6, length: 1.10, halfWidth: 0.30, height: 0.32, centerY: -0.62 },
    propZ: -4.45,
    propRadius: 1.50,
  },
}
