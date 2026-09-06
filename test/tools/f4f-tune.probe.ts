/**
 * F4F-4 的參數掃描 —— 「只退回本項、其餘為出貨值」。
 *
 * 跑法：`npx vite-node test/tools/f4f-tune.probe.ts`
 *
 * 【爬升曲線的形狀是這一台獨有的約束】試飛報告的 Enclosure E 明說爬升率
 * 由海平面到 14,000 ft 是**定值** 1,940 fpm，之後線性掉到 35,000 ft 歸零。
 * 所以除了五項驗收，還要看逐高度的爬升率是不是平的。
 */
import { maxClimbRate, maxLevelSpeed, serviceCeiling, stallSpeed } from '../../src/analysis/envelope'
import { derivedClMax } from '../../src/specs/types'
import { F4F4, F4F4_HISTORICAL as H } from '../../src/specs/f4f4'
import type { AircraftSpec } from '../../src/specs/types'

const KMH = 3.6
const HP = 745.7
const FT = 0.3048
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
console.log('推導 CL_max ' + derivedClMax(F4F4, false).toFixed(3)
  + ' 對史實 ' + H.clMax.toFixed(3) + ' → ' + p(derivedClMax(F4F4, false), H.clMax))
console.log('欄位：臨界極速 | 海面極速 | 海平面爬升 | 升限 | 失速\n')

row('出貨值', F4F4)

console.log('\n── cd0 ──')
for (const cd0 of [0.0230, 0.0245, 0.0260, 0.0275, 0.0290]) {
  row(`cd0 ${cd0.toFixed(4)}`, { ...F4F4, drag: { ...F4F4.drag, cd0 } })
}

console.log('\n── etaMax（cd0 出貨值）──')
for (const etaMax of [0.82, 0.84, 0.86, 0.88]) {
  row(`etaMax ${etaMax.toFixed(2)}`, { ...F4F4, prop: { ...F4F4.prop, etaMax } })
}

console.log('\n── ramEfficiency ──')
for (const ram of [0.15, 0.30, 0.45, 0.60]) {
  row(`ram ${ram.toFixed(2)}`, { ...F4F4, engine: { ...F4F4.engine, ramEfficiency: ram } })
}

console.log('\n── 爬升曲線的形狀（史實：海平面到 14,000 ft = 4,267 m 都是 591 m/min）──')
const HS = [0, 1000, 2000, 3000, 4000, 4267, 5000, 6000, 7000, 8000]
console.log('高度 m'.padEnd(26) + HS.map((h) => h.toFixed(0).padStart(7)).join(''))
console.log('出貨值'.padEnd(24)
  + HS.map((h) => maxClimbRate(F4F4, h).rate * 60).map((v) => v.toFixed(0).padStart(7)).join(''))
for (const ac of [2000, 4000, 6000, 8000]) {
  const s: AircraftSpec = {
    ...F4F4,
    engine: {
      ...F4F4.engine,
      gears: F4F4.engine.gears.map((g, i) => (i === 0 ? { ...g, altCritical: ac * FT } : g)),
    },
  }
  console.log(`gears[0] crit ${ac} ft`.padEnd(24)
    + HS.map((h) => maxClimbRate(s, h).rate * 60).map((v) => v.toFixed(0).padStart(7)).join(''))
}
for (const p1 of [850, 900, 950, 1000]) {
  const s: AircraftSpec = {
    ...F4F4,
    engine: {
      ...F4F4.engine,
      gears: [
        F4F4.engine.gears[0]!,
        { ...F4F4.engine.gears[1]!, powerSeaLevel: p1 * HP },
        F4F4.engine.gears[2]!,
      ],
    },
  }
  console.log(`gears[1] SL ${p1} hp`.padEnd(24)
    + HS.map((h) => maxClimbRate(s, h).rate * 60).map((v) => v.toFixed(0).padStart(7)).join(''))
}

console.log('\n── 速度─高度曲線（Grumman 1471C, Normal Fighter 7,426 lb，mph）──')
const PTS: [number, number][] = [[0, 275.0], [2500, 281.8], [4600, 283.1],
  [12000, 303.2], [14000, 304.5], [19000, 317.0], [19400, 318.0]]
