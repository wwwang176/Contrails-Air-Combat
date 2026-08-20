/**
 * He 111 提高那兩項的**組合包**。上一支（he111-boost）逐一解每個旋鈕，
 * 這一支把最乾淨的那兩個放在一起，因為它們會互相影響：`powerSeaLevel`
 * 抬高的是「臨界高度以下的整條線」，5,000 m 也跟著漲一點。
 */
import {
  maxLevelSpeed, maxClimbRate, stallSpeed, serviceCeiling,
} from '../../src/analysis/envelope'
import { HE111, HE111_HISTORICAL as H } from '../../src/specs/he111'
import { applyFeel, feelFor } from '../../src/specs/feel'
import type { AircraftSpec } from '../../src/specs/types'

const KMH = 3.6
const PS = 735.5
const n = (v: number, w: number, d = 1): string => v.toFixed(d).padStart(w)
const pct = (a: number, b: number): string => {
  const p = ((a - b) / b) * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`.padStart(8)
}

function make(sl: number, crit: number): AircraftSpec {
  return {
    ...HE111,
    engine: {
      ...HE111.engine,
      gears: [{ powerSeaLevel: sl * PS, powerCritical: crit * PS, altCritical: 5300 }],
    },
  }
}

function row(sl: number, crit: number, note = ''): void {
  const s = make(sl, crit)
  const g = applyFeel(s, feelFor(s))
  console.log(`  ${n(sl, 6, 0)}${n(crit, 7, 0)}`
    + pct(maxLevelSpeed(s, 0) * KMH, H.vmaxSeaLevel * KMH)
    + pct(maxLevelSpeed(s, 5000) * KMH, H.vmaxAtCritical.speed * KMH)
    + pct(maxClimbRate(s, 0).rate, H.climbRateSeaLevel)
    + pct(stallSpeed(s, 0, 1) * KMH, H.stallSpeed * KMH)
    + pct(serviceCeiling(s), H.serviceCeiling)
    + `  ${n(maxClimbRate(s, 0).rate, 5, 2)}${n(serviceCeiling(s), 7, 0)}`
    + `  |${n(maxClimbRate(g, 0).rate, 6, 2)}${n(maxLevelSpeed(g, 5000) * KMH, 7, 0)}`
    + `${n(serviceCeiling(g), 7, 0)}  ${note}`)
}

console.log('\n  史實：369 / 405 km/h、4.5 m/s、150 km/h、6,300 m')
console.log('   SL PS  crit  海平面   5000m    海爬     失速     升限 | 未套：爬 升限 | 出貨：爬 5km速 升限')
row(2680, 2216, '← 出貨')
console.log('  ── 只把海平面爬升拉上去（powerSeaLevel）──────────────────')
row(2854, 2216, '爬升命中 4.5')
row(3000, 2216, '爬升 +11%')
row(3150, 2216, '爬升 +22%')
console.log('  ── 兩個一起（爬升命中 4.5 之後再補 5,000 m 極速）─────────')
row(2854, 2280, '')
row(2854, 2340, '5,000 m 命中 405')
row(2854, 2420, '')
console.log('  ── 兩個一起（爬升 +22% 之後再補）─────────────────────')
row(3150, 2280, '')
row(3150, 2320, '5,000 m 命中 405')
row(3150, 2420, '')
console.log()
