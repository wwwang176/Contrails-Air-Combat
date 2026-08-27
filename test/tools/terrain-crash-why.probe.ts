/**
 * 甲板群島那一場，是誰撞了山、為什麼。不是測試（`.probe.ts`）。
 *
 * 跑法：`node node_modules/vite-node/vite-node.mjs test/tools/terrain-crash-why.probe.ts`
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
    out.aimWorld.copy(this.aim); out.throttle = 0.7; out.firing = false
  }
}

const DT = 1 / 240
const arch = createArchipelago()
function ground(x: number, z: number): number {
  const h = arch.field.sample(x, z)
  return Number.isFinite(h) && h > 0 ? h : 0
}

const b = createBattle(new Idle(), {
  ...DEFAULT_BATTLE, altitude: 600, units: lineAbreast(HEAD_ON, P51D, 20, BF109K4, 20),
}, 20260805)

/** 每架最近 N 步的狀態，用來回看撞山前發生了什麼 */
const TRAIL = 240 * 8
const trail = b.world.combatants.map(() => [] as string[])
let now = 0

b.world.crashPolicy = (c) => {
  const p = c.aircraft.state.position
  const crashed = isCrashed(p, (x, z) => ground(x, z), 0)
  if (crashed && ground(p.x, p.z) > 1 && c.hp > 0) {
    const ctl = c.controller
    const ai = ctl instanceof AiController ? ctl : null
    console.log(`\n=== #${c.index} 撞山 t=${now.toFixed(1)}s`,
      `hp ${c.hp.toFixed(0)}/${c.aircraft.spec.hp}`,
      `位置 ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}`,
      `地形 ${ground(p.x, p.z).toFixed(0)} m`,
      `TAS ${(c.aircraft.state.velocity.length() * 3.6).toFixed(0)} km/h`,
      ai ? `意圖 ${ai.intent}/${ai.mode} 安全層 ${ai.safetyAction}` : '(非 AI)')
    console.log('  前 8 秒（每 0.5 s）：')
    for (const line of trail[c.index]!) console.log('   ', line)
  }
  return crashed
}
for (const c of b.world.combatants) {
  const ctl = c.controller
  if (ctl instanceof AiController) { ctl.terrain = { islands: arch.islands }; ctl.clearTerrainState() }
}

for (let i = 0; i < Math.round(180 / DT); i++) {
  now = i * DT
  stepBattle(b, DT)
  if (i % 120 !== 0) continue
  for (const c of b.world.combatants) {
    if (!c.alive) continue
    const p = c.aircraft.state.position
    const ctl = c.controller
    const ai = ctl instanceof AiController ? ctl : null
    const sn = ai === null ? null : (ai as unknown as { sense: { island: number; floor: number } }).sense
    const t = trail[c.index]!
    t.push(`t=${now.toFixed(1)} y=${p.y.toFixed(0)} 離地=${(p.y - ground(p.x, p.z)).toFixed(0)}`
      + ` TAS=${(c.aircraft.state.velocity.length() * 3.6).toFixed(0)}`
      + ` hp=${c.hp.toFixed(0)}`
      + (ai ? ` ${ai.intent}/${ai.mode} 安全層=${ai.safetyAction} 島=${sn!.island} 地板=${sn!.floor.toFixed(0)}` : ''))
    if (t.length > TRAIL / 120) t.shift()
  }
}
console.log('\n跑完')
