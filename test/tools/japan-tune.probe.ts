/**
 * 三台日本機的參數掃描 —— 「只退回本項、其餘全為出貨值」。**不是測試。**
 *
 * 跑法：`npx vite-node test/tools/japan-tune.probe.ts`
 *
 * 【多印一欄「到 5,000 m 的秒數」】日方對 Ki-84 與 G4M 給的原生量是**時間**
 * 不是速率（5,000 m 5′54″、3,000 m 7′16″），`climbRateSeaLevel` 是換算來的。
 * 直接印秒數才對得上來源，不必經過那個換算。
 */
import {
  maxLevelSpeed, maxClimbRate, serviceCeiling, stallSpeed,
} from '../../src/analysis/envelope'
import { derivedClMax } from '../../src/specs/types'
import { KI84, KI84_HISTORICAL } from '../../src/specs/ki84'
import { A6M5, A6M5_HISTORICAL } from '../../src/specs/a6m5'
import { G4M, G4M_HISTORICAL } from '../../src/specs/g4m'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'

const KMH = 3.6
const p = (v: number, ref: number): string => {
  const e = (v / ref - 1) * 100
  return `${e >= 0 ? '+' : ''}${e.toFixed(1)}%`.padStart(7)
}
const n = (v: number, w: number, d = 0): string => v.toFixed(d).padStart(w)

/** 梯形積分 ∫dh/rate，爬到 top 的秒數。爬不上去回 Infinity。 */
function timeTo(spec: AircraftSpec, top: number): number {
  const step = 100
  let t = 0
  for (let h = 0; h < top; h += step) {
    const a = maxClimbRate(spec, h).rate
    const b = maxClimbRate(spec, h + step).rate
    if (a <= 0 || b <= 0) return Infinity
    t += (step * (1 / a + 1 / b)) / 2
  }
  return t
}

function row(label: string, s: AircraftSpec, h: HistoricalReference, climbTop: number,
  climbRef: number): void {
  const alt = h.vmaxAtCritical.altitude
  const vC = maxLevelSpeed(s, alt) * KMH
  const vS = maxLevelSpeed(s, 0) * KMH
  const cl = maxClimbRate(s, 0).rate * 60
  const ce = serviceCeiling(s)
  const st = stallSpeed(s, 0, 1) * KMH
  const tc = timeTo(s, climbTop)
  console.log(
    `${label.padEnd(22)} ${n(vC, 5, 1)}${p(vC, h.vmaxAtCritical.speed * KMH)}`
    + ` |${n(vS, 5, 1)}${p(vS, h.vmaxSeaLevel * KMH)}`
    + ` |${n(cl, 5, 0)}${p(cl, h.climbRateSeaLevel * 60)}`
    + ` |${n(ce, 6, 0)}${p(ce, h.serviceCeiling)}`
    + ` |${n(st, 5, 1)}${p(st, h.stallSpeed * KMH)}`
    + ` |${n(tc, 5, 0)}s${p(tc, climbRef)}`)
}

