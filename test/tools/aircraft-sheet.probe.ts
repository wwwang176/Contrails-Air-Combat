/**
 * 兩台飛機的完整性能表（出貨中的 `GAME_FEEL`）。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/aircraft-sheet.probe.ts
 *
 * 【印的是玩家實際飛到的那台】套過 `GAME_FEEL`，過載上限用 `spec.limits.gPositive`
 * ——2026-08-11 拿掉飛行員硬夾之後，那就是真正夾住飛機的值。
 */
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { GAME_FEEL, applyFeel } from '../../src/specs/feel'
import {
  instantaneousTurnRate, sustainedTurnRate, bestSustainedTurnRate,
  stallSpeed, maxClimbRate, maxLevelSpeed, serviceCeiling, maxRollRate,
} from '../../src/analysis/envelope'
import { derivedClMax, type AircraftSpec } from '../../src/specs/types'
import { G0 } from '../../src/core/math'

const KMH = 3.6
const DEG = 180 / Math.PI

function minInst(s: AircraftSpec, alt: number): [number, number] {
  let best = Infinity
  let bv = 0
  for (let v = 40; v <= 320; v += 0.5) {
    const w = instantaneousTurnRate(s, alt, v)
    if (w > 1e-6 && v / w < best) { best = v / w; bv = v }
  }
  return [best, bv]
}
function bestSust(s: AircraftSpec, alt: number): [number, number, number] {
  const w = bestSustainedTurnRate(s, alt)
  if (!(w > 1e-6)) return [Infinity, 0, 0]
  let bv = 0
  let bd = Infinity
  for (let v = 40; v <= 250; v += 0.25) {
    const d = Math.abs(sustainedTurnRate(s, alt, v) - w)
    if (d < bd) { bd = d; bv = v }
  }
  return [bv / w, w, bv]
}

const P = applyFeel(P51D, GAME_FEEL)
const B = applyFeel(BF109K4, GAME_FEEL)

const row = (label: string, f: (s: AircraftSpec) => string) => {
  console.log(`${label.padEnd(24)}${f(P).padStart(16)}${f(B).padStart(16)}`)
}

console.log(`GAME_FEEL = ${JSON.stringify(GAME_FEEL)}\n`)
console.log(`${''.padEnd(24)}${'P-51D'.padStart(16)}${'Bf 109'.padStart(16)}`)
console.log('─'.repeat(56))
console.log('【機體】')
row('戰鬥重量 kg', (s) => s.mass.toFixed(0))
row('翼面積 m²', (s) => s.wing.area.toFixed(2))
row('翼負荷 kg/m²', (s) => (s.mass / s.wing.area).toFixed(1))
row('CLmax', (s) => derivedClMax(s, false).toFixed(3))
row('過載上限 G', (s) => s.limits.gPositive.toFixed(1))

for (const alt of [0, 4000]) {
  console.log(`\n【${alt} m】`)
  row('失速 km/h', (s) => (stallSpeed(s, alt, 1) * KMH).toFixed(0))
  row('角落速度 km/h', (s) => (stallSpeed(s, alt, s.limits.gPositive) * KMH).toFixed(0))
  row('最小瞬時半徑 m', (s) => `${minInst(s, alt)[0].toFixed(0)} @${(minInst(s, alt)[1] * KMH).toFixed(0)}`)
  row('最大瞬時轉彎率 °/s', (s) => {
    let best = 0
    for (let v = 40; v <= 320; v += 0.5) best = Math.max(best, instantaneousTurnRate(s, alt, v))
    return (best * DEG).toFixed(1)
  })
  row('最佳持續轉彎 °/s', (s) => {
    const [, w, v] = bestSust(s, alt)
    return `${(w * DEG).toFixed(1)} @${(v * KMH).toFixed(0)}`
  })
  row('最小持續半徑 m', (s) => bestSust(s, alt)[0].toFixed(0))
  row('平飛極速 km/h', (s) => (maxLevelSpeed(s, alt) * KMH).toFixed(0))
  row('最佳爬升 m/min', (s) => (maxClimbRate(s, alt).rate * 60).toFixed(0))
  row('滾轉率 @400km/h °/s', (s) => (maxRollRate(s, alt, 400 / KMH) * DEG).toFixed(0))
}

console.log('\n【升限】')
row('實用升限 m', (s) => serviceCeiling(s).toFixed(0))

console.log('\n【對打時誰佔便宜（Bf109 ÷ P-51，>1 = 109 較優）】')
const ratio = (name: string, f: (s: AircraftSpec) => number, higherIsBetter: boolean) => {
  const r = f(B) / f(P)
  const adv = higherIsBetter ? r : 1 / r
  console.log(`${name.padEnd(24)}${r.toFixed(3).padStart(10)}   `
    + `${adv > 1.02 ? '109 優' : adv < 0.98 ? 'P-51 優' : '打平'}`)
}
ratio('最小瞬時半徑 @4000', (s) => minInst(s, 4000)[0], false)
ratio('最佳持續轉彎率 @4000', (s) => bestSustainedTurnRate(s, 4000), true)
ratio('海平面爬升', (s) => maxClimbRate(s, 0).rate, true)
ratio('4000 m 極速', (s) => maxLevelSpeed(s, 4000), true)
ratio('滾轉率 @400km/h SL', (s) => maxRollRate(s, 0, 400 / KMH), true)
ratio('實用升限', (s) => serviceCeiling(s), true)

console.log('\n【4000 m、20°/s 轉彎時的掉速率 km/h/s（正 = 還在加速）】')
for (const [name, s] of [['P-51D', P], ['Bf 109', B]] as [string, AircraftSpec][]) {
  const cells = [350, 450, 550].map((kmh) => {
    const v = kmh / KMH
    const n = Math.sqrt(1 + ((20 / DEG * v) / G0) ** 2)
    const w = sustainedTurnRate(s, 4000, v)
    // 用持續轉彎率反推：能持續的轉彎率高於 20°/s 就代表 20°/s 還有餘裕
    return `${(w * DEG).toFixed(1)}°/s可持續${w * DEG >= 20 ? '（20°/s 不掉速）' : '（20°/s 會掉速）'} n=${n.toFixed(1)}`
  })
  console.log(`  ${name}`)
  ;[350, 450, 550].forEach((kmh, i) => console.log(`    ${kmh} km/h  ${cells[i]}`))
}
