/**
 * 第二版改出模型的閉迴路量尺。一次性量測，不進測試組。
 *
 * `FIT=1` 只跑原改出航向並輸出 `fit\t{JSON}`，供離線擬合保存觸發特徵與
 * 實際掉高。一般模式另跑升力水平投影變體及現行安全層，CSV 後接摘要。
 *
 * 跑法：
 *   SPEC=p51d FIT=1 npx vite-node test/tools/recovery-eval.probe.ts
 *   SPEC=p51d npx vite-node test/tools/recovery-eval.probe.ts
 */
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { A6M5 } from '../../src/specs/a6m5'
import { F4F4 } from '../../src/specs/f4f4'
import { F6F5 } from '../../src/specs/f6f5'
import { KI84 } from '../../src/specs/ki84'
import { B17G } from '../../src/specs/b17g'
import { HE111 } from '../../src/specs/he111'
import { G4M } from '../../src/specs/g4m'
import { maxLoadFactorAero, stallSpeed } from '../../src/analysis/envelope'
import { DEFAULT_SAFETY, recoveryAltitude } from '../../src/ai/safety'
import {
  RECOVERY_V2_COEFFS, bankFromUpright, createRecoveryFeatures, fixedMargin,
  predictFromFeatures, predictRecovery, predictRecoveryRollout, recoveryFeatures,
  setupAircraft, simulateTrial,
  worstGamma, type ModelParams, type RecoveryDirection, type RecoveryFeatures,
  type Scenario, type SafetyModel,
} from '../../src/tools/recoveryModel'
import type { AircraftSpec } from '../../src/specs/types'

declare const process: { env: Record<string, string | undefined> }

const DEG = Math.PI / 180
const ALL: readonly AircraftSpec[] = [P51D, BF109K4, A6M5, F4F4, F6F5, KI84, B17G, HE111, G4M]
const spec = ALL.find((s) => s.id === (process.env['SPEC'] ?? 'p51d'))
if (spec === undefined) {
  throw new Error(`沒有這個機種：${process.env['SPEC']}，可選 ${ALL.map((s) => s.id).join(' ')}`)
}

const FIT_ONLY = process.env['FIT'] === '1'
const MEASURE_ROLLOUT = process.env['ROLLOUT'] === '1'
const SUMMARY_ONLY = process.env['SUMMARY'] === '1'
const ROLLOUT_HZ = Math.max(1, Number(process.env['ROLLOUT_HZ'] ?? 240))
const GROUNDS = [1000, 4000]
const DIVES = [-5, -10, -20, -30, -45, -60, -75, -89]
const BANKS = [0, 45, 90, 135, 180]
/** 初始滾轉角速度，°/s。正值代表坡度增加。 */
const ROLL_RATES = [0, 90]
const SECONDS = 30
const params: ModelParams = { ...RECOVERY_V2_COEFFS, latch: true, margin: 0 }

/** 失速 1.2 倍至紅線 IAS 0.85 倍，各高度均分四格。 */
function speedsFor(s: AircraftSpec, ground: number): number[] {
  const vs = stallSpeed(s, ground, 1)
  const tasPerIas = vs / stallSpeed(s, 0, 1)
  const lo = vs * 1.2
  const hi = s.limits.vne * tasPerIas * 0.85
  return [0, 1, 2, 3].map((i) => Math.round(lo + ((hi - lo) * i) / 3))
}

interface FirstRecovery {
  triggerAgl: number
  triggerBank: number
  triggerGamma: number
  triggerTas: number
  minAgl: number
  predictedDrop: number
  rolloutDrop: number
  rolloutSeconds: number
  rolloutRecovered: boolean
  features: RecoveryFeatures
}

function firstRecovery(
  s: Scenario,
  model: SafetyModel,
  direction: RecoveryDirection = 'velocity',
): FirstRecovery {
  const features = createRecoveryFeatures()
  const out: FirstRecovery = {
    triggerAgl: NaN, triggerBank: NaN, triggerGamma: NaN, triggerTas: NaN,
    minAgl: NaN, predictedDrop: NaN, rolloutDrop: NaN, rolloutSeconds: NaN,
    rolloutRecovered: false, features,
  }
  let phase: 'before' | 'recovering' | 'done' = 'before'
  simulateTrial(s, model, params, SECONDS, false, (st) => {
    if (phase === 'done') return
    const v = st.aircraft.state.velocity
    if (phase === 'before') {
      if (!st.takeover) return
      phase = 'recovering'
      out.triggerAgl = st.agl
      out.triggerBank = bankFromUpright(st.aircraft) / DEG
      const tas = v.length()
      out.triggerGamma = Math.asin(Math.max(-1, Math.min(1, v.y / Math.max(tas, 1e-3)))) / DEG
      out.triggerTas = tas
      out.minAgl = st.agl
      if (model === 'new') {
        recoveryFeatures(st.aircraft, features, direction)
        out.predictedDrop = predictFromFeatures(features, RECOVERY_V2_COEFFS)
        if (MEASURE_ROLLOUT) {
          const rollout = predictRecoveryRollout(st.aircraft, direction, 20, 1 / ROLLOUT_HZ)
          out.rolloutDrop = rollout.drop
          out.rolloutSeconds = rollout.seconds
          out.rolloutRecovered = rollout.recovered
        }
      }
      return
    }
    if (st.agl < out.minAgl) out.minAgl = st.agl
    if (v.y >= 0) phase = 'done'
  }, { recoveryDirection: direction, stopAfterFirstRecovery: true })
  return out
}

