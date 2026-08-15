/**
 * 「集合令解除不掉」的**根因驗證**。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/rally-reset.probe.ts
 *
 * 【假設】`Aircraft.reset()` 的第一行是
 *
 * ```ts
 * this.state = createFlightState(altitude, tas)
 * ```
 *
 * —— 它**整個換掉 `state` 物件**，`state.position` 因此是一個新的 `Vector3`。
 * 而 `setup.ts` 的 `createBattle` 把指揮層快照的位置抓成**參考**：
 *
 * ```ts
 * position: c.aircraft.state.position,   // readonly，抓一次就再也接不回去
 * ```
 *
 * 於是任何一次 `reset()` 之後，`commandUnits[i].position` 變成一個孤兒向量，
 * 永遠停在重置那一刻的座標。`resetBattle`（再打一場）對**每一架**都呼叫
 * `world.respawn(c)` → `aircraft.reset()`，所以重開一場之後**整個指揮層**
 * 讀到的是一整場凍結的座標。
 *
 * 受害的不只集合令：`centroidDistance`、`flankPoint`、`flankArrived`、
 * `planWithdrawOrder` 的敵群質心 —— 指揮層每一個吃位置的判斷都一起壞掉。
 *
 * 【為什麼之前的探針複製不出來】`rally-stuck` 與 `rally-handover` 都只呼叫
 * `createBattle` 一次、從不重開。實機則是「再打一場」按下去就中招。
 *
 * 【量法】對照組不重開、實驗組重開，兩邊都量同一條不變式：
 * 「長機在判定圈內」是否蘊含「命令已解除」。順帶直接驗證凍結本身 ——
 * 比對快照座標與飛機本體座標。
 */
import { createBattle, resetBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import type { CommandState, CommandUnit } from '../../src/ai/command'
import type { Flight } from '../../src/battle/flights'

const DT = 1 / 240
const WARMUP = 30
const SECONDS = 400

function leaderOf(flight: Flight, units: readonly CommandUnit[]): number {
  for (let i = 0; i < flight.count; i++) {
    const u = units[flight.members[i]!]
    if (u === undefined || !u.alive) continue
    return flight.members[i]!
  }
  return -1
}

function run(label: string, doReset: boolean): void {
  const cfg = { ...battleConfigFrom(DEFAULT_SKIRMISH), altitude: 4000, tas: 200 }
  const b: Battle = createBattle(new AiController(), cfg, 20260813)
  const units = b.commandUnits
  const fs = b.flights.flights
  const states: CommandState[] = [b.blueCommand, b.redCommand]

  for (let s = 0; s < Math.round(WARMUP / DT); s++) stepBattle(b, DT)
  if (doReset) resetBattle(b, 20260814)

  let violations = 0
  let worstHold = 0
  const heldSince = new Float64Array(fs.length)
  const prevOrder: (object | null)[] = new Array(fs.length).fill(null)

  let t = 0
  for (let s = 0; s < Math.round(SECONDS / DT); s++) {
    stepBattle(b, DT)
    t += DT
    for (let f = 0; f < fs.length; f++) {
      const flight = fs[f]!
      const st = flight.team === 'blue' ? states[0]! : states[1]!
      const order = st.orders[f] ?? null
      if (order !== prevOrder[f]) { prevOrder[f] = order; heldSince[f] = t; continue }
      if (order === null || order.kind !== 'rally') continue
      const held = t - heldSince[f]!
      if (held > worstHold) worstHold = held
      const lead = leaderOf(flight, units)
      if (lead < 0) continue
      const u = units[lead]!
      const p = order.point
      const d = Math.hypot(u.position.x - p.x, u.position.y - p.y, u.position.z - p.z)
      if (d <= order.radius) violations++
    }
  }

  // ── 凍結本身的直接證據：快照座標 vs 飛機本體座標 ──────────
  let stale = 0
  let worstGap = 0
  const cs = b.world.combatants
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    const u = units[i]!
    const real = c.aircraft.state.position
    if (u.position !== real) stale++
    const gap = Math.hypot(u.position.x - real.x, u.position.y - real.y, u.position.z - real.z)
    if (gap > worstGap) worstGap = gap
  }

  console.log(`── ${label} ──`)
  // 【「別名」那一欄修好之後恆為 40/40，那是預期的】快照現在本來就是副本。
  // 有判別力的是**落差** —— 修好前重開一場會是 5300 m，修好後是 0 m。
  console.log(
    `  快照與本體非同一物件的架數：${stale}/${cs.length}（修好後恆為全部）　`
    + `**最大座標落差 ${worstGap.toFixed(0)} m**`,
  )
  console.log(
    `  不變式違反 ${violations} 步（長機在判定圈內、命令仍未解除）　`
    + `任一張 rally 最長持有 ${worstHold.toFixed(0)}s`,
  )
  console.log('')
}

console.log('【怎麼讀】「不再指向本體」> 0 就是凍結成立；最大落差就是指揮層')
console.log('　讀到的座標離真相多遠。不變式違反與最長持有是它的後果。\n')
run(`對照組：不重開（${WARMUP}s 暖機 + ${SECONDS}s）`, false)
run(`實驗組：暖機後 resetBattle（再打一場）`, true)
