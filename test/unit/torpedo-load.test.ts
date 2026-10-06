import { describe, expect, it, vi } from 'vitest'
import { createTorpedoLoad, resetTorpedoLoad, stepTorpedoLoad } from '../../bench/torpedo-load'
import { TORPEDOES_CAPACITY } from '../../src/world/torpedo'

describe('魚雷效能負載', () => {
  it('每步模擬前補滿魚雷，重設後仍保留八艘存活艦艇', () => {
    const state = createTorpedoLoad()
    const world = state.battle.world
    const ships = world.ships
    expect(ships).toHaveLength(8)
    expect(world.torpedoes.live).toBe(TORPEDOES_CAPACITY)
    let sampledSteps = 0
    const originalStep = world.step.bind(world)
    const step = vi.spyOn(world, 'step').mockImplementation(dt => {
      expect(world.torpedoes.live).toBe(TORPEDOES_CAPACITY)
      expect(ships.filter(ship => ship.hp > 0)).toHaveLength(8)
      sampledSteps++
      originalStep(dt)
    })
    try {
      for (let round = 0; round < 2; round++) {
        // 模擬池已耗盡，驗證下一步與重設都會補回完整負載。
        world.torpedoes.clear()
        if (round > 0) {
          resetTorpedoLoad(state)
          expect(world.torpedoes.live).toBe(TORPEDOES_CAPACITY)
          expect(world.ships).toBe(ships)
        }
        for (let i = 0; i < 1000; i++) stepTorpedoLoad(state)
      }
      expect(sampledSteps).toBe(2000)
    } finally {
      step.mockRestore()
    }
  })
})
