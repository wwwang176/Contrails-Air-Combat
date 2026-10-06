import { describe, expect, it } from 'vitest'
import { createSurfaceAttackState, resetSurfaceAttack, type StrikeRef } from '../../src/ai/surfaceAttack'
import { createStrikeState } from '../../src/ai/strikeRun'
import { createBombAim } from '../../src/ai/bombRun'
import { createDiveBombState } from '../../src/ai/diveBomb'
import { createShipAim } from '../../src/ai/shipAttack'
import { createGroundTarget } from '../../src/world/groundTargets'

describe('對地與對艦航次重設', () => {
  it('清除舊航次但保留狀態物件，且不需要世界或飛機依賴', () => {
    const state = createSurfaceAttackState()
    const ctx = {
      strike: createStrikeState(), bombAim: createBombAim(), diveBomb: createDiveBombState(),
      shipAim: createShipAim(), strikeRef: { kind: 'ground', index: 3 } as StrikeRef,
    }
    const groundStrafe = state.groundStrafe
    const references = { ...ctx }
    state.groundAim = 3
    state.groundAttackActive = true
    state.groundStrafeActive = true
    groundStrafe.phase = 'egress'
    groundStrafe.armed = true
    groundStrafe.target = createGroundTarget(3, 'parkedP51', 'red', 0, 0, 0)
    groundStrafe.egressHeading.set(1, 0, 0)
    groundStrafe.reattackRange = 3000
    groundStrafe.interceptTime = 0.8
    ctx.strike.phase = 'egress'
    ctx.strike.target = 3
    ctx.strike.release = true
    ctx.strike.plan.aim.set(10, 20, 30)
    ctx.bombAim.active = true
    ctx.bombAim.release = true
    ctx.bombAim.aim.set(10, 20, 30)
    ctx.diveBomb.phase = 'dive'
    ctx.diveBomb.holdAlt = 1700
    ctx.diveBomb.aim.set(10, 20, 30)
    ctx.shipAim.ship = 3
    ctx.shipAim.gun = 2
    ctx.shipAim.point = 1

    resetSurfaceAttack(state, ctx)

    expect(state).toEqual(createSurfaceAttackState())
    expect(ctx.strike).toEqual(createStrikeState())
    expect(ctx.bombAim).toEqual(createBombAim())
    expect(ctx.diveBomb).toEqual(createDiveBombState())
    // 與原行為一致：解除主索引即可使砲位、瞄點與種類失效。
    expect(ctx.shipAim).toEqual({ ship: -1, gun: 2, point: 1 })
    expect(ctx.strikeRef).toEqual({ kind: 'ground', index: -1 })
    expect(state.groundStrafe).toBe(groundStrafe)
    for (const key of ['strike', 'bombAim', 'diveBomb', 'shipAim', 'strikeRef'] as const) {
      expect(ctx[key]).toBe(references[key])
    }
  })
})
