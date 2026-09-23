import { describe, expect, it } from 'vitest'
import { PlayerController } from '../../src/control/PlayerController'
import { createCommand } from '../../src/control/Controller'
import { createInputState } from '../../src/input/InputState'
import type { Aircraft } from '../../src/aircraft/Aircraft'

/**
 * # 戰鬥機掛彈的投彈鍵
 *
 * 每按一下 B 投一次。按下與放開落在同一幀之間也不會漏 —— 讀的是累計次數。
 */

const self = {} as Aircraft

describe('PlayerController：B 投彈', () => {
  it('多按一下就投一次，下一步不再投', () => {
    const input = createInputState()
    const pc = new PlayerController(input)
    const out = createCommand()
    pc.update(self, 1 / 240, out)
    expect(out.bombing).toBe(false)
    input.bombTaps++
    pc.update(self, 1 / 240, out)
    expect(out.bombing).toBe(true)
    pc.update(self, 1 / 240, out)
    expect(out.bombing).toBe(false)
    input.bombTaps++
    pc.update(self, 1 / 240, out)
    expect(out.bombing).toBe(true)
  })

  it('投彈鍵不會開槍，左鍵照常開槍', () => {
    const input = createInputState()
    const pc = new PlayerController(input)
    const out = createCommand()
    input.bombTaps++
    pc.update(self, 1 / 240, out)
    expect(out.firing).toBe(false)
    input.firing = true
    pc.update(self, 1 / 240, out)
    expect(out.firing).toBe(true)
  })
})
