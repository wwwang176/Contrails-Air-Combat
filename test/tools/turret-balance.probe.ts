/**
 * 砲塔傷害倍率的效果 —— 20 架 P-51D 對 20 架 B-17G，300 秒。
 *
 *   npx tsx test/tools/turret-balance.probe.ts
 *
 * 砲塔開與關各跑一場，印兩邊的存活與損失 —— 調平衡要看的是「差多少」。
 *
 * `TURRET_DAMAGE_SCALE` 是模組常數，所以要比不同倍率就改那個常數重跑 ——
 * 這一支只負責把三個數字印乾淨。
 */
import { createBattle, stepBattle, DEFAULT_BATTLE, type Battle } from '../../src/battle/setup'
import { TURRET_DAMAGE_SCALE } from '../../src/weapons/turret'
import { HEAD_ON } from '../../src/battle/entry'
import { lineAbreast } from '../../src/battle/order'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

const DT = 1 / 240
const SEED = 20260821
const SECONDS = 300

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

const config = (): typeof DEFAULT_BATTLE => ({
  ...DEFAULT_BATTLE,
  units: lineAbreast(HEAD_ON, P51D, 20, B17G, 20),
})

function run(turretsOn: boolean): Battle {
  const b = createBattle(new Idle(), config(), SEED)
  if (!turretsOn) {
    for (const c of b.world.combatants) {
      if (c.aircraft.spec.turrets.length === 0) continue
      b.world.setSpec(c, { ...c.aircraft.spec, turrets: [] })
    }
  }
  for (let k = 0; k < SECONDS / DT; k++) stepBattle(b, DT)
  return b
}

const alive = (b: Battle, id: string): number =>
  b.world.combatants.filter((c) => c.alive && c.aircraft.spec.id === id).length

const on = run(true)
const off = run(false)

const p = (b: Battle): string =>
  `P-51 存活 ${String(alive(b, P51D.id)).padStart(2)}/20`
  + `   B-17 存活 ${String(alive(b, B17G.id)).padStart(2)}/20`

console.log(`  TURRET_DAMAGE_SCALE = ${TURRET_DAMAGE_SCALE}`)
console.log(`  砲塔開：${p(on)}`)
console.log(`  砲塔關：${p(off)}`)
console.log(`  → 砲塔讓 P-51 多損失 ${alive(off, P51D.id) - alive(on, P51D.id)} 架`
  + `、B-17 多活 ${alive(on, B17G.id) - alive(off, B17G.id)} 架`)
