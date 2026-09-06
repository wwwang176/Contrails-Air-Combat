/**
 * He 111 與 B-17G 的性能對照史實 —— **它們還沒有進 L2 測試**，這支是替代品。
 *
 *   npx vite-node test/tools/bomber-histo.probe.ts
 *
 * 【為什麼是 probe 不是測試】把它寫成 `historical.test.ts` 的第三、四筆
 * 就等於宣告那些係數已經定案；實際上兩份 spec 的檔頭都寫著「全部是起始值」。
 * 先量出偏差有多大，才有辦法判斷是要調係數還是要放寬區間 —— 那是負責人
 * 的裁定（`docs/backlog.md` §1）。
 *
 * 【滾轉率怎麼算】`moments.clDa` 是副翼的滾轉力矩導數。穩態滾轉率由
 * 「操縱力矩 = 滾轉阻尼力矩」解出：`p = clDa·δ · V / (−clP · b/2)`，
 * 其中 δ 取滿舵 1.0。這與飛行手冊上的「滿舵滾轉率」是同一個量。
 */
import {
  maxLevelSpeed, maxClimbRate, stallSpeed, serviceCeiling,
} from '../../src/analysis/envelope'
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109K4, BF109K4_HISTORICAL } from '../../src/specs/bf109k4'
import { HE111, HE111_HISTORICAL } from '../../src/specs/he111'
import { B17G, B17G_HISTORICAL } from '../../src/specs/b17g'
import { applyFeel, feelFor } from '../../src/specs/feel'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'

const KMH = 3.6
const RAD = 180 / Math.PI

const CASES: { spec: AircraftSpec; hist: HistoricalReference; inL2: boolean }[] = [
  { spec: P51D, hist: P51D_HISTORICAL, inL2: true },
  { spec: BF109K4, hist: BF109K4_HISTORICAL, inL2: true },
  { spec: HE111, hist: HE111_HISTORICAL, inL2: true },
  { spec: B17G, hist: B17G_HISTORICAL, inL2: true },
]

const n = (v: number, w = 8, d = 1): string => v.toFixed(d).padStart(w)
const pct = (a: number, b: number): string => {
  const p = ((a - b) / b) * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`.padStart(7)
}

/** 滿舵穩態滾轉率，度/秒。 */
function rollRate(spec: AircraftSpec, tas: number): number {
  const m = spec.moments
  const p = (m.clDa * tas) / (-m.clP * (spec.wing.span / 2))
  return p * RAD
}

function row(label: string, model: number, hist: number, unit: string): void {
  console.log(`    ${label.padEnd(16)}${n(model)}  ${n(hist)}  ${pct(model, hist)}  ${unit}`)
}

console.log('\n══ L2 那五項：模型（未套手感）對史實 ═══════════════════════')
for (const { spec, hist, inL2 } of CASES) {
  console.log(`\n  ${spec.name}${inL2 ? '' : '   ← 不在 L2 測試裡'}`)
  console.log(`    ${''.padEnd(16)}${'模型'.padStart(7)}  ${'史實'.padStart(7)}   偏差`)
  row('海平面極速', maxLevelSpeed(spec, 0) * KMH, hist.vmaxSeaLevel * KMH, 'km/h')
  row(`${hist.vmaxAtCritical.altitude} m 極速`,
    maxLevelSpeed(spec, hist.vmaxAtCritical.altitude) * KMH,
    hist.vmaxAtCritical.speed * KMH, 'km/h')
  row('海平面爬升率', maxClimbRate(spec, 0).rate, hist.climbRateSeaLevel, 'm/s')
  row('失速速度', stallSpeed(spec, 0, 1) * KMH, hist.stallSpeed * KMH, 'km/h')
  row('實用升限', serviceCeiling(spec), hist.serviceCeiling, 'm')
}

console.log('\n══ 出貨值（套 GAME_FEEL）對史實 ═══════════════════════════')
console.log(`  ${'機種'.padEnd(14)}${'爬升 m/s'.padStart(18)}${'升限 m'.padStart(20)}`)
console.log(`  ${''.padEnd(14)}${'史實'.padStart(8)}${'出貨'.padStart(8)}${'倍'.padStart(6)}`
  + `${'史實'.padStart(8)}${'出貨'.padStart(8)}${'倍'.padStart(6)}`)
for (const { spec, hist } of CASES) {
  const g = applyFeel(spec, feelFor(spec))
  const c = maxClimbRate(g, 0).rate
  const s = serviceCeiling(g)
  console.log(`  ${spec.name.padEnd(14)}${n(hist.climbRateSeaLevel, 8, 1)}${n(c, 8, 1)}`
    + `${n(c / hist.climbRateSeaLevel, 6, 2)}`
    + `${n(hist.serviceCeiling, 8, 0)}${n(s, 8, 0)}${n(s / hist.serviceCeiling, 6, 2)}`)
}

console.log('\n══ 滿舵滾轉率（度/秒）—— **沒有任何史實斷言** ═══════════════')
console.log(`  ${'機種'.padEnd(14)}${'clDa'.padStart(8)}${'翼展'.padStart(7)}`
  + `${'400 km/h'.padStart(10)}${'出貨'.padStart(8)}   真機手冊`)
const BOOK: Record<string, string> = {
  'P-51D Mustang': '約 90（400 km/h 滿舵）',
  'Bf 109 G-6': '約 60（滾轉在高速變重）',
  'He 111 H-6': '沒查到數字',
  'B-17G Flying Fortress': '沒查到數字',
}
for (const { spec } of CASES) {
  const tas = 400 / KMH
  const g = applyFeel(spec, feelFor(spec))
  console.log(`  ${spec.name.padEnd(14)}${n(spec.moments.clDa, 8, 3)}`
    + `${n(spec.wing.span, 7, 2)}${n(rollRate(spec, tas), 10, 1)}`
    + `${n(rollRate(g, tas), 8, 1)}   ${BOOK[spec.name] ?? ''}`)
}
console.log()
