/**
 * F6F-5 的參數掃描 —— 「只退回本項、其餘全為出貨值」。
 *
 * 跑法：`npx vite-node test/tools/f6f-tune.probe.ts`
 */
import { maxClimbRate, maxLevelSpeed, serviceCeiling, stallSpeed } from '../../src/analysis/envelope'
import { derivedClMax } from '../../src/specs/types'
import { F6F5, F6F5_HISTORICAL as H } from '../../src/specs/f6f5'
import type { AircraftSpec } from '../../src/specs/types'

const KMH = 3.6
const p = (v: number, ref: number): string => {
  const e = (v / ref - 1) * 100
  return `${(e >= 0 ? '+' : '')}${e.toFixed(1)}%`
}
const n = (v: number, w: number, d = 0): string => v.toFixed(d).padStart(w)

function row(label: string, s: AircraftSpec): void {
  const alt = H.vmaxAtCritical.altitude
  const vC = maxLevelSpeed(s, alt) * KMH
  const vS = maxLevelSpeed(s, 0) * KMH
  const cl = maxClimbRate(s, 0).rate * 60
  const ce = serviceCeiling(s)
  const st = stallSpeed(s, 0, 1) * KMH
  // 峰值位置：臨界高度兩側各 3000 m 都要更低
  const lo = maxLevelSpeed(s, alt - 3000) * KMH
  const hi = maxLevelSpeed(s, Math.min(alt + 3000, 11000)) * KMH
  console.log(
    `${label.padEnd(30)} ${n(vC, 5, 1)} ${p(vC, H.vmaxAtCritical.speed * KMH).padStart(6)}`
    + ` | ${n(vS, 5, 1)} ${p(vS, H.vmaxSeaLevel * KMH).padStart(6)}`
    + ` | ${n(cl, 5, 0)} ${p(cl, H.climbRateSeaLevel * 60).padStart(6)}`
    + ` | ${n(ce, 6, 0)} ${p(ce, H.serviceCeiling).padStart(6)}`
    + ` | ${n(st, 5, 1)} ${p(st, H.stallSpeed * KMH).padStart(6)}`
    + ` | 峰值餘裕 ${n(vC - lo, 5, 1)} /${n(vC - hi, 5, 1)}`)
}

console.log('史實：臨界高度 ' + (H.vmaxAtCritical.speed * KMH).toFixed(1)
  + ' km/h @ ' + H.vmaxAtCritical.altitude.toFixed(0) + ' m'
  + '、海平面 ' + (H.vmaxSeaLevel * KMH).toFixed(1)
  + '、爬升 ' + (H.climbRateSeaLevel * 60).toFixed(0) + ' m/min'
  + '、升限 ' + H.serviceCeiling.toFixed(0) + ' m'
  + '、失速 ' + (H.stallSpeed * KMH).toFixed(1) + ' km/h')
console.log(`模型 clMax ${derivedClMax(F6F5, false).toFixed(3)}  史實 ${H.clMax.toFixed(3)}`)
console.log(''.padEnd(30) + ' 臨界極速        | 海面極速        | 爬升            | 升限             | 失速            |')

row('出貨值', F6F5)
console.log('── cd0 ──')
for (const c of [0.0175, 0.0180, 0.0185, 0.0190, 0.0195, 0.0200, 0.0210]) {
  row(`cd0 ${c.toFixed(4)}`, { ...F6F5, drag: { ...F6F5.drag, cd0: c } })
}
console.log('── etaMax（cd0 出貨）──')
for (const e of [0.82, 0.85, 0.88, 0.90]) {
  row(`etaMax ${e}`, { ...F6F5, prop: { ...F6F5.prop, etaMax: e } })
}
console.log('── vRef ──')
for (const v of [35, 40, 45, 50, 55]) {
  row(`vRef ${v}`, { ...F6F5, prop: { ...F6F5.prop, vRef: v } })
}
console.log('── ramEfficiency ──')
for (const r of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
  row(`ram ${r}`, { ...F6F5, engine: { ...F6F5.engine, ramEfficiency: r } })
}
console.log('── 組合（cd0 × etaMax）──')
for (const [c, e] of [[0.0210, 0.90], [0.0200, 0.89], [0.0195, 0.88], [0.0190, 0.88],
                      [0.0195, 0.87], [0.0185, 0.86], [0.0182, 0.85]] as [number, number][]) {
  row(`cd0 ${c.toFixed(4)} × etaMax ${e}`,
    { ...F6F5, drag: { ...F6F5.drag, cd0: c }, prop: { ...F6F5.prop, etaMax: e } })
}
console.log('── oswald ──')
for (const o of [0.75, 0.80, 0.85]) {
  row(`oswald ${o}`, { ...F6F5, wing: { ...F6F5.wing, oswald: o } })
}

// ── 爬升隨高度：真機在低增壓檔到 ~15,000 ft 幾乎是平的 ──────────
console.log('\n── 爬升率隨高度 m/min（只動 gears[0].altCritical）──')
const HS = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000]
console.log('高度 m'.padEnd(24) + HS.map((h) => String(h).padStart(7)).join(''))
for (const ac of [1000, 3000, 5500, 8000]) {
  const s: AircraftSpec = {
    ...F6F5,
    engine: {
      ...F6F5.engine,
      gears: F6F5.engine.gears.map((g, i) =>
        i === 0 ? { ...g, altCritical: ac * 0.3048 } : g),
    },
  }
  console.log(`gears[0] crit ${ac} ft`.padEnd(24)
    + HS.map((h) => maxClimbRate(s, h).rate * 60).map((v) => v.toFixed(0).padStart(7)).join(''))
}
console.log('\n── 同上，五項驗收 ──')
for (const ac of [1000, 3000, 5500, 8000]) {
  row(`gears[0] crit ${ac} ft`, {
    ...F6F5,
    engine: {
      ...F6F5.engine,
      gears: F6F5.engine.gears.map((g, i) =>
        i === 0 ? { ...g, altCritical: ac * 0.3048 } : g),
    },
  })
}

console.log('\n── 補上換檔谷底：gears[0] crit 5500 ft + gears[1] 的海平面出力 ──')
for (const p1 of [1700, 1800, 1900]) {
  const s: AircraftSpec = {
    ...F6F5,
    engine: {
      ...F6F5.engine,
      gears: [
        { ...F6F5.engine.gears[0]!, altCritical: 5500 * 0.3048 },
        { ...F6F5.engine.gears[1]!, powerSeaLevel: p1 * 745.7 },
        F6F5.engine.gears[2]!,
      ],
    },
  }
  console.log(`gears[1] SL ${p1} hp`.padEnd(24)
    + HS.map((h) => maxClimbRate(s, h).rate * 60).map((v) => v.toFixed(0).padStart(7)).join(''))
  row(`  → 五項`, s)
}
