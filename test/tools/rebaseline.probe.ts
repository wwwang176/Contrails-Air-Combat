/**
 * 重錄 `spawn-baseline.ts` 與 `tactics-baseline.ts` 的 `_REPLAY` 校驗和。
 * 不是測試。跑法：`npx vite-node test/tools/rebaseline.probe.ts`
 *
 * 【為什麼不用 `spawn-baseline.probe.ts`】那一支重印**整個檔案**（含出生表），
 * 而出生表釘的是另一件事、這一輪沒有動，重印會把它的檔頭註解洗掉。這一支
 * 只印四個校驗和，貼回去就好。
 *
 * 【一定要雙跑】重錄一個不穩定的值毫無意義 —— 這一支自己跑兩遍再比對。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { Idle, SCENES, SEED, STEPS, DT, replayDigest } from './spawn-snapshot'

for (const [name, make] of Object.entries(SCENES)) {
  for (const quota0 of [false, true]) {
    const digests: string[] = []
    for (let pass = 0; pass < 2; pass++) {
      const b = createBattle(new Idle(), make(), SEED)
      if (quota0) {
        for (const c of b.world.combatants) {
          if (c.controller instanceof AiController) {
            c.controller.tacticalConfig = { ...c.controller.tacticalConfig, quota: 0 }
          }
        }
      }
      for (let k = 0; k < STEPS; k++) stepBattle(b, DT)
      digests.push(await replayDigest(b))
    }
    const stable = digests[0] === digests[1]
    const tag = quota0 ? `${name}_BEFORE_TACTICS` : `${name}_REPLAY`
    console.log(`${stable ? '雙跑一致' : '★ 雙跑不一致，不可重錄'}  ${tag}`)
    console.log(`  '${digests[0]}'`)
    if (!stable) console.log(`  '${digests[1]}'`)
  }
}
