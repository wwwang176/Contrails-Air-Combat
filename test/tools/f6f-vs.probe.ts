/**
 * F6F-5 對 P-51D 與 Bf 109 K-4 的性能對照。不是測試，**不斷言任何事**。
 *
 * 跑法：`npx vite-node test/tools/f6f-vs.probe.ts`
 *
 * 【為什麼要這一支】`historical.test.ts` 守的是「每一台各自對得起真機」，
 * 但玩家感受到的是**三台之間的相對關係**。史實對得上不代表對局合理 ——
 * 這一支印出遊戲層（套 GAME_FEEL，也就是玩家實際飛的那台）的並排數字。
 */
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109K4, BF109K4_HISTORICAL } from '../../src/specs/bf109k4'
import { F6F5, F6F5_HISTORICAL } from '../../src/specs/f6f5'
import { applyFeel, feelFor } from '../../src/specs/feel'
import {
  bestSustainedTurnRate, maxClimbRate, maxLevelSpeed, maxRollRate, serviceCeiling, stallSpeed,
} from '../../src/analysis/envelope'
import { derivedClMax, type AircraftSpec, type HistoricalReference } from '../../src/specs/types'

const KMH = 3.6
const DEGPS = 180 / Math.PI
const n = (v: number, w: number, d = 0): string => v.toFixed(d).padStart(w)

const SPECS = [P51D, F6F5, BF109K4]

function table(label: string, of: (s: AircraftSpec) => AircraftSpec): void {
  const list = SPECS.map(of)
  console.log(`\n══ ${label} ══════════════════════════════════════`)
  console.log('                       ' + SPECS.map((s) => s.name.padStart(16)).join(''))
  const row = (name: string, f: (s: AircraftSpec) => string): void =>
    console.log(name.padEnd(23) + list.map((s) => f(s).padStart(16)).join(''))

  row('翼負荷 kg/m²', (s) => n(s.mass / s.wing.area, 6, 1))
  row('功率負荷 W/kg', (s) => n(s.engine.gears[0]!.powerSeaLevel / s.mass, 6, 0))
  for (const h of [0, 3000, 6000]) {
    row(`極速 ${h} m  km/h`, (s) => n(maxLevelSpeed(s, h) * KMH, 6, 0))
  }
  for (const h of [0, 3000, 6000]) {
    row(`爬升 ${h} m  m/min`, (s) => n(maxClimbRate(s, h).rate * 60, 6, 0))
  }
  row('實用升限 m', (s) => n(serviceCeiling(s), 6, 0))
  row('失速 km/h', (s) => n(stallSpeed(s, 0, 1) * KMH, 6, 1))
  for (const h of [0, 4000]) {
    row(`持續迴旋 ${h} m °/s`, (s) => n(bestSustainedTurnRate(s, h) * DEGPS, 6, 2))
  }
  for (const v of [300, 450, 600]) {
    row(`滾轉 ${v} km/h °/s`, (s) => n(maxRollRate(s, 0, v / KMH) * DEGPS, 6, 1))
  }
}

table('史實層（specs/*.ts 未經包裝）', (s) => s)
table('遊戲層（套 GAME_FEEL）', (s) => applyFeel(s, feelFor(s)))


// ══ 史實 vs 模型：逐項偏差 ═══════════════════════════════════
const HIST: HistoricalReference[] = [P51D_HISTORICAL, F6F5_HISTORICAL, BF109K4_HISTORICAL]
console.log('\n══ 史實 vs 模型（史實層，未套 GAME_FEEL）══════════════')
console.log('                     ' + SPECS.map((x) => x.name.padStart(23)).join(''))
function cmp(
  name: string, hf: (h: HistoricalReference) => number,
  mf: (s: AircraftSpec, i: number) => number, d = 0,
): void {
  const cells = SPECS.map((sp, i) => {
    const h = hf(HIST[i]!)
    const m = mf(sp, i)
    const e = (m / h - 1) * 100
    return `${m.toFixed(d)} / ${h.toFixed(d)}  ${(e >= 0 ? '+' : '') + e.toFixed(1)}%`.padStart(23)
  })
  console.log(name.padEnd(21) + cells.join(''))
}
cmp('臨界高度極速 km/h', (h) => h.vmaxAtCritical.speed * KMH,
  (sp, i) => maxLevelSpeed(sp, HIST[i]!.vmaxAtCritical.altitude) * KMH)
cmp('海平面極速 km/h', (h) => h.vmaxSeaLevel * KMH, (sp) => maxLevelSpeed(sp, 0) * KMH)
cmp('海平面爬升 m/min', (h) => h.climbRateSeaLevel * 60, (sp) => maxClimbRate(sp, 0).rate * 60)
cmp('實用升限 m', (h) => h.serviceCeiling, (sp) => serviceCeiling(sp))
cmp('失速 km/h', (h) => h.stallSpeed * KMH, (sp) => stallSpeed(sp, 0, 1) * KMH, 1)
cmp('CL_max', (h) => h.clMax, (sp) => derivedClMax(sp, false), 3)
console.log('（臨界高度各自不同：P-51D 7,600 m、F6F-5 7,041 m、K-4 7,500 m）')

// ══ 對照：P-51D 若用它的**真實**戰鬥重量 4,300 kg ═══════════════
// （出貨的 3,900 kg 是為了讓爬升／升限對上史實而校準出來的，見 specs/p51d.ts）
const P51_REAL: AircraftSpec = { ...P51D, mass: 4300 }
console.log('\n══ 持續迴旋：P-51D 的質量校準把它推到哪裡 ══════════════')
for (const h of [0, 4000]) {
  const f = (s: AircraftSpec): string => (bestSustainedTurnRate(s, h) * DEGPS).toFixed(2).padStart(8)
  console.log(`  ${String(h).padStart(5)} m   F6F-5 ${f(F6F5)}   P-51D 出貨 3,900kg ${f(P51D)}`
    + `   P-51D 真實 4,300kg ${f(P51_REAL)}   K-4 ${f(BF109K4)}`)
}
console.log(`  翼負荷 kg/m²  F6F-5 ${(F6F5.mass / F6F5.wing.area).toFixed(1)}`
  + `   P-51D 出貨 ${(P51D.mass / P51D.wing.area).toFixed(1)}`
  + `   P-51D 真實 ${(4300 / P51D.wing.area).toFixed(1)}`
  + `   K-4 ${(BF109K4.mass / BF109K4.wing.area).toFixed(1)}`)
