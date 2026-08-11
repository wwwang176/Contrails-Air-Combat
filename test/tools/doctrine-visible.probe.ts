/**
 * 副判準：打法真的看得出來嗎。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/doctrine-visible.probe.ts
 *
 * 【它問的問題與主判準不同】主判準（`ai-defence` 等）問「AI 有沒有變強」。
 * 這一支問「玩家看不看得出兩台在用不同的打法」—— 那是這批改動的目的，
 * 而它不會出現在任何一條勝負門檻上。
 *
 * 【為什麼一定要走 createBattle】`ai-defence` 等護欄直接 `new Aircraft(P51D)`，
 * 走的是**史實 spec**，量的不是玩家飛的那台飛機。`createBattle` 是
 * `applyFeel(…, GAME_FEEL)` 的唯一入口（見 `battle/setup.ts`），所以副判準
 * 一定要由它進場。
 *
 * 【為什麼看分位數而不是平均】纏鬥的速度分布是雙峰的（俯衝段與拉桿段），
 * 平均會落在兩峰之間的谷底 —— 一個誰都沒有真的待過的速度。
 */
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'

const DT = 1 / 240
const SECONDS = 150
const SEED = 20260811
/** 每 0.1 s 採一次，避免相鄰幀高度相關。 */
const SAMPLE_STRIDE = 24

const b = createBattle(new AiController(), DEFAULT_BATTLE, SEED)
const cs = b.world.combatants
const blueTas: number[] = []
const blueAlt: number[] = []
const redTas: number[] = []
const redAlt: number[] = []

for (let s = 0; s < Math.round(SECONDS / DT); s++) {
  stepBattle(b, DT)
  if (s % SAMPLE_STRIDE !== 0) continue
  for (const c of cs) {
    if (!c.alive) continue
    const tas = c.aircraft.state.velocity.length() * 3.6
    const alt = c.aircraft.state.position.y
    if (c.aircraft.spec.id === 'p51d') { blueTas.push(tas); blueAlt.push(alt) }
    else { redTas.push(tas); redAlt.push(alt) }
  }
}

const pct = (a: number[], p: number) =>
  [...a].sort((x, y) => x - y)[Math.round((a.length - 1) * p)]!

for (const [n, t, h] of [
  ['P-51D', blueTas, blueAlt],
  ['Bf 109', redTas, redAlt],
] as const) {
  console.log(
    `${n}  TAS p10/中位/p90 ${pct(t, 0.1).toFixed(0)}/${pct(t, 0.5).toFixed(0)}`
    + `/${pct(t, 0.9).toFixed(0)} km/h`
    + `　高度 ${pct(h, 0.1).toFixed(0)}/${pct(h, 0.5).toFixed(0)}`
    + `/${pct(h, 0.9).toFixed(0)} m　樣本 ${t.length}`,
  )
}
console.log(
  `中位 TAS 差 ${(pct(blueTas, 0.5) - pct(redTas, 0.5)).toFixed(0)} km/h`
  + `　中位高度差 ${(pct(blueAlt, 0.5) - pct(redAlt, 0.5)).toFixed(0)} m`,
)
