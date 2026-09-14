/**
 * 安全層的 clearance 要多少才擋得住「俯衝進上升中的地形」。不是測試。
 *
 * 跑法：`node node_modules/vite-node/vite-node.mjs test/tools/terrain-clearance.probe.ts`
 */
import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { createArchipelago } from '../../src/world/archipelago'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { AiController } from '../../src/ai/AiController'
import { isCrashed } from '../../src/aircraft/crash'
import { DEFAULT_SAFETY } from '../../src/ai/safety'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

class Idle implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim); out.throttle = 0.7; out.firing = false
  }
}
const DT = 1 / 240
const arch = createArchipelago()
function ground(x: number, z: number): number {
  const h = arch.field.sample(x, z)
  return Number.isFinite(h) && h > 0 ? h : 0
}
const BASE_FIGHTER = DEFAULT_SAFETY.fighterClearance
const BASE_BOMBER = DEFAULT_SAFETY.bomberClearance

for (const clearance of [120, 160, 200, 260, 320]) {
  DEFAULT_SAFETY.fighterClearance = clearance
  DEFAULT_SAFETY.bomberClearance = clearance
  const b = createBattle(new Idle(), {
    ...DEFAULT_BATTLE, altitude: 600, units: lineAbreast(HEAD_ON, P51D, 20, BF109K4, 20),
  }, 20260805)
  let hit = 0, fell = 0
  b.world.crashPolicy = (c) => {
    const p = c.aircraft.state.position
    const crashed = isCrashed(p, (x, z) => ground(x, z), 0)
    if (crashed && ground(p.x, p.z) > 1) { if (c.hp > 0) hit++; else fell++ }
    return crashed
  }
  for (const c of b.world.combatants) {
    const ctl = c.controller
    if (ctl instanceof AiController) { ctl.terrain = { islands: arch.islands }; ctl.clearTerrainState() }
  }
  let touched = 0
  const seen = new Set<number>()
  let minMargin = Infinity
  for (let i = 0; i < Math.round(180 / DT); i++) {
    stepBattle(b, DT)
    if (i % 12 !== 0) continue
    for (let k = 0; k < b.world.combatants.length; k++) {
      const c = b.world.combatants[k]!
      if (!c.alive) continue
      const p = c.aircraft.state.position
      const g = ground(p.x, p.z)
      if (g > 1 && p.y - g < minMargin) minMargin = p.y - g
      const ctl = c.controller
      if (ctl instanceof AiController && ctl.safetyAction === 'terrain') seen.add(k)
    }
  }
  touched = seen.size
  console.log('clearance', String(clearance).padStart(3), 'm | 撞山', hit,
    '| 被打下來掉在陸上', fell, '| 被地形接管過', touched, '/ 40',
    '| 陸上最低餘裕', minMargin.toFixed(0), 'm',
    '| 存活', b.world.combatants.filter((c) => c.alive).length)
}
DEFAULT_SAFETY.fighterClearance = BASE_FIGHTER
DEFAULT_SAFETY.bomberClearance = BASE_BOMBER
