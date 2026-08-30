/**
 * 把「史實表自己對不對得起來」量出來 —— 不改 spec。
 *
 * 跑法：`npx vite-node test/tools/reconcile.probe.ts`
 *（`node_modules/.bin` 不存在時改用
 *  `node node_modules/vite-node/vite-node.mjs test/tools/reconcile.probe.ts`）
 *
 * 四個問法：
 *   1. **爬升／升限／失速三項各自要求多重？**（主診斷，見下）
 *   2. 失速要對上史實需要多大的 clMax？（換算成模型現在有多少）
 *   3. 兩個極速點各自要求的 cd0 差多少？
 *   4. 固定 cd0，升限要對上史實需要多輕？
 *
 * 【第 1 項為什麼是主診斷】史實性能表很常混著不同掛載狀態的數字。混進同一
 * 張表之後症狀看起來完全像是模型壞了，而調係數只會把一項調對、另一項調更歪。
 * 三項**各自獨立**反解出來的重量若聚在一起，那就是那張表的實驗重量。
 *
 * 【一定要看對照組】四台一起印就是為了這個。只有一台聚在一起 → 是那台的表
 * 混了狀態；全部都散 → 是模型的通病，別拿減重去補。
 *
 * 【失速那一項最有力】它完全不吃出力，只有升力除以重量。爬升與升限都可能被
 * 「模型推力不足」解釋，失速不行 —— 失速跟著另外兩項指到同一個重量，才排得掉
 * 那個解釋。2026-08-27 的 P-51D 就是這樣定案的（見 `specs/p51d.ts` 的 `mass`）。
 */
import {
  maxClimbRate, maxLevelSpeed, serviceCeiling, stallSpeed,
} from '../../src/analysis/envelope'
import { derivedClMax } from '../../src/specs/types'
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109K4, BF109K4_HISTORICAL } from '../../src/specs/bf109k4'
import { HE111, HE111_HISTORICAL } from '../../src/specs/he111'
import { B17G, B17G_HISTORICAL } from '../../src/specs/b17g'
import { F6F5, F6F5_HISTORICAL } from '../../src/specs/f6f5'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'

const KMH = 3.6
const n = (v: number, w: number, d = 0): string => v.toFixed(d).padStart(w)

/** 二分找出讓 f(x) 跨過 target 的 x。f 必須單調。 */
function solve(f: (x: number) => number, target: number, lo: number, hi: number): number {
  const up = f(hi) > f(lo)
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2
    if ((f(m) < target) === up) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

function report(base: AircraftSpec, hist: HistoricalReference, cd0: number): void {
  const at = (c: number, m = base.mass): AircraftSpec =>
    ({ ...base, mass: m, drag: { ...base.drag, cd0: c } })
  console.log(`\n══ ${base.name}   出貨 cd0 ${base.drag.cd0}、質量 ${base.mass} kg ══════`)

  // ── 主診斷：三項各自要求多重（其餘全為出貨值）──────────────
  const byMass = (m: number): AircraftSpec => ({ ...base, mass: m })
  const lo = base.mass * 0.5
  const hi = base.mass * 1.5
  const mClimb = solve((m) => maxClimbRate(byMass(m), 0).rate, hist.climbRateSeaLevel, lo, hi)
  const mCeiling = solve((m) => serviceCeiling(byMass(m)), hist.serviceCeiling, lo, hi)
  const mStall = solve((m) => stallSpeed(byMass(m), 0, 1), hist.stallSpeed, lo, hi)
  const pct = (m: number): string => `${n(m, 7)} kg（${(m / base.mass * 100).toFixed(1)}%）`
  console.log('  【只動質量，其餘出貨值】史實這三項各自要求多重：')
  console.log(`    海平面爬升 ${n(hist.climbRateSeaLevel * 60, 6)} m/min  →  ${pct(mClimb)}`)
  console.log(`    實用升限   ${n(hist.serviceCeiling, 6)} m      →  ${pct(mCeiling)}`)
  console.log(`    失速速度   ${n(hist.stallSpeed * KMH, 6, 1)} km/h  →  ${pct(mStall)}`
    + '   ← 不吃出力，最有力的一項')
  const spreadLo = Math.min(mClimb, mCeiling, mStall)
  const spreadHi = Math.max(mClimb, mCeiling, mStall)
  const spread = (spreadHi / spreadLo - 1) * 100
  console.log(`    三者散佈 ${spreadLo.toFixed(0)}–${spreadHi.toFixed(0)} kg，極差 ${spread.toFixed(1)}%`
    + `　${spread < 5 ? '← 聚在一起：史實表指向這個重量' : '← 散開：不是單一質量能解釋的'}`)

  const cSL = solve((c) => maxLevelSpeed(at(c), 0) * KMH, hist.vmaxSeaLevel * KMH, 0.010, 0.045)
  const cHi = solve((c) => maxLevelSpeed(at(c), hist.vmaxAtCritical.altitude) * KMH,
    hist.vmaxAtCritical.speed * KMH, 0.005, 0.045)
  console.log(`  海平面 ${(hist.vmaxSeaLevel * KMH).toFixed(0)} km/h 要求 cd0 = ${cSL.toFixed(4)}`)
  console.log(`  ${hist.vmaxAtCritical.altitude} m ${(hist.vmaxAtCritical.speed * KMH).toFixed(0)}`
    + ` km/h 要求 cd0 = ${cHi.toFixed(4)}   兩者相差 ${(cSL / cHi).toFixed(2)} 倍`)

  const mCeil = solve((m) => serviceCeiling(at(cd0, m)), hist.serviceCeiling,
    base.mass * 0.4, base.mass)
  console.log(`  取 cd0 ${cd0}：升限 ${n(serviceCeiling(at(cd0)), 6)} m`
    + `（史實 ${hist.serviceCeiling}）—— 要對上得減重到 ${n(mCeil, 6)} kg`
    + `（${(mCeil / base.mass * 100).toFixed(0)}%）`)

  const clM = derivedClMax(base, false)
  const need = clM * (stallSpeed(base, 0, 1) / hist.stallSpeed) ** 2
  console.log(`  失速 ${n(stallSpeed(base, 0, 1) * KMH, 5, 1)} 對史實`
    + ` ${n(hist.stallSpeed * KMH, 5, 1)} km/h：模型 clMax ${clM.toFixed(3)}`
    + `，史實那個數字要求 ${need.toFixed(3)}`)
}

report(P51D, P51D_HISTORICAL, P51D.drag.cd0)
report(BF109K4, BF109K4_HISTORICAL, BF109K4.drag.cd0)
report(HE111, HE111_HISTORICAL, 0.022)
report(B17G, B17G_HISTORICAL, 0.0215)
report(F6F5, F6F5_HISTORICAL, F6F5.drag.cd0)
console.log()
