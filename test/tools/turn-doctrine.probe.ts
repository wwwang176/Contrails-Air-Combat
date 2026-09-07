/**
 * **迴旋吃虧的一方改打能量戰之後，實際在做什麼。** 不是測試（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/turn-doctrine.probe.ts
 *
 * 【為什麼要對照組】主題那一組（f4f4 vs a6m5）的數字單看分不出「機制壞了」
 * 與「機體不如人」。同機種對戰的 `airframeTurnAdvantage` 恆為 0、恆不徵召，
 * 所以它跑的是完全沒有這一層的路徑 —— 由**資料**產生的對照組，不靠開關。
 *
 * 【為什麼俯衝那一欄用公尺】判準是用公尺講的（進場要比對方高 300～600 m），
 * 換算成 `energyRatio` 只會多一層要在腦裡還原的東西。
 *
 * 【種子的限制】`createBattle` 的 `seed` 只餵飛行員名字，換種子逐位元相同。
 * 這一支印的是**一個情境**不是統計分布。要看穩健性得自己加初速微擾
 * （做法見 `extend-trigger.probe.ts` 的 `jitter`）。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, uniform } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { INTENTS } from '../../src/ai/rules'
import type { TacticalPhase } from '../../src/ai/tactics'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 300
const SEED = 20260907
const PHASES: TacticalPhase[] = ['build', 'perch', 'dive', 'zoom', 'cooldown']

function run(blue: string, red: string, perSide: number) {
  const b = createBattle(
    new AiController(), battleConfigFrom(uniform(blue, perSide, red, perSide)), SEED,
  )
  const cs: Combatant[] = b.world.combatants
  const isBlue = cs.map(c => b.blue.includes(c))
  const intent: Record<string, number> = {}
  const phase: Record<string, number> = {}
  for (const i of INTENTS) intent[i] = 0
  for (const p of PHASES) phase[p] = 0
  const prev: string[] = cs.map(() => 'off')
  const diveAlt: number[] = []
  let alive = 0
  let shot = 0
  let dives = 0
  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      const a = c.controller
      if (!(a instanceof AiController) || !c.alive || !isBlue[i]) continue
      alive += DT
      intent[a.intent] = (intent[a.intent] ?? 0) + DT
      if (a.shotInstant > 0) shot += DT
      const p = a.tactics.phase
      if (p !== 'off') phase[p] = (phase[p] ?? 0) + DT
      if (p === 'dive' && prev[i] !== 'dive') {
        dives++
        diveAlt.push(a.sit.altitudeAdvantage)
      }
      prev[i] = p
    }
  }
  const srt = [...diveAlt].sort((x, y) => x - y)
  return {
    alive, intent, phase, shot, dives,
    med: srt.length > 0 ? srt[Math.floor(srt.length / 2)]! : Number.NaN,
    bLeft: b.blue.filter(c => c.alive).length,
    rLeft: b.red.filter(c => c.alive).length,
  }
}

const P = (x: number, a: number) => `${(100 * x / Math.max(1e-9, a)).toFixed(1).padStart(5)}%`
const CASES: [string, string][] = [
  ['f4f4', 'a6m5'],    // 主題
  ['f6f5', 'a6m5'],    // 同樣被徵召的另一台
  ['p51d', 'bf109k4'], // 同一個現象的另一組機種
  ['f4f4', 'f4f4'],    // 對照：不徵召
]

for (const n of [4, 20]) {
  console.log(`\n════ 每邊 ${n} 架、${SECONDS} s、觀測藍隊全體 ════`)
  console.log('對局              藍/紅 │' + INTENTS.map(i => i.padStart(8)).join('')
    + ' │' + PHASES.map(p => p.padStart(8)).join('') + ' │ 射擊解 dive次 俯衝高度差')
  for (const [a, r] of CASES) {
    const x = run(a, r, n)
    console.log(`${(a + ' vs ' + r).padEnd(16)}${String(x.bLeft).padStart(3)}/${String(x.rLeft).padEnd(3)}│`
      + INTENTS.map(i => P(x.intent[i] ?? 0, x.alive).padStart(8)).join('')
      + ' │' + PHASES.map(p => P(x.phase[p] ?? 0, x.alive).padStart(8)).join('')
      + ` │ ${P(x.shot, x.alive)} ${String(x.dives).padStart(6)}`
      + ` ${(Number.isNaN(x.med) ? '—' : x.med.toFixed(0)).padStart(8)} m`)
  }
}
