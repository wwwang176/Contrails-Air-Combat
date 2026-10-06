import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { createPlayerControl } from '../../src/app/playerControl'
import { createInputState } from '../../src/input/InputState'
import { createCameraBlend } from '../../src/camera/cameraBlend'
import { createGodCameraState } from '../../src/camera/godCamera'
import { createDamageMarks } from '../../src/hud/damageMarks'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'

function setup() {
  const world = new World()
  const playerController = { update() {} }
  const playerAi = { update() {} }
  const player = world.add(new Aircraft(P51D), playerController, 'blue', new Vector3())
  const input = createInputState()
  const deps = {
    input, playerController, playerAi,
    bindings: { clearHolds: vi.fn() }, camera: new PerspectiveCamera(),
    rig: { viewBase: new Quaternion(), snapTo: vi.fn() },
    aimAssist: { step: vi.fn(), reset: vi.fn() },
    visuals: { get: () => ({ position: new Vector3(10, 20, 30) }) },
    godCam: createGodCameraState(), godBlend: createCameraBlend(),
    godInput: { lookX: 0, lookY: 0 }, damageMarks: createDamageMarks(),
  }
  const control = createPlayerControl(deps)
  const battle = { takeoverSeat: -1, takeoverKiller: -1 }
  const step = () => control.stepPlayerControl(battle, player, world, 1 / 60)
  return { world, player, input, deps, control, battle, step }
}

describe('玩家操控的切換', () => {
  it('進上帝視角立刻交給 AI，離開時還給手動操控', () => {
    const { player, input, deps, step } = setup()
    const resetTrack = vi.spyOn(player.aircraft.director, 'resetTrack')
    input.godView = true
    input.firing = true
    input.aimDeltaX = 0.25
    input.aimDeltaY = -0.1
    expect(step()).toBe(false)
    expect(player.controller).toBe(deps.playerAi)
    expect(input.playerAi).toBe(true)
    expect(input.firing).toBe(false)
    expect(deps.godInput).toEqual({ lookX: 0.25, lookY: -0.1 })
    expect(input.aimDeltaX).toBe(0)
    expect(deps.godBlend.active).toBe(true)
    input.godView = false
    step()
    expect(player.controller).toBe(deps.playerController)
    expect(input.playerAi).toBe(false)
    expect(deps.rig.snapTo).toHaveBeenCalledTimes(1)
    expect(resetTrack).toHaveBeenCalledTimes(1)
    expect(deps.godInput).toEqual({ lookX: 0, lookY: 0 })
    step()
    expect(resetTrack).toHaveBeenCalledTimes(1)
  })

  it('死亡效果只在剛死時清一次；死亡中照樣吃上帝鏡頭的輸入', () => {
    const { player, input, deps, control, battle, step } = setup()
    battle.takeoverSeat = 1
    input.godView = true
    input.viewMode = 'bomb'
    input.lookActive = true
    input.lookYaw = 1
    input.aimDeltaX = 0.3
    deps.damageMarks[0]!.intensity = 1
    expect(step()).toBe(true)
    expect(input.dead).toBe(true)
    expect(input.viewMode).toBe('third')
    expect(input.lookActive).toBe(false)
    expect(input.lookYaw).toBe(0)
    expect(deps.damageMarks[0]!.intensity).toBe(0)
    expect(player.controller).toBe(deps.playerController)
    expect(deps.godInput.lookX).toBe(0.3)
    deps.damageMarks[0]!.intensity = 0.8
    step()
    expect(deps.damageMarks[0]!.intensity).toBe(0.8)
    expect(deps.godInput.lookX).toBe(0)
    control.resetDeathState()
    step()
    expect(deps.damageMarks[0]!.intensity).toBe(0)
    battle.takeoverSeat = -1
    step()
    expect(input.dead).toBe(false)
    expect(player.controller).toBe(deps.playerAi)
  })

  it('手動轉動準星之後才套瞄準輔助；投彈視角或 AI 飛時放掉輔助目標', () => {
    const { player, world, input, deps, step } = setup()
    input.aimDeltaX = 0.1
    const initial = input.aimWorld.clone()
    step()
    expect(input.aimWorld.equals(initial)).toBe(false)
    expect(deps.aimAssist.step).toHaveBeenCalledWith(
      input.aimWorld, 0.1 * deps.camera.fov * Math.PI / 180 / 2,
      1 / 60, player, world.combatants,
    )
    input.viewMode = 'bomb'
    input.aimDeltaX = 0.1
    step()
    input.playerAi = true
    step()
    expect(deps.aimAssist.step).toHaveBeenCalledTimes(1)
    expect(deps.aimAssist.reset).toHaveBeenCalledTimes(2)
  })

  it('換場時清掉按住的操控與過渡狀態，不留下過期的離開邊緣', () => {
    const { input, deps, control, step } = setup()
    input.godView = true
    step()
    control.leaveGodView()
    expect(input.godView).toBe(false)
    expect(input.playerAi).toBe(false)
    expect(deps.godBlend.active).toBe(false)
    expect(deps.bindings.clearHolds).toHaveBeenCalledTimes(1)
    step()
    expect(deps.rig.snapTo).not.toHaveBeenCalled()
    expect(deps.godBlend.active).toBe(false)
    input.godView = true
    step()
    expect(deps.godBlend.active).toBe(true)
  })
})
