/**
 * 「P-51D 能不能在**真實試飛重量**下讓五項全部對上史實」—— 只量，不改 spec。
 *
 * 跑法：`npx vite-node test/tools/p51-real-mass.probe.ts`
 *
 * ── 兩個發現，這支就是要驗證它們 ────────────────────────────
 *
 * ① **出貨的 `engine.gears` 混了兩個出力狀態。** V-1650-7 在 67"Hg WEP、
 *    3,000 rpm 的真實額定是海平面 1,630 BHP、低增壓 1,700 @ 5,750 ft、
 *    高增壓 1,555 BHP @ 19,300 ft。出貨值填的是：
 *
 *      { SL 1490, crit 1720 @ 1900 m }   ← 1,490 是 **61"Hg 軍用／起飛**值
 *      { SL 1290, crit 1370 @ 5900 m }   ← 1,370 遠低於 WEP 的 1,555
 *
 *    也就是低增壓檔的海平面用軍用值、臨界用 WEP 值；高增壓檔兩個都偏低。
 *    海平面短少 9.4%、高增壓臨界短少 13.5%。
 *
 * ② **史實表本身混了重量。** 極速／爬升／升限對得上 AAF 44-15342 的試飛
 *    （P-51D-15NA，起飛總重 **9,760 lb = 4,427 kg**、67"Hg）：
 *
 *      海平面極速 375 mph、26,000 ft 442 mph、海平面爬升 3,600 fpm、
 *      升限 41,600 ft
 *
 *    但 `stallSpeed` 的 160 km/h 配 `clMax` 1.45 反解出來是 3,900 kg
 *    —— 那是**另一個載重狀態**。專案 2026-08-27 的診斷把「失速也指向
 *    3,900 kg」當成「模型出力不足」的排除證據，但失速那一項只是說
 *    「那個失速數字屬於 3,900 kg」，它不是速度／爬升那一組的證人。
 */
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109K4, BF109K4_HISTORICAL as HB } from '../../src/specs/bf109k4'
import {
  bestSustainedTurnRate, instantaneousTurnRate, maxClimbRate, maxLevelSpeed,
  serviceCeiling, stallSpeed, sustainedTurnRate,
} from '../../src/analysis/envelope'
import { derivedClMax, type AircraftSpec, type HistoricalReference } from '../../src/specs/types'

const HP = 745.7
const KMH = 3.6
const MPH = 0.44704
const FT = 0.3048
const FPM = 0.00508
const DEGPS = 180 / Math.PI

/** 44-15342 試飛（9,760 lb、67"Hg WEP）—— 失速由 clMax 1.45 換算到該重量 */
const TEST: HistoricalReference = {
  vmaxAtCritical: { speed: 442 * MPH, altitude: 26000 * FT },
  vmaxSeaLevel: 375 * MPH,
  climbRateSeaLevel: 3600 * FPM,
  serviceCeiling: 41600 * FT,
  stallSpeed: Math.sqrt(2 * 4427 * 9.80665 / (1.225 * 21.83 * 1.45)),
  clMax: 1.45,
}

/** 真實的 67"Hg WEP 額定 */
const WEP_GEARS = [
  { powerSeaLevel: 1630 * HP, powerCritical: 1700 * HP, altCritical: 5750 * FT },
  { powerSeaLevel: 1400 * HP, powerCritical: 1555 * HP, altCritical: 19300 * FT },
]

const make = (o: {
  mass?: number; gears?: typeof WEP_GEARS; cd0?: number; ram?: number
  alphaCrit?: number; oswald?: number
}): AircraftSpec => ({
  ...P51D,
  mass: o.mass ?? P51D.mass,
  engine: {
    gears: o.gears ?? P51D.engine.gears,
    ramEfficiency: o.ram ?? P51D.engine.ramEfficiency,
  },
  drag: { ...P51D.drag, cd0: o.cd0 ?? P51D.drag.cd0 },
  wing: { ...P51D.wing, oswald: o.oswald ?? P51D.wing.oswald },
  lift: { ...P51D.lift, alphaCrit: o.alphaCrit ?? P51D.lift.alphaCrit },
})

