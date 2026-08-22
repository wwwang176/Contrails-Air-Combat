import { createBattle, stepBattle } from '../../src/battle/setup'
import { Idle, SCENES, SEED, STEPS, DT, replayDigest } from './spawn-snapshot'

/**
 * 印出每個場景 30 秒重播的校驗和。**一次性的量尺，不是測試。**
 *
 * 用途是回答「這一版的行為 digest 是多少」—— 拿去跟 `spawn-baseline.ts` 的
 * 既有值對照，或當成新護欄的基準。
 */
async function main(): Promise<void> {
  for (const name of Object.keys(SCENES) as (keyof typeof SCENES)[]) {
    const b = createBattle(new Idle(), SCENES[name](), SEED)
    for (let k = 0; k < STEPS; k++) stepBattle(b, DT)
    console.log(`${name}_REPLAY = ${await replayDigest(b)}`)
  }
}

void main()
