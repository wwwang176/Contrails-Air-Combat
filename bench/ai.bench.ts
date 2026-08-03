import { bench, describe } from 'vitest'
import { createAiLoad, resetAiLoad, stepAiLoad } from './ai-load'

/**
 * AI 纏鬥的微基準。
 *
 * 本檔只負責**輸出**數字；會讓 `npx vitest run` 紅燈的是
 * test/unit/perf-gate.test.ts，兩者呼叫同一份 bench/ai-load.ts。
 */
const RESET_INTERVAL = 240 * 20

describe('World.step（兩架 AI 纏鬥）', () => {
  const state = createAiLoad()
  let steps = 0

  bench('2 架 AI + 彈丸 + 命中判定', () => {
    stepAiLoad(state)
    if (++steps % RESET_INTERVAL === 0) resetAiLoad(state)
  })
})
