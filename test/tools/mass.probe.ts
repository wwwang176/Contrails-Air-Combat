/** 減重到史實升限對應的重量之後，其餘四項會怎麼動。 */
import { maxLevelSpeed, maxClimbRate, stallSpeed, serviceCeiling } from '../../src/analysis/envelope'
import { HE111, HE111_HISTORICAL } from '../../src/specs/he111'
import { B17G, B17G_HISTORICAL } from '../../src/specs/b17g'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'
const KMH = 3.6
const pct = (a: number, b: number): string => {
  const p = (a - b) / b * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`.padStart(7)
}
const n = (v: number, w: number, d = 0): string => v.toFixed(d).padStart(w)
function show(base: AircraftSpec, h: HistoricalReference, masses: readonly number[]): void {
  console.log(`\n══ ${base.name} ═══════════════════════════════════════════`)
  console.log('    質量 kg   海平面極速   臨界高度極速    海爬      失速      升限')
  for (const m of masses) {
    const s: AircraftSpec = { ...base, mass: m }
    const a = h.vmaxAtCritical.altitude
    console.log(`  ${n(m, 8)}${pct(maxLevelSpeed(s, 0) * KMH, h.vmaxSeaLevel * KMH)}`
      + `      ${pct(maxLevelSpeed(s, a) * KMH, h.vmaxAtCritical.speed * KMH)}`
      + `   ${pct(maxClimbRate(s, 0).rate, h.climbRateSeaLevel)}`
      + `   ${pct(stallSpeed(s, 0, 1) * KMH, h.stallSpeed * KMH)}`
      + `   ${pct(serviceCeiling(s), h.serviceCeiling)}`
      + `${m === base.mass ? '   ← 出貨' : ''}`)
  }
}
show(HE111, HE111_HISTORICAL, [12500, 11500, 10500, 9543, 9000])
show(B17G, B17G_HISTORICAL, [24500, 22000, 20000, 19017, 18000])
console.log()
