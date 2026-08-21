/**
 * 產生「改動前」的出生表、編制表與 30 秒重播校驗和。
 *
 *   npx tsx test/tools/spawn-baseline.probe.ts > test/fixtures/spawn-baseline.ts
 *
 * 邏輯全在 `spawn-snapshot.ts`，這裡只負責印。**產生的檔案要自己補上檔頭
 * 註解**（那一段不適合由這裡印，改一次註解就要重跑一次探針）。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { Idle, SCENES, SEED, STEPS, DT, spawnLines, replayDigest } from './spawn-snapshot'

// 【頂層 await】`isolatedModules` + ESNext module 下可用；`replayDigest` 因為
// 走 `crypto.subtle` 是 async
for (const [name, make] of Object.entries(SCENES)) {
  const b = createBattle(new Idle(), make(), SEED)
  console.log(`export const ${name}: readonly string[] = [`)
  for (const line of spawnLines(b)) console.log(`  '${line}',`)
  console.log(']')
  for (let k = 0; k < STEPS; k++) stepBattle(b, DT)
  console.log(`export const ${name}_REPLAY = '${await replayDigest(b)}'`)
  console.log('')
}