const pc = (v: number, r: number): string => {
  const e = (v / r - 1) * 100
  return `${(e >= 0 ? '+' : '') + e.toFixed(1)}%`
}
function five(label: string, s: AircraftSpec, h: HistoricalReference): void {
  const cell = (v: number, r: number, d = 0): string =>
    `${v.toFixed(d)} ${pc(v, r)}`.padStart(15)
  console.log(label.padEnd(34)
    + cell(maxLevelSpeed(s, h.vmaxAtCritical.altitude) * KMH, h.vmaxAtCritical.speed * KMH)
    + cell(maxLevelSpeed(s, 0) * KMH, h.vmaxSeaLevel * KMH)
    + cell(maxClimbRate(s, 0).rate * 60, h.climbRateSeaLevel * 60)
    + cell(serviceCeiling(s), h.serviceCeiling)
    + cell(stallSpeed(s, 0, 1) * KMH, h.stallSpeed * KMH, 1))
}
const HEAD = ''.padEnd(34) + '     臨界極速       海面極速           爬升           升限           失速'

console.log('══ 現況與兩個修正各自的效果（史實表＝44-15342，9,760 lb）══')
console.log(`史實：${(TEST.vmaxAtCritical.speed * KMH).toFixed(0)} km/h @ `
  + `${TEST.vmaxAtCritical.altitude.toFixed(0)} m、${(TEST.vmaxSeaLevel * KMH).toFixed(0)} km/h、`
  + `${(TEST.climbRateSeaLevel * 60).toFixed(0)} m/min、${TEST.serviceCeiling.toFixed(0)} m、`
  + `${(TEST.stallSpeed * KMH).toFixed(1)} km/h`)
console.log(HEAD)
five('出貨（3,900 kg、舊 gears）', P51D, TEST)
five('只換真實重量 4,427 kg', make({ mass: 4427 }), TEST)
five('只換真實 WEP gears', make({ gears: WEP_GEARS }), TEST)
five('兩個都換', make({ mass: 4427, gears: WEP_GEARS }), TEST)

console.log('\n══ 兩個都換之後，再掃 cd0（其餘不動）══')
console.log(HEAD)
for (const c of [0.0163, 0.0170, 0.0176, 0.0182, 0.0190]) {
  five(`  cd0 ${c.toFixed(4)}`, make({ mass: 4427, gears: WEP_GEARS, cd0: c }), TEST)
}
console.log('\n══ 再掃 ramEfficiency（cd0 = 0.0176）══')
console.log(HEAD)
for (const r of [0.80, 0.85, 0.90, 0.95, 1.0]) {
  five(`  ram ${r.toFixed(2)}`, make({ mass: 4427, gears: WEP_GEARS, cd0: 0.0176, ram: r }), TEST)
}
console.log('\n══ 失速：alphaCrit（CL_max 的門檻是史實 1.45 的 ±8% → 1.334…1.566）══')
for (const a of [15.5, 16.0, 16.5, 17.0]) {
  const s = make({ mass: 4427, alphaCrit: a * Math.PI / 180 })
  console.log(`  alphaCrit ${a}°  CL_max ${derivedClMax(s, false).toFixed(3)}`
    + `（對 1.45 ${pc(derivedClMax(s, false), 1.45)}）`
    + `  失速 ${(stallSpeed(s, 0, 1) * KMH).toFixed(1)} km/h`
    + `（對 ${(TEST.stallSpeed * KMH).toFixed(1)} ${pc(stallSpeed(s, 0, 1) * KMH, TEST.stallSpeed * KMH)}）`)
}

