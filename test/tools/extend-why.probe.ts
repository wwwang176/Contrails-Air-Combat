/**
 * **撤退期間 AI 到底在幹嘛 + 是不是太擁擠。** **不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/extend-why.probe.ts
 *
 * 【承接 `extend-payoff.probe.ts` 的發現】
 *
 *   收益中位 +0.016（≈ 0）、三到四成越撤越糟、
 *   只有四到五成補夠才走、中位只撐 3.6 秒、**56~58% 被 `defend` 打斷**
 *
 * 【這一支要分開回答兩件事】
 *
 * **一、是不是引擎不夠力？**
 *
 * 算式先講清楚：平飛 1 G、WEP，實測淨加速度約 4 m/s²（`accel` 量過）。
 * 3.6 秒能給 14.4 m/s ≈ 52 km/h，換算成 `cornerRatio` 約 **+0.116**。
 * 而實測收益只有 **+0.016 —— 只拿到 14%**。
 *
 * 所以引擎能給的比拿到的多七倍。若真是引擎不夠力，那 86% 的缺口要有去處。
 * 這裡量撤退期間的**過載、油門、減速板**：
 *
 *   過載 ≫ 1      → 它還在轉彎。誘導阻力 ∝ n²，5 G 時淨加速度是負的
 *   油門 < WEP    → 有人把油門收掉了（安全層？減速判準？）
 *   減速板 > 0    → `brakeCornerRatio` 在撤退期間仍然生效
 *
 * 三者都正常而收益仍然是 0，才輪得到「引擎不夠力」。
 *
 * **二、是不是太擁擠？**
 *
 * 撤退的前提是拉開距離，而 40 架擠在一起時退到哪裡都有人。掃隊伍規模：
 * 若 `defend` 插隊比例隨規模單調下降、收益隨規模上升，那就是場景問題，
 * 不是 AI 的判準問題。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, uniform } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_RULES } from '../../src/ai/rules'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 420

interface Span {
  gain: number
  seconds: number
  satisfied: boolean
  next: string
  /** 撤退期間的平均值 */
  loadFactor: number
  throttle: number
  brake: number
  /** 最近的敵機距離（撤退期間平均），m */
  foeRange: number
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))
  return sorted[i]!
}
const median = (xs: number[]) => pct([...xs].sort((a, b) => a - b), 0.5)

function run(perSide: number): Span[] {
  const cfg = battleConfigFrom(uniform('p51d', perSide, 'bf109g6', perSide))
  const b = createBattle(new AiController(), cfg, 20260813)
  const cs: Combatant[] = b.world.combatants
  const spans: Span[] = []
  const inExtend = new Uint8Array(cs.length)
  const since = new Float64Array(cs.length)
  const r0 = new Float64Array(cs.length)
  // 累加器：撤退期間的平均
  const nAcc = new Float64Array(cs.length)
  const gAcc = new Float64Array(cs.length)
  const thrAcc = new Float64Array(cs.length)
  const brkAcc = new Float64Array(cs.length)
  const rngAcc = new Float64Array(cs.length)
  let t = 0

  for (let s = 0; s < Math.round(SECONDS / DT); s++) {
    stepBattle(b, DT)
    t += DT
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      const now = c.alive && ai.intent === 'extend' ? 1 : 0
      if (now === 1) {
        if (inExtend[i] === 0) {
          since[i] = t
          r0[i] = ai.sit.cornerRatio
          nAcc[i] = 0; gAcc[i] = 0; thrAcc[i] = 0; brkAcc[i] = 0; rngAcc[i] = 0
        }
        // 【每個物理步都累加】撤退中位只有 3.6 秒，取樣會漏掉整段
        nAcc[i] = nAcc[i]! + 1
        gAcc[i] = gAcc[i]! + Math.abs(c.aircraft.diag.loadFactor)
        thrAcc[i] = thrAcc[i]! + c.command.throttle
        brkAcc[i] = brkAcc[i]! + c.command.brake
        // 最近的活著的敵機
        let best = Infinity
        for (let j = 0; j < cs.length; j++) {
          const o = cs[j]!
          if (!o.alive || j === i) continue
          const sameTeam = b.blue.includes(c) === b.blue.includes(o)
          if (sameTeam) continue
          const d = c.aircraft.state.position.distanceTo(o.aircraft.state.position)
          if (d < best) best = d
        }
        rngAcc[i] = rngAcc[i]! + (Number.isFinite(best) ? best : 0)
      } else if (inExtend[i] === 1 && c.alive) {
        const n = Math.max(nAcc[i]!, 1)
        const r1 = ai.sit.cornerRatio
        spans.push({
          gain: r1 - r0[i]!,
          seconds: t - since[i]!,
          satisfied: r1 > DEFAULT_RULES.cornerExit,
          next: ai.intent,
          loadFactor: gAcc[i]! / n,
          throttle: thrAcc[i]! / n,
          brake: brkAcc[i]! / n,
          foeRange: rngAcc[i]! / n,
        })
      }
      inExtend[i] = now
    }
  }
  return spans
}

console.log(`每邊 N 架、${SECONDS} 秒、VETERAN、同一顆種子。WEP 油門 = ${WEP_THROTTLE}\n`)
console.log('  N   段數  收益中位  補夠才走  被defend打斷  持續中位 ｜ 撤退期間：過載  油門  減速板  最近敵機')

for (const perSide of [20, 8, 4, 2, 1]) {
  const spans = run(perSide)
  if (spans.length === 0) { console.log(`${String(perSide).padStart(3)}    （一段都沒有）`); continue }
  const sat = spans.filter((s) => s.satisfied).length
  const def = spans.filter((s) => s.next === 'defend').length
  const p = (x: number) => `${(x / spans.length * 100).toFixed(0)}%`
  console.log(
    `${String(perSide).padStart(3)} ${String(spans.length).padStart(6)}   `
    + `${median(spans.map((s) => s.gain)).toFixed(3).padStart(6)}    `
    + `${p(sat).padStart(5)}       `
    + `${p(def).padStart(5)}       `
    + `${median(spans.map((s) => s.seconds)).toFixed(1).padStart(5)}s ｜ `
    + `${median(spans.map((s) => s.loadFactor)).toFixed(2).padStart(6)} `
    + `${median(spans.map((s) => s.throttle)).toFixed(2).padStart(5)} `
    + `${median(spans.map((s) => s.brake)).toFixed(2).padStart(6)} `
    + `${median(spans.map((s) => s.foeRange)).toFixed(0).padStart(8)} m`,
  )
}

console.log('\n【怎麼讀 —— 引擎那一題】')
console.log('　平飛 1 G、WEP 的淨加速度約 4 m/s²，3.6 秒 ≈ +0.116 的 ratio。')
console.log('　實測收益若遠低於它，缺口要在「過載／油門／減速板」三欄裡找得到去處。')
console.log('　過載 ≫ 1 就是答案：誘導阻力 ∝ n²，那不是引擎的問題。')
console.log('　三欄都正常（過載≈1、油門滿、減速板 0）而收益仍是 0 —— 那才輪到引擎。')
console.log('\n【怎麼讀 —— 擁擠那一題】')
console.log('　N 變小時「被 defend 打斷」若單調下降、收益單調上升 → 是場景擁擠。')
console.log('　N=1（1v1）仍然打斷得很兇 → 與架數無關，是判準本身。')