// ── Ki-84 ─────────────────────────────────────────────────────
{
  const H = KI84_HISTORICAL
  // 日方到 5,000 m：5′54″（3,794 kg）／5′37″（≈3,400）／6′26″（ハ45特）
  // 平均 359 秒。船橋那次按質量修到 3,600 kg 是 354 × 3600/3794 = 336 秒。
  const REF = 359
  console.log(`\n══ Ki-84 疾風 ══  史實 臨界 ${(H.vmaxAtCritical.speed * KMH).toFixed(0)}`
    + ` @${H.vmaxAtCritical.altitude}m、海面 ${(H.vmaxSeaLevel * KMH).toFixed(0)}`
    + `、爬升 ${(H.climbRateSeaLevel * 60).toFixed(0)} m/min、升限 ${H.serviceCeiling}`
    + `、失速 ${(H.stallSpeed * KMH).toFixed(1)}、到 5,000 m ${REF} 秒`)
  console.log(`模型 clMax ${derivedClMax(KI84, false).toFixed(3)}  史實 ${H.clMax.toFixed(3)}`)
  console.log(''.padEnd(22) + ' 臨界極速       | 海面極速      | 爬升         '
    + '| 升限          | 失速         | 到 5,000 m')
  row('出貨', KI84, H, 5000, REF)
  for (const vRef of [50, 55, 60, 65, 70]) {
    row(`vRef ${vRef}`, { ...KI84, prop: { ...KI84.prop, vRef } }, H, 5000, REF)
  }
  for (const cd0 of [0.024, 0.026, 0.028, 0.030]) {
    row(`cd0 ${cd0}`, { ...KI84, drag: { ...KI84.drag, cd0 } }, H, 5000, REF)
  }
  for (const etaMax of [0.80, 0.82, 0.85, 0.88]) {
    row(`etaMax ${etaMax}`, { ...KI84, prop: { ...KI84.prop, etaMax } }, H, 5000, REF)
  }
  for (const fom of [0.5, 0.65, 0.8]) {
    row(`figureOfMerit ${fom}`, { ...KI84, prop: { ...KI84.prop, figureOfMerit: fom } }, H, 5000, REF)
  }
  // 一速的海平面出力沒有直接來源（見 specs/ki84.ts），掃一遍
  const PS = 735.5
  for (const sl of [1800, 1900, 2000]) {
    const g = [{ ...KI84.engine.gears[0]!, powerSeaLevel: sl * PS }, KI84.engine.gears[1]!]
    row(`gear0 SL ${sl}PS`, { ...KI84, engine: { ...KI84.engine, gears: g } }, H, 5000, REF)
  }
  // 爬升剖面：換檔的空隙會在這裡露出一個假凹谷（見 specs/f6f5.ts 的中立檔）
  const PROFILE = (label: string, s: AircraftSpec): void => {
    const cells: string[] = []
    for (let h = 0; h <= 8000; h += 1000) cells.push(n(maxClimbRate(s, h).rate * 60, 6, 0))
    console.log(`${label.padEnd(26)}${cells.join('')}`)
  }
  console.log('\n── 爬升剖面 m/min（0…8,000 m，每 1,000）──')
  console.log(''.padEnd(26) + [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => n(k * 1000, 6, 0)).join(''))
  PROFILE('出貨 gear1 SL 1450', KI84)
  for (const sl1 of [1350, 1450, 1550, 1620]) {
    const g = [{ ...KI84.engine.gears[0]!, powerSeaLevel: 2000 * PS },
      { ...KI84.engine.gears[1]!, powerSeaLevel: sl1 * PS }]
    PROFILE(`gear0 2000 / gear1 ${sl1}`, { ...KI84, engine: { ...KI84.engine, gears: g } })
  }

  // oswald 對爬升的槓桿比對極速大得多：爬升速度下 CL 0.76、極速下只有 0.17
  console.log('\n── oswald（其餘出貨值）──')
  for (const oswald of [0.70, 0.74, 0.78, 0.80]) {
    row(`oswald ${oswald}`, { ...KI84, wing: { ...KI84.wing, oswald } }, H, 5000, REF)
  }

  console.log('\n── 組合：cd0 × vRef × oswald（gear0 SL 1800 PS 不動）──')
  for (const cd0 of [0.021, 0.022, 0.023]) {
    for (const vRef of [68, 72, 76]) {
      for (const oswald of [0.78, 0.80]) {
        row(`cd0 ${cd0} vRef ${vRef} e ${oswald}`, {
          ...KI84, drag: { ...KI84.drag, cd0 },
          wing: { ...KI84.wing, oswald }, prop: { ...KI84.prop, vRef },
        }, H, 5000, REF)
      }
    }
  }
}