// ══ 核心矛盾：一個 cd0 對不上兩個極速點 ═══════════════════════
//
// 試飛的比值 375/442 = 0.848。模型在高速的立方律給的是
//   V_SL/V_alt = ((P_SL/P_alt)(ρ_alt/ρ_SL))^⅓ = ((1630/1555)(0.4434))^⅓ = 0.7745
// 也就是模型在**高空太快**（同一個 cd0 下比值固定，調 cd0 動不了它）。
// 差額指向壓縮性：442 mph @ 26,000 ft 是 M 0.625，而出貨的 machCrit 是 0.72
// —— 模型在那裡完全沒有波阻。
const g1 = (sl: number) => [
  { powerSeaLevel: sl * HP, powerCritical: 1700 * HP, altCritical: 5750 * FT },
  WEP_GEARS[1]!,
]
const mk = (sl: number, cd0: number, mc: number): AircraftSpec => ({
  ...make({ mass: 4427, cd0 }),
  engine: { gears: g1(sl), ramEfficiency: P51D.engine.ramEfficiency },
  drag: { ...P51D.drag, cd0, machCrit: mc },
})
console.log('\n══ 三個變數一起掃（質量 4,427 kg 固定）══')
console.log('  gear1 SL 是低增壓檔的海平面出力；試飛在爬升中實測 0 ft 為 1,780 BHP')
console.log(''.padEnd(34) + '     臨界極速       海面極速           爬升           升限           失速')
for (const mc of [0.72, 0.68, 0.65, 0.62]) {
  for (const sl of [1630, 1700, 1780]) {
    for (const c of [0.0163, 0.0172]) {
      five(`  machCrit ${mc} SL ${sl} cd0 ${c.toFixed(4)}`, mk(sl, c, mc), TEST)
    }
  }
}

// ══ 候選組態：把三個錯一起修掉 ═══════════════════════════════
const CAND = (cd0: number): AircraftSpec => ({
  ...P51D,
  mass: 4427,
  engine: { gears: g1(1780), ramEfficiency: 0.9 },
  drag: { ...P51D.drag, cd0, machCrit: 0.62 },
})
console.log('\n══ 候選組態 vs 出貨：跨機種斷言全查 ═══════════════════')
const RATIO_H = (HB.climbRateSeaLevel * 60) / (TEST.climbRateSeaLevel * 60)
const RATIO_OLD = (HB.climbRateSeaLevel * 60) / (P51D_HISTORICAL.climbRateSeaLevel * 60)
const rows: [string, (s: AircraftSpec) => string, string][] = [
  ['爬升比 K-4/P-51D', (s) => {
    const r = maxClimbRate(BF109K4, 0).rate / maxClimbRate(s, 0).rate
    return `${r.toFixed(3)}`
  }, `史實 舊${RATIO_OLD.toFixed(3)} / 新${RATIO_H.toFixed(3)}，±5%`],
  ['9,000 m 極速優勢 km/h', (s) =>
    (maxLevelSpeed(s, 9000) * KMH - maxLevelSpeed(BF109K4, 9000) * KMH).toFixed(1), '> 20'],
  ['7,000 m 差 km/h', (s) =>
    (maxLevelSpeed(s, 7000) * KMH - maxLevelSpeed(BF109K4, 7000) * KMH).toFixed(1), '< 0'],
  ['8,000 m 差 km/h', (s) =>
    (maxLevelSpeed(s, 8000) * KMH - maxLevelSpeed(BF109K4, 8000) * KMH).toFixed(1), '> 0'],
  ['升限差距 %', (s) => {
    const p = serviceCeiling(s), b = serviceCeiling(BF109K4)
    return (Math.abs(p - b) / Math.min(p, b) * 100).toFixed(1)
  }, '< 8'],
  ['爬升比最大值 0–9km', (s) => {
    let mx = 0
    for (let h = 0; h <= 9000; h += 1000) mx = Math.max(mx, maxClimbRate(BF109K4, h).rate / maxClimbRate(s, h).rate)
    return mx.toFixed(3)
  }, '< 1.8'],
  ['持續轉彎 250 P−K °/s', (s) =>
    ((sustainedTurnRate(s, 0, 250 / KMH) - sustainedTurnRate(BF109K4, 0, 250 / KMH)) * DEGPS).toFixed(3), '> 0'],
  ['持續轉彎 300 K−P °/s', (s) =>
    ((sustainedTurnRate(BF109K4, 0, 300 / KMH) - sustainedTurnRate(s, 0, 300 / KMH)) * DEGPS).toFixed(3), '> 0'],
  ['瞬間轉彎比 最小值', (s) => {
    let mn = Infinity
    for (let v = 300; v <= 700; v += 50) mn = Math.min(mn, instantaneousTurnRate(s, 3000, v / KMH) / instantaneousTurnRate(BF109K4, 3000, v / KMH))
    return mn.toFixed(3)
  }, '> 1'],
  ['持續迴旋 0 m °/s', (s) => (bestSustainedTurnRate(s, 0) * DEGPS).toFixed(2), 'F6F 16.94'],
  ['持續迴旋 4000 m °/s', (s) => (bestSustainedTurnRate(s, 4000) * DEGPS).toFixed(2), 'F6F 12.17'],
  ['翼負荷 kg/m²', (s) => (s.mass / s.wing.area).toFixed(1), 'F6F 181.6'],
]
console.log(''.padEnd(24) + '   出貨 3900kg      候選 cd0.0163      候選 cd0.0172   門檻')
for (const [name, f, gate] of rows) {
  console.log(name.padEnd(24)
    + f(P51D).padStart(14) + f(CAND(0.0163)).padStart(18) + f(CAND(0.0172)).padStart(20)
    + '   ' + gate)
}
console.log('\n══ 候選組態的五項（對新史實表）══')
console.log(''.padEnd(34) + '     臨界極速       海面極速           爬升           升限           失速')
five('  cd0 0.0163', CAND(0.0163), TEST)
five('  cd0 0.0172', CAND(0.0172), TEST)
console.log('\n══ 同一個候選，對**舊**史實表（3,900 kg 那一組）══')
five('  cd0 0.0172（舊表）', CAND(0.0172), P51D_HISTORICAL)

