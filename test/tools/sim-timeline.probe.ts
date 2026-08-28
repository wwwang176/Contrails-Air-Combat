/** 【拋棄式】用遊戲實際的遭遇戰設定（VETERAN、20v20、中空）重跑時間線。 */
import { Vector3 } from 'three'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv
const AI = argv[argv.length - 1] !== 'idle'
const DT = 1 / 240
class Idle implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim); out.throttle = 0.7; out.firing = false
  }
}
const b = createBattle(new Idle(), battleConfigFrom(DEFAULT_SKIRMISH), 1)
if (!AI) for (const k of b.world.combatants) k.controller = new Idle()
const ais = b.world.combatants.map((c) => c.controller).filter((k): k is AiController => k instanceof AiController)
const made = () => ais.reduce((a, k) => a + (k as unknown as { decisionsMade: number }).decisionsMade, 0)

const WIN = 1200
let prev = made()
for (let seg = 0; seg < 30; seg++) {
  const us = new Float64Array(WIN)
  for (let i = 0; i < WIN; i++) {
    const t = performance.now(); stepBattle(b, DT); us[i] = (performance.now() - t) * 1000
  }
  const s = Array.from(us).sort((a, x) => a - x)
  const cs = b.world.combatants
  const alive = cs.filter((c) => c.alive).length
  const m = made(); const dps = (m - prev) / WIN; prev = m
  let near = 0
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    if (cs[i]!.team !== cs[j]!.team && cs[i]!.alive && cs[j]!.alive
      && cs[i]!.aircraft.state.position.distanceTo(cs[j]!.aircraft.state.position) < 2000) near++
  }
  console.log(`t=${((seg + 1) * WIN * DT).toFixed(0).padStart(3)}s 活${String(alive).padStart(2)} 近${String(near).padStart(3)} 決策/步 ${dps.toFixed(2)} 彈${String(b.world.projectiles.live).padStart(4)}  `
    + `p50 ${s[(WIN * 0.5) | 0]!.toFixed(0).padStart(5)}  p95 ${s[(WIN * 0.95) | 0]!.toFixed(0).padStart(5)}  p99 ${s[(WIN * 0.99) | 0]!.toFixed(0).padStart(5)}  max ${s[WIN - 1]!.toFixed(0).padStart(6)} µs`)
}
