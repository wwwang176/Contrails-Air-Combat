/**
 * Ju 87 B-2 的參數掃描 —— 「只動本項、其餘為出貨值」。
 *
 * 跑法：`npx vite-node test/tools/ju87-tune.probe.ts`
 *
 * 【錨點是手冊的巡航點，不是二手的極速】Betriebsanleitung 給了**持續出力**
 * （1.10 ata、2,100 rpm：地面 800 PS、地面檔額定 900、高空檔額定 800）下的
 * 真空速：海平面 300、5 km 350 km/h。出力與速度同源，阻力由它定；二手的
 * 「4,100 m 380 km/h」「12 分鐘到 3,700 m」只當對照組。
 */
import {
  dragAt, maxClimbRate, maxLevelSpeed, serviceCeiling, stallSpeed,
} from '../../src/analysis/envelope'
import { enginePower } from '../../src/physics/propulsion'
import { atmosphere } from '../../src/physics/atmosphere'
import { derivedClMax } from '../../src/specs/types'
import { JU87 } from '../../src/specs/ju87'
import type { AircraftSpec } from '../../src/specs/types'
import type { AirData } from '../../src/physics/types'

const KMH = 3.6
const PS = 735.5
const air: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }

/** 持續出力：三個點照手冊（800／900／800 PS），高空檔的地面值照戰鬥出力等比 */
function cruise(s: AircraftSpec): AircraftSpec {
  const [bl, hl] = s.engine.gears
  return {
    ...s,
    engine: {
      ...s.engine,
      gears: [
        { ...bl!, powerSeaLevel: 800 * PS, powerCritical: 900 * PS },
        { ...hl!, powerSeaLevel: hl!.powerSeaLevel * 800 / 950, powerCritical: 800 * PS },
      ],
    },
  }
}

/** 到某高度的爬升時間（分），逐 100 m 積分 */
function timeTo(s: AircraftSpec, h: number): number {
  let t = 0
  for (let z = 0; z < h; z += 100) t += 100 / Math.max(maxClimbRate(s, z + 50).rate, 0.05)
  return t / 60
}

/** 1 g 下的最大升阻比 */
function ldMax(s: AircraftSpec): number {
  let best = 0
  for (let v = 30; v < 120; v += 0.5) {
    const d = dragAt(s, 0, v, 1)
    if (Number.isFinite(d) && d > 0) best = Math.max(best, (s.mass * 9.80665) / d)
  }
  return best
}

const p = (v: number, ref: number): string => {
  const e = (v / ref - 1) * 100
  return `${e >= 0 ? '+' : ''}${e.toFixed(1)}%`
}
const n = (v: number, w: number, d = 0): string => v.toFixed(d).padStart(w)

function row(label: string, s: AircraftSpec): void {
  const c = cruise(s)
  const c0 = maxLevelSpeed(c, 0) * KMH
  const c5 = maxLevelSpeed(c, 5000) * KMH
  const v41 = maxLevelSpeed(s, 4100) * KMH
  const v0 = maxLevelSpeed(s, 0) * KMH
  const cl = maxClimbRate(s, 0)
  const t37 = timeTo(s, 3700)
  const ce = serviceCeiling(s)
  console.log(
    `${label.padEnd(22)} 巡航 ${n(c0, 5, 1)} ${p(c0, 300).padStart(6)} ${n(c5, 5, 1)} ${p(c5, 350).padStart(6)}`
    + ` | 極速 4.1km ${n(v41, 5, 1)} ${p(v41, 380).padStart(6)} 海面 ${n(v0, 5, 1)}`
    + ` | 爬升 ${n(cl.rate * 60, 4)} m/min @${n(cl.speed * KMH, 4)} km/h  3.7km ${n(t37, 4, 1)} 分 ${p(t37, 12).padStart(6)}`
    + ` | 升限 ${n(ce, 5)} ${p(ce, 8200).padStart(6)} | L/D ${ldMax(s).toFixed(1)}`)
}

// ── 引擎：兩檔交點 ──
const alts = [0, 1000, 2000, 2550, 3000, 3500, 4000, 5000, 5400, 6000, 7000, 8000]
console.log('戰鬥出力 PS（ram 不計）：')
for (const h of alts) {
  atmosphere(h, air)
  const gears = JU87.engine.gears.map((g) => enginePower({ ...JU87, engine: { ...JU87.engine, gears: [g] } }, air, 0, 1.1) / PS)
  console.log(`  ${String(h).padStart(5)} m  地面檔 ${gears[0]!.toFixed(0).padStart(5)}  高空檔 ${gears[1]!.toFixed(0).padStart(5)}`)
}
console.log(`失速（乾淨、無動力、海平面）${(stallSpeed(JU87, 0, 1) * KMH).toFixed(1)} km/h；推導 CL_max ${derivedClMax(JU87, false).toFixed(3)}`)
console.log('')

row('出貨值', JU87)
console.log('\n── cd0 ──')
for (const cd0 of [0.026, 0.028, 0.030, 0.032, 0.034, 0.036]) {
  row(`cd0 ${cd0.toFixed(3)}`, { ...JU87, drag: { ...JU87.drag, cd0 } })
}
console.log('\n── oswald ──')
for (const oswald of [0.65, 0.70, 0.75, 0.80]) {
  row(`oswald ${oswald.toFixed(2)}`, { ...JU87, wing: { ...JU87.wing, oswald } })
}
console.log('\n── etaMax ──')
for (const etaMax of [0.78, 0.80, 0.82, 0.84]) {
  row(`etaMax ${etaMax.toFixed(2)}`, { ...JU87, prop: { ...JU87.prop, etaMax } })
}

// ── 對照組：換重量，其餘不動 ──
// 手冊的第二個升限 9,300 m 是「不帶彈、平均重量」：4,390 − 500 彈 − 185 半油 ≈ 3,705 kg。
// 同一組係數在那個重量下若自己對上 9,300，阻力極線就有了第二個獨立的證人。
console.log('\n── 對照組：重量（其餘出貨值）──')
for (const mass of [4390, 3890, 3705]) {
  const s = { ...JU87, mass }
  const ce = serviceCeiling(s)
  console.log(`  ${mass} kg  升限 ${ce.toFixed(0)}（對 9,300 ${p(ce, 9300)}；對 8,200 ${p(ce, 8200)}）`
    + `  極速 4.1km ${(maxLevelSpeed(s, 4100) * KMH).toFixed(1)}  到 3.7km ${timeTo(s, 3700).toFixed(1)} 分`)
}
