import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Scene, ShaderMaterial, Vector3, WebGLRenderer } from 'three'
import { createSky, SKY_RADIUS, SKY_RENDER_ORDER } from '../../src/render/sky'
import { CAMERA_FAR, CAMERA_NEAR } from '../../src/render/scene'
import { FAR_SEA_RENDER_ORDER } from '../../src/render/ocean'
import { PROP_DISC_RENDER_ORDER } from '../../src/render/geometry/assembly'

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
    // 【用具名常數不用字面量】原本寫死 1 與 60000 並在註解裡重複一次。
    // 遠平面改成 800 km 之後那兩個數字與註解全都變成死的，而測試照樣綠 ——
    // 不會有任何東西提醒下一個人。改成直接對照 scene.ts 的來源。
    expect(SKY_RADIUS).toBeGreaterThan(CAMERA_NEAR)
    expect(SKY_RADIUS).toBeLessThan(CAMERA_FAR)
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

/**
 * 天空**最後畫**。
 *
 * 【它在買什麼】先畫的話整個螢幕被天空著色一次，再被地面與海整片蓋掉。
 * 最後畫只有真正看得到的天空像素才付錢。
 *
 * 【為什麼要動深度輸出】球半徑只有 40 km，而遠海半邊 3,000 km。最後畫又
 * 開著深度測試的話，天空的深度（約 0.99998）比遠海小 —— 它會反過來把遠海
 * 蓋掉。頂點著色器把 z 推到 w，深度就是最遠的 1.0，任何真實幾何都贏得過它。
 */
describe('天空最後畫', () => {
  it('排在所有不透明物之後', () => {
    const sky = createSky()
    expect(sky.renderOrder).toBe(SKY_RENDER_ORDER)
    expect(SKY_RENDER_ORDER).toBeGreaterThan(PROP_DISC_RENDER_ORDER)
    expect(SKY_RENDER_ORDER).toBeGreaterThan(FAR_SEA_RENDER_ORDER)
  })

  it('材質不是 transparent —— 它要留在不透明那一批', () => {
    // three 先畫 opaque 再畫 transparent，`renderOrder` 只在批內排序。天空
    // 若進了 transparent 批，粒子、曳光彈、螺旋槳圓盤就會被它蓋掉。
    expect((createSky().material as ShaderMaterial).transparent).toBe(false)
  })

  it('深度輸出在遠平面上，不是球面的 40 km', () => {
    const src = (createSky().material as ShaderMaterial).vertexShader
    expect(src).toContain('gl_Position.z = gl_Position.w')
  })

  it('不寫深度', () => {
    // 寫的話它會擋住之後畫的半透明層（粒子、曳光彈、渦流）
    expect((createSky().material as ShaderMaterial).depthWrite).toBe(false)
  })

  it('開著深度測試 —— 被擋住的天空像素不該付錢', () => {
    expect((createSky().material as ShaderMaterial).depthTest).toBe(true)
  })
})
