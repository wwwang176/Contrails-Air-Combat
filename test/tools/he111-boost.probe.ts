/**
 * He 111 的 5,000 m 極速與海平面爬升要提高 —— 每個旋鈕各自解到目標，
 * 再看它把其他四項推到哪裡。**允許超過史實。**
 *
 *   npx tsx test/tools/he111-boost.probe.ts
 *
 * 【為什麼要逐一解而不是一起調】五項判準不是獨立的，`feel.ts` 檔頭列了三條
 * 耦合。逐一解才看得出哪個旋鈕「只動想動的那一項」、哪個是連坐。
 */
import {
  maxLevelSpeed, maxClimbRate, stallSpeed, serviceCeiling,
} from '../../src/analysis/envelope'
import { HE111, HE111_HISTORICAL as H } from '../../src/specs/he111'
import type { AircraftSpec } from '../../src/specs/types'

const KMH = 3.6
const PS = 735.5
const n = (v: number, w: number, d = 1): string => v.toFixed(d).padStart(w)
const pct = (a: number, b: number): string => {
  const p = ((a - b) / b) * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`.padStart(8)
}

type Knob = (v: number) => AircraftSpec
const KNOBS: { tag: string; now: number; lo: number; hi: number; make: Knob }[] = [
  {
    tag: 'powerCritical PS', now: 2216, lo: 2000, hi: 4000,
    make: (v) => ({ ...HE111, engine: { ...HE111.engine,
      gears: [{ ...HE111.engine.gears[0]!, powerCritical: v * PS }] } }),
  },
  {
    tag: 'powerSeaLevel PS', now: 2680, lo: 2200, hi: 5000,
    make: (v) => ({ ...HE111, engine: { ...HE111.engine,
      gears: [{ ...HE111.engine.gears[0]!, powerSeaLevel: v * PS }] } }),
  },
  {
    tag: 'cd0', now: 0.0206, lo: 0.008, hi: 0.030,
    make: (v) => ({ ...HE111, drag: { ...HE111.drag, cd0: v } }),
  },
  {
    tag: 'oswald', now: 0.75, lo: 0.5, hi: 1.6,
    make: (v) => ({ ...HE111, wing: { ...HE111.wing, oswald: v } }),
  },
  {
    tag: 'prop.etaMax', now: 0.80, lo: 0.6, hi: 1.0,
    make: (v) => ({ ...HE111, prop: { ...HE111.prop, etaMax: v } }),
  },
  {
    tag: 'prop.vRef m/s', now: 45, lo: 12, hi: 80,
    make: (v) => ({ ...HE111, prop: { ...HE111.prop, vRef: v } }),
  },
  {
    tag: 'mass kg', now: 13727, lo: 8000, hi: 16000,
    make: (v) => ({ ...HE111, mass: v }),
  },
]

/** 二分解出讓 metric 命中 target 的旋鈕值；解不到回 NaN。 */
function solve(k: typeof KNOBS[number], metric: (s: AircraftSpec) => number,
  target: number): number {
  let lo = k.lo
  let hi = k.hi
  const up = metric(k.make(hi)) > metric(k.make(lo))
  if ((metric(k.make(hi)) - target) * (metric(k.make(lo)) - target) > 0) return NaN
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2
    if ((metric(k.make(m)) < target) === up) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

function report(title: string, metric: (s: AircraftSpec) => number, target: number,
  digits: number): void {
  console.log(`\n══ ${title} ══════════════════════════════════`)
  console.log('  旋鈕                現值 →   需要   海平面   5000m    海爬     失速     升限')
  for (const k of KNOBS) {
    const v = solve(k, metric, target)
    if (!Number.isFinite(v)) {
      console.log(`  ${k.tag.padEnd(18)}${n(k.now, 8, digits)} →  達不到`)
      continue
    }
    const s = k.make(v)
    console.log(`  ${k.tag.padEnd(18)}${n(k.now, 8, digits)} →${n(v, 7, digits)}`
      + pct(maxLevelSpeed(s, 0) * KMH, H.vmaxSeaLevel * KMH)
      + pct(maxLevelSpeed(s, 5000) * KMH, H.vmaxAtCritical.speed * KMH)
      + pct(maxClimbRate(s, 0).rate, H.climbRateSeaLevel)
      + pct(stallSpeed(s, 0, 1) * KMH, H.stallSpeed * KMH)
      + pct(serviceCeiling(s), H.serviceCeiling))
  }
}

console.log('\n  現況：海平面 +0.0%、5,000 m −3.6%、海爬 −13.0%、失速 +5.6%、升限 +3.5%')
console.log('  史實：369 / 405 km/h / 4.5 m/s / 150 km/h / 6,300 m')

report('目標一：5,000 m 極速命中史實 405 km/h',
  (s) => maxLevelSpeed(s, 5000) * KMH, 405, 4)
report('目標二：海平面爬升命中史實 4.5 m/s',
  (s) => maxClimbRate(s, 0).rate, 4.5, 4)
report('目標三：海平面爬升拉到 5.5 m/s（超過史實 22%）',
  (s) => maxClimbRate(s, 0).rate, 5.5, 4)
console.log()
