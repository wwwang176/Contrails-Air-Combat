/**
 * 【一次性量測】複製 god-view.test.ts 的場景：玩家座位坐 AiController，
 * 統計 120 秒內藍方指揮層對每一支分隊發過的命令步數 —— 分辨「接線斷了」
 * 與「排程從來輪不到玩家那一支」。
 *
 *   npx vite-node test/tools/god-order.probe.ts
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'

const DT = 1 / 240
const SECONDS = 120

const b = createBattle(new AiController())
const nFlights = b.blueCommand.orders.length
const steps = new Array<number>(nFlights).fill(0)
const kinds = new Map<string, number>()
let pinnedFlight = -1

for (let s = 0; s < SECONDS * 240; s++) {
  stepBattle(b, DT)
  pinnedFlight = b.flights.flightOf[b.flights.pinned] ?? -1
  for (let f = 0; f < nFlights; f++) {
    const o = b.blueCommand.orders[f]
    if (o !== null && o !== undefined) {
      steps[f] = (steps[f] ?? 0) + 1
      const k = (o as { kind?: string }).kind ?? 'unknown'
      if (s % 240 === 0) kinds.set(k, (kinds.get(k) ?? 0) + 1)
    }
  }
}

console.log(`玩家分隊 = ${pinnedFlight}（最後一步）`)
console.log(`各分隊拿到命令的步數：${steps.join(', ')}`)
console.log(`命令種類（每秒取樣）：${[...kinds.entries()].map(([k, v]) => `${k}×${v}`).join('  ') || '（一個都沒有）'}`)
