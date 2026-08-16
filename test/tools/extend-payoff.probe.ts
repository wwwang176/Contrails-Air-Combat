/**
 * **撤退到底有沒有用？** 量每一次 `extend` 的收益。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/extend-payoff.probe.ts
 *
 * 【為什麼要這一支】已知「每架每 23 秒放棄追擊一次、平均撤 8.6 秒」，但
 * **不知道撤完有沒有真的把速度補回來**。這兩種情況的修法完全相反：
 *
 *   補得到 → `extend` 是好的，該治的是「為什麼掉那麼快」
 *   補不到 → `extend` 本身壞了，調它的門檻永遠沒用
 *
 * 2026-08-13 之前的所有調參都跳過了這個問題直接動門檻，兩次都被否決。
 *
 * 【量什麼】每一段 `extend`（進入 → 離開）記下：
 *
 *   進入／離開時的 cornerRatio     差值就是收益
 *   持續秒數                        收益 ÷ 秒數 = 效率
 *   高度變化                        俯衝換速的話高度會掉
 *   離開的原因                      速度補夠了？還是被別的意圖插隊？
 *
 * 【「離開原因」是關鍵】`extend` 的解除條件是 `cornerRatio > cornerExit`，
 * 但 `defend`（有人在打我）的優先序更高，可以隨時插隊。若大多數 `extend`
 * 是**被插隊打斷**而不是**補夠了才走**，那它的頻率高就完全合理 —— 它根本
 * 沒被允許跑完。
 *
 * 【跑玩家實際玩到的配置】`battleConfigFrom(DEFAULT_SKIRMISH)` = `VETERAN`，
 * 不是護欄用的 `ACE`（見 2026-08-13 紀錄的缺陷丙）。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_RULES } from '../../src/ai/rules'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 420
/** 每幀都要抓進入／離開，不能用取樣 —— 一段 extend 可能只有幾百毫秒 */
const OPENINGS = [
  { name: '4000/200', altitude: 4000, tas: 200 },
  { name: '5500/150', altitude: 5500, tas: 150 },
]

interface Span {
  ratio0: number
  ratio1: number
  alt0: number
  alt1: number
  seconds: number
  /** 離開時 cornerRatio 有沒有真的超過 cornerExit */
  satisfied: boolean
  /** 離開後接的是哪個意圖 */
  next: string
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))
  return sorted[i]!
}

function run(opening: typeof OPENINGS[number]): Span[] {
  const cfg = {
    ...battleConfigFrom(DEFAULT_SKIRMISH),
    altitude: opening.altitude,
    tas: opening.tas,
  }
  const b = createBattle(new AiController(), cfg, 20260813)
  const cs: Combatant[] = b.world.combatants
  const spans: Span[] = []
  const inExtend = new Uint8Array(cs.length)
  const since = new Float64Array(cs.length)
  const ratio0 = new Float64Array(cs.length)
  const alt0 = new Float64Array(cs.length)
  let t = 0

  for (let s = 0; s < Math.round(SECONDS / DT); s++) {
    stepBattle(b, DT)
    t += DT
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      const now = c.alive && ai.intent === 'extend' ? 1 : 0
      if (now === 1 && inExtend[i] === 0) {
        since[i] = t
        ratio0[i] = ai.sit.cornerRatio
        alt0[i] = c.aircraft.state.position.y
      } else if (now === 0 && inExtend[i] === 1) {
        // 【陣亡不算一段】它不是「離開 extend」
        if (c.alive) {
          const r1 = ai.sit.cornerRatio
          spans.push({
            ratio0: ratio0[i]!,
            ratio1: r1,
            alt0: alt0[i]!,
            alt1: c.aircraft.state.position.y,
            seconds: t - since[i]!,
            satisfied: r1 > DEFAULT_RULES.cornerExit,
            next: ai.intent,
          })
        }
      }
      inExtend[i] = now
    }
  }
  return spans
}

console.log(`20v20、${SECONDS} 秒、VETERAN。`)
console.log(`extend 的解除門檻 cornerExit = ${DEFAULT_RULES.cornerExit}`)
console.log(`（進入門檻 cornerEnter = ${DEFAULT_RULES.cornerEnter}）\n`)

for (const o of OPENINGS) {
  const spans = run(o)
  const gains = spans.map((s) => s.ratio1 - s.ratio0).sort((a, b) => a - b)
  const secs = spans.map((s) => s.seconds).sort((a, b) => a - b)
  const dAlt = spans.map((s) => s.alt1 - s.alt0).sort((a, b) => a - b)
  const satisfied = spans.filter((s) => s.satisfied).length
  const worse = spans.filter((s) => s.ratio1 < s.ratio0).length
  const byNext = new Map<string, number>()
  for (const s of spans) byNext.set(s.next, (byNext.get(s.next) ?? 0) + 1)

  console.log(`── 開局 ${o.name}　共 ${spans.length} 段 ──`)
  console.log(
    `  收益（離開 ratio − 進入 ratio）：`
    + `中位 ${pct(gains, 0.5).toFixed(3)}　`
    + `p10 ${pct(gains, 0.1).toFixed(3)}　p90 ${pct(gains, 0.9).toFixed(3)}`,
  )
  console.log(
    `  **越撤越糟的段數：${worse} / ${spans.length}`
    + `（${(worse / Math.max(spans.length, 1) * 100).toFixed(1)}%）**`,
  )
  console.log(
    `  **真的補到門檻才走的：${satisfied} / ${spans.length}`
    + `（${(satisfied / Math.max(spans.length, 1) * 100).toFixed(1)}%）**`,
  )
  console.log(
    `  持續秒數：中位 ${pct(secs, 0.5).toFixed(1)}　`
    + `p90 ${pct(secs, 0.9).toFixed(1)}　最長 ${pct(secs, 1).toFixed(1)}`,
  )
  console.log(
    `  高度變化 m：中位 ${pct(dAlt, 0.5).toFixed(0)}　`
    + `p10 ${pct(dAlt, 0.1).toFixed(0)}　p90 ${pct(dAlt, 0.9).toFixed(0)}`,
  )
  const sorted = [...byNext].sort((a, c) => c[1] - a[1])
  console.log(
    `  離開後接的意圖：`
    + sorted.map(([k, v]) => `${k} ${(v / Math.max(spans.length, 1) * 100).toFixed(0)}%`).join('　'),
  )
  console.log('')
}

console.log('【怎麼讀】')
console.log('　「真的補到門檻才走」比例低 → extend 一直被插隊打斷，它沒機會做完事。')
console.log('　　那時該修的是「誰在插隊」，不是 extend 的門檻。')
console.log('　「越撤越糟」比例高 → extend 這個動作本身無效，撤了反而更慢。')
console.log('　　那時該修的是 extend 做什麼（extendPitchAngle），不是何時進出。')
console.log('　兩者都低、收益是正的 → extend 是健康的，該治的是「為什麼掉那麼快」。')
