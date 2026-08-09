/**
 * P-51D 與 Bf 109 的性能對照表。不是測試（`.probe.ts`）。
 *
 * 跑法：`npx vite-node test/tools/aircraft-compare.probe.ts`
 *
 * 【為什麼要一支探針而不是抄註解】`specs/*.ts` 的註解記的是**調參當下**的
 * 值，而升限、爬升率、迴旋率全是由 `analysis/envelope.ts` 從空氣動力係數
 * 實算出來的。任何一次調參都可能讓註解與現況分家 —— 這支永遠問現在的程式。
 */
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109G6, BF109G6_HISTORICAL } from '../../src/specs/bf109g6'
import { batteryDps } from '../../src/weapons/types'
import {
  bestSustainedTurnRate, cornerSpeed, instantaneousTurnRate, maxClimbRate,
  maxLevelSpeed, maxRollRate, serviceCeiling, stallSpeed,
} from '../../src/analysis/envelope'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'

const MS_KMH = 3.6
const RAD = 180 / Math.PI
/** 遊戲的預設交戰高度（`DEFAULT_BATTLE.altitude`） */
const ALT = 4000

interface Row {
  label: string
  /** 兩機的值 */
  p: number
  b: number
  unit: string
  digits: number
  /**
   * true = 數字大的比較強；false = 小的比較強；null = **不可比**。
   *
   * 【為什麼要有 null】匯聚距離就是一個：109 的武裝全在中軸線上，匯聚對它
   * 根本沒有意義（`weapons/bf109g6.ts`）。硬標一個贏家會讀成一項優勢。
   */
  higherIsBetter: boolean | null
}

const rows: Row[] = []
function add(
  label: string, p: number, b: number, unit: string, digits: number,
  higherIsBetter: boolean | null,
): void {
  rows.push({ label, p, b, unit, digits, higherIsBetter })
}

function turnAtCorner(s: AircraftSpec): number {
  return instantaneousTurnRate(s, ALT, cornerSpeed(s, ALT)) * RAD
}

// ── 重量與尺寸 ────────────────────────────────────────
add('空重（模型質量）', P51D.mass, BF109G6.mass, 'kg', 0, false)
add('翼面積', P51D.wing.area, BF109G6.wing.area, 'm²', 2, true)
add('翼展', P51D.wing.span, BF109G6.wing.span, 'm', 2, true)
add('翼負荷', P51D.mass / P51D.wing.area, BF109G6.mass / BF109G6.wing.area, 'kg/m²', 1, false)

// ── 直線性能 ──────────────────────────────────────────
add('海平面極速', maxLevelSpeed(P51D, 0) * MS_KMH, maxLevelSpeed(BF109G6, 0) * MS_KMH, 'km/h', 0, true)
add(`${ALT} m 極速`, maxLevelSpeed(P51D, ALT) * MS_KMH, maxLevelSpeed(BF109G6, ALT) * MS_KMH, 'km/h', 0, true)
add('7,000 m 極速', maxLevelSpeed(P51D, 7000) * MS_KMH, maxLevelSpeed(BF109G6, 7000) * MS_KMH, 'km/h', 0, true)
add('海平面爬升率', maxClimbRate(P51D, 0).rate * 60, maxClimbRate(BF109G6, 0).rate * 60, 'm/min', 0, true)
add(`${ALT} m 爬升率`, maxClimbRate(P51D, ALT).rate * 60, maxClimbRate(BF109G6, ALT).rate * 60, 'm/min', 0, true)
add('實用升限', serviceCeiling(P51D), serviceCeiling(BF109G6), 'm', 0, true)

