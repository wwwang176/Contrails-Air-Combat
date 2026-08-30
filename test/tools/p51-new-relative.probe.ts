/** 修正質量／出力之後，L3 平衡關係的新數字。只量。 */
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import {
  instantaneousTurnRate, maxLevelSpeed, specificExcessPower, sustainedTurnRate,
} from '../../src/analysis/envelope'
const KMH = 1 / 3.6
const DEG = 180 / Math.PI
console.log('── 極速差 P−K（km/h）──')
for (const h of [0, 3000, 5000, 6000, 7000, 8000, 9000, 10000]) {
  console.log(`  ${String(h).padStart(6)} m  `
    + ((maxLevelSpeed(P51D, h) - maxLevelSpeed(BF109K4, h)) * 3.6).toFixed(1).padStart(7))
}
console.log('── 持續轉彎率 °/s（海平面）──')
for (const v of [200, 230, 250, 270, 300, 350, 400, 500]) {
  const p = sustainedTurnRate(P51D, 0, v * KMH) * DEG
  const b = sustainedTurnRate(BF109K4, 0, v * KMH) * DEG
  console.log(`  ${String(v).padStart(4)} km/h  P ${p.toFixed(2).padStart(6)}  K ${b.toFixed(2).padStart(6)}`
    + `  P−K ${(p - b).toFixed(2).padStart(6)}`)
}
console.log('── 瞬間轉彎率 °/s（海平面）──')
for (const v of [200, 250, 300, 400, 500, 600]) {
  const p = instantaneousTurnRate(P51D, 0, v * KMH) * DEG
  const b = instantaneousTurnRate(BF109K4, 0, v * KMH) * DEG
  console.log(`  ${String(v).padStart(4)} km/h  P ${p.toFixed(2).padStart(6)}  K ${b.toFixed(2).padStart(6)}`
    + `  P/K ${(p / b).toFixed(3)}`)
}
console.log('── Ps 4G @3,000 m（m/s）──')
for (const v of [400, 450, 500, 550, 600, 650, 700]) {
  const p = specificExcessPower(P51D, 3000, v * KMH, 4)
  const b = specificExcessPower(BF109K4, 3000, v * KMH, 4)
  console.log(`  ${String(v).padStart(4)} km/h  P ${p.toFixed(2).padStart(7)}  K ${b.toFixed(2).padStart(7)}`
    + `  P−K ${(p - b).toFixed(2).padStart(7)}`)
}
console.log('── Ps 1G @5,000 m 交叉（K−P，變號處即交叉點）──')
for (const v of [500, 550, 600, 650, 700, 750, 800, 850]) {
  const d = specificExcessPower(BF109K4, 5000, v * KMH, 1) - specificExcessPower(P51D, 5000, v * KMH, 1)
  console.log(`  ${String(v).padStart(4)} km/h  K−P ${d.toFixed(2).padStart(7)}`)
}
console.log('── Ps 5G @3,000 m、450 km/h（都要 < −20）──')
console.log(`  P ${specificExcessPower(P51D, 3000, 450 * KMH, 5).toFixed(1)}`
  + `  K ${specificExcessPower(BF109K4, 3000, 450 * KMH, 5).toFixed(1)}`)

console.log('── 持續轉彎高速端（找交叉點）──')
for (const v of [500, 550, 600, 650, 700, 750, 800]) {
  const p = sustainedTurnRate(P51D, 0, v * KMH) * DEG
  const b = sustainedTurnRate(BF109K4, 0, v * KMH) * DEG
  console.log(`  ${String(v).padStart(4)} km/h  P ${p.toFixed(2).padStart(6)}  K ${b.toFixed(2).padStart(6)}  P−K ${(p - b).toFixed(2).padStart(6)}`)
}
console.log('── 縫翼反事實：把 K-4 的 slatAlphaBonus 歸零，瞬間轉彎比 P/K ──')
const noSlat = { ...BF109K4, lift: { ...BF109K4.lift, slatAlphaBonus: 0 } }
for (const v of [200, 250, 300, 400]) {
  const p = instantaneousTurnRate(P51D, 0, v * KMH) * DEG
  const b0 = instantaneousTurnRate(BF109K4, 0, v * KMH) * DEG
  const b1 = instantaneousTurnRate(noSlat, 0, v * KMH) * DEG
  console.log(`  ${String(v).padStart(4)} km/h  有縫翼 ${(p / b0).toFixed(3)}   無縫翼 ${(p / b1).toFixed(3)}`)
}
console.log('── Ps 4G @3,000 m 的交叉點附近 ──')
for (const v of [540, 560, 570, 580, 600]) {
  const d = specificExcessPower(P51D, 3000, v * KMH, 4) - specificExcessPower(BF109K4, 3000, v * KMH, 4)
  console.log(`  ${String(v).padStart(4)} km/h  P−K ${d.toFixed(2).padStart(6)}`)
}

console.log('── 瞬間轉彎交叉點（P/K 過 1）──')
for (const v of [420, 440, 450, 460, 470, 480, 500]) {
  const r = instantaneousTurnRate(P51D, 0, v * KMH) / instantaneousTurnRate(BF109K4, 0, v * KMH)
  console.log(`  ${String(v).padStart(4)} km/h  P/K ${r.toFixed(4)}`)
}
console.log('── 持續轉彎 K/P 比（要有界）──')
for (const v of [200, 250, 300, 400, 500, 550]) {
  const r = sustainedTurnRate(BF109K4, 0, v * KMH) / sustainedTurnRate(P51D, 0, v * KMH)
  console.log(`  ${String(v).padStart(4)} km/h  K/P ${r.toFixed(4)}`)
}
console.log('── 1G Ps @3,000 m（存在 P-51 佔優區間？）──')
for (const v of [500, 550, 600, 650, 700]) {
  const p = specificExcessPower(P51D, 3000, v * KMH, 1)
  const b = specificExcessPower(BF109K4, 3000, v * KMH, 1)
  console.log(`  ${String(v).padStart(4)} km/h  P ${p.toFixed(2).padStart(7)}  K ${b.toFixed(2).padStart(7)}  P−K ${(p - b).toFixed(2).padStart(6)}`)
}
console.log('── 升限 ──')
