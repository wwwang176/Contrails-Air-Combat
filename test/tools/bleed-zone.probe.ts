/**
 * **AI 待在「虧損區」多久？** 純檢視量測。不是測試（`.probe.ts`）。跑法：
 *   npx vite-node test/tools/bleed-zone.probe.ts
 *
 * 【虧損區的定義】TAS > 該高度的可持續極速（滿油門平飛 Ps = 0 的速度）。
 * 在這之上，超額的動能被阻力持續蒸發 —— 專案負責人 2026-08-24 的體感：
 * 「高速換到速度後很容易被空氣阻力減速，重新拉回高度後會很不值得。」
 *
 * 【量什麼】護送關 300 秒（與 escort-trace 同一場），對每一架戰鬥機逐步記：
 *
 *   佔時    在虧損區的時間比例
 *   蒸發    在區內以 n=1 的 |Ps| 積分 —— 「純粹因為速度太快」蒸發的能量高度。
 *           轉彎的誘導阻力另計（那是買轉彎率，不是浪費）
 *
 * 【誠實的邊界】n=1 的 Ps 是下限：區內同時在拉 G 時真正的蒸發更多，但那部分
 * 記在「轉彎的代價」帳上比較公平。這支只回答「速度本身這個桶漏多兇」。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { maxLevelSpeed, specificExcessPower } from '../../src/analysis/envelope'
import type { AircraftSpec } from '../../src/specs/types'
import { readyCard } from '../fixtures/mission'

const DT = 1 / 240
const SECONDS = 300

const card = readyCard('allies-m1')
if (!card) throw new Error('找不到護送關')
const battle = createBattle(new AiController(), missionConfigFrom(card), 20260805)

/** 可持續極速查表：50 m 一格。二分搜尋不便宜，72k 步 × 30 架不做快取跑不完 */
const cache = new Map<AircraftSpec, Map<number, number>>()
function vSustain(spec: AircraftSpec, alt: number): number {
  let m = cache.get(spec)
  if (!m) { m = new Map(); cache.set(spec, m) }
  const key = Math.round(alt / 50)
  let v = m.get(key)
  if (v === undefined) {
    v = maxLevelSpeed(spec, key * 50, 1)
    m.set(key, v)
  }
  return v
}

interface Tally {
  name: string
  steps: number
  inZone: number
  /** 區內 |Ps|·dt 的積分，m（能量高度） */
  bled: number
  /** 區內的 (V − Vs) 平均用 */
  overSum: number
  /** 進入區的段數（連續段） */
  episodes: number
  wasIn: boolean
}

const fighters = battle.world.combatants.filter(
  (c) => battle.board.protectedMask[c.index] === 0,
)
const tallies = new Map<number, Tally>()
for (const c of fighters) {
  tallies.set(c.index, {
    name: `${c.team === 'blue' ? '藍' : '紅'} ${c.aircraft.spec.name ?? '?'}`,
    steps: 0, inZone: 0, bled: 0, overSum: 0, episodes: 0, wasIn: false,
  })
}

for (let s = 0; s < SECONDS * 240; s++) {
  stepBattle(battle, DT)
  for (const c of fighters) {
    if (!c.alive) continue
    const t = tallies.get(c.index)!
    t.steps++
    const v = c.aircraft.state.velocity.length()
    const alt = c.aircraft.state.position.y
    const vs = vSustain(c.aircraft.spec, alt)
    if (v > vs) {
      t.inZone++
      t.overSum += v - vs
      const ps = specificExcessPower(c.aircraft.spec, alt, v, 1, 1)
      if (ps < 0) t.bled += -ps * DT
      if (!t.wasIn) { t.episodes++; t.wasIn = true }
    } else t.wasIn = false
  }
}

// ── 按機種彙整 ────────────────────────────────────────────
const groups = new Map<string, { steps: number, inZone: number, bled: number, overSum: number, episodes: number, n: number }>()
for (const t of tallies.values()) {
  let g = groups.get(t.name)
  if (!g) { g = { steps: 0, inZone: 0, bled: 0, overSum: 0, episodes: 0, n: 0 }; groups.set(t.name, g) }
  g.steps += t.steps
  g.inZone += t.inZone
  g.bled += t.bled
  g.overSum += t.overSum
  g.episodes += t.episodes
  g.n++
}

console.log(`護送關 300 s、seed 20260805。虧損區 = TAS > 該高度可持續極速\n`)
console.log('  機種            架數   佔時    平均超速   蒸發/架    段數/架  段均蒸發')
for (const [name, g] of groups) {
  const share = (100 * g.inZone) / g.steps
  const over = g.inZone > 0 ? g.overSum / g.inZone : 0
  console.log(
    `  ${name.padEnd(14)} ${String(g.n).padStart(4)}`
    + ` ${share.toFixed(1).padStart(5)}%`
    + ` ${over.toFixed(0).padStart(7)} m/s`
    + ` ${(g.bled / g.n).toFixed(0).padStart(8)} m`
    + ` ${(g.episodes / g.n).toFixed(1).padStart(8)}`
    + ` ${(g.episodes > 0 ? g.bled / g.episodes : 0).toFixed(0).padStart(8)} m`,
  )
}
console.log(
  '\n  【對照的尺】109 在 4000 m 的總比能量約 5,300 m；一次 25° 俯衝換速循環'
  + '\n  　動用約 200~300 m。蒸發/架若與後者同量級，虧損區才算實質的漏。',
)
