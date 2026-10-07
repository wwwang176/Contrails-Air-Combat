import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { createBattleAudioController } from '../../src/app/battleAudioController'
import { createListenerMotion } from '../../src/audio/listenerMotion'
import type { Combatant } from '../../src/world/combatant'

/**
 * 聽者的位置。第三人稱鏡頭繞著機身轉，耳朵跟著鏡頭的話，轉頭會改變距離、讓聽者
 * 有速度 —— 都卜勒把附近的引擎聲拉高拉低。耳朵在機身上，朝向才跟鏡頭。
 */
function setup() {
  const camera = new Vector3(100, 50, 0)
  const ear = new Vector3()
  const plane = new Vector3(0, 40, 0)
  const listenerMotion = createListenerMotion()
  const seenAtBegin: Vector3[] = []
  const deps = {
    audio: {
      beginFrame: vi.fn(() => { seenAtBegin.push(ear.clone()) }),
      endFrame: vi.fn(), setTimeScale: vi.fn(),
    },
    cannonAudio: { reset: vi.fn(), playCannons: vi.fn() },
    listenerMotion,
    flightAudio: { reset: vi.fn(), update: vi.fn() },
    aircraftLoopAudio: { reset: vi.fn(), update: vi.fn() },
    battleAudioCues: {
      reset: vi.fn(), rebuildVolleyGroups: vi.fn(), playFrame: vi.fn(), ownTurretVolley: false,
    },
    cameraPosition: camera,
    ear,
    renderPositions: [new Vector3(), plane],
  }
  const controller = createBattleAudioController(deps as unknown as Parameters<typeof createBattleAudioController>[0])
  const player = { index: 1, alive: true } as unknown as Combatant
  const world = { combatants: [], ships: [], groundTargets: [], projectiles: {}, bombs: {} } as never
  return { controller, camera, ear, plane, player, world, listenerMotion, seenAtBegin }
}

describe('聽者的位置', () => {
  it('自己在飛：耳朵在機身上，而且在音訊引擎讀方位之前就寫好', () => {
    const { controller, ear, plane, player, world, seenAtBegin } = setup()
    controller.update(world, player, 1, 1 / 60, false, false)
    expect(ear.toArray()).toEqual(plane.toArray())
    expect(seenAtBegin[0]!.toArray()).toEqual(plane.toArray())
  })

  it('上帝視角與陣亡後：耳朵在鏡頭上', () => {
    const { controller, ear, camera, player, world } = setup()
    controller.update(world, player, 1, 1 / 60, true, false)
    expect(ear.toArray()).toEqual(camera.toArray())
    const dead = { ...player, alive: false } as Combatant
    controller.update(world, dead, 2, 1 / 60, false, false)
    expect(ear.toArray()).toEqual(camera.toArray())
  })

  /** 鏡頭繞著機身轉一大圈，機身不動 —— 聽者不該有速度 */
  it('鏡頭繞機身轉，都卜勒用的聽者速度維持 0', () => {
    const { controller, camera, player, world, listenerMotion } = setup()
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2
      camera.set(Math.cos(a) * 15, 43, Math.sin(a) * 15)
      controller.update(world, player, i / 60, 1 / 60, false, false)
    }
    expect(listenerMotion.velocity.length()).toBe(0)
  })

  /**
   * 上帝視角：聽者不參與都卜勒。鏡頭 300 m/s 掠過飛機時音高會被拉到近兩倍，而 Shift 的
   * 1,200 m/s 會被當成瞬移、一下歸零一下恢復 —— 只留飛機自己的移動造成的變調
   */
  it('上帝視角時鏡頭在移動，都卜勒用的聽者速度仍是 0', () => {
    const { controller, camera, plane, player, world, listenerMotion } = setup()
    // 先在座艙裡飛一段，帶著速度切進上帝視角 —— 不歸零的話那一段速度會留著
    for (let i = 0; i < 30; i++) {
      plane.z -= 100 / 60
      controller.update(world, player, i / 60, 1 / 60, false, false)
    }
    expect(listenerMotion.velocity.length()).toBeGreaterThan(50)
    for (let i = 0; i < 60; i++) {
      camera.set(i * 5, 500, 0)
      controller.update(world, player, i / 60, 1 / 60, true, false)
    }
    expect(listenerMotion.velocity.length()).toBe(0)
  })

  /** 回座艙：耳朵瞬移回機身那一幀不算速度，之後照常量機身的速度 */
  it('從上帝視角回座艙：不跳，之後聽者速度跟上機身', () => {
    const { controller, camera, plane, player, world, listenerMotion } = setup()
    camera.set(5000, 800, 0)
    controller.update(world, player, 0, 1 / 60, true, false)
    controller.update(world, player, 1 / 60, 1 / 60, false, false)
    expect(listenerMotion.velocity.length()).toBe(0)
    for (let i = 0; i < 60; i++) {
      plane.z -= 100 / 60
      controller.update(world, player, (i + 2) / 60, 1 / 60, false, false)
    }
    expect(-listenerMotion.velocity.z).toBeCloseTo(100, 0)
  })
})
