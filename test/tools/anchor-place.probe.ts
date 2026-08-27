/**
 * 錨島該放在哪裡。不是測試（`.probe.ts`）。
 *
 * 跑法：`node node_modules/vite-node/vite-node.mjs test/tools/anchor-place.probe.ts`
 *
 * 【要回答什麼】`outerRadius = 1,806` 的錨島放在交會區附近，一定會壓到
 * 某些飛機的進場航跡（編隊橫向撐到 |x| ≤ 2,675，兩隊從 z = ±5,000 對頭）。
 * 那會讓「繞島佔時」混進「開局就在繞路」—— 而我們要的是**纏鬥被山擋路**。
 *
 * 所以把佔時拆成兩段：交會前與交會後。交會 = 兩隊質心的 z 間距首次
 * 小於 1,000 m。挑**交會後高、交會前低**的位置。
 *
 * 【撞山怎麼數】在 `crashPolicy` 這個 predicate 裡數。`World.destroy`
 * 第一行就是 `c.hp = 0`，事後讀 hp 分不出撞山與被打下來 —— 那個判準會
 * 靜靜地恆為「沒撞山」。
 */
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { createArchipelago } from '../../src/world/archipelago'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { AiController } from '../../src/ai/AiController'
import { isCrashed } from '../../src/aircraft/crash'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

class Idle implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim)
    out.throttle = 0.7
    out.firing = false
  }
}

const DT = 1 / 240
/** 交會判定：兩隊質心的 z 間距小於這個值，m */
const MERGE_GAP = 1000
const SECONDS = 180

const arch = createArchipelago()
const src = { islands: arch.islands }
const anchor = arch.islands[0]!
const anchor2 = arch.islands[1]!

function ground(x: number, z: number): number {
  const h = arch.field.sample(x, z)
  return Number.isFinite(h) && h > 0 ? h : 0
}

function run(label: string, altitude: number, n: number, seed: number): void {
  const b = createBattle(new Idle(), {
    ...DEFAULT_BATTLE, altitude, units: lineAbreast(HEAD_ON, P51D, n, BF109K4, n),
  }, seed)

  let hitLand = 0
  b.world.crashPolicy = (c) => {
    const p = c.aircraft.state.position
    const crashed = isCrashed(p, (x, z) => ground(x, z), 0)
    if (crashed && ground(p.x, p.z) > 1) hitLand++
    return crashed
  }
  for (const c of b.world.combatants) {
    const ctl = c.controller
    if (ctl instanceof AiController) { ctl.terrain = src; ctl.clearTerrainState() }
  }

  let merged = false
  let mergeAt = -1
  const pre = { ticks: 0, sense: 0, safety: 0 }
  const post = { ticks: 0, sense: 0, safety: 0 }
  let minMargin = Infinity
  const byIsland = new Map<number, number>()
  /** 這一場曾經被地形接管過的飛機 */
  const touched = new Set<number>()

  for (let i = 0; i < Math.round(SECONDS / DT); i++) {
    stepBattle(b, DT)

    if (!merged) {
      let bz = 0, bn = 0, rz = 0, rn = 0
      for (const c of b.world.combatants) {
        if (!c.alive) continue
        if (c.team === 'blue') { bz += c.aircraft.state.position.z; bn++ }
        else { rz += c.aircraft.state.position.z; rn++ }
      }
      if (bn > 0 && rn > 0 && Math.abs(bz / bn - rz / rn) < MERGE_GAP) {
        merged = true
        mergeAt = i * DT
      }
    }

    if (i % 12 !== 0) continue
    const bin = merged ? post : pre
    for (const c of b.world.combatants) {
      if (!c.alive) continue
      bin.ticks++
      const p = c.aircraft.state.position
      const g = ground(p.x, p.z)
      if (g > 1 && p.y - g < minMargin) minMargin = p.y - g
      const ctl = c.controller
      if (!(ctl instanceof AiController)) continue
      const sn = (ctl as unknown as { sense: { island: number } }).sense
      if (sn.island >= 0) {
        bin.sense++
        byIsland.set(sn.island, (byIsland.get(sn.island) ?? 0) + 1)
      }
      if (ctl.safetyAction === 'terrain') { bin.safety++; touched.add(b.world.combatants.indexOf(c)) }
    }
  }

  const pc = (a: number, t: number): string => ((a / Math.max(1, t)) * 100).toFixed(2) + '%'
  console.log(
    label.padEnd(16),
    '交會', mergeAt.toFixed(0).padStart(3), 's',
    '| 交會前 繞島', pc(pre.sense, pre.ticks).padStart(7), '安全層', pc(pre.safety, pre.ticks).padStart(7),
    '| 交會後 繞島', pc(post.sense, post.ticks).padStart(7), '安全層', pc(post.safety, post.ticks).padStart(7),
    '| 撞山', hitLand,
    '| 陸上最低餘裕', minMargin.toFixed(0).padStart(5), 'm',
    '| 被地形接管過的架數', String(touched.size).padStart(2), '/', n * 2,
    '| 繞的是', [...byIsland.entries()].sort((a, b2) => b2[1] - a[1])
      .map(([i, n2]) => `#${i}${i < 2 ? '(錨)' : ''}:${n2}`).join(' ') || '無',
  )
}

console.log('島數', arch.islands.length, '| 錨島', JSON.stringify({
  cx: anchor.cx, cz: anchor.cz, peak: anchor.peak.toFixed(0),
  outerR: anchor.outerRadius.toFixed(0),
  edgeToOrigin: (Math.hypot(anchor.cx, anchor.cz) - anchor.outerRadius).toFixed(0),
  gap: (Math.hypot(anchor.cx - anchor2.cx, anchor.cz - anchor2.cz)
    - anchor.outerRadius - anchor2.outerRadius).toFixed(0),
}))
run('600 m 4v4', 600, 4, 20260805)
run('600 m 8v8', 600, 8, 20260805)
run('600 m 16v16', 600, 16, 20260805)
run('600 m 12v12', 600, 12, 20260805)
run('600 m 20v20', 600, 20, 20260805)
run('4000 m 8v8', 4000, 8, 20260805)
run('4000 m 20v20', 4000, 20, 20260805)
