import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import {
  CANNON_SHAKE, SHAKE_MAX_ANGLE, addCannonShake, addShake, applyCameraShake,
  createCameraShake, hudShakeAngle, stepCameraShake,
} from '../../src/camera/cameraShake'
import { DEG } from '../../src/core/math'

describe('砲擊震動的獨立距離與時間', () => {
  it.each(['muzzle', 'impact'] as const)('%s 的距離只衰減角度，不縮短持續時間', kind => {
    const near = createCameraShake(), far = createCameraShake()
    const profile = CANNON_SHAKE[kind]
    addCannonShake(near, kind, 0, 0, 0, new Vector3())
    addCannonShake(far, kind, 0, 0, 0, new Vector3(0, profile.range / 2, 0))
    expect(near.cannon[kind].amplitude * SHAKE_MAX_ANGLE / DEG).toBeCloseTo(profile.angleDeg)
    expect(far.cannon[kind].amplitude).toBeCloseTo(near.cannon[kind].amplitude / 2)
    expect(far.cannon[kind].remaining).toBe(near.cannon[kind].remaining)
    stepCameraShake(near, profile.seconds / 2)
    stepCameraShake(far, profile.seconds / 2)
    expect(hudShakeAngle(far)).toBeCloseTo(hudShakeAngle(near) / 2, 12)
    stepCameraShake(near, profile.seconds)
    stepCameraShake(far, profile.seconds)
    expect(hudShakeAngle(near)).toBe(0)
    expect(hudShakeAngle(far)).toBe(0)
  })

  it('近處強震不被遠處弱震降低或延長', () => {
    const shake = createCameraShake()
    addCannonShake(shake, 'impact', 0, 0, 0, new Vector3())
    stepCameraShake(shake, 0.1)
    const before = { ...shake.cannon.impact }
    addCannonShake(shake, 'impact', 0, 0, 0, new Vector3(170, 0, 0))
    expect(shake.cannon.impact).toEqual(before)
  })

  it('砲口與落點各自消退，較短的落點不會裁掉砲口尾韻', () => {
    const shake = createCameraShake()
    addCannonShake(shake, 'impact', 0, 0, 0, new Vector3())
    addCannonShake(shake, 'muzzle', 0, 0, 0, new Vector3())
    stepCameraShake(shake, CANNON_SHAKE.impact.seconds)
    expect(shake.cannon.impact.remaining).toBe(0)
    expect(shake.cannon.muzzle.remaining).toBeGreaterThan(0)
    const camera = new PerspectiveCamera()
    applyCameraShake(shake, camera)
    expect(camera.quaternion.w).toBeLessThan(1)
    shake.reset()
    expect(hudShakeAngle(shake)).toBe(0)
    expect(shake.cannon.impact.remaining).toBe(0)
    expect(shake.cannon.muzzle.remaining).toBe(0)
  })

  it('已有較強炸彈時，砲口與落點不加大或修改原本的震動', () => {
    const bomb = createCameraShake(), mixed = createCameraShake()
    for (const shake of [bomb, mixed]) addShake(shake, 0, 0, 0, 0.76, new Vector3())
    addCannonShake(mixed, 'muzzle', 0, 0, 0, new Vector3())
    addCannonShake(mixed, 'impact', 0, 0, 0, new Vector3())
    // 前半秒炸彈仍較強，砲口與落點不應改變它的角度。
    for (let i = 0; i < 30; i++) {
      stepCameraShake(bomb, 1 / 60); stepCameraShake(mixed, 1 / 60)
      const a = new PerspectiveCamera(), b = new PerspectiveCamera()
      applyCameraShake(bomb, a); applyCameraShake(mixed, b)
      expect(b.quaternion.equals(a.quaternion)).toBe(true)
      expect(hudShakeAngle(mixed)).toBe(hudShakeAngle(bomb))
    }
  })
})
