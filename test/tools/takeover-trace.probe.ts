import { Vector3 } from 'three'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import type { Combatant } from '../../src/world/World'
import { Idle } from './spawn-snapshot'
import { readyCard } from '../fixtures/mission'

/**
 * 玩家那一架交給 AI 代飛之後的**逐秒軌跡**。不是測試。
 *
 * ```
 * npx tsx test/tools/takeover-trace.probe.ts
 * ```
 *
 * 【它在回答什麼】人工回報：「AI 會把方位對向敵人，但過 5 秒會抬高飛機直直
 * 飛，再過 5 秒左右降低機頭直直飛，上下反覆。」這支印出俯仰的時間序列與
 * 同一拍的意圖、模式、以及 `extendPitchAngle` 的兩個輸入，好把振盪對回成因。
 *
 * 【為什麼不開瀏覽器】`main.ts` 的代飛就是把同一顆 `AiController` 接到玩家
 * 座位上，飛行迴圈一個字都不一樣。無頭跑得到逐格數字，畫面只看得到現象。
 */
const DT = 1 / 240
const SECONDS = 120
const SEED = 20260805
const STRIDE = 24

/**
 * 要量哪一張卡。**就地改這兩行** —— 專案不引入 `@types/node`，所以拿不到
 * `process.argv`。
 */
const ID = 'allies-m1'

const card = readyCard(ID)
const b = createBattle(new Idle(), missionConfigFrom(card), SEED)

// 【代飛】main.ts 的 I 鍵就是這三行
const me = b.player
const ai = new AiController()
ai.board = b.board
ai.selfIndex = me.index
ai.setDecisionPhase(me.index / b.world.combatants.length)
me.controller = ai

function nearestEnemy(cs: readonly Combatant[], self: Combatant): number {
  let best = Infinity
  for (const o of cs) {
    if (!o.alive || o.team === self.team || o.index === self.index) continue
    const d = o.aircraft.state.position.distanceTo(self.aircraft.state.position)
    if (d < best) best = d
  }
  return best
}

/**
 * 【為什麼要容錯】這支要拿去跑舊 commit 做 A/B，而那些 commit 沒有
 * `speedAdvantage` 這個欄位。讀到 `undefined` 時
 * `.toFixed()` 會直接拋 —— 那會讓「跨版本比較」這件事本身做不成。
 */
function num(x: number | undefined): string {
  return x === undefined ? '   —' : x.toFixed(3)
}

const FWD = new Vector3(0, 0, -1)
const nose = new Vector3()

console.log(`${card.id}（${card.title}）座位 ${me.index}，${SECONDS} s`)
console.log('  t     高度   TAS   機首°  航跡°  aimY   意圖      模式        '
  + '相位   cRatio  spdAdv  最近敵機')

const rows: { t: number; theta: number; alt: number }[] = []
for (let k = 0; k < Math.round(SECONDS / DT); k++) {
  stepBattle(b, DT)
  if (k % STRIDE !== 0) continue
  const st = me.aircraft.state
  nose.copy(FWD).applyQuaternion(st.orientation)
  const theta = Math.asin(Math.max(-1, Math.min(1, nose.y))) * (180 / Math.PI)
  const v = st.velocity
  const speed = v.length()
  const gamma = speed > 1e-6
    ? Math.asin(Math.max(-1, Math.min(1, v.y / speed))) * (180 / Math.PI) : 0
  const t = k * DT
  rows.push({ t, theta, alt: st.position.y })
  console.log(
    `  ${t.toFixed(1).padStart(5)} ${st.position.y.toFixed(0).padStart(6)} `
    + `${me.aircraft.diag.aero.tas.toFixed(0).padStart(5)} `
    + `${theta.toFixed(1).padStart(6)} ${gamma.toFixed(1).padStart(6)} `
    + `${me.command.aimWorld.y.toFixed(3).padStart(6)} `
    + `${ai.intent.padEnd(9)} ${ai.mode.padEnd(11)} `
    + `${num(ai.sit.cornerRatio).padStart(6)} `
    + `${num(ai.sit.speedAdvantage).padStart(7)} `
    + `${nearestEnemy(b.world.combatants, me).toFixed(0).padStart(7)}`,
  )
}

// ── 振盪的週期與振幅 ──────────────────────────────────────
const peaks: number[] = []
for (let i = 1; i < rows.length - 1; i++) {
  const a = rows[i - 1]!.theta
  const c = rows[i]!.theta
  const d = rows[i + 1]!.theta
  if ((c > a && c >= d) || (c < a && c <= d)) peaks.push(i)
}
let sumPeriod = 0
let n = 0
let maxSwing = 0
for (let i = 1; i < peaks.length; i++) {
  const dt = rows[peaks[i]!]!.t - rows[peaks[i - 1]!]!.t
  // 只採計看得出來的擺動，濾掉數值雜訊造成的微小反折
  const swing = Math.abs(rows[peaks[i]!]!.theta - rows[peaks[i - 1]!]!.theta)
  if (swing < 3) continue
  sumPeriod += 2 * dt
  n++
  if (swing > maxSwing) maxSwing = swing
}
console.log('')
console.log(`機首俯仰的擺動：${n} 次，平均週期 `
  + `${n > 0 ? (sumPeriod / n).toFixed(1) : '—'} s，最大峰谷差 `
  + `${maxSwing.toFixed(1)}°`)
