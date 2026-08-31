/**
 * **PURSUIT_MIRROR_8V8 的距離閘到底開了沒？** 不是測試。
 *
 * 跑法：`npx vite-node test/tools/tactics-gate.probe.ts`
 *
 * `tactics-off.test.ts` 有一格斷言那一場「打不到 enterRange，所以開關沒有
 * 差別」，並把成因（最遠交戰距離 2174 m < 2500 m）也釘住。命中盒改動之後
 * 量到 2742 m —— 那個前提不再成立。這一支問的是**結論還成不成立**：
 * quota 0 與 0.5 的校驗和是不是仍然相同。
 *
 *   相同  →  只是那個註解裡的數字過期了，閘還是沒有真的改變行為
 *   不同  →  這一格的整個分類都變了，那不是改數字能解決的
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_TACTICS } from '../../src/ai/tactics'
import { Idle, SCENES, SEED, STEPS, DT, replayDigest } from './spawn-snapshot'

for (const name of ['PURSUIT_MIRROR_8V8', 'HEADON_20V20'] as const) {
  const out: { quota: number; digest: string; maxRange: number; open: number }[] = []
  for (const quota of [0, 0.5]) {
    const b = createBattle(new Idle(), SCENES[name](), SEED)
    const ais: AiController[] = []
    for (const c of b.world.combatants) {
      if (c.controller instanceof AiController) {
        c.controller.tacticalConfig = { ...DEFAULT_TACTICS, quota }
        ais.push(c.controller)
      }
    }
    let maxRange = 0
    let open = 0
    for (let k = 0; k < STEPS; k++) {
      stepBattle(b, DT)
      if (k % 24 !== 0) continue
      for (const a of ais) {
        if (a.sit.range > maxRange) maxRange = a.sit.range
        if (a.sit.range >= DEFAULT_TACTICS.enterRange) open++
      }
    }
    out.push({ quota, digest: await replayDigest(b), maxRange, open })
  }
  console.log(`\n══ ${name}　enterRange = ${DEFAULT_TACTICS.enterRange} m ══`)
  for (const r of out) {
    console.log(`  quota ${r.quota}　最遠交戰 ${r.maxRange.toFixed(0)} m`
      + `　超過閘門的取樣 ${r.open} 次`)
  }
  console.log(`  兩者校驗和${out[0]!.digest === out[1]!.digest ? '**相同**' : '不同'}`)
  console.log(`    ${out[0]!.digest}`)
  console.log(`    ${out[1]!.digest}`)
}
