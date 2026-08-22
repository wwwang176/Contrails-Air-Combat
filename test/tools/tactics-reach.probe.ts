import { createBattle, stepBattle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_TACTICS } from '../../src/ai/tactics'
import type { TacticalPhase } from '../../src/ai/tactics'
import { Idle, SCENES, SEED, STEPS, DT } from './spawn-snapshot'

/**
 * 戰術層在每個場景「碰得到嗎」。**一次性的量尺，不是測試。**
 *
 * 回答的是「`quota = 0.5` 跟關掉一模一樣」到底是沒接上，還是那一場的距離
 * 本來就進不了 `enterRange`。
 */
const PHASES: TacticalPhase[] = ['off', 'build', 'perch', 'dive', 'zoom', 'cooldown']

function run(name: keyof typeof SCENES, quota: number): void {
  const b = createBattle(new Idle(), SCENES[name](), SEED)
  const ais: AiController[] = []
  for (const c of b.world.combatants) {
    if (c.controller instanceof AiController) {
      c.controller.tacticalConfig = { ...DEFAULT_TACTICS, quota }
      ais.push(c.controller)
    }
  }
  const slots = ais.filter((a) => a.tactics.lastTarget !== -2).length
  const count = new Map<TacticalPhase, number>(PHASES.map((p) => [p, 0]))
  let samples = 0
  let maxRange = 0
  let farSamples = 0
  for (let k = 0; k < STEPS; k++) {
    stepBattle(b, DT)
    if (k % 24 !== 0) continue
    for (const a of ais) {
      count.set(a.tactics.phase, count.get(a.tactics.phase)! + 1)
      samples++
      const r = a.sit.range
      if (r > maxRange) maxRange = r
      if (r > DEFAULT_TACTICS.enterRange) farSamples++
    }
  }
  const parts = PHASES.map((p) => `${p} ${(100 * count.get(p)! / samples).toFixed(1)}%`)
  console.log(`${name} quota=${quota}  架數 ${ais.length}（起始名額 ${slots}）`)
  console.log(`  ${parts.join('  ')}`)
  console.log(`  最遠 ${maxRange.toFixed(0)} m，超過 enterRange 的取樣 `
    + `${(100 * farSamples / samples).toFixed(1)}%`)
}

for (const name of Object.keys(SCENES) as (keyof typeof SCENES)[]) {
  run(name, 0.5)
}
