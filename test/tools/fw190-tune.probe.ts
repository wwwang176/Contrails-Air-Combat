/**
 * Fw 190 D-9 的參數掃描 —— 「只動本項、其餘為出貨值」。
 *
 * 跑法：`npx vite-node test/tools/fw190-tune.probe.ts`
 */
import { maxClimbRate, maxLevelSpeed, serviceCeiling, stallSpeed } from '../../src/analysis/envelope'
import { derivedClMax } from '../../src/specs/types'
import { FW190, FW190_HISTORICAL as H } from '../../src/specs/fw190'
import type { AircraftSpec } from '../../src/specs/types'

const KMH = 3.6
const p = (v: number, ref: number): string => {
  const e = (v / ref - 1) * 100
  return `${e >= 0 ? '+' : ''}${e.toFixed(1)}%`
}
const n = (v: number, w: number, d = 0): string => v.toFixed(d).padStart(w)

function row(label: string, s: AircraftSpec): void {
  const alt = H.vmaxAtCritical.altitude
  const vC = maxLevelSpeed(s, alt) * KMH
  const vS = maxLevelSpeed(s, 0) * KMH
  const cl = maxClimbRate(s, 0).rate * 60
  const ce = serviceCeiling(s)
  const st = stallSpeed(s, 0, 1) * KMH
  const lo = maxLevelSpeed(s, Math.max(alt - 3000, 0)) * KMH
  const hi = maxLevelSpeed(s, Math.min(alt + 3000, 11000)) * KMH
  console.log(
    `${label.padEnd(26)} ${n(vC, 5, 1)} ${p(vC, H.vmaxAtCritical.speed * KMH).padStart(6)}`
    + ` | ${n(vS, 5, 1)} ${p(vS, H.vmaxSeaLevel * KMH).padStart(6)}`
    + ` | ${n(cl, 5, 0)} ${p(cl, H.climbRateSeaLevel * 60).padStart(6)}`
    + ` | ${n(ce, 6, 0)} ${p(ce, H.serviceCeiling).padStart(6)}`
    + ` | ${n(st, 5, 1)} ${p(st, H.stallSpeed * KMH).padStart(6)}`
    + ` | 峰值餘裕 ${n(vC - lo, 5, 1)} /${n(vC - hi, 5, 1)}`)
}

console.log('史實：臨界 ' + (H.vmaxAtCritical.speed * KMH).toFixed(1)
  + ' km/h @ ' + H.vmaxAtCritical.altitude.toFixed(0) + ' m'
  + '、海面 ' + (H.vmaxSeaLevel * KMH).toFixed(1)
  + '、爬升 ' + (H.climbRateSeaLevel * 60).toFixed(0) + ' m/min'
  + '、升限 ' + H.serviceCeiling.toFixed(0) + ' m'
  + '、失速 ' + (H.stallSpeed * KMH).toFixed(1) + ' km/h')
console.log('推導 CL_max ' + derivedClMax(FW190, false).toFixed(3)
  + ' 對史實 ' + H.clMax.toFixed(3) + ' → ' + p(derivedClMax(FW190, false), H.clMax))
console.log('欄位：臨界極速 | 海面極速 | 海平面爬升 | 升限 | 失速\n')

row('出貨值', FW190)

console.log('\n── cd0 ──')
for (const cd0 of [0.020, 0.021, 0.022, 0.023, 0.024, 0.025]) {
  row(`cd0 ${cd0.toFixed(4)}`, { ...FW190, drag: { ...FW190.drag, cd0 } })
}

console.log('\n── vRef ──')
for (const vRef of [40, 45, 50, 55, 60, 65]) {
  row(`vRef ${vRef}`, { ...FW190, prop: { ...FW190.prop, vRef } })
}

console.log('\n── etaMax ──')
for (const etaMax of [0.82, 0.84, 0.86, 0.88, 0.90]) {
  row(`etaMax ${etaMax.toFixed(2)}`, { ...FW190, prop: { ...FW190.prop, etaMax } })
}

console.log('\n── ramEfficiency ──')
for (const ram of [0.2, 0.35, 0.5, 0.65, 0.8]) {
  row(`ram ${ram.toFixed(2)}`, { ...FW190, engine: { ...FW190.engine, ramEfficiency: ram } })
}

console.log('\n── oswald ──')
for (const oswald of [0.74, 0.77, 0.80, 0.83]) {
  row(`oswald ${oswald.toFixed(2)}`, { ...FW190, wing: { ...FW190.wing, oswald } })
}

console.log('\n── 逐高度極速與爬升 ──')
const HS = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000]
console.log('高度 m'.padEnd(12) + HS.map((h) => h.toFixed(0).padStart(7)).join(''))
console.log('極速 km/h'.padEnd(10) + HS.map((h) => (maxLevelSpeed(FW190, h) * KMH).toFixed(0).padStart(7)).join(''))
console.log('爬升 m/s'.padEnd(10) + HS.map((h) => maxClimbRate(FW190, h).rate.toFixed(1).padStart(7)).join(''))
