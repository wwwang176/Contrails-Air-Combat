/** 【拋棄式】每步的成本 vs 這一步有幾架在做 10 Hz 決策。 */
import { Vector3 } from 'three'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

const DT = 1 / 240
class Idle implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim); out.throttle = 0.7; out.firing = false
  }
}
const b = createBattle(new Idle(), battleConfigFrom(DEFAULT_SKIRMISH), 1)
const ais = b.world.combatants
  .map((c) => c.controller)
  .filter((k): k is AiController => k instanceof AiController)
console.log(`AI 控制器 ${ais.length} 具`)
const made = () => ais.reduce((a, k) => a + (k as unknown as { decisionsMade: number }).decisionsMade, 0)

for (let i = 0; i < 300 + 9600; i++) stepBattle(b, DT)   // 跑到穩態的纏鬥（t≈41 s）

const N = 4800
const us = new Float64Array(N)
const nd = new Int32Array(N)
let prev = made()
for (let i = 0; i < N; i++) {
  const t = performance.now(); stepBattle(b, DT); us[i] = (performance.now() - t) * 1000
  const m = made(); nd[i] = m - prev; prev = m
}
// 依「這一步有幾架在決策」分桶
const buckets = new Map<number, number[]>()
for (let i = 0; i < N; i++) {
  const k = nd[i]!
  if (!buckets.has(k)) buckets.set(k, [])
  buckets.get(k)!.push(us[i]!)
}
console.log('決策架數 → 步數 / 中位 µs / 平均 µs')
for (const k of Array.from(buckets.keys()).sort((a, x) => a - x)) {
  const v = buckets.get(k)!.sort((a, x) => a - x)
  const mean = v.reduce((a, x) => a + x, 0) / v.length
  console.log(`  ${String(k).padStart(2)}  ${String(v.length).padStart(5)} 步   `
    + `中位 ${v[(v.length * 0.5) | 0]!.toFixed(0).padStart(5)}   平均 ${mean.toFixed(0).padStart(5)}   `
    + `最高 ${v[v.length - 1]!.toFixed(0).padStart(6)}`)
}
const s = Array.from(us).sort((a, x) => a - x)
console.log(`整體 p50 ${s[(N * 0.5) | 0]!.toFixed(0)}  p99 ${s[(N * 0.99) | 0]!.toFixed(0)}  max ${s[N - 1]!.toFixed(0)} µs`)
console.log(`決策總數 ${prev}，平均每步 ${(Array.from(nd).reduce((a, x) => a + x, 0) / N).toFixed(2)} 架`)
