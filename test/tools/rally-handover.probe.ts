/**
 * 「集合令永遠解除不掉」的**交接複製**。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/rally-handover.probe.ts
 *
 * 【為什麼要這一支】`rally-stuck.probe.ts` 全程用 `AiController` 佔玩家座位，
 * 32 張 rally 命令 32 張都正常解除，一張都卡不住。而人工回報（
 * 座位 #8）是一張握了 196 秒、期間多次深入判定圈（250 m、209 m、145 m／
 * 判定 300 m）都沒解除。
 *
 * 兩者唯一的差別是**開場那十幾秒是人在飛**：
 *
 *   人在飛時   `stepCommandLayer` 推導出 `playerFlight = flightOf[pinned]`，
 *              `stepCommand` 每一步都把那一支的 `orders/spent/idle` 清成 0
 *   交給 AI 後 `human` 變偽 → `playerFlight = -1` → 那一支開始收命令
 *
 * 這一支就是把那個交接複製出來：前 `HUMAN_SECONDS` 秒座位上是
 * `PlayerController`（不吃輸入，等於直線平飛），之後換成 `AiController`。
 *
 * 【量的是一條不變式，不是統計】對每一支握著 rally 的分隊，每個物理步檢查
 * 「長機在判定圈內」是否蘊含「這一步之後命令被解除」。`leaderDistance` 用的
 * 就是第一個存活成員，而 `compactFlights` 把玩家釘在 `members[0]` ——
 * 所以違反這條就是缺陷本身，不需要跑到 600 秒去等症狀浮現。
 */
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { PlayerController } from '../../src/control/PlayerController'
import { createInputState } from '../../src/input/InputState'
import type { CommandState, CommandUnit } from '../../src/ai/command'
import type { Flight } from '../../src/battle/flights'

const DT = 1 / 240
const SECONDS = 600
/** 開場由「人」飛多久。人工回報是玩家飛到 t≈15s 才切上帝視角 */
const HUMAN_SECONDS = 15

function leaderOf(flight: Flight, units: readonly CommandUnit[]): number {
  for (let i = 0; i < flight.count; i++) {
    const u = units[flight.members[i]!]
    if (u === undefined || !u.alive) continue
    return flight.members[i]!
  }
  return -1
}

function run(name: string, altitude: number, tas: number, humanSeconds: number): void {
  const cfg = { ...battleConfigFrom(DEFAULT_SKIRMISH), altitude, tas }
  // 【不吃輸入 = 直線平飛】重點不是他飛得像不像人，是這段期間
  // `stepCommandLayer` 推導出的 `human` 為真、那一支分隊被跳過
  const b: Battle = createBattle(new PlayerController(createInputState()), cfg, 20260813)
  const units = b.commandUnits
  const fs = b.flights.flights
  const states: CommandState[] = [b.blueCommand, b.redCommand]
  const pinned = b.flights.pinned
  let handed = false

  /** 違反不變式的次數：長機在圈內，但下一步命令還在（且還是同一張） */
  let violations = 0
  let worstHold = 0
  let worstInsideStreak = 0
  /** 每一支分隊目前這一張 rally 已經「長機在圈內」連續幾步 */
  const streak = new Int32Array(fs.length)
  const heldSince = new Float64Array(fs.length)
  const prevOrder: (object | null)[] = new Array(fs.length).fill(null)

  let t = 0
  for (let s = 0; s < Math.round(SECONDS / DT); s++) {
    if (!handed && t >= humanSeconds) {
      // 交接：座位換上 AiController。與遊戲裡按 G／I 是同一件事
      b.world.combatants[pinned]!.controller = new AiController()
      handed = true
    }
    stepBattle(b, DT)
    t += DT

    for (let f = 0; f < fs.length; f++) {
      const flight = fs[f]!
      const st = flight.team === 'blue' ? states[0]! : states[1]!
      const order = st.orders[f] ?? null

      if (order !== prevOrder[f]) {
        prevOrder[f] = order
        streak[f] = 0
        heldSince[f] = t
        continue
      }
      if (order === null || order.kind !== 'rally') { streak[f] = 0; continue }

      const held = t - heldSince[f]!
      if (held > worstHold) worstHold = held

      const lead = leaderOf(flight, units)
      if (lead < 0) { streak[f] = 0; continue }
      const u = units[lead]!
      const p = order.point
      const d = Math.hypot(u.position.x - p.x, u.position.y - p.y, u.position.z - p.z)
      if (d <= order.radius) {
        // 這一步 `stepBattle` 已經跑過解除檢查，命令卻還在 —— 就是違反
        streak[f]!
        streak[f] = streak[f]! + 1
        violations++
        if (streak[f]! > worstInsideStreak) worstInsideStreak = streak[f]!
      } else {
        streak[f] = 0
      }
    }
  }

  console.log(
    `── ${name}　人飛 ${humanSeconds}s 後交接　${SECONDS} 秒　pinned = #${pinned} ──`,
  )
  console.log(
    `  **不變式違反 ${violations} 步**（長機在判定圈內、命令仍未解除）　`
    + `最長連續 ${worstInsideStreak} 步（${(worstInsideStreak * DT).toFixed(2)}s）`,
  )
  console.log(`  任一張 rally 的最長持有 ${worstHold.toFixed(0)}s`)
  console.log('')
}

console.log('【怎麼讀】違反步數 > 0 就是缺陷本身 —— `leaderDistance <= radius`')
console.log('　成立卻沒解除。最長持有若接近 600s，就是人工回報的那個症狀。\n')
run('2000/200', 2000, 200, HUMAN_SECONDS)
run('4000/200', 4000, 200, HUMAN_SECONDS)
// 對照組：全程 AI（等於 rally-stuck.probe.ts 的條件）
run('4000/200（不交接）', 4000, 200, 0)