// ══ 不動 machCrit 的路線：只修出力與重量，cd0 補回物理值 ═══════
console.log('\n══ machCrit 維持 0.72（不動），gear1 SL 1,780，只掃 cd0 ══')
console.log(''.padEnd(34) + '     臨界極速       海面極速           爬升           升限           失速')
for (const c of [0.0172, 0.0178, 0.0184, 0.0190, 0.0196]) {
  five(`  cd0 ${c.toFixed(4)}`, mk(1780, c, 0.72), TEST)
}
console.log('\n  跨機種（machCrit 0.72、SL 1780）')
console.log(''.padEnd(24) + '  cd0 .0178   cd0 .0184   cd0 .0190   門檻')
for (const [name, f, gate] of rows) {
  console.log(name.padEnd(24)
    + f(mk(1780, 0.0178, 0.72)).padStart(11)
    + f(mk(1780, 0.0184, 0.72)).padStart(12)
    + f(mk(1780, 0.0190, 0.72)).padStart(12) + '   ' + gate)
}

console.log('\n══ 細掃 cd0：臨界極速（要 ≤ +5%）對 9,000 m 優勢（要 > 20 km/h）══')
for (const c of [0.0178, 0.0180, 0.0182, 0.0184, 0.0186]) {
  const s = mk(1780, c, 0.72)
  const adv = maxLevelSpeed(s, 9000) * KMH - maxLevelSpeed(BF109K4, 9000) * KMH
  const vC = maxLevelSpeed(s, TEST.vmaxAtCritical.altitude) * KMH
  const r = maxClimbRate(BF109K4, 0).rate / maxClimbRate(s, 0).rate
  console.log(`  cd0 ${c.toFixed(4)}  臨界極速 ${pc(vC, TEST.vmaxAtCritical.speed * KMH).padStart(6)}`
    + `   9,000 m 優勢 ${adv.toFixed(1).padStart(5)} km/h`
    + `   爬升比 ${r.toFixed(3)}（${pc(r, RATIO_H)}）`
    + `   海面 ${pc(maxLevelSpeed(s, 0) * KMH, TEST.vmaxSeaLevel * KMH).padStart(6)}`
    + `   爬升 ${pc(maxClimbRate(s, 0).rate * 60, TEST.climbRateSeaLevel * 60).padStart(6)}`
    + `   升限 ${pc(serviceCeiling(s), TEST.serviceCeiling).padStart(6)}`)
}
