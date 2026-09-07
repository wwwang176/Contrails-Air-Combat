import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import {
  applyBlend, blendWeight, createCameraBlend, startBlend, GOD_BLEND_SECONDS,
} from '../../src/camera/cameraBlend'

const DT = 1 / 60

/** 起點姿態：在原點、朝 −Z、FOV 60 */
function fromPose(camera: PerspectiveCamera): void {
  camera.position.set(0, 0, 0)
  camera.quaternion.identity()
  camera.fov = 60
}

/** 終點姿態：上方 800 m、俯視 45°、FOV 80 */
function toPose(camera: PerspectiveCamera): void {
  camera.position.set(0, 800, 0)
  camera.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 4)
  camera.fov = 80
}

describe('blendWeight', () => {
  it('兩端是 0 與 1，中點是 0.5', () => {
    expect(blendWeight(0)).toBe(0)
    expect(blendWeight(1)).toBe(1)
    expect(blendWeight(0.5)).toBeCloseTo(0.5, 12)
  })

  it('單調遞增，而且兩端斜率為零 —— 起步與到位都不是硬切', () => {
    let prev = 0
    for (let i = 1; i <= 100; i++) {
      const w = blendWeight(i / 100)
      expect(w).toBeGreaterThanOrEqual(prev)
      prev = w
    }
    expect(blendWeight(0.01)).toBeLessThan(0.01)
    expect(1 - blendWeight(0.99)).toBeLessThan(0.01)
  })

  it('超出 [0, 1] 的輸入夾住', () => {
    expect(blendWeight(-1)).toBe(0)
    expect(blendWeight(2)).toBe(1)
  })
})

describe('鏡頭過渡（G 進出上帝視角）', () => {
  it('開始的那一幀（dt = 0）相機仍在起點', () => {
    const camera = new PerspectiveCamera()
    const b = createCameraBlend()
    fromPose(camera)
    startBlend(b, camera)
    toPose(camera)
    applyBlend(b, camera, 0)
    expect(camera.position.length()).toBeLessThan(1e-9)
    expect(camera.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-9)
    expect(camera.fov).toBe(60)
    expect(b.active).toBe(true)
  })

  it('走滿時間之後停在終點，而且過渡結束', () => {
    const camera = new PerspectiveCamera()
    const b = createCameraBlend()
    fromPose(camera)
    startBlend(b, camera)
    const steps = Math.ceil(GOD_BLEND_SECONDS / DT) + 2
    for (let i = 0; i < steps; i++) {
      toPose(camera)
      applyBlend(b, camera, DT)
    }
    const want = new PerspectiveCamera()
    toPose(want)
    expect(camera.position.distanceTo(want.position)).toBeLessThan(1e-9)
    expect(camera.quaternion.angleTo(want.quaternion)).toBeLessThan(1e-9)
    expect(camera.fov).toBe(80)
    expect(b.active).toBe(false)
  })

  it('中途在兩端之間，四元數維持單位長度', () => {
    const camera = new PerspectiveCamera()
    const b = createCameraBlend()
    fromPose(camera)
    startBlend(b, camera)
    const half = Math.round(GOD_BLEND_SECONDS / 2 / DT)
    for (let i = 0; i < half; i++) {
      toPose(camera)
      applyBlend(b, camera, DT)
    }
    expect(camera.position.y).toBeGreaterThan(100)
    expect(camera.position.y).toBeLessThan(700)
    expect(camera.fov).toBeGreaterThan(62)
    expect(camera.fov).toBeLessThan(78)
    expect(Math.abs(camera.quaternion.length() - 1)).toBeLessThan(1e-9)
    const tilt = camera.quaternion.angleTo(new Quaternion())
    expect(tilt).toBeGreaterThan(0.1)
    expect(tilt).toBeLessThan(Math.PI / 4 - 0.1)
  })

  it('位置是一路往終點走的，不會先退再進', () => {
    const camera = new PerspectiveCamera()
    const b = createCameraBlend()
    fromPose(camera)
    startBlend(b, camera)
    let prevY = 0
    for (let i = 0; i < 200; i++) {
      toPose(camera)
      applyBlend(b, camera, DT)
      expect(camera.position.y).toBeGreaterThanOrEqual(prevY - 1e-9)
      prevY = camera.position.y
    }
  })

  it('終點在動也跟得上 —— 上帝鏡頭進場後就可以移動', () => {
    const camera = new PerspectiveCamera()
    const b = createCameraBlend()
    fromPose(camera)
    startBlend(b, camera)
    const steps = Math.ceil(GOD_BLEND_SECONDS / DT) + 2
    for (let i = 0; i < steps; i++) {
      toPose(camera)
      camera.position.x = i * 3
      applyBlend(b, camera, DT)
    }
    expect(camera.position.x).toBeCloseTo((steps - 1) * 3, 9)
  })

  it('沒有在過渡時完全不碰相機', () => {
    const camera = new PerspectiveCamera()
    const b = createCameraBlend()
    toPose(camera)
    applyBlend(b, camera, DT)
    const want = new PerspectiveCamera()
    toPose(want)
    expect(camera.position.distanceTo(want.position)).toBe(0)
    expect(camera.fov).toBe(80)
  })

  it('過渡中再開始一次，是從現在的位置接著走，不會跳回舊起點', () => {
    const camera = new PerspectiveCamera()
    const b = createCameraBlend()
    fromPose(camera)
    startBlend(b, camera)
    const half = Math.round(GOD_BLEND_SECONDS / 2 / DT)
    for (let i = 0; i < half; i++) {
      toPose(camera)
      applyBlend(b, camera, DT)
    }
    const midY = camera.position.y
    // 中途按 G 回頭：起點是現在這個位置，終點回到原點
    startBlend(b, camera)
    fromPose(camera)
    applyBlend(b, camera, 0)
    expect(camera.position.y).toBeCloseTo(midY, 9)
  })
})
