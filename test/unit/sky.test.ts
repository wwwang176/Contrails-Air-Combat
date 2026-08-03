import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { createSky, SKY_RADIUS } from '../../src/render/sky'

/**
 * 天空球必須跟著相機走。
 *
 * 【為什麼這一條值得測】症狀是「飛遠了天空破洞」，而成因離症狀很遠 ——
 * 球固定在原點、半徑 40 km、`BackSide`，飛出 40 km 就變成從殼外面看它，
 * 而場景沒有 clear color，球以外的方向全部是黑的。更早出現的是近平面
 * 切過球面留下的破洞。海面本來就會重新置中，天空是漏掉的那一個。
 */
describe('天空球跟隨相機', () => {
  it('剛建立時位於原點', () => {
    const sky = createSky()
    expect(sky.position.toArray()).toEqual([0, 0, 0])
  })

  it('onBeforeRender 之後移到相機位置', () => {
    const sky = createSky()
    const camera = new PerspectiveCamera(65, 1, 1, 60000)
    camera.position.set(50000, 3000, -80000)
    sky.onBeforeRender(
      null as unknown as WebGLRenderer, new Scene(), camera,
      sky.geometry, sky.material as never, null as never,
    )
    expect(sky.position.distanceTo(camera.position)).toBeLessThan(1e-9)
  })

  it('世界矩陣同一格就更新，不落後一幀', () => {
    const sky = createSky()
    const camera = new PerspectiveCamera(65, 1, 1, 60000)
    camera.position.set(12345, 678, -9012)
    sky.onBeforeRender(
      null as unknown as WebGLRenderer, new Scene(), camera,
      sky.geometry, sky.material as never, null as never,
    )
    const world = new Vector3().setFromMatrixPosition(sky.matrixWorld)
    expect(world.distanceTo(camera.position)).toBeLessThan(1e-9)
  })

  it('半徑落在相機的近／遠平面之間', () => {
    // 近平面 1、遠平面 60,000（見 render/scene.ts）
    expect(SKY_RADIUS).toBeGreaterThan(1)
    expect(SKY_RADIUS).toBeLessThan(60000)
  })

  it('縮放沒有被跟隨邏輯覆寫掉', () => {
    const sky = createSky()
    const camera = new PerspectiveCamera()
    camera.position.set(1, 2, 3)
    sky.onBeforeRender(
      null as unknown as WebGLRenderer, new Scene(), camera,
      sky.geometry, sky.material as never, null as never,
    )
    expect(sky.scale.x).toBe(SKY_RADIUS)
    const scale = new Vector3().setFromMatrixScale(sky.matrixWorld)
    expect(scale.x).toBeCloseTo(SKY_RADIUS, 3)
  })
})
