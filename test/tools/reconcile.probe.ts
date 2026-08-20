/**
 * 把「史實表自己對不對得起來」量出來 —— 不改 spec。
 *
 * 三個問法：
 *   1. 固定 cd0，升限要對上史實需要多輕？
 *   2. 失速要對上史實需要多大的 clMax？（換算成模型現在有多少）
 *   3. 兩個極速點各自要求的 cd0 差多少？
 */
import { maxLevelSpeed, serviceCeiling, stallSpeed } from '../../src/analysis/envelope'
import { derivedClMax } from '../../src/specs/types'
import { HE111, HE111_HISTORICAL } from '../../src/specs/he111'
import { B17G, B17G_HISTORICAL } from '../../src/specs/b17g'
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

report(HE111, HE111_HISTORICAL, 0.022)
report(B17G, B17G_HISTORICAL, 0.0215)
console.log()