/**
 * 起點高度與預測高度互相影響空氣密度。由地面附近開始固定點迭代四次，使探測
 * 機使用最後真正起飛的絕對高度，而不是另造一架五公里高、未步進的探測機。
 */
function modelStart(base: Scenario, direction: RecoveryDirection): number {
  const sink = -Math.sin(base.gammaDeg * DEG) * base.tas
  const buffer = Math.max(5, sink * 0.3)
  let agl = 20
  for (let i = 0; i < 4; i++) {
    const probe = setupAircraft({ ...base, agl })
    agl = Math.max(predictRecovery(probe, RECOVERY_V2_COEFFS, direction) + buffer, 20)
  }
  return agl
}

function currentStart(base: Scenario): number {
  const sink = -Math.sin(base.gammaDeg * DEG) * base.tas
  const buffer = Math.max(5, sink * 0.3)
  let agl = 140
  for (let i = 0; i < 4; i++) {
    const probe = setupAircraft({ ...base, agl })
    const tas = probe.state.velocity.length()
    const nMax = Math.min(
      maxLoadFactorAero(base.spec, probe.state.position.y, tas), base.spec.limits.gPositive,
    )
    const need = recoveryAltitude(tas, worstGamma(probe), nMax) * DEFAULT_SAFETY.factor
      + DEFAULT_SAFETY.clearance
    agl = Math.max(need + buffer, 140)
  }
  return agl
}

interface Row {
  ground: number
  tas: number
  gamma: number
  bank: number
  rollRate: number
  newMin: number
  variantMin: number
  curMin: number
  trigBank: number
  actualDrop: number
  rolloutDrop: number
  rolloutSeconds: number
  rolloutRecovered: boolean
}

const rows: string[] = []
rows.push([
  'csv', 'spec', 'ground', 'tas', 'gamma', 'bank', 'rollRate', 'startAgl',
  'trigAgl', 'trigBank', 'trigGamma', 'trigTas', 'predictedDrop', 'actualDrop',
  'rolloutDrop', 'rolloutSeconds', 'rolloutRecovered', 'push', 'newMin',
  'variantMin', 'variantDelta', 'curTrigAgl', 'curMin',
].join(','))
const results: Row[] = []

for (const ground of GROUNDS) {
  for (const tas of speedsFor(spec, ground)) {
    for (const gamma of DIVES) {
      for (const bank of BANKS) {
        for (const rollRate of ROLL_RATES) {
          const base: Scenario = {
            spec, ground, agl: 0, tas, gammaDeg: gamma, bankDeg: bank,
            rollRateDeg: rollRate, load: 1, intent: 'strafe',
          }
          const velocityStart = modelStart(base, 'velocity')
          const variantStart = FIT_ONLY ? velocityStart : modelStart(base, 'lift-horizontal')
          const startAgl = Math.max(velocityStart, variantStart)
          const n = firstRecovery({ ...base, agl: startAgl }, 'new')
          const actualDrop = n.triggerAgl - n.minAgl

          if (FIT_ONLY && !SUMMARY_ONLY && Number.isFinite(actualDrop)) {
            console.log(`fit\t${JSON.stringify({
              spec: spec.id,
              cell: { ground, tas, gamma, bank, rollRate },
              features: n.features,
              actualDrop,
            })}`)
          }

          let vMin = NaN
          let curTrig = NaN
          let curMin = NaN
          if (!FIT_ONLY) {
            const variant = firstRecovery(
              { ...base, agl: startAgl }, 'new', 'lift-horizontal',
            )
            vMin = variant.minAgl
            // 現行層與第二版從同一個（或更高）起點進場，避免起點本身改變上層
            // 對地瞄準軌跡而把兩者比較成不同場景。
            const current = firstRecovery(
              { ...base, agl: Math.max(startAgl, currentStart(base)) }, 'current',
            )
            curTrig = current.triggerAgl
            curMin = current.minAgl
          }

          rows.push([
            'csv', spec.id, ground, tas, gamma, bank, rollRate, startAgl.toFixed(1),
            n.triggerAgl.toFixed(1), n.triggerBank.toFixed(0), n.triggerGamma.toFixed(1),
            n.triggerTas.toFixed(0), n.predictedDrop.toFixed(1), actualDrop.toFixed(1),
            n.rolloutDrop.toFixed(1), n.rolloutSeconds.toFixed(3),
            n.rolloutRecovered ? 1 : 0, n.features.push ? 1 : 0, n.minAgl.toFixed(1), vMin.toFixed(1),
            (vMin - n.minAgl).toFixed(1), curTrig.toFixed(1), curMin.toFixed(1),
          ].join(','))
          results.push({
            ground, tas, gamma, bank, rollRate, newMin: n.minAgl,
            variantMin: vMin, curMin, trigBank: n.triggerBank, actualDrop,
            rolloutDrop: n.rolloutDrop, rolloutSeconds: n.rolloutSeconds,
            rolloutRecovered: n.rolloutRecovered,
          })
        }
      }
    }
  }
}