function curve(label: string, s: AircraftSpec): void {
  const cells = PTS.map(([ft, mph]) => {
    const v = maxLevelSpeed(s, ft * FT) / 0.44704
    return `${v.toFixed(0)}/${((v / mph - 1) * 100).toFixed(0)}%`.padStart(10)
  })
  console.log(label.padEnd(22) + cells.join(''))
}
console.log('高度 ft'.padEnd(22) + PTS.map(([ft]) => ft.toFixed(0).padStart(10)).join(''))
console.log('史實 mph'.padEnd(20) + PTS.map(([, m]) => m.toFixed(1).padStart(10)).join(''))
curve('出貨值', F4F4)
for (const cd0 of [0.0200, 0.0215, 0.0230, 0.0245]) {
  curve(`cd0 ${cd0.toFixed(4)}`, { ...F4F4, drag: { ...F4F4.drag, cd0 } })
}
for (const e of [0.86, 0.88, 0.90]) {
  curve(`etaMax ${e.toFixed(2)}`, { ...F4F4, prop: { ...F4F4.prop, etaMax: e } })
}
for (const vr of [30, 36, 42, 50]) {
  curve(`vRef ${vr}`, { ...F4F4, prop: { ...F4F4.prop, vRef: vr } })
}

console.log('\n── 組合掃描：cd0 × etaMax × vRef ──')
for (const cd0 of [0.0225, 0.0235, 0.0245]) {
  for (const e of [0.87, 0.89]) {
    for (const vr of [30, 36]) {
      const s: AircraftSpec = {
        ...F4F4,
        drag: { ...F4F4.drag, cd0 },
        prop: { ...F4F4.prop, etaMax: e, vRef: vr },
      }
      const label = `cd0 ${cd0.toFixed(4)} eta ${e} vRef ${vr}`
      curve(label, s)
      row('  → ' + label, s)
    }
  }
}

console.log('\n── figureOfMerit（只動低速推力）：cd0 0.0245 / eta 0.87 / vRef 36 ──')
for (const fm of [0.55, 0.65, 0.72, 0.80]) {
  const s: AircraftSpec = {
    ...F4F4,
    drag: { ...F4F4.drag, cd0: 0.0245 },
    prop: { ...F4F4.prop, etaMax: 0.87, vRef: 36, figureOfMerit: fm },
  }
  row(`fm ${fm.toFixed(2)}`, s)
}
console.log('\n── 同上，爬升曲線 ──')
console.log('高度 m'.padEnd(26) + HS.map((h) => h.toFixed(0).padStart(7)).join(''))
for (const fm of [0.55, 0.65, 0.72, 0.80]) {
  const s: AircraftSpec = {
    ...F4F4,
    drag: { ...F4F4.drag, cd0: 0.0245 },
    prop: { ...F4F4.prop, etaMax: 0.87, vRef: 36, figureOfMerit: fm },
  }
  console.log(`fm ${fm.toFixed(2)}`.padEnd(24)
    + HS.map((h) => maxClimbRate(s, h).rate * 60).map((v) => v.toFixed(0).padStart(7)).join(''))
}

console.log('\n── oswald × cd0（eta 0.87 / vRef 36）──')
for (const os of [0.62, 0.68, 0.74, 0.80]) {
  for (const cd0 of [0.0235, 0.0250, 0.0265]) {
    const s: AircraftSpec = {
      ...F4F4,
      wing: { ...F4F4.wing, oswald: os },
      drag: { ...F4F4.drag, cd0 },
      prop: { ...F4F4.prop, etaMax: 0.87, vRef: 36 },
    }
    row(`oswald ${os} cd0 ${cd0.toFixed(4)}`, s)
  }
}

console.log('\n── 細掃（eta 0.87 / vRef 36）──')
for (const os of [0.58, 0.62, 0.66, 0.70]) {
  for (const cd0 of [0.0225, 0.0235, 0.0245]) {
    row(`oswald ${os} cd0 ${cd0.toFixed(4)}`, {
      ...F4F4,
      wing: { ...F4F4.wing, oswald: os },
      drag: { ...F4F4.drag, cd0 },
      prop: { ...F4F4.prop, etaMax: 0.87, vRef: 36 },
    })
  }
}

console.log('\n── 定案候選：oswald 0.62 / cd0 0.0245 / eta 0.87 / vRef 36，掃 ram ──')
for (const ram of [0.30, 0.45, 0.60]) {
  const s: AircraftSpec = {
    ...F4F4,
    wing: { ...F4F4.wing, oswald: 0.62 },
    drag: { ...F4F4.drag, cd0: 0.0245 },
    prop: { ...F4F4.prop, etaMax: 0.87, vRef: 36 },
    engine: { ...F4F4.engine, ramEfficiency: ram },
  }
  row(`ram ${ram.toFixed(2)}`, s)
  curve(`  ram ${ram.toFixed(2)}`, s)
  console.log('  爬升'.padEnd(22)
    + HS.map((h) => maxClimbRate(s, h).rate * 60).map((v) => v.toFixed(0).padStart(7)).join(''))
}
