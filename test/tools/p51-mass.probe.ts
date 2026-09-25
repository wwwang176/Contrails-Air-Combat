/**
 * 「P-51D 改回真實戰鬥重量 4,300 kg 會付出什麼代價」—— 只量，不改 spec。
 *
 * 跑法：`npx vite-node test/tools/p51-mass.probe.ts`
 *
 * 出貨的 3,900 kg 是校準值（見 `specs/p51d.ts` 的 `mass`）：史實的爬升／升限／
 * 失速三項各自反解都指向約 90% 的出貨重，而「重量玩家感受不到」，所以
 * 用載重狀態去換那三項。這支把「換回去」的帳算清楚 —— 史實驗收與兩機種
 * 相對性能的參考線各自會落在哪裡。
 */
import { P51D, P51D_HISTORICAL as HP } from '../../src/specs/p51d'
import { BF109K4, BF109K4_HISTORICAL as HB } from '../../src/specs/bf109k4'
import { F6F5 } from '../../src/specs/f6f5'
import {
  bestSustainedTurnRate, instantaneousTurnRate, maxClimbRate, maxLevelSpeed,
  serviceCeiling, specificExcessPower, stallSpeed, sustainedTurnRate,
} from '../../src/analysis/envelope'
import type { AircraftSpec } from '../../src/specs/types'

const KMH = 3.6
const DEGPS = 180 / Math.PI
const MASSES = [3900, 4000, 4100, 4200, 4300]
const at = (m: number): AircraftSpec => ({ ...P51D, mass: m })
const pad = (s: string, w: number): string => s.padStart(w)
const pc = (v: number, ref: number): string => {
  const e = (v / ref - 1) * 100
  return `${(e >= 0 ? '+' : '') + e.toFixed(1)}%`
}
const cells = (f: (s: AircraftSpec) => string): string =>
  MASSES.map((m) => pad(f(at(m)), 15)).join('')

console.log('══ P-51D 只動質量：史實五項（±5% 是 historical.test.ts 的門檻）══')
console.log('                 ' + MASSES.map((m) => pad(`${m} kg`, 15)).join(''))
const line = (name: string, f: (s: AircraftSpec) => number, ref: number, d = 0): void =>
  console.log(name.padEnd(17) + cells((s) => `${f(s).toFixed(d)} ${pc(f(s), ref)}`))
line('臨界高度極速', (s) => maxLevelSpeed(s, 7600) * KMH, HP.vmaxAtCritical.speed * KMH)
line('海平面極速', (s) => maxLevelSpeed(s, 0) * KMH, HP.vmaxSeaLevel * KMH)
line('海平面爬升', (s) => maxClimbRate(s, 0).rate * 60, HP.climbRateSeaLevel * 60)
line('實用升限', (s) => serviceCeiling(s), HP.serviceCeiling)
line('失速', (s) => stallSpeed(s, 0, 1) * KMH, HP.stallSpeed * KMH, 1)

console.log('\n══ 跨機種斷言 ══════════════════════════════════════')
// historical.test.ts：K-4 對 P-51D 的爬升優勢比值，史實 ±5%
const RATIO_HIST = (HB.climbRateSeaLevel * 60) / (HP.climbRateSeaLevel * 60)
console.log(`爬升比 K-4/P-51D（史實 ${RATIO_HIST.toFixed(4)}，門檻 ±5%）`)
console.log('                 ' + cells((s) => {
  const r = maxClimbRate(BF109K4, 0).rate / maxClimbRate(s, 0).rate
  return `${r.toFixed(3)} ${pc(r, RATIO_HIST)}`
}))

// P-51D 對 K-4 的相對性能：史實上誰佔優的方向，括號裡是參考線，不是測試門檻
console.log('\n9,000 m 對 K-4 的極速優勢（參考線 > 20 km/h）')
console.log('                 ' + cells((s) =>
  (maxLevelSpeed(s, 9000) * KMH - maxLevelSpeed(BF109K4, 9000) * KMH).toFixed(1)))
console.log('7,000 m 的差（參考線 < 0）')
console.log('                 ' + cells((s) =>
  (maxLevelSpeed(s, 7000) * KMH - maxLevelSpeed(BF109K4, 7000) * KMH).toFixed(1)))
console.log('8,000 m 的差（參考線 > 0）')
console.log('                 ' + cells((s) =>
  (maxLevelSpeed(s, 8000) * KMH - maxLevelSpeed(BF109K4, 8000) * KMH).toFixed(1)))