if (!SUMMARY_ONLY) for (const row of rows) console.log(row)

const margin = fixedMargin(spec)
const valid = results.filter((r) => Number.isFinite(r.newMin))
const sorted = [...valid].sort((a, b) => a.newMin - b.newMin)
const pct = (values: readonly number[], q: number): number => {
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.min(ordered.length - 1, Math.floor(q * ordered.length))]!
}
const label = (r: Row): string => (
  `${r.ground}/${r.tas}/${r.gamma}°/坡度${r.bank}°/滾${r.rollRate}`
)

console.log(`\n== ${spec.name}（${spec.role}）固定餘裕 ${margin} m，係數 ${JSON.stringify(RECOVERY_V2_COEFFS)}`)
console.log(`有效 ${valid.length}/${results.length} 格`)
if (sorted.length > 0) {
  const newValues = sorted.map((r) => r.newMin)
  console.log(`新模型（餘裕 0）最低 ${sorted[0]!.newMin.toFixed(1)} m（${label(sorted[0]!) }）`)
  console.log(`  分位 1% ${pct(newValues, 0.01).toFixed(1)}／5% ${pct(newValues, 0.05).toFixed(1)}／中位 ${pct(newValues, 0.5).toFixed(1)}／95% ${pct(newValues, 0.95).toFixed(1)} m`)
  console.log(`  加固定餘裕仍撞地 ${valid.filter((r) => r.newMin + margin < 0).length} 格`)
  console.log('  最晚的 10 格：')
  for (const r of sorted.slice(0, 10)) {
    console.log(`    ${label(r)}  ${r.newMin.toFixed(1)} m（觸發坡度 ${r.trigBank.toFixed(0)}°）`)
  }
}

if (MEASURE_ROLLOUT) {
  const measured = valid.filter((r) => Number.isFinite(r.rolloutDrop))
  const errors = measured.map((r) => r.rolloutDrop - r.actualDrop)
  const durations = measured.map((r) => r.rolloutSeconds)
  console.log(`物理預演 ${ROLLOUT_HZ} Hz：${measured.length} 格；未在上限內改出 ${measured.filter((r) => !r.rolloutRecovered).length} 格`)
  if (errors.length > 0) {
    const ordered = [...measured].sort((a, b) => (
      (a.rolloutDrop - a.actualDrop) - (b.rolloutDrop - b.actualDrop)
    ))
    const low = ordered[0]!
    const high = ordered[ordered.length - 1]!
    console.log(`  預演誤差：最低 ${Math.min(...errors).toFixed(1)}／1% ${pct(errors, 0.01).toFixed(1)}／5% ${pct(errors, 0.05).toFixed(1)}／中位 ${pct(errors, 0.5).toFixed(1)}／95% ${pct(errors, 0.95).toFixed(1)}／最高 ${Math.max(...errors).toFixed(1)} m`)
    console.log(`  非零格 ${errors.filter((value) => Math.abs(value) > 0.05).length}；最低 ${label(low)}，最高 ${label(high)}`)
    console.log(`  改出時間：中位 ${pct(durations, 0.5).toFixed(2)}／95% ${pct(durations, 0.95).toFixed(2)}／最長 ${Math.max(...durations).toFixed(2)} s`)
  }
}

if (!FIT_ONLY) {
  const variants = valid.filter((r) => Number.isFinite(r.variantMin))
  const variantValues = variants.map((r) => r.variantMin)
  const deltas = variants.map((r) => r.variantMin - r.newMin)
  const currents = valid.filter((r) => Number.isFinite(r.curMin))
  const currentValues = currents.map((r) => r.curMin)
  console.log(`升力水平投影變體：最低 ${Math.min(...variantValues).toFixed(1)}／1% ${pct(variantValues, 0.01).toFixed(1)}／5% ${pct(variantValues, 0.05).toFixed(1)}／中位 ${pct(variantValues, 0.5).toFixed(1)}／95% ${pct(variantValues, 0.95).toFixed(1)} m`)
  console.log(`  相對原指令差值：最低 ${Math.min(...deltas).toFixed(1)}／中位 ${pct(deltas, 0.5).toFixed(1)}／最高 ${Math.max(...deltas).toFixed(1)} m`)
  console.log(`現行安全層：最低 ${Math.min(...currentValues).toFixed(1)}／中位 ${pct(currentValues, 0.5).toFixed(1)} m；撞地 ${currents.filter((r) => r.curMin < 0).length} 格`)
}
