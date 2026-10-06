import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { createInputState } from '../../src/input/InputState'
import { createCameraBlend } from '../../src/camera/cameraBlend'
import { createCameraShake } from '../../src/camera/cameraShake'
import { createGodCameraState } from '../../src/camera/godCamera'
import type { CameraRig } from '../../src/camera/CameraRig'
import {
  createBattleCameraFrameOutput, createBattleCameraFrameScratch,
  updateBattleCameraFrame, type BattleCameraFrameDependencies,
} from '../../src/app/battleCameraFrame'

function fixture() {
  const camera = new PerspectiveCamera(65, 16 / 9, 1, 60000)
  const rig = { update: vi.fn<CameraRig['update']>() }
  const deps: BattleCameraFrameDependencies = {
    ctx: { camera }, rig,
    godCam: createGodCameraState(), godTarget: new Vector3(),
    godBlend: createCameraBlend(), cameraShake: createCameraShake(),
    scratch: createBattleCameraFrameScratch(),
  }
  const output = createBattleCameraFrameOutput()
  const input = createInputState()
  const aircraft = new Aircraft(P51D)
  const player = { aircraft }
  const world = { bombDrag: 0, groundAt: () => 0 }
  const terrain = { collisionHeightAt: () => 20 }
  const position = new Vector3(10, 1000, 20)
  const quaternion = new Quaternion()
  function step(bombPoint: Vector3 | null = null, frameSeconds = 1 / 60, worldSeconds = 1 / 60) {
    updateBattleCameraFrame(
      deps, frameSeconds, worldSeconds, input, world, terrain, 1 / 240,
      player, null, position, quaternion, bombPoint, output,
    )
  }
  return { deps, output, input, aircraft, rig, world, position, quaternion, step }
}

describe('戰鬥幀的鏡頭', () => {
  it('內插後的姿態直接寫進既有的 HUD 輸出物件', () => {
    const f = fixture()
    const attitude = f.output.attitude
    f.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 6)
    f.step()
    expect(f.output.attitude).toBe(attitude)
    expect(attitude.pitch).toBeCloseTo(Math.PI / 6)
    expect(attitude.roll).toBeCloseTo(0)
    expect(f.output.agl).toBe(980)
    expect(f.output.releaseOk).toBe(false)
    expect(f.output.releaseEnv).toBeNull()
    f.quaternion.identity()
    f.step()
    expect(attitude.pitch).toBeCloseTo(0)
    expect(attitude.roll).toBeCloseTo(0)
  })

  it('重用解出的落點；瞄準器關掉時清掉過期的目標', () => {
    const f = fixture()
    f.input.viewMode = 'bomb'
    const mount = new Vector3(0, -2, 0)
    f.step(mount)
    expect(f.output.bombState).toBe('solved')
    expect(f.output.bombTarget).toBe(f.deps.scratch.bombPoint)
    expect(f.deps.scratch.bombStart.y).toBe(998)
    expect(f.rig.update.mock.calls[0]![9]).toBe(f.output.bombTarget)
    f.input.viewMode = 'third'
    f.step(mount)
    expect(f.output.bombState).toBe('solved')
    expect(f.output.bombTarget).toBeNull()
    f.step()
    expect(f.output.bombState).toBe('off')
    expect(f.output.bombTarget).toBeNull()
  })

  it('模擬暫停時，自由鏡頭照幀時間移動', () => {
    const f = fixture()
    f.deps.godCam.position.set(0, 1000, 0)
    f.input.godView = true
    f.input.godMove.forward = true
    f.deps.cameraShake.sustained = 1
    f.step(new Vector3(), 0.1, 0)
    expect(f.deps.godCam.position.z).toBeLessThan(0)
    expect(f.deps.ctx.camera.position).toEqual(f.deps.godCam.position)
    expect(f.rig.update).not.toHaveBeenCalled()
    expect(f.deps.cameraShake.sustained).toBe(0)
    expect(f.output.bombState).toBe('off')
    expect(f.output.bombTarget).toBeNull()
  })

  it('瞄準器解不出來時回報無解，不留著上一次的落點', () => {
    const f = fixture()
    f.input.viewMode = 'bomb'
    f.input.bombRelease = true
    f.step()
    expect(f.output.bombState).toBe('solved')
    expect(f.deps.scratch.bombEye).toEqual(f.position)
    f.world.groundAt = () => -1e9
    f.step()
    expect(f.output.bombState).toBe('none')
    expect(f.output.bombTarget).toBeNull()
  })
})
