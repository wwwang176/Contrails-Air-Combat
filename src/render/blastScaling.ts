import { FIRE_CHUNK_DRAG, FIRE_CHUNK_LIFE, FIRE_CHUNK_SIZE } from './chunks'
import type { BlastParams } from './blastRecipes'

/** Shared lifetime multiplier for all blast particle pools. */
export const BLAST_PACE = 0.6

/** Converts explosive yield to the linear scale used by blast recipes. */
export function blastScale(yieldRatio: number): number {
  return Math.cbrt(Math.max(0, yieldRatio))
}

/** Returns the outer fireball radius for an already scaled recipe. */
export function blastFireRadius(p: BlastParams): number {
  const travel = (p.fireSpeed / FIRE_CHUNK_DRAG)
    * (1 - Math.exp(-FIRE_CHUNK_DRAG * FIRE_CHUNK_LIFE * BLAST_PACE))
  return travel + (FIRE_CHUNK_SIZE * p.fireSize) / 2
}

/** Presentation-only multiplier used by bomb impacts. */
export const BOMB_BLAST_SIZE = 2

/** Scales recipe dimensions and counts while preserving zero-count particle types. */
export function scaleBlast(
  src: BlastParams, yieldRatio: number, out: { -readonly [K in keyof BlastParams]: number },
): void {
  const s = blastScale(yieldRatio)
  const n = (v: number): number => (v === 0 ? 0 : Math.max(1, Math.round(v * s)))
  out.fireCount = n(src.fireCount)
  out.fireSpeed = src.fireSpeed
  out.fireSize = src.fireSize * s
  out.fireCone = src.fireCone
  out.smokeCount = n(src.smokeCount)
  out.smokeSpeed = src.smokeSpeed
  out.smokeSize = src.smokeSize * s
  out.smokeCone = src.smokeCone
  out.dustCount = n(src.dustCount)
  out.dustSpeed = src.dustSpeed
  out.dustSize = src.dustSize * s
  out.dustCone = src.dustCone
  out.sprayCount = n(src.sprayCount)
  out.spraySpeed = src.spraySpeed
  out.sprayCone = src.sprayCone
  out.jetCount = n(src.jetCount)
  out.jetSpread = src.jetSpread * s
  out.jetHeight = src.jetHeight * s
  out.jetRadius = src.jetRadius * s
  out.mistPerJet = src.mistPerJet
  out.mistSize = src.mistSize
  out.glowSize = src.glowSize
  out.glowAlpha = src.glowAlpha
}
