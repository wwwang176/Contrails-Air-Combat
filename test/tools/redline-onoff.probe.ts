/**
 * 紅線守線的開／關對照：F4F-4 對 A6M5 各 20 架打 300 秒，A6M 活著時
 * IAS/vne 的最高值。關掉的做法是把 `overspeedRatio` 拉到 2，讓守線永不觸發。
 *
 *   npx vite-node test/tools/redline-onoff.probe.ts
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { battleConfigFrom, uniform } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_SAFETY } from '../../src/ai/safety'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 300
const SEED = 20260907

function a6mMax(): number {
  const b = createBattle(
    new AiController(), battleConfigFrom(uniform('f4f4', 20, 'a6m5', 20)), SEED,
  )
  const red: Combatant[] = b.world.combatants.filter((c) => c.team === 'red')
  const ias = (c: Combatant): number => c.aircraft.diag.aero.tas * Math.sqrt(c.aircraft.diag.air.sigma)
  let best = 0
  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    for (const c of red) {
      if (!c.alive) continue
      const r = ias(c) / c.aircraft.spec.limits.vne
      if (r > best) best = r
    }
  }
  return best
}

const saved = DEFAULT_SAFETY.overspeedRatio
console.log(JSON.stringify({ 守線開著: a6mMax().toFixed(3) }))
DEFAULT_SAFETY.overspeedRatio = 2
console.log(JSON.stringify({ 守線關掉: a6mMax().toFixed(3) }))
DEFAULT_SAFETY.overspeedRatio = saved
