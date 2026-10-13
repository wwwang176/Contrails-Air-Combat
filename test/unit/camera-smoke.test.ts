import { afterEach, describe, expect, it } from 'vitest'
import { Color, Group, NormalBlending, PerspectiveCamera, Scene, ShaderLib, Texture, Vector3, type WebGLRenderer } from 'three'
import { createParticles, type Particles } from '../../src/render/particles'
import { injectBillboard, injectCameraSmoke } from '../../src/render/particleShader'
import { cameraSmokeEnabled, cameraSmokeResponse, cameraSmokeWeight, sampleCameraSmoke } from '../../src/render/cameraSmokeField'
import { createCameraSmoke } from '../../src/render/cameraSmoke'
import { addSmokeLighting } from '../../src/render/smokeLighting'
import { createBlastLightUniforms } from '../../src/render/blastLights'
import { createWaterMist } from '../../src/render/blastParticles'
import { createCameraSmokeMask } from '../../src/render/cameraSmokeMask'

const pools: Particles[] = []
afterEach(() => { for (const p of pools) p.dispose(); pools.length = 0; cameraSmokeEnabled.value = 0 })
function smoke(scene: Scene | Group, color: Color, enabled = true): Particles {
  const pool = createParticles({
    capacity: 8, life: 10, blending: NormalBlending, sizeFrom: 10, sizeTo: 10,
    gravity: 0, drag: 0, alphaFrom: 0.5, cameraSmoke: enabled,
    color: (_t, out) => { out.copy(color) },
  })
  pools.push(pool)
  scene.add(pool.object)
  pool.emit(0, 0, 0, 0, 0, 0)
  pool.step(0)
  return pool
}
function sample(scene: Scene, eye = new Vector3()) {
  const out = { density: 0, diameter: 0, color: new Color() }
  sampleCameraSmoke(scene, eye, out)
  return out
}

describe('鏡頭內的煙量與顏色', () => {
  it('水霧加入交接並保留原本白藍色，離開或重設後沒有殘影', () => {
    const scene = new Scene(), view = new PerspectiveCamera(60, 16 / 9, 0.1, 1000)
    const mist = createWaterMist(1)
    const effect = createCameraSmoke(new Texture())
    const mask = createCameraSmokeMask(new Texture())
    pools.push(mist); scene.add(mist.object)
    try {
      mist.emit(0, 0, 0, 0, 0, 0, 10); mist.step(0)
      const original = new Color()
      mist.object.getColorAt(0, original)
      effect.update(scene, view, 1 / 60, 0)
      expect(effect.stats.culled).toBe(1)
      const sampled = sample(scene)
      expect(sampled.color.r).toBeCloseTo(original.r)
      expect(sampled.color.g).toBeCloseTo(original.g)
      expect(sampled.color.b).toBeCloseTo(original.b)
      expect(sampled.color.b).toBeGreaterThan(sampled.color.r)
      mask.update(scene, view, 1)
      expect(mask.volumeDensity).toBeGreaterThan(0)
      expect(mask.volumeColor.r / mask.volumeDensity).toBeCloseTo(original.r)
      expect(mask.volumeColor.g / mask.volumeDensity).toBeCloseTo(original.g)
      expect(mask.volumeColor.b / mask.volumeDensity).toBeCloseTo(original.b)
      view.position.z = 200
      effect.update(scene, view, 1 / 60, 0)
      expect(effect.stats.maxDensity).toBe(0)
      expect(mist.object.geometry.getAttribute('aCameraSmoke').getX(0)).toBe(0)
      view.position.z = 0
      effect.update(scene, view, 1 / 60, 0)
      expect(effect.stats.maxDensity).toBeGreaterThan(0)
      mist.reset()
      effect.update(scene, view, 1 / 60, 0)
      expect(effect.stats.maxDensity).toBe(0)
    } finally { effect.dispose(); mask.dispose() }
  })
  it('外側擦過不遮住畫面；進入時連續變濃，深處完整接手', () => {
    expect(cameraSmokeWeight(5, 10)).toBe(0)
    expect(cameraSmokeWeight(3.4, 10)).toBeCloseTo(0.5)
    expect(cameraSmokeWeight(1, 10)).toBe(1)
    expect(cameraSmokeWeight(0, 0)).toBe(0)
  })
  it('多團煙的厚度相加，顏色依各團煙量混合', () => {
    const scene = new Scene()
    smoke(scene, new Color(0.1, 0.1, 0.1))
    const first = sample(scene)
    expect(first.density).toBeCloseTo(-Math.log(0.5))
    smoke(scene, new Color(0.9, 0.7, 0.5))
    const mixed = sample(scene)
    expect(mixed.density).toBeCloseTo(first.density * 2)
    expect(mixed.color.r).toBeCloseTo(0.5)
    expect(mixed.color.g).toBeCloseTo(0.4)
    expect(mixed.color.b).toBeCloseTo(0.3)
    expect(mixed.diameter).toBeCloseTo(10)
  })
  it('只採樣當前場景中可見的煙，隱藏父節點、非煙粒子與移除的煙不計入', () => {
    const scene = new Scene()
    const group = new Group()
    scene.add(group)
    const pool = smoke(group, new Color(0.1, 0.1, 0.1))
    smoke(scene, new Color(1, 0, 0), false)
    group.visible = false
    expect(sample(scene).density).toBe(0)
    group.visible = true
    expect(sample(scene).density).toBeGreaterThan(0)
    group.remove(pool.object)
    expect(sample(scene).density).toBe(0)
  })
  it('使用父節點世界位置與縮放，而非粒子的局部位置', () => {
    const scene = new Scene()
    const group = new Group()
    group.position.set(100, 200, 300)
    group.scale.setScalar(2)
    scene.add(group)
    smoke(group, new Color(0.2, 0.3, 0.4))
    expect(sample(scene).density).toBe(0)
    expect(sample(scene, group.position).diameter).toBeCloseTo(20)
  })
  it('粒子死亡、清空與池銷毀後都不留下遮罩濃度', () => {
    const scene = new Scene()
    const p = smoke(scene, new Color(0.1, 0.1, 0.1))
    p.step(11)
    expect(sample(scene).density).toBe(0)
    p.emit(0, 0, 0, 0, 0, 0); p.step(0)
    expect(sample(scene).density).toBeGreaterThan(0)
    p.reset()
    expect(sample(scene).density).toBe(0)
    p.emit(0, 0, 0, 0, 0, 0); p.step(0)
    p.dispose(); pools.splice(pools.indexOf(p), 1)
    expect(sample(scene).density).toBe(0)
  })
  it('高速移動縮短反應時間，且相同時間的平滑不依賴幀率', () => {
    expect(cameraSmokeResponse(1 / 60, 150)).toBeGreaterThan(cameraSmokeResponse(1 / 60, 0))
    expect(1 - (1 - cameraSmokeResponse(1 / 120, 30)) ** 2).toBeCloseTo(cameraSmokeResponse(1 / 60, 30))
  })
  it('有光照的黑煙沿用太陽遮暗與爆炸閃光，未受光的蒸汽保持原色', () => {
    const scene = new Scene()
    const p = smoke(scene, new Color(0.2, 0.2, 0.2))
    const lights = createBlastLightUniforms()
    const control = addSmokeLighting(p, new Vector3(0, 1, 0), new Color(1, 1, 1), 2.2, 0, lights)
    const shaded = sample(scene).color.r
    expect(shaded).toBeLessThan(0.2)
    control.setEnabled(false)
    expect(sample(scene).color.r).toBeCloseTo(0.2)
    lights.uBlastLightColor.value[0]!.set(1, 0.3, 0.1)
    lights.uBlastLightRadius.value[0] = 100
    const lit = sample(scene).color
    expect(lit.r).toBeGreaterThan(0.2)
    expect(lit.r).toBeGreaterThan(lit.b)
  })
  it('鏡頭穿過受光煙團中心，核心顏色不因位置向量翻轉而閃爍', () => {
    const scene = new Scene()
    const p = smoke(scene, new Color(0.2, 0.2, 0.2))
    addSmokeLighting(p, new Vector3(0, 0, 1), new Color(1, 1, 1), 2.2, 0)
    const before = sample(scene, new Vector3(0, 0, 0.001))
    const after = sample(scene, new Vector3(0, 0, -0.001))
    expect(before.color.toArray()).toEqual(after.color.toArray())
    expect(before.density).toBeCloseTo(after.density)
  })
})

