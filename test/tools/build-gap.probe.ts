/**
 * **`build` 期間 `energyRatio` 爬到哪裡？離 `perchEnter` 有多遠？**
 * 不是測試（`.probe.ts`）。跑法：npx vite-node test/tools/build-gap.probe.ts
 *
 * 【它回答的問題】「蓄能門檻是不是訂太高」。答案是不是 —— `perchEnter = 0.5`
 * 換算成 F4F 的高度優勢是 298～554 m，落在判準要求的 300～600 m 內。真正的
 * 限制是**時間**：實測累積速率約 0.0057 /s，由進場的 0.16 爬到 0.5 需要約
 * 60 秒，而 60 秒不可能不被 `defend`、命令或丟失目標打斷。
 *
 * 所以每一段 `build` 幾乎都是撞 `buildMax` 而結束，而不是蓄滿而結束 ——
 * 那正是「撞期限就帶著手上的能量去打」（`settled`）存在的理由。這一支是
 * 那個結論的證據，改動 `buildMax` 或 `perchEnter` 之後要重跑。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, uniform } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_TACTICS } from '../../src/ai/tactics'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 300
const SEED = 20260907

interface Span { enter: number; peak: number; secs: number; reached: boolean }

function run(blue: string, red: string, perSide: number): Span[] {
  const b = createBattle(
    new AiController(), battleConfigFrom(uniform(blue, perSide, red, perSide)), SEED,
  )
  const cs: Combatant[] = b.world.combatants
  const spans: Span[] = []
  const inBuild = new Uint8Array(cs.length)
  const e0 = new Float64Array(cs.length)
  const pk = new Float64Array(cs.length)
  const t0 = new Float64Array(cs.length)
  let t = 0
  for (let s = 0; s < Math.round(SECONDS / DT); s++) {
    stepBattle(b, DT)
    t += DT
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      const a = c.controller
      if (!(a instanceof AiController)) continue
      const now = c.alive && a.tactics.phase === 'build' ? 1 : 0
      const er = a.sit.energyRatio
      if (now === 1) {
        if (inBuild[i] === 0) { e0[i] = er; pk[i] = er; t0[i] = t }
        if (er > pk[i]!) pk[i] = er
      } else if (inBuild[i] === 1 && c.alive) {
        spans.push({
          enter: e0[i]!, peak: pk[i]!, secs: t - t0[i]!,
          reached: pk[i]! > DEFAULT_TACTICS.perchEnter,
        })
      }
      inBuild[i] = now
    }
  }
  return spans
}

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))]!
}
const F = (x: number, d = 3) => (Number.isNaN(x) ? '   —' : x.toFixed(d)).padStart(7)

console.log(`perchEnter = ${DEFAULT_TACTICS.perchEnter}`
  + `  buildMax = ${DEFAULT_TACTICS.buildMax} s\n`)
console.log('對局                 N   段數 │ 進場 p50 │ 峰值 p50   p90 │ 停留 p50 │ 蓄滿率')
for (const [a, r] of [['f4f4', 'a6m5'], ['f6f5', 'a6m5'], ['p51d', 'bf109k4']] as [string, string][]) {
  for (const n of [4, 20]) {
    const sp = run(a, r, n)
    const peaks = sp.map(x => x.peak)
    console.log(`${(a + ' vs ' + r).padEnd(18)}${String(n).padStart(3)} ${String(sp.length).padStart(6)} │`
      + `${F(pct(sp.map(x => x.enter), 0.5))}  │`
      + `${F(pct(peaks, 0.5))} ${F(pct(peaks, 0.9))} │`
      + `${F(pct(sp.map(x => x.secs), 0.5), 1)} s │`
      + `${(100 * sp.filter(x => x.reached).length / Math.max(1, sp.length)).toFixed(1).padStart(6)}%`)
  }
}
