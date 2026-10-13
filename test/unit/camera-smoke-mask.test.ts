import { afterEach, describe, expect, it } from 'vitest'
import { Color, NormalBlending, PerspectiveCamera, Scene, Texture, type BufferAttribute } from 'three'
import { createParticles, type Particles } from '../../src/render/particles'
import { createCameraSmokeMask, projectSmoke, smokeHandoffTarget, smokeReplacementDensity, SMOKE_MASK_WIDTH, SMOKE_MASK_HEIGHT } from '../../src/render/cameraSmokeMask'

const pools: Particles[] = []
afterEach(() => { for (const pool of pools) pool.dispose(); pools.length = 0 })
function setup(x = 0, z = -6) {
  const world = new Scene()
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1000)
  camera.updateMatrixWorld(true)
  const pool = createParticles({
    capacity: 1, life: 10, sizeFrom: 10, sizeTo: 10, alphaFrom: 0.7,
    gravity: 0, drag: 0, blending: NormalBlending, cameraSmoke: true,
    color: (_t, out) => out.copy(new Color(0.2, 0.3, 0.4)),
  })
  pools.push(pool); world.add(pool.object)
  pool.emit(x, 0, z, 0, 0, 0); pool.step(0)
  return { world, camera, pool, mask: createCameraSmokeMask(new Texture()) }
}

describe('大片近煙的投影與交接', () => {
  it('覆蓋率裁切到可見畫面，背面不計入；縮放與長寬比沿用投影矩陣', () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1000)
    const p = { x: 0, y: 0, rx: 0, ry: 0, coverage: 0 }
    projectSmoke(0, 0, 6, 10, camera, p)
    const original = p.coverage
    expect(original).toBeGreaterThan(0.8)
    projectSmoke(100, 0, 6, 10, camera, p); expect(p.coverage).toBe(0)
    projectSmoke(0, 0, -6, 10, camera, p); expect(p.coverage).toBe(0)
    camera.zoom = 2; camera.updateProjectionMatrix()
    projectSmoke(0, 0, 6, 10, camera, p); expect(p.coverage).toBe(1)
  })
  it('尚未進入半徑內就能完整接手，遠處或小面積不誤觸', () => {
    expect(smokeHandoffTarget(6, 10, 0.9)).toBe(1)
    expect(smokeHandoffTarget(20, 10, 1)).toBe(0)
    expect(smokeHandoffTarget(7, 10, 0.1)).toBe(0)
    expect(smokeHandoffTarget(2, 10, 0)).toBe(1)
    expect(smokeHandoffTarget(1, 0, 1)).toBe(0)
  })
  it('進出覆蓋率門檻不同，交接目標只取完整接手或還原，不永久停在半透明', () => {
    expect(smokeHandoffTarget(6, 10, 0.69)).toBe(0)
    expect(smokeHandoffTarget(6, 10, 0.7)).toBe(1)
    expect(smokeHandoffTarget(6, 10, 0.6, true)).toBe(1)
    expect(smokeHandoffTarget(6, 10, 0.5, true)).toBe(0)
  })
  it('交接途中遮罩補足原煙片減少的透明度', () => {
    for (const alpha of [0, 0.2, 0.7, 0.99]) for (const weight of [0, 0.2, 0.5, 1]) {
      const density = smokeReplacementDensity(alpha, weight)
      const transmission = (1 - alpha * (1 - weight)) * Math.exp(-density)
      expect(transmission).toBeCloseTo(1 - alpha, 10)
    }
  })
  it('完整交接與 shader 使用同一權重，前方煙保留深度；背後不留殘影', () => {
    const { world, camera, pool, mask } = setup()
    mask.update(world, camera, 1)
    expect(mask.stats.culled).toBe(1)
    expect(pool.object.geometry.getAttribute('aCameraSmoke').getX(0)).toBe(1)
    expect(mask.stats.maxDensity).toBeGreaterThan(0)
    expect(Math.min(...mask.depths)).toBe(6)
    camera.rotation.y = Math.PI; camera.updateMatrixWorld(true)
    mask.update(world, camera, 1)
    expect(mask.stats.maxDensity).toBe(0)
    expect(pool.object.geometry.getAttribute('aCameraSmoke').getX(0)).toBe(0)
    mask.dispose()
  })
  it('左側煙片交接不把右側晴空整片蓋住', () => {
    const { world, camera, mask } = setup(-3, -4)
    mask.update(world, camera, 1)
    expect(mask.stats.candidates).toBe(1)
    expect(mask.stats.maxDensity).toBeGreaterThan(0)
    for (let y = 0; y < SMOKE_MASK_HEIGHT; y++) {
      expect(mask.data[(y * SMOKE_MASK_WIDTH + SMOKE_MASK_WIDTH - 1) * 4 + 3]).toBe(0)
    }
    mask.dispose()
  })
  it('重用與清空粒子槽位立即通知 GPU 清除交接權重', () => {
    const { world, camera, pool, mask } = setup()
    mask.update(world, camera, 1)
    const attribute = pool.object.geometry.getAttribute('aCameraSmoke') as BufferAttribute
    const beforeEmit = attribute.version
    pool.emit(0, 0, -100, 0, 0, 0)
    expect(attribute.getX(0)).toBe(0)
    expect(attribute.version).toBeGreaterThan(beforeEmit)
    attribute.setX(0, 1)
    const beforeReset = attribute.version
    pool.reset()
    expect(attribute.getX(0)).toBe(0)
    expect(attribute.version).toBeGreaterThan(beforeReset)
    mask.update(world, camera, 1)
    expect(mask.stats.maxDensity).toBe(0)
    mask.dispose()
  })
  it('剛進入體積霧不把前方煙片搬到鏡頭前，濃度連續', () => {
    const outside = setup(0, -5.01), inside = setup(0, -4.99)
    outside.mask.update(outside.world, outside.camera, 1)
    inside.mask.update(inside.world, inside.camera, 1)
    expect(Math.min(...outside.mask.depths)).toBeCloseTo(5.01)
    expect(Math.min(...inside.mask.depths)).toBeCloseTo(4.99)
    expect(inside.mask.volumeDensity).toBeGreaterThan(0)
    expect(inside.mask.volumeDensity).toBeLessThan(0.001)
    expect(inside.mask.stats.maxDensity).toBeCloseTo(outside.mask.stats.maxDensity, 3)
    outside.mask.dispose(); inside.mask.dispose()
  })
})