// ── 機動 ──────────────────────────────────────────────
add('失速速度（海平面 1 G）', stallSpeed(P51D, 0, 1) * MS_KMH, stallSpeed(BF109G6, 0, 1) * MS_KMH, 'km/h', 0, false)
add(`角速（${ALT} m）`, cornerSpeed(P51D, ALT) * MS_KMH, cornerSpeed(BF109G6, ALT) * MS_KMH, 'km/h', 0, false)
add(`瞬時迴旋率（${ALT} m、角速）`, turnAtCorner(P51D), turnAtCorner(BF109G6), '°/s', 1, true)
add(`持續迴旋率（${ALT} m）`, bestSustainedTurnRate(P51D, ALT) * RAD, bestSustainedTurnRate(BF109G6, ALT) * RAD, '°/s', 2, true)
add('滾轉率 @ 400 km/h', maxRollRate(P51D, ALT, 400 / MS_KMH) * RAD, maxRollRate(BF109G6, ALT, 400 / MS_KMH) * RAD, '°/s', 0, true)
add('滾轉率 @ 650 km/h', maxRollRate(P51D, ALT, 650 / MS_KMH) * RAD, maxRollRate(BF109G6, ALT, 650 / MS_KMH) * RAD, '°/s', 0, true)
add('結構 G 限（正）', P51D.limits.gPositive, BF109G6.limits.gPositive, 'G', 1, true)
add('不可超越速度 VNE', P51D.limits.vne * MS_KMH, BF109G6.limits.vne * MS_KMH, 'km/h', 0, true)
add('零升阻力係數 cd0', P51D.drag.cd0, BF109G6.drag.cd0, '', 4, false)

// ── 火力 ──────────────────────────────────────────────
add('火力 DPS', batteryDps(P51D.battery), batteryDps(BF109G6.battery), '傷害/s', 1, true)
add('槍口初速（瞄準用那挺）', P51D.battery.sight.muzzleVelocity, BF109G6.battery.sight.muzzleVelocity, 'm/s', 0, true)
add('匯聚距離（不可比，見下）', P51D.battery.convergence, BF109G6.battery.convergence, 'm', 0, null)
add('命中盒體積合計', boxVolume(P51D), boxVolume(BF109G6), 'm³', 1, false)

function boxVolume(s: AircraftSpec): number {
  let v = 0
  for (const b of s.hitBoxes) {
    v += 8 * b.half.x * b.half.y * b.half.z
  }
  return v
}

const W = 30
console.log(`=== ${P51D.name} vs ${BF109G6.name}（模型實算，交戰高度 ${ALT} m）===\n`)
console.log(`${'項目'.padEnd(W - 4)}${'P-51D'.padStart(12)}${'Bf 109'.padStart(12)}   誰佔優`)
console.log('─'.repeat(W + 34))
for (const r of rows) {
  const better = r.higherIsBetter === null ? '—'
    : r.higherIsBetter ? (r.p > r.b ? 'P-51' : r.p < r.b ? 'Bf 109' : '相同')
      : (r.p < r.b ? 'P-51' : r.p > r.b ? 'Bf 109' : '相同')
  const ratio = r.b !== 0 ? r.p / r.b : NaN
  console.log(
    `${r.label.padEnd(W - String(r.label).length + r.label.length - r.label.length + W - 4)}`
      .slice(0, W - 4).padEnd(W - 4)
    + `${r.p.toFixed(r.digits).padStart(12)}${r.b.toFixed(r.digits).padStart(12)}`
    + `   ${better.padEnd(7)}（P÷B = ${ratio.toFixed(2)}）`,
  )
}

console.log('\n=== 史實對照值（specs/*.ts 的 HistoricalReference）===')
const hp: HistoricalReference = P51D_HISTORICAL
const hb: HistoricalReference = BF109G6_HISTORICAL
console.log(`${'項目'.padEnd(W - 4)}${'P-51D'.padStart(12)}${'Bf 109'.padStart(12)}`)
console.log('─'.repeat(W + 20))
const hist: [string, number, number, number][] = [
  ['海平面極速 km/h', hp.vmaxSeaLevel * MS_KMH, hb.vmaxSeaLevel * MS_KMH, 0],
  ['臨界高度極速 km/h', hp.vmaxAtCritical.speed * MS_KMH, hb.vmaxAtCritical.speed * MS_KMH, 0],
  ['臨界高度 m', hp.vmaxAtCritical.altitude, hb.vmaxAtCritical.altitude, 0],
  ['海平面爬升率 m/min', hp.climbRateSeaLevel * 60, hb.climbRateSeaLevel * 60, 0],
  ['實用升限 m', hp.serviceCeiling, hb.serviceCeiling, 0],
  ['失速速度 km/h', hp.stallSpeed * MS_KMH, hb.stallSpeed * MS_KMH, 0],
  ['最大升力係數', hp.clMax, hb.clMax, 2],
]
for (const [label, a, b, d] of hist) {
  console.log(`${label.padEnd(W - 4)}${a.toFixed(d).padStart(12)}${b.toFixed(d).padStart(12)}`)
}
