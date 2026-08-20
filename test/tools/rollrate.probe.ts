/**
 * 滾轉率對「當年的設計規範」—— 兩台轟炸機都查不到公開的飛行測試值，
 * 但查得到**規範**，而規範比任何單一數字更好用。
 *
 * 【判準是螺旋角 pb/2V，不是度／秒】p 是滾轉角速度（rad/s）、b 翼展、
 * V 真空速。它的物理意義是「翼尖走過的螺旋線與飛行路徑的夾角」——
 * 把翼展與速度都除掉之後，剩下的才是**副翼設計得好不好**。
 *
 * Perkins & Hage 的教科書列的最低要求：
 *   **戰鬥機 0.09、轟炸／運輸 0.07**（NACA Report 715 用 0.07 當「操縱
 *   品質良好」的門檻）
 *
 * 【這個模型裡它剛好可以手算】穩態滾轉是「操縱力矩 = 滾轉阻尼力矩」：
 *   `p = clDa·δ·V / (−clP·b/2)`  ⟹  `pb/2V = clDa·δ / (−clP)`
 * 滿舵 δ=1 時 **pb/2V = clDa / (−clP)**，與速度、翼展都無關。
 * 也就是說規範可以直接翻譯成一個 clDa 值。
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

const REQ: Record<string, number> = { fighter: 0.09, bomber: 0.07 }
const SPECS = [P51D, BF109G6, HE111, B17G]

/** 滿舵螺旋角 pb/2V —— 與速度、翼展無關。 */
const helix = (s: AircraftSpec): number => s.moments.clDa / -s.moments.clP

console.log('\n══ 現況：滿舵螺旋角 pb/2V 對規範 ═══════════════════════════')
console.log('  機種              clDa    clP   pb/2V   規範   達成率')
for (const s of SPECS) {
  const h = helix(s)
  const r = REQ[s.role]!
  console.log(`  ${s.name.padEnd(16)}${n(s.moments.clDa, 7, 3)}${n(s.moments.clP, 7, 2)}`
    + `${n(h, 8, 4)}${n(r, 7, 2)}${n((h / r) * 100, 8, 0)}%`)
}

console.log('\n══ 換算成度／秒（3,000 m）══════════════════════════════════')
console.log('  機種              300 km/h  400 km/h  500 km/h   出貨 400 km/h')
for (const s of SPECS) {
  const g = applyFeel(s, feelFor(s))
  const at = (spec: AircraftSpec, kmh: number): number =>
    maxRollRate(spec, 3000, kmh / KMH) * DEG
  console.log(`  ${s.name.padEnd(16)}${n(at(s, 300), 9, 1)}${n(at(s, 400), 10, 1)}`
    + `${n(at(s, 500), 10, 1)}${n(at(g, 400), 14, 1)}`)
}

console.log('\n══ 若把兩台轟炸機拉到規範的 pb/2V = 0.07 ═══════════════════')
console.log('  機種              clDa 現值 → 規範值   400 km/h 滾轉率  出貨')
for (const s of [HE111, B17G]) {
  const want = 0.07 * -s.moments.clP
  const t: AircraftSpec = { ...s, moments: { ...s.moments, clDa: want } }
  const g = applyFeel(t, feelFor(t))
  console.log(`  ${s.name.padEnd(16)}${n(s.moments.clDa, 8, 4)} → ${n(want, 6, 4)}`
    + `${n(maxRollRate(s, 3000, 400 / KMH) * DEG, 12, 1)} →`
    + `${n(maxRollRate(t, 3000, 400 / KMH) * DEG, 6, 1)} °/s`
    + `${n(maxRollRate(g, 3000, 400 / KMH) * DEG, 8, 1)} °/s`)
}

console.log('\n══ controlStiffening 吃掉多少（400 km/h、3,000 m）═══════════')
console.log('  機種              aileronK   qRef   該高度動壓   剩下的舵權限')
for (const s of SPECS) {
  const rho = 0.9093
  const v = 400 / KMH
  const q = 0.5 * rho * v * v
  const f = Math.min(1, (s.controlStiffening.qRef / q) ** s.controlStiffening.aileronK)
  console.log(`  ${s.name.padEnd(16)}${n(s.controlStiffening.aileronK, 8, 2)}`
    + `${n(s.controlStiffening.qRef, 8, 0)}${n(q, 12, 0)}${n(f * 100, 13, 0)}%`)
}
console.log()
