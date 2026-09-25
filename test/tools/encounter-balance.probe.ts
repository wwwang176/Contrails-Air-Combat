/**
 * **20v20 遭遇戰的攻守平衡有沒有被 `extendRecoveredLatch` 打壞？**
 * 不是測試（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/encounter-balance.probe.ts
 *
 * 【為什麼要這一支】單一種子的 20v20 對這個閂鎖的開關可以反應到戰損比差
 * 好幾倍，但這個系統對初始條件極度敏感（`2026-08-22-extend-recovery-design.md`
 * §2.5），單一種子答不了「是不是真的打壞了」。這一支開與關各跑五次微擾。
 *
 * 【量什麼】只量三件事，其餘不管：
 *
 * ```
 *   存活數        兩隊各自，300 秒結束時
 *   累計傷害      兩隊各自受到的
 *   最大半徑      全程任一架飛機離原點的最大水平距離（戰場有沒有被拉散）
 * ```
 *
 * 【判讀】戰損比是**單一種子的極值統計**還是**系統性的偏斜**？前者在五次
 * 微擾下會來回跳，後者會一致地偏向同一隊。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_RULES, type RuleConfig } from '../../src/ai/rules'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 300
const SEED = 20260807
const SALTS = [0, 101, 202, 303, 404]

const n = (v: number, w: number, d = 1): string =>
  (Number.isFinite(v) ? v.toFixed(d) : '—').padStart(w)

function jitter(b: ReturnType<typeof createBattle>, salt: number): void {
  if (salt === 0) return
  for (const c of b.world.combatants) {
    let h = (salt ^ (c.index * 0x9e3779b1)) >>> 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
    c.aircraft.state.velocity.multiplyScalar(1 + ((h >>> 8) / 0xffffff - 0.5) * 0.01)
  }
}

interface Row {
  blueAlive: number
  redAlive: number
  blueDmg: number
  redDmg: number
  maxRadius: number
}

function run(salt: number, on: boolean): Row {
  const b = createBattle(
    new AiController(), battleConfigFrom(DEFAULT_SKIRMISH), SEED,
  )
  jitter(b, salt)
  const cfg: RuleConfig = on
    ? DEFAULT_RULES
    : { ...DEFAULT_RULES, recoveredExit: false }
  for (const c of b.world.combatants) {
    if (c.controller instanceof AiController) c.controller.rulesConfig = cfg
  }

  const cs: Combatant[] = b.world.combatants
  const hp0 = cs.map((c) => c.hp)
  let maxRadius = 0

  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    if (k % 24 !== 0) continue
    for (const c of cs) {
      if (!c.alive) continue
      const p = c.aircraft.state.position
      const r = Math.hypot(p.x, p.z)
      if (r > maxRadius) maxRadius = r
    }
  }

  let blueAlive = 0
  let redAlive = 0
  let blueDmg = 0
  let redDmg = 0
  for (const c of cs) {
    const taken = Math.max(0, hp0[c.index]! - c.hp)
    if (c.team === b.player.team) { blueDmg += taken; if (c.alive) blueAlive++ }
    else { redDmg += taken; if (c.alive) redAlive++ }
  }
  return { blueAlive, redAlive, blueDmg, redDmg, maxRadius }
}

for (const on of [false, true]) {
  console.log(`\n══ ${on ? '開啟' : '關閉（對照組）'} ══`)
  console.log('  擾動    存活 藍:紅    受傷 藍:紅        戰損比   最大半徑')
  const ratios: number[] = []
  const radii: number[] = []
  for (const salt of SALTS) {
    const r = run(salt, on)
    // 【比值方向固定成「藍受傷 ÷ 紅受傷」】用 max/min 會把「誰吃虧」洗掉，
    // 而這一題問的正是有沒有系統性偏向同一隊
    const ratio = r.blueDmg / Math.max(1, r.redDmg)
    ratios.push(ratio)
    radii.push(r.maxRadius)
    console.log(`  ${String(salt).padStart(4)}  ${n(r.blueAlive, 6, 0)}:`
      + `${n(r.redAlive, 2, 0)}     ${n(r.blueDmg, 7, 0)}:${n(r.redDmg, 7, 0)}`
      + `   ${n(ratio, 8, 3)}   ${n(r.maxRadius, 8, 0)} m`)
  }
  const sorted = ratios.slice().sort((a, x) => a - x)
  console.log(`  戰損比中位 ${n(sorted[2]!, 6, 3)}`
    + `　最大半徑中位 ${n(radii.slice().sort((a, x) => a - x)[2]!, 7, 0)} m`)
}

console.log('\n【怎麼讀】戰損比 = 藍隊受傷 ÷ 紅隊受傷。1.0 = 打平。')
console.log('若五次微擾下比值都偏向同一側，那是系統性偏斜；來回跳就是極值統計。')