describe('近煙 shader 與繪製狀態', () => {
  it('實際 three shader 同時有淡出與頂點剔除；未啟用時保留原本粒子', () => {
    const shader = { ...ShaderLib.basic }
    injectBillboard(shader, false)
    injectCameraSmoke(shader)
    expect(shader.vertexShader).toContain('vAlpha *= mix(1.0, smokeFade, uCameraSmokeEnabled)')
    expect(shader.vertexShader).toContain('gl_Position = vec4(2.0, 2.0, 2.0, 1.0)')
    expect(shader.fragmentShader).toContain('texture2D( alphaMap, vSpunUv ).g')
  })
  it('沒有煙時不新增繪製；有煙時不清除戰場，結束與重設都還原狀態', () => {
    const world = new Scene()
    const view = new PerspectiveCamera()
    const effect = createCameraSmoke(new Texture())
    let draws = 0
    const renderer = {
      autoClear: true,
      info: { autoReset: true },
      render() { expect(this.autoClear).toBe(false); expect(this.info.autoReset).toBe(false); draws++ },
    }
    effect.update(world, view, 1 / 60, 1 / 60)
    effect.render(renderer as unknown as WebGLRenderer)
    expect(draws).toBe(0)
    smoke(world, new Color(0.1, 0.1, 0.1))
    effect.update(world, view, 1 / 60, 1 / 60)
    effect.render(renderer as unknown as WebGLRenderer)
    expect(draws).toBe(1)
    expect(renderer.autoClear).toBe(true)
    expect(renderer.info.autoReset).toBe(true)
    view.position.x = 300
    effect.update(world, view, 1 / 60, 1 / 60)
    effect.render(renderer as unknown as WebGLRenderer)
    expect(draws).toBe(1)
    effect.reset()
    expect(cameraSmokeEnabled.value).toBe(0)
    effect.dispose()
  })
})
