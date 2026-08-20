/**
 * He 111 的史料重新對照 —— 舊的 `HE111_HISTORICAL` 混了兩種掛載狀態。
 *
 * 【查到的事】
 *   1. 升限 8,500 m 是**輕載**的值。同一段來源緊接著寫：掛滿彈時降到
 *      6,500 m。我們的 spec 模的是「掛滿彈的作戰重量」，該對的是 6,500。
 *   2. 6,000 m 435 km/h 同樣是輕載值。IL-2 的 H-6 資料表（standard
 *      weight 13,727 kg）給的是 5,000 m 405 km/h，而且 6,000 m 的爬升
 *      只剩 1.8 m/s —— 那台在 6,000 m 已經快到頂了，不可能再飛 435。
 *   3. Jumo 211F 的 **Nennhöhe 是 5,300 m**，不是 spec 填的 4,800。
 *
 * 【IL-2 資料表，13,727 kg】
 *   海平面 369（爬升檔）、2,000 m 398、5,000 m 405 km/h
 *   海爬 4.5、3,000 m 3.6、6,000 m 1.8 m/s
 *   升限 6,300 m、淨形失速 150…184 km/h
 *   Jumo 211F：起飛 1,340 PS；爬升檔 海平面 1,120、1,900 m 1,210、
 *              5,300 m 1,060 PS
 */
import { maxLevelSpeed, maxClimbRate, stallSpeed, serviceCeiling } from '../../src/analysis/envelope'
import { HE111 } from '../../src/specs/he111'
import type { AircraftSpec } from '../../src/specs/types'

const PS = 735.5
const KMH = 3.6
const REF = { v0: 369, v5: 405, ceil: 6300, climb: 4.5, stall: 150 }
const n = (v: number, w: number, d = 0): string => v.toFixed(d).padStart(w)
const pct = (a: number, b: number): string => {
  const p = ((a - b) / b) * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`.padStart(8)
}

function make(mass: number, cd0: number, alt: number): AircraftSpec {
  return {
    ...HE111,
    mass,
    drag: { ...HE111.drag, cd0 },
    engine: {
      ...HE111.engine,
      gears: [{ powerSeaLevel: 2680 * PS, powerCritical: 2120 * PS, altCritical: alt }],
    },
  }
}

function row(mass: number, cd0: number, alt: number): void {
  const s = make(mass, cd0, alt)
  console.log(`  ${n(mass, 7)}${n(cd0, 9, 4)}${n(alt, 7)}`
    + pct(maxLevelSpeed(s, 0) * KMH, REF.v0)
    + pct(maxLevelSpeed(s, 5000) * KMH, REF.v5)
    + pct(maxClimbRate(s, 0).rate, REF.climb)
    + pct(stallSpeed(s, 0, 1) * KMH, REF.stall)
    + pct(serviceCeiling(s), REF.ceil))
}

console.log('\n  對照基準：IL-2 He 111 H-6 資料表 @ 13,727 kg')
console.log('    海平面 369、5,000 m 405 km/h、海爬 4.5 m/s、淨形失速 150、升限 6,300 m\n')
console.log('    質量      cd0  臨界高  海平面   5000m    海爬    失速    升限')
console.log('  —— 現況（臨界 4,800、出貨質量）——————————————————')
row(12500, 0.0227, 4800)
console.log('  —— 只把臨界高度改成真機的 5,300 ——————————————————')
for (const c of [0.0227, 0.0215, 0.0206, 0.0200]) row(12500, c, 5300)
console.log('  —— 臨界 5,300 + 質量改成 IL-2 的 13,727 ————————————')
for (const c of [0.0227, 0.0215, 0.0206, 0.0200]) row(13727, c, 5300)
console.log()
