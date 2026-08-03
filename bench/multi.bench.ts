import { bench, describe } from 'vitest'
import { createMultiLoad, resetMultiLoad, stepMultiLoad } from './multi-load'

/**
 * 20v20 × 滿載彈丸的微基準。
 *
 * 本檔只負責**輸出**數字；會讓 `npx vitest run` 紅燈的是
 * test/unit/perf-gate.test.ts，兩者呼叫同一份 bench/multi-load.ts。
 */
const RESET_INTERVAL = 240 * 20

describe('World.step（20v20 + 滿載 4,000 發）', () => {
  const state = createMultiLoad()
  let steps = 0

  bench('40 架 AI + 滿載彈丸 + 命中判定', () => {
    stepMultiLoad(state)
    if (++steps % RESET_INTERVAL === 0) resetMultiLoad(state)
  })
})
