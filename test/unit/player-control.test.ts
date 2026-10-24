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
import { STICK_GAIN } from '../../src/input/mouseStick'

/**
 * 觸控層：預設有一根手指按著。`recentre` 照真的那一份，把手指現在的位置當成新的中心，位置歸零
 */
function fakeTouch() {
  const touch = {
    visible: false,
    held: true,
    stick: { x: 0, y: 0 },
    recentre: vi.fn(() => { touch.stick.x = 0; touch.stick.y = 0 }),
  }
  return touch
}

function setup() {
  const world = new World()
  const playerController = { update() {}, coolWhileAway: vi.fn() }
  const playerAi = { update() {} }
  const player = world.add(new Aircraft(P51D), playerController, 'blue', new Vector3())
  const input = createInputState()
  const deps = {
    input, playerController, playerAi,
    bindings: { clearHolds: vi.fn() }, camera: new PerspectiveCamera(),
    rig: { viewBase: new Quaternion(), snapTo: vi.fn(), magnification: 2.5 },
    aimAssist: { step: vi.fn(), reset: vi.fn() },
    visuals: { get: () => ({ position: new Vector3(10, 20, 30) }) },
    godCam: createGodCameraState(), godBlend: createCameraBlend(),
    godInput: { lookX: 0, lookY: 0 }, damageMarks: createDamageMarks(),
    touch: fakeTouch(),
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

  /** 【代飛時前機槍照樣冷卻】那時 `World.step` 不呼叫玩家控制器，熱度會凍結 */
  it('代飛的每一幀替玩家控制器冷卻，手動操控時不另外冷卻', () => {
    const { input, deps, step } = setup()
    step()
    expect(deps.playerController.coolWhileAway).not.toHaveBeenCalled()
    input.playerAi = true
    step()
    expect(deps.playerController.coolWhileAway).toHaveBeenCalledTimes(1)
    expect(deps.playerController.coolWhileAway).toHaveBeenCalledWith(1 / 60)
    input.playerAi = false
    step()
    expect(deps.playerController.coolWhileAway).toHaveBeenCalledTimes(1)
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
      1 / 60, player, world.combatants, 2.5,
    )
    input.viewMode = 'bomb'
    input.aimDeltaX = 0.1
    step()
    input.playerAi = true
    step()
    expect(deps.aimAssist.step).toHaveBeenCalledTimes(1)
    expect(deps.aimAssist.reset).toHaveBeenCalledTimes(2)
  })

  /**
   * 【滑鼠搖桿】滑鼠位移推搖桿而不是轉瞄準點；瞄準點每幀放在機首，鏡頭因此跟著機首。
   * 瞄準輔助推的是瞄準點，這個模式沒有，放掉
   */
  it('滑鼠搖桿：位移進搖桿、瞄準點在機首、不套瞄準輔助', () => {
    const { player, input, deps, step } = setup()
    player.aircraft.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), 0.5)
    const nose = new Vector3(0, 0, -1).applyQuaternion(player.aircraft.state.orientation)
    input.controlMode = 'stick'
    input.aimWorld.set(1, 0, 0)
    input.aimDeltaX = 0.1
    input.aimDeltaY = -0.04
    step()
    expect(input.stickActive).toBe(true)
    expect(input.stickX).toBeCloseTo(0.1 * STICK_GAIN, 12)
    expect(input.stickY).toBeCloseTo(-0.04 * STICK_GAIN, 12)
    expect(input.aimDeltaX).toBe(0)
    expect(input.aimWorld.distanceTo(nose)).toBeLessThan(1e-12)
    expect(deps.aimAssist.step).not.toHaveBeenCalled()
    expect(deps.aimAssist.reset).toHaveBeenCalled()
  })

  it('滑鼠搖桿＋投彈視角：照樣推搖桿，瞄準點在機首', () => {
    const { input, step } = setup()
    input.controlMode = 'stick'
    input.viewMode = 'bomb'
    input.aimWorld.set(1, 0, 0)
    input.aimDeltaX = 0.1
    step()
    expect(input.stickX).toBeCloseTo(0.1 * STICK_GAIN, 12)
    expect(input.aimWorld.toArray()).toEqual([0, 0, -1])
  })

  /**
   * 【觸控搖桿】位置照抄觸控給的值，不經過滑鼠的累積；這一幀的滑鼠位移清掉。
   * 瞄準點在機首、不套瞄準輔助，與滑鼠搖桿一樣
   */
  it('觸控層顯示＋設定搖桿：搖桿位置照抄觸控', () => {
    const { player, input, deps, step } = setup()
    player.aircraft.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), 0.5)
    const nose = new Vector3(0, 0, -1).applyQuaternion(player.aircraft.state.orientation)
    input.controlMode = 'stick'
    deps.touch.visible = true
    step()
    deps.touch.stick.x = 0.6
    deps.touch.stick.y = -0.3
    input.aimDeltaX = 0.1
    step()
    expect(input.stickActive).toBe(true)
    expect([input.stickX, input.stickY]).toEqual([0.6, -0.3])
    expect(input.aimDeltaX).toBe(0)
    expect(input.aimWorld.distanceTo(nose)).toBeLessThan(1e-12)
    expect(deps.aimAssist.step).not.toHaveBeenCalled()
  })

  /** 【不吃回中設定】手指按住不動，「回中：快」也不能把桿量吃掉 */
  it('觸控搖桿：手指不動，回中「快」多步之後位置不變', () => {
    const { input, deps, step } = setup()
    input.controlMode = 'stick'
    input.stickRecenter = 'fast'
    deps.touch.visible = true
    step()
    deps.touch.stick.x = 0.8
    for (let i = 0; i < 60; i++) step()
    expect(input.stickX).toBe(0.8)
  })

  /**
   * 【搖桿來源換了就歸零】觸控層出現：滑鼠累積的桿量不帶進觸控；觸控層消失：觸控最後的位置
   * 不交給滑鼠接著累積
   */
  /**
   * 【放開之後照回中設定】手指按著時不衰減（照抄）；放開之後桿量從放開那一刻起照設定走：
   * 「關」留著、「慢」「快」照時間常數衰減，與滑鼠同一個 `stepStick`
   */
  it('觸控搖桿：放開之後依回中設定——關留著、快很快回中、慢比快慢', () => {
    const after = (lv: 'off' | 'slow' | 'fast') => {
      const { input, deps, step } = setup()
      input.controlMode = 'stick'
      input.stickRecenter = lv
      deps.touch.visible = true
      step()
      deps.touch.stick.x = 0.8
      step()
      expect(input.stickX).toBe(0.8)
      deps.touch.held = false
      deps.touch.stick.x = 0
      for (let i = 0; i < 30; i++) step()
      return input.stickX
    }
    expect(after('off')).toBe(0.8)
    const fast = after('fast')
    const slow = after('slow')
    expect(fast).toBeLessThan(0.8 * 0.05)
    expect(slow).toBeGreaterThan(fast)
    expect(slow).toBeLessThan(0.8)
  })

  it('觸控層出現或消失的那一幀桿量與方向舵歸零', () => {
    const { input, deps, step } = setup()
    input.controlMode = 'stick'
    step()
    input.stickX = 0.5
    input.rudderLeft = true
    deps.touch.visible = true
    step()
    expect(input.stickX).toBe(0)
    expect(input.rudderLeft).toBe(false)
    deps.touch.stick.x = 0.7
    step()
    expect(input.stickX).toBe(0.7)
    deps.touch.visible = false
    step()
    expect(input.stickX).toBe(0)
  })

  it('設定是滑鼠瞄準：觸控照舊走瞄準', () => {
    const { input, deps, step } = setup()
    deps.touch.visible = true
    deps.touch.stick.x = 0.6
    input.aimDeltaX = 0.1
    step()
    expect(input.stickActive).toBe(false)
    expect(input.stickX).toBe(0)
    expect(deps.aimAssist.step).toHaveBeenCalledTimes(1)
  })

  /**
   * 【歸零要連觸控一起】只清 `stickX/Y` 的話，下一幀照抄觸控又把按著的手指的位移灌回來：
   * 代飛交還、陣亡後接手僚機都會帶著舊桿量飛
   */
  it('觸控搖桿：交還與陣亡時觸控的中心一起重設，下一幀不灌回舊桿量', () => {
    const { input, deps, battle, step } = setup()
    input.controlMode = 'stick'
    deps.touch.visible = true
    step()
    deps.touch.stick.x = 0.8
    step()
    expect(input.stickX).toBe(0.8)
    input.playerAi = true
    step()
    input.playerAi = false
    step()
    step()
    expect(input.stickX).toBe(0)
    deps.touch.stick.x = 0.8
    battle.takeoverSeat = 1
    step()
    battle.takeoverSeat = -1
    step()
    expect(input.stickX).toBe(0)
  })

  /** 【代飛期間觸控不進搖桿】交還時歸零，代飛中按著的手指不能直接推飛機 */
  it('觸控搖桿＋代飛：位置不照抄', () => {
    const { input, deps, step } = setup()
    input.controlMode = 'stick'
    deps.touch.visible = true
    step()
    input.playerAi = true
    deps.touch.stick.x = 0.6
    step()
    expect(input.stickX).toBe(0)
  })

  /** 【交還時歸零】`I` 交還、離開上帝視角：代飛前壓著的桿量不該接著飛 */
  it('交還操縱時桿量與方向舵歸零', () => {
    const { input, step } = setup()
    input.controlMode = 'stick'
    step()
    input.stickX = 0.7
    input.rudderRight = true
    input.playerAi = true
    step()
    input.playerAi = false
    step()
    expect(input.stickX).toBe(0)
    expect(input.rudderRight).toBe(false)
  })

  /**
   * 【死亡鏡頭的每一幀都清】接手僚機時座位直接換上玩家控制器（`battleRuntime`），不經過這裡的
   * 交還分支；死亡期間按著的 A／D 會帶到新的一架
   */
  it('陣亡期間每一幀桿量與方向舵歸零', () => {
    const { input, battle, step } = setup()
    input.controlMode = 'stick'
    step()
    input.stickY = 0.9
    battle.takeoverSeat = 1
    step()
    expect(input.stickY).toBe(0)
    input.rudderRight = true
    step()
    expect(input.rudderRight).toBe(false)
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