// ── A6M5 ──────────────────────────────────────────────────────
{
  const H = A6M5_HISTORICAL
  // 日方到 6,000 m：7 分 01 秒（推力式単排気管型）
  const REF = 421
  console.log(`\n══ A6M5 零戰 ══  史實 臨界 ${(H.vmaxAtCritical.speed * KMH).toFixed(0)}`
    + ` @${H.vmaxAtCritical.altitude}m、海面 ${(H.vmaxSeaLevel * KMH).toFixed(0)}`
    + `、爬升 ${(H.climbRateSeaLevel * 60).toFixed(0)} m/min、升限 ${H.serviceCeiling}`
    + `、失速 ${(H.stallSpeed * KMH).toFixed(1)}、到 6,000 m ${REF} 秒`)
  console.log(`模型 clMax ${derivedClMax(A6M5, false).toFixed(3)}  史實 ${H.clMax.toFixed(3)}`)
  console.log(''.padEnd(22) + ' 臨界極速       | 海面極速      | 爬升         '
    + '| 升限          | 失速         | 到 6,000 m')
  row('出貨', A6M5, H, 6000, REF)
  for (const vRef of [32, 36, 40, 45]) {
    row(`vRef ${vRef}`, { ...A6M5, prop: { ...A6M5.prop, vRef } }, H, 6000, REF)
  }
  for (const cd0 of [0.017, 0.018, 0.019, 0.020]) {
    row(`cd0 ${cd0}`, { ...A6M5, drag: { ...A6M5.drag, cd0 } }, H, 6000, REF)
  }
  for (const etaMax of [0.85, 0.87, 0.89, 0.90]) {
    row(`etaMax ${etaMax}`, { ...A6M5, prop: { ...A6M5.prop, etaMax } }, H, 6000, REF)
  }
  const PS2 = 735.5
  for (const sl of [1080, 1110, 1130]) {
    const g = [{ ...A6M5.engine.gears[0]!, powerSeaLevel: sl * PS2 }, A6M5.engine.gears[1]!]
    row(`gear0 SL ${sl}PS`, { ...A6M5, engine: { ...A6M5.engine, gears: g } }, H, 6000, REF)
  }
  console.log('── 組合：cd0 × vRef（gear0 SL 1130 PS）──')
  for (const cd0 of [0.017, 0.018, 0.019]) {
    for (const vRef of [36, 40, 45]) {
      const g = [{ ...A6M5.engine.gears[0]!, powerSeaLevel: 1130 * PS2 }, A6M5.engine.gears[1]!]
      row(`cd0 ${cd0} vRef ${vRef}`, {
        ...A6M5, drag: { ...A6M5.drag, cd0 },
        prop: { ...A6M5.prop, vRef }, engine: { ...A6M5.engine, gears: g },
      }, H, 6000, REF)
    }
  }
}

// ── G4M ───────────────────────────────────────────────────────
{
  const H = G4M_HISTORICAL
  // 二二型同重量：3,000 m ／ 7 分 16 秒
  const REF = 436
  console.log(`\n══ G4M 一式陸攻 ══  史實 臨界 ${(H.vmaxAtCritical.speed * KMH).toFixed(0)}`
    + ` @${H.vmaxAtCritical.altitude}m、海面 ${(H.vmaxSeaLevel * KMH).toFixed(0)}`
    + `、爬升 ${(H.climbRateSeaLevel * 60).toFixed(0)} m/min、升限 ${H.serviceCeiling}`
    + `、失速 ${(H.stallSpeed * KMH).toFixed(1)}、到 3,000 m ${REF} 秒`)
  console.log(''.padEnd(22) + ' 臨界極速       | 海面極速      | 爬升         '
    + '| 升限          | 失速         | 到 3,000 m')
  row('出貨', G4M, H, 3000, REF)
  for (const oswald of [0.50, 0.52, 0.55, 0.58, 0.60, 0.62]) {
    row(`oswald ${oswald}`, { ...G4M, wing: { ...G4M.wing, oswald } }, H, 3000, REF)
  }
  for (const oswald of [0.55, 0.58]) {
    for (const cd0 of [0.028, 0.030, 0.032]) {
      row(`e ${oswald} cd0 ${cd0}`, { ...G4M, wing: { ...G4M.wing, oswald }, drag: { ...G4M.drag, cd0 } }, H, 3000, REF)
    }
  }
  for (const vRef of [50, 60, 70, 80]) {
    row(`vRef ${vRef}`, { ...G4M, prop: { ...G4M.prop, vRef } }, H, 3000, REF)
  }
  for (const cd0 of [0.030, 0.033, 0.036, 0.040]) {
    row(`cd0 ${cd0}`, { ...G4M, drag: { ...G4M.drag, cd0 } }, H, 3000, REF)
  }
  console.log('── 組合：cd0 × oswald × vRef ──')
  for (const cd0 of [0.032, 0.035, 0.038]) {
    for (const oswald of [0.55, 0.62]) {
      for (const vRef of [60, 70]) {
        row(`cd0 ${cd0} e ${oswald} vRef ${vRef}`, {
          ...G4M, drag: { ...G4M.drag, cd0 },
          wing: { ...G4M.wing, oswald }, prop: { ...G4M.prop, vRef },
        }, H, 3000, REF)
      }
    }
  }
}
console.log()
