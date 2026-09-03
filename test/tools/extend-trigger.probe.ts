import { Vector3 } from 'three'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_RULES } from '../../src/ai/rules'
import { Idle } from './spawn-snapshot'
import { readyCard } from '../fixtures/mission'

/**
 * **玩家那一架按 `I` 代飛之後，每一次進入 `extend` 的完整前因。**不是測試。
 *
 * ```
 * npx tsx test/tools/extend-trigger.probe.ts
 * ```
 *
 * 【只量玩家那一架】人工驗收看得到的**只有自己那一架**。把全場的 AI 一起
 * 平均，答的就不是人工回報的那個問題。實測過兩次教訓：
 *
 * - 取中位會把「近距離纏鬥中被踢出去」與「遠距離正常撤退」混成一個不存在
 *   的案例（2026-08-22 專案負責人指出）。
 * - 逐卡的 extend 佔時對「玩家那一支分隊有沒有在打」極度敏感：同一張卡，
 *   玩家座位放 `Idle` 是 0.0%、放 AI 是 41.9%。那個量承載不了「哪張卡比較
 *   嚴重」的結論。
 *
 * 所以這支只印**一架飛機的事件序列**，不做跨機、跨卡的平均。
 */
const DT = 1 / 240
const SECONDS = 300
const SEED = 20260805
const STRIDE = 24
const STEP = DT * STRIDE

/** 專案負責人實際玩過的兩張卡 */
const CARDS: [string, 'allies' | 'axis'][] = [
  ['allies-m1', 'axis'],
  ['allies-m1', 'allies'],
]

const FWD = new Vector3(0, 0, -1)
const nose = new Vector3()
const s = (x: number, w: number, dp = 0) =>
  (Number.isFinite(x) ? x.toFixed(dp) : '∞').padStart(w)

/**
 * 把每一架的初速擾動 ±0.5%，擾動量由 `(salt, index)` 決定。
 *
 * 【為什麼要自己造擾動】`createBattle` 的 `seed` **只餵飛行員名字** —— 換種子
 * 跑出來逐位元相同。少了擾動就分不出「這個結果是穩的」還是「這一次剛好」。
 *
 * 【為什麼不用 `Math.random`】專案禁止。整數雜湊，同樣的輸入給同樣的擾動。
 */
function jitter(b: ReturnType<typeof createBattle>, salt: number): void {
  if (salt === 0) return
  for (const c of b.world.combatants) {
    let h = (salt ^ (c.index * 0x9e3779b1)) >>> 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
    c.aircraft.state.velocity.multiplyScalar(1 + ((h >>> 8) / 0xffffff - 0.5) * 0.01)
  }
}

/** 五次微擾。0 = 不擾動的那一次 */
const SALTS = [0, 101, 202, 303, 404]
const summary: string[] = []

for (const [id] of CARDS) {
 for (const salt of SALTS) {
  const card = readyCard(id)
  const b = createBattle(new Idle(), missionConfigFrom(card), SEED)
  jitter(b, salt)

  // 【代飛】main.ts 的 I 鍵就是這三行
  const me = b.player
  const ai = new AiController()
  ai.board = b.board
  ai.selfIndex = me.index
  ai.setDecisionPhase(me.index / b.world.combatants.length)
  me.controller = ai

  let prev = 'approach'
  let energyHeld = -1
  let sinceShot = Infinity
  let extendTime = 0
  let aliveTime = 0
  let hasTargetTime = 0
  const theta: number[] = []
  const rows: string[] = []
  let entries = 0
  let turnCaused = 0

  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    if (k % STRIDE !== 0) continue
    if (!me.alive) continue
    aliveTime += STEP
    if (ai.target !== null) hasTargetTime += STEP
    if (ai.intent === 'extend') extendTime += STEP

    nose.copy(FWD).applyQuaternion(me.aircraft.state.orientation)
    theta.push(Math.asin(Math.max(-1, Math.min(1, nose.y))) * (180 / Math.PI))
    if (theta.length > Math.round(5 / STEP)) theta.shift()

    energyHeld = ai.rules.extendEnergyLatch ? energyHeld + STEP : -1
    sinceShot = ai.shotInstant > 0 ? 0 : sinceShot + STEP

    if (ai.intent === 'extend' && prev !== 'extend') {
      entries++
      if (ai.rules.extendTurnLatch) turnCaused++
      let sum = 0
      for (const v of theta) sum += v
      rows.push(`  ${s(k * DT, 6, 1)}  `
        + `${energyHeld < 0 ? '     —' : s(energyHeld, 6, 1)}s  `
        + `${ai.rules.extendTurnLatch ? '是' : '否'}   `
        + `${ai.rules.extendFloorLatch ? '是' : '否'}  `
        + `${s(sinceShot, 7, 1)}s ${s(sum / theta.length, 7, 1)}° `
        + `${s(ai.sit.energyAdvantage, 8)} ${s(ai.sit.range, 7)}`)
    }
    prev = ai.intent
  }

  const share = 100 * extendTime / Math.max(1e-9, aliveTime)
  summary.push(`  ${id.padEnd(15)}${me.aircraft.spec.id.padEnd(9)}`
    + `擾動 ${String(salt).padStart(3)}   存活 ${aliveTime.toFixed(0).padStart(3)} s   `
    + `extend ${share.toFixed(1).padStart(5)}%   ${String(entries).padStart(3)} 次   `
    + `迴旋閂鎖觸發 ${String(turnCaused).padStart(3)} 次`)

  if (salt === 0) {
    console.log(`══ ${id}（${card.title}）—— 玩家座位 ${me.index}，`
      + `${me.aircraft.spec.id}，代飛 ${SECONDS} s（未擾動）══`)
    console.log(`  存活 ${aliveTime.toFixed(0)} s，有目標 `
      + `${(100 * hasTargetTime / Math.max(1e-9, aliveTime)).toFixed(1)}%，`
      + `extend 佔時 ${share.toFixed(1)}%，進入 extend ${entries} 次`)
    if (entries > 0) {
      console.log('   時刻   能量閂鎖  迴旋 見底  射擊解斷  俯仰5s   比能量   距離')
      for (const r of rows) console.log(r)
    }
    console.log('')
  }
 }
}

console.log('五次微擾的分散度（±0.5% 初速）')
for (const l of summary) console.log(l)
console.log('')

console.log(`遲滯帶：能量閂鎖低於 ${DEFAULT_RULES.energyEnter} m 觸發、`
  + `高於 ${DEFAULT_RULES.energyExit} m 解除；`
  + `extend 只在距離 < ${DEFAULT_RULES.extendRange} m 時由相對理由觸發`)
