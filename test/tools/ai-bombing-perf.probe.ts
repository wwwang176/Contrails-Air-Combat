import { createBattle, stepBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import type { BattleConfig } from '../../src/battle/setup'
import type { ReadyMissionCard } from '../../src/battle/missions'
import type { Controller } from '../../src/control/Controller'
import { shouldRelease } from '../../src/ai/bombRun'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { G4M } from '../../src/specs/g4m'
import { bombDragK, BOMB_TERMINAL_SPEED } from '../../src/world/bomb'
import { AI_DECISION_HZ } from '../../src/ai/AiController'

/**
 * 投彈解算的效能量測。
 *
 * 【為什麼要一支獨立的探針】現有的 perf gate 量不到這條路 —— `bench/ai-load.ts`
 * 是兩架戰鬥機、20v20 那一組也沒有艦隊，所以 `shouldRelease` 一次都不會跑。
 *
 * 跑法：`npx vitest run test/tools/ai-bombing-perf.probe.ts`（它自己不是
 * 測試檔，用 vite-node 或改副檔名跑）。這裡輸出數字，不設門檻 ——
 * **護欄定值是負責人的決定。**
 */

const IDLE: Controller = { update() {} }
const DT = 1 / 240

const card = MISSIONS.japan.find((c) => c.id === 'japan-m3') as ReadyMissionCard

/**
 * @param solve false = 把彈艙容量餵 0，AI 走掃射那一支、一次都不解算。
 *   **這才是隔離出解算成本的對照組** —— 拿掉整個艦隊的話，差值會混進
 *   防空砲、黑雲與撞船判定。
 */
function wire(cfg: BattleConfig, solve: boolean): () => void {
  const b = createBattle(IDLE, cfg, 1234)
  for (const c of b.world.combatants) {
    const ctl = c.controller
    if (!(ctl instanceof AiController)) continue
    ctl.ships = b.world.ships
    ctl.bombBay = solve ? c.bombBay : null
    ctl.bombDrag = b.world.bombDrag
  }
  return () => stepBattle(b, DT)
}

/** 多批取最小 —— 與 `perf-gate.test.ts` 同一個統計方式。 */
function measure(step: () => void, steps: number, batches: number): number {
  for (let i = 0; i < 2000; i++) step()   // 熱身
  let best = Infinity
  for (let b = 0; b < batches; b++) {
    const t0 = performance.now()
    for (let i = 0; i < steps; i++) step()
    const us = ((performance.now() - t0) * 1000) / steps
    if (us < best) best = us
  }
  return best
}

const cfg = missionConfigFrom(card)
const bare: BattleConfig = { ...cfg }
delete (bare as { fleet?: unknown }).fleet

const noFleet = measure(wire(bare, false), 4000, 5)
const fleetOnly = measure(wire(cfg, false), 4000, 5)

console.log('japan-m3 6v6（六架一式陸攻、八艘船）')
console.log(`  沒有艦隊            ${noFleet.toFixed(1)} µs/step`)
console.log(`  有艦隊、不解算      ${fleetOnly.toFixed(1)} µs/step   (艦隊本身 +${(fleetOnly - noFleet).toFixed(1)})`)

/**
 * 【整場比對量不出解算成本】會投彈的那一組把船打沉了，防空砲與黑雲跟著
 * 變少 —— 兩組跑的不是同一場，差值被場景分歧蓋掉（實測甚至是負的）。
 *
 * 所以改成量**單次成本 × 呼叫率**，兩者都是可以獨立確認的數字。
 */
const cls = SHIP_CLASSES.wichita
const ship = createShip(0, cls, 'red', 0, -1200, 0, 8)
const plane = new Aircraft(G4M)
plane.state.position.set(0, 1000, 0)
plane.state.velocity.set(0, 0, -90)
const k = bombDragK(BOMB_TERMINAL_SPEED)

for (let i = 0; i < 500; i++) shouldRelease(plane, ship, k, DT)
let per = Infinity
for (let b = 0; b < 5; b++) {
  const n = 200
  const t0 = performance.now()
  for (let i = 0; i < n; i++) shouldRelease(plane, ship, k, DT)
  const us = ((performance.now() - t0) * 1000) / n
  if (us < per) per = us
}

// 最壞情況：每一架轟炸機都在走廊內、每個決策拍都解算
const BOMBERS = 6
const worst = (per * BOMBERS * AI_DECISION_HZ) / 240
console.log('')
console.log(`  單次 shouldRelease（1,000 m，走廊內）  ${per.toFixed(1)} µs`)
console.log(`  最壞攤提（${BOMBERS} 架 × ${AI_DECISION_HZ} Hz ÷ 240）      ${worst.toFixed(1)} µs/step`)

// 走廊外的那一段：閘應該讓它幾乎免費
plane.state.position.set(0, 1000, 6000)
for (let i = 0; i < 500; i++) shouldRelease(plane, ship, k, DT)
let gated = Infinity
for (let b = 0; b < 5; b++) {
  const n = 20000
  const t0 = performance.now()
  for (let i = 0; i < n; i++) shouldRelease(plane, ship, k, DT)
  const us = ((performance.now() - t0) * 1000) / n
  if (us < gated) gated = us
}
console.log(`  單次 shouldRelease（走廊外，被閘擋掉）  ${gated.toFixed(4)} µs`)
