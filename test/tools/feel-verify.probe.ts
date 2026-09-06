/**
 * 出貨中的 `GAME_FEEL` 到底長什麼樣。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/feel-verify.probe.ts
 *
 * 【為什麼需要它】其他探針都是「在 GAME_FEEL 之上再乘一層」，所以它們的
 * 「基準」會隨出貨值漂移。這一支只印**出貨值本身**的絕對數字，用來對照
 * 改動前後有沒有守住該守住的東西（爬升、極速）。
 *
 * 【對照基準】mass/power/cd0 那一組改動之前，P-51D 的值是：
 *   海平面爬升 1999 m/min、SL 極速 584 km/h、4000 m 極速 700 km/h、
 *   升限 15379 m、最小瞬時 R@4000 250 m、失速 SL 145 km/h。
 */
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { GAME_FEEL, applyFeel } from '../../src/specs/feel'
import {
  instantaneousTurnRate, sustainedTurnRate, bestSustainedTurnRate,
  stallSpeed, maxClimbRate, maxLevelSpeed, serviceCeiling,
} from '../../src/analysis/envelope'
import { derivedClMax, type AircraftSpec } from '../../src/specs/types'

const KMH = 3.6

function minInst(s: AircraftSpec, alt: number): number {
  let best = Infinity
  for (let v = 40; v <= 320; v += 0.5) {
    const w = instantaneousTurnRate(s, alt, v)
    if (w > 1e-6) best = Math.min(best, v / w)
  }
  return best
}
function minSust(s: AircraftSpec, alt: number): number {
  const w = bestSustainedTurnRate(s, alt)
  if (!(w > 1e-6)) return Infinity
  let bv = 0
  let bd = Infinity
  for (let v = 40; v <= 250; v += 0.25) {
    const d = Math.abs(sustainedTurnRate(s, alt, v) - w)
    if (d < bd) { bd = d; bv = v }
  }
  return bv / w
}

console.log('出貨中的 GAME_FEEL：', JSON.stringify(GAME_FEEL))
console.log('\n【改動前的 P-51D 基準】爬升 1999、SL極速 584、4k極速 700、升限 15379、'
  + '最小瞬時R@4k 250、失速SL 145\n')

for (const raw of [P51D, BF109K4]) {
  const s = applyFeel(raw, GAME_FEEL)
  console.log(`=== ${raw.name} ===`)
  console.log(`  CLmax            ${derivedClMax(s, false).toFixed(3)}`)
  console.log(`  失速 SL / 4000m  ${(stallSpeed(s, 0, 1) * KMH).toFixed(0)} / ${(stallSpeed(s, 4000, 1) * KMH).toFixed(0)} km/h`)
  console.log(`  真角落速度 @4000 ${(stallSpeed(s, 4000, s.limits.gPositive) * KMH).toFixed(0)} km/h  （過載上限 ${s.limits.gPositive} G）`)
  console.log(`  最小瞬時 R @4000 ${minInst(s, 4000).toFixed(0)} m`)
  console.log(`  最佳持續 R @4000 ${minSust(s, 4000).toFixed(0)} m`)
  console.log(`  海平面爬升        ${(maxClimbRate(s, 0).rate * 60).toFixed(0)} m/min`)
  console.log(`  極速 SL / 4000m  ${(maxLevelSpeed(s, 0) * KMH).toFixed(0)} / ${(maxLevelSpeed(s, 4000) * KMH).toFixed(0)} km/h`)
  console.log(`  實用升限          ${serviceCeiling(s).toFixed(0)} m`)
  console.log()
}

// ── 爬升率是不是「全高度」都守住，還是只有海平面 ──────────────
/** 改動前的出貨值，用來逐點對照 */
const BEFORE = { roll: 1.2, oswald: 2, power: 1.98, lift: 1.3, cd0: 2.06, mass: 1 }

console.log('=== 爬升率逐高度對照（改動前 vs 現在）===')
for (const raw of [P51D, BF109K4]) {
  console.log(`
${raw.name}`)
  console.log('  高度      改動前      現在      差')
  for (const alt of [0, 2000, 4000, 6000, 8000, 10000]) {
    const a = maxClimbRate(applyFeel(raw, BEFORE), alt).rate * 60
    const b = maxClimbRate(applyFeel(raw, GAME_FEEL), alt).rate * 60
    console.log(`  ${String(alt).padStart(5)} m  ${a.toFixed(0).padStart(8)}  ${b.toFixed(0).padStart(8)}`
      + `  ${((b / a - 1) * 100).toFixed(1).padStart(6)}%`)
  }
  const ca = serviceCeiling(applyFeel(raw, BEFORE))
  const cb = serviceCeiling(applyFeel(raw, GAME_FEEL))
  console.log(`  升限     ${ca.toFixed(0).padStart(8)}  ${cb.toFixed(0).padStart(8)}  ${((cb / ca - 1) * 100).toFixed(1).padStart(6)}%`)
}
