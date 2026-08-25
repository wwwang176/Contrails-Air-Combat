/**
 * 兩個「−25% 配方」的完整副作用。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/turn-sideeffect.probe.ts
 *
 * 【過載上限用真值】`envelope.ts` 讀的是 `spec.limits.gPositive`，但實際
 * 夾住飛機的是 `limiters.ts` 的 `PILOT_G_POSITIVE = 6.5`（該檔 :110 明寫
 * 結構分支對出貨機隊不可達）。這裡把有效上限直接寫進 gPositive，讓包絡
 * 算出來的就是玩家真正飛得到的。
 */
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { GAME_FEEL, applyFeel } from '../../src/specs/feel'
import {
  instantaneousTurnRate, sustainedTurnRate, bestSustainedTurnRate,
  stallSpeed, maxClimbRate, maxLevelSpeed, serviceCeiling,
} from '../../src/analysis/envelope'
import { derivedClMax, type AircraftSpec } from '../../src/specs/types'

const KMH = 3.6

function minInst(s: AircraftSpec, alt: number): number {
  let best = Infinity
  for (let v = 40; v <= 320; v += 0.5) {
    const w = instantaneousTurnRate(s, alt, v)
    if (w > 1e-6) best = Math.min(best, v / w)
  }
  return best
}
function minSust(s: AircraftSpec, alt: number): number {
  const w = bestSustainedTurnRate(s, alt)
  if (!(w > 1e-6)) return Infinity
  let bv = 0
  let bd = Infinity
  for (let v = 40; v <= 250; v += 0.25) {
    const d = Math.abs(sustainedTurnRate(s, alt, v) - w)
    if (d < bd) { bd = d; bv = v }
  }
  return bv / w
}
/** 真角落速度：氣動過載首次達到有效上限 nEff 的速度 */
function trueCorner(s: AircraftSpec, alt: number, nEff: number): number {
  return stallSpeed(s, alt, nEff)
}

interface Case { name: string; make: (s: AircraftSpec) => AircraftSpec; nEff: number }
/** 軟夾之後的有效上限就是 spec 自己的結構極限：P-51D 8、Bf109 7.5 */
const structural = (s: AircraftSpec) => s.limits.gPositive

/**
 * 【注意 GAME_FEEL 已經含 mass 0.9】`make` 的結果會再被 `applyFeel` 乘一次，
 * 所以要拿到「相對史實 spec 的有效質量 m」，這裡必須先除掉出貨倍率。
 * 不除的話每一列都會比標示值再輕 10%，連「改動前」那一列都不是改動前。
 */
const relMass = (m: number) => m / GAME_FEEL.mass

const CASES: Case[] = [
  {
    name: '改動前（硬夾 6.5 G、原重量）',
    make: (s) => ({ ...s, mass: s.mass * relMass(1) }),
    nEff: 6.5,
  },
  {
    name: '軟夾（原重量）',
    make: (s) => ({ ...s, mass: s.mass * relMass(1) }),
    nEff: -1,
  },
  ...([0.9, 0.85, 0.8, 0.75, 0.7].map((m) => ({
    name: `軟夾 + 有效質量 ${m.toFixed(2)}`,
    make: (s: AircraftSpec) => ({ ...s, mass: s.mass * relMass(m) }),
    nEff: -1,
  }))),
  {
    name: '軟夾 + 質量 0.85 + CLmax ×1.15',
    make: (s: AircraftSpec) => ({
      ...s,
      mass: s.mass * relMass(0.85),
      lift: { ...s.lift, clAlpha: s.lift.clAlpha * 1.15 },
    }),
    nEff: -1,
  },
]

for (const raw of [P51D, BF109K4]) {
  console.log(`\n===== ${raw.name} =====`)
  console.log('配方                       CLmax  失速SL 失速4k 真角速4k 最小瞬時R4k 最佳持續R4k  爬升m/min SL極速 4k極速  升限')
  for (const c of CASES) {
    const base = applyFeel(c.make(raw), GAME_FEEL)
    // 有效過載上限寫進 gPositive，讓 envelope 用真值。nEff < 0 = 軟夾，用結構極限
    const nEff = c.nEff < 0 ? structural(base) : c.nEff
    const s: AircraftSpec = { ...base, limits: { ...base.limits, gPositive: nEff } }
    console.log(
      c.name.padEnd(26)
      + `${derivedClMax(s, false).toFixed(2).padStart(6)} `
      + `${(stallSpeed(s, 0, 1) * KMH).toFixed(0).padStart(6)} `
      + `${(stallSpeed(s, 4000, 1) * KMH).toFixed(0).padStart(6)} `
      + `${(trueCorner(s, 4000, nEff) * KMH).toFixed(0).padStart(8)} `
      + `${minInst(s, 4000).toFixed(0).padStart(11)}m `
      + `${minSust(s, 4000).toFixed(0).padStart(11)}m `
      + `${(maxClimbRate(s, 0).rate * 60).toFixed(0).padStart(9)} `
      + `${(maxLevelSpeed(s, 0) * KMH).toFixed(0).padStart(6)} `
      + `${(maxLevelSpeed(s, 4000) * KMH).toFixed(0).padStart(6)} `
      + `${serviceCeiling(s).toFixed(0).padStart(6)}`,
    )
  }
}

console.log('\n=== 兩機的相對關係（平衡有沒有被打破）===')
for (const c of CASES) {
  const p = applyFeel(c.make(P51D), GAME_FEEL)
  const b = applyFeel(c.make(BF109K4), GAME_FEEL)
  const ps: AircraftSpec = { ...p, limits: { ...p.limits, gPositive: c.nEff < 0 ? structural(p) : c.nEff } }
  const bs: AircraftSpec = { ...b, limits: { ...b.limits, gPositive: c.nEff < 0 ? structural(b) : c.nEff } }
  console.log(`${c.name.padEnd(26)} 最小瞬時R 109÷P51 = `
    + `${(minInst(bs, 4000) / minInst(ps, 4000)).toFixed(3)}   `
    + `最佳持續率 109÷P51 = ${(bestSustainedTurnRate(bs, 4000) / bestSustainedTurnRate(ps, 4000)).toFixed(3)}   `
    + `爬升 109÷P51 = ${(maxClimbRate(bs, 0).rate / maxClimbRate(ps, 0).rate).toFixed(3)}`)
}

console.log('\n=== 黑視：拉到極限時的過載會落在哪 ===')
console.log('（gEffect.ts：6 G 起漸暗、8 G 全黑）')
for (const c of CASES) {
  for (const raw of [P51D, BF109K4]) {
    const n = c.nEff < 0 ? raw.limits.gPositive : c.nEff
    console.log(`${c.name.padEnd(22)} ${raw.id.padEnd(9)} 過載上限 ${n} G → `
      + `黑視強度 ${(Math.min(1, Math.max(0, (n - 6) / 2)) * 100).toFixed(0)}%`)
  }
}
