import { bench, describe } from 'vitest'
import {
  createProjectileLoad, resetProjectileLoad, stepProjectileLoad,
} from './projectile-load'

/**
 * 彈丸池微基準。
 *
 * 驗收門檻（spec §3.2）：滿載 4,000 發時維持 60 FPS。換算成單步預算是
 * 400 µs（240 Hz 下一幀最多 4 步，1.6 ms 只佔一幀的 10%）。
 *
 * 本檔只負責**輸出**數字；會讓 `npx vitest run` 紅燈的是
 * test/unit/perf-gate.test.ts，兩者呼叫的是同一份 bench/projectile-load.ts。
 */
const RESET_INTERVAL = 240

describe('World.step（滿載彈丸池）', () => {
  const state = createProjectileLoad()
  let steps = 0

  bench('4,000 發 + 2 架 × 6 命中盒', () => {
    stepProjectileLoad(state)
    if (++steps % RESET_INTERVAL === 0) resetProjectileLoad(state)
  })
})
