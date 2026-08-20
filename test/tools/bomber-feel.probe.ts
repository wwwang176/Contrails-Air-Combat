/**
 * 轟炸機該不該有自己一組 `GAME_FEEL` —— 決策材料。
 *
 *   npx tsx test/tools/bomber-feel.probe.ts
 *
 * 【問題】`GAME_FEEL` 的六個倍率是 2026-08-07 照 P-51D 與 Bf 109 調的。
 * 同一組套在轟炸機上，出貨的爬升率是史實的 2.7–2.9 倍，而戰鬥機只有 1.89 倍
 * —— 轟炸機被放大得**更多**。沒有人裁定過這件事。
 *
 * 【怎麼縮回去】`feel.ts` 檔頭寫的耦合關係：高速平飛時 `V_max³ ∝ power/cd0`，
 * 所以 **power 與 cd0 同倍率一起動時極速不變**，動到的只有「多出來的功率」，
 * 也就是爬升與持續迴旋。下面的 `k` 就是同時乘在這兩項上的因子。
 */
import {
  maxLevelSpeed, maxClimbRate, serviceCeiling,
  cornerSpeed, bestSustainedTurnRate,
} from '../../src/analysis/envelope'
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109G6, BF109G6_HISTORICAL } from '../../src/specs/bf109g6'
import { HE111, HE111_HISTORICAL } from '../../src/specs/he111'
import { B17G, B17G_HISTORICAL } from '../../src/specs/b17g'
import { GAME_FEEL, applyFeel } from '../../src/specs/feel'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'

const KMH = 3.6
const n = (v: number, w: number, d = 1): string => v.toFixed(d).padStart(w)

const CASES: { spec: AircraftSpec; hist: HistoricalReference }[] = [
  { spec: P51D, hist: P51D_HISTORICAL },
  { spec: BF109G6, hist: BF109G6_HISTORICAL },
  { spec: HE111, hist: HE111_HISTORICAL },
  { spec: B17G, hist: B17G_HISTORICAL },
]

const scaled = (k: number) => ({
  ...GAME_FEEL, power: GAME_FEEL.power * k, cd0: GAME_FEEL.cd0 * k,
})

/** 解出讓「出貨爬升 ÷ 史實爬升」等於 target 的 k。 */
function solveK(spec: AircraftSpec, hist: HistoricalReference, target: number): number {
  let lo = 0.2
  let hi = 1.0
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2
    const r = maxClimbRate(applyFeel(spec, scaled(m)), 0).rate / hist.climbRateSeaLevel
    if (r < target) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

console.log('\n══ 出貨值（現在，四台共用同一組 GAME_FEEL）══════════════════')
console.log('  機種              極速   爬升   爬升倍   角落速度  持續迴旋  升限')
console.log('                   km/h    m/s    對史實     km/h      °/s      m')
for (const { spec, hist } of CASES) {
  const g = applyFeel(spec, GAME_FEEL)
  console.log(`  ${spec.name.padEnd(16)}${n(maxLevelSpeed(g, 0) * KMH, 6, 0)}`
    + `${n(maxClimbRate(g, 0).rate, 7, 1)}`
    + `${n(maxClimbRate(g, 0).rate / hist.climbRateSeaLevel, 8, 2)}×`
    + `${n(cornerSpeed(g, 3000) * KMH, 9, 0)}`
    + `${n((bestSustainedTurnRate(g, 3000) * 180) / Math.PI, 9, 1)}`
    + `${n(serviceCeiling(g), 8, 0)}`)
}

console.log('\n══ 把轟炸機的爬升倍數縮到與戰鬥機一樣的 1.89× ══════════════')
console.log('  （power 與 cd0 同乘 k，極速不動；動到的只有多出來的功率）\n')
console.log('  機種                 k    power   cd0    極速   爬升  角落速度 持續迴旋')
for (const { spec, hist } of CASES.slice(2)) {
  const k = solveK(spec, hist, 1.89)
  const f = scaled(k)
  const g = applyFeel(spec, f)
  console.log(`  ${spec.name.padEnd(16)}${n(k, 7, 3)}${n(f.power, 8, 3)}${n(f.cd0, 7, 3)}`
    + `${n(maxLevelSpeed(g, 0) * KMH, 7, 0)}`
    + `${n(maxClimbRate(g, 0).rate, 7, 1)}`
    + `${n(cornerSpeed(g, 3000) * KMH, 9, 0)}`
    + `${n((bestSustainedTurnRate(g, 3000) * 180) / Math.PI, 9, 1)}`)
}

console.log('\n══ 幾個中間值（兩台共用同一個 k，才會是「一組」而不是逐機調）══')
console.log('  k       He 111 爬升 / 倍數        B-17G 爬升 / 倍數')
for (const k of [1.0, 0.9, 0.8, 0.7, 0.65, 0.6]) {
  const g1 = applyFeel(HE111, scaled(k))
  const g2 = applyFeel(B17G, scaled(k))
  const c1 = maxClimbRate(g1, 0).rate
  const c2 = maxClimbRate(g2, 0).rate
  console.log(`  ${n(k, 4, 2)}   ${n(c1, 8, 1)} m/s`
    + `${n(c1 / HE111_HISTORICAL.climbRateSeaLevel, 8, 2)}×`
    + `      ${n(c2, 8, 1)} m/s${n(c2 / B17G_HISTORICAL.climbRateSeaLevel, 8, 2)}×`
    + `${k === 1 ? '   ← 現在（等於不另訂）' : ''}`)
}
console.log()
