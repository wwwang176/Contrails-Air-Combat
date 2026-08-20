/**
 * `controlStiffening.aileronK` 該是多少 —— 有一個可以算的參考點。
 *
 * 【k = 1.0 的物理意義】高速時舵偏角被飛行員的臂力上限卡住：桿力 ∝ q·δ，
 * 臂力固定 ⟹ `δ ∝ 1/q ∝ 1/V²`。滾轉率 `p ∝ δ·V`，所以
 *
 *   p ∝ V · (1/V²) = **1/V**
 *
 * 本模型的 `δ_eff = δ · (qRef/q)^k` 代進去是 `p ∝ V^(1−2k)`：
 *
 *   k = 0.0  →  p ∝ V      舵權限不受速度影響（輕舵、助力舵）
 *   k = 0.5  →  p ∝ V⁰     滾轉率在 qRef 之上維持定值
 *   k = 1.0  →  p ∝ 1/V    **臂力固定的飛行員**
 *   k > 1.0  →  掉得比臂力上限還快 —— 沒有對應的物理機制
 *
 * 「重舵」的正確模型是 **qRef 訂低**（更早撞到力量上限），不是把 k 調大。
 */
import { maxRollRate } from '../../src/analysis/envelope'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { HE111 } from '../../src/specs/he111'
import { B17G } from '../../src/specs/b17g'
import { applyFeel, feelFor } from '../../src/specs/feel'
import type { AircraftSpec } from '../../src/specs/types'

const KMH = 3.6
const DEG = 180 / Math.PI
const n = (v: number, w: number, d = 1): string => v.toFixed(d).padStart(w)

const SPEEDS = [250, 300, 350, 400, 450, 500]

function curve(s: AircraftSpec, label: string): void {
  const g = applyFeel(s, feelFor(s))
  const vne = s.limits.vne * KMH
  console.log(`  ${label.padEnd(22)}`
    + SPEEDS.map((k) => {
      const v = maxRollRate(g, 3000, k / KMH) * DEG
      return (k > vne ? '  —' : n(v, 7, 1)).padStart(8)
    }).join('')
    + `   vne ${vne.toFixed(0)}`)
}

const withK = (s: AircraftSpec, k: number): AircraftSpec =>
  ({ ...s, controlStiffening: { ...s.controlStiffening, aileronK: k } })

console.log('\n══ 出貨滾轉率隨速度（°/s、3,000 m、超過 vne 的格子留空）══════')
console.log('  設定                     250     300     350     400     450     500')
curve(P51D, 'P-51D  k 0.35')
curve(BF109G6, 'Bf 109 k 1.50')
console.log('  ── He 111（qRef 4250）────────────────────────────────────')
for (const k of [1.8, 1.4, 1.0, 0.5]) curve(withK(HE111, k), `He 111 k ${k.toFixed(2)}`)
console.log('  ── B-17G（qRef 4250）─────────────────────────────────────')
for (const k of [2.4, 1.6, 1.0, 0.5]) curve(withK(B17G, k), `B-17G  k ${k.toFixed(2)}`)

console.log('\n══ 曲線指數：p ∝ V^e（由 300→450 km/h 兩點反解）════════════')
console.log('  設定                 指數 e    理論對照')
for (const [s, label] of [[P51D, 'P-51D  k 0.35'], [BF109G6, 'Bf 109 k 1.50'],
  [HE111, 'He 111 k 1.80'], [B17G, 'B-17G  k 2.40']] as const) {
  const g = applyFeel(s, feelFor(s))
  const a = maxRollRate(g, 3000, 300 / KMH)
  const b = maxRollRate(g, 3000, 450 / KMH)
  const e = Math.log(b / a) / Math.log(450 / 300)
  const k = s.controlStiffening.aileronK
  console.log(`  ${label.padEnd(20)}${n(e, 7, 2)}    1−2k = ${n(1 - 2 * k, 6, 2)}`
    + `${e < -1.2 ? '   ← 掉得比臂力上限還快' : ''}`)
}
console.log('\n  參考：k=1.0 給 e=−1.00（臂力固定）、k=0.5 給 e=0（定值）')
console.log()