console.log(`升限差距（參考線 < 8%，K-4 ${serviceCeiling(BF109K4).toFixed(0)} m）`)
console.log('                 ' + cells((s) => {
  const p = serviceCeiling(s), b = serviceCeiling(BF109K4)
  return `${p.toFixed(0)} ${(Math.abs(p - b) / Math.min(p, b) * 100).toFixed(1)}%`
}))
console.log('K-4/P-51D 爬升比最大值（參考線 < 1.8，掃 0…9,000 m）')
console.log('                 ' + cells((s) => {
  let mx = 0
  for (let h = 0; h <= 9000; h += 1000) {
    mx = Math.max(mx, maxClimbRate(BF109K4, h).rate / maxClimbRate(s, h).rate)
  }
  return mx.toFixed(3)
}))
console.log('持續轉彎 250 km/h：P-51 − K-4 °/s（參考線 > 0）')
console.log('                 ' + cells((s) =>
  ((sustainedTurnRate(s, 0, 250 / KMH) - sustainedTurnRate(BF109K4, 0, 250 / KMH)) * DEGPS)
    .toFixed(3)))
console.log('持續轉彎 300 km/h：K-4 − P-51 °/s（參考線 > 0）')
console.log('                 ' + cells((s) =>
  ((sustainedTurnRate(BF109K4, 0, 300 / KMH) - sustainedTurnRate(s, 0, 300 / KMH)) * DEGPS)
    .toFixed(3)))
console.log('瞬間轉彎比 P-51/K-4 的最大值（參考線 > 1 且 < 1.10）')
console.log('                 ' + cells((s) => {
  let mn = Infinity, mx = 0
  for (let v = 300; v <= 700; v += 50) {
    const r = instantaneousTurnRate(s, 3000, v / KMH) / instantaneousTurnRate(BF109K4, 3000, v / KMH)
    mn = Math.min(mn, r); mx = Math.max(mx, r)
  }
  return `${mn.toFixed(3)}–${mx.toFixed(3)}`
}))
console.log('4G @3,000 m 的 Ps：P-51 − K-4（參考線 > 0，v = 500 km/h）')
console.log('                 ' + cells((s) =>
  (specificExcessPower(s, 3000, 500 / KMH, 4)
   - specificExcessPower(BF109K4, 3000, 500 / KMH, 4)).toFixed(1)))

console.log('\n══ 對 F6F-5 的關係（這才是問題的起點）══════════════════')
console.log('                 ' + MASSES.map((m) => pad(`${m} kg`, 15)).join(''))
console.log('翼負荷 kg/m²     ' + cells((s) => (s.mass / s.wing.area).toFixed(1))
  + `   F6F ${(F6F5.mass / F6F5.wing.area).toFixed(1)}`)
for (const h of [0, 4000]) {
  console.log(`持續迴旋 ${h} m °/s`.padEnd(17) + cells((s) => {
    const p = bestSustainedTurnRate(s, h) * DEGPS
    const f = bestSustainedTurnRate(F6F5, h) * DEGPS
    return `${p.toFixed(2)} ${pc(p, f)}`
  }) + `   F6F ${(bestSustainedTurnRate(F6F5, h) * DEGPS).toFixed(2)}`)
}

// ── 另一個方向：不動 P-51D，改讓 F6F 轉得好一點 ──────────────
// 持續轉彎是**推力受限**的，所以能動的是誘導阻力（oswald）與 cd0。
console.log('\n══ 反方向：只動 F6F 的 oswald / cd0，它的迴旋與五項驗收 ══')
console.log('                     迴旋0m   迴旋4000m |  臨界極速   海面極速   爬升    升限')
for (const [o, c] of [[0.80, 0.0195], [0.85, 0.0195], [0.88, 0.0195],
                      [0.85, 0.0200], [0.88, 0.0205]] as [number, number][]) {
  const s: AircraftSpec = {
    ...F6F5, wing: { ...F6F5.wing, oswald: o }, drag: { ...F6F5.drag, cd0: c },
  }
  const t0 = bestSustainedTurnRate(s, 0) * DEGPS
  const t4 = bestSustainedTurnRate(s, 4000) * DEGPS
  console.log(`oswald ${o} cd0 ${c.toFixed(4)}`.padEnd(21)
    + `${t0.toFixed(2).padStart(7)}${t4.toFixed(2).padStart(10)} | `
    + `${pc(maxLevelSpeed(s, 7041) * KMH, 629.3).padStart(8)}`
    + `${pc(maxLevelSpeed(s, 0) * KMH, 521.4).padStart(10)}`
    + `${pc(maxClimbRate(s, 0).rate * 60, 811).padStart(8)}`
    + `${pc(serviceCeiling(s), 11308).padStart(8)}`)
}
console.log(`（P-51D 出貨 3,900 kg 的迴旋是 ${(bestSustainedTurnRate(P51D, 0) * DEGPS).toFixed(2)}`
  + ` / ${(bestSustainedTurnRate(P51D, 4000) * DEGPS).toFixed(2)} °/s）`)
