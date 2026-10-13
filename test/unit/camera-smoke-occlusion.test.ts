import { afterEach, describe, expect, it } from 'vitest'
import { NormalBlending, PerspectiveCamera, Scene, Texture } from 'three'
import { createParticles, type Particles } from '../../src/render/particles'
import {
  createCameraSmokeMask, smokeReplacementDensity, SMOKE_MASK_WIDTH, SMOKE_MASK_HEIGHT,
} from '../../src/render/cameraSmokeMask'

const pools: Particles[] = []
const masks: ReturnType<typeof createCameraSmokeMask>[] = []
const CELLS = SMOKE_MASK_WIDTH * SMOKE_MASK_HEIGHT
const CENTRE = Math.floor(SMOKE_MASK_HEIGHT / 2) * SMOKE_MASK_WIDTH + Math.floor(SMOKE_MASK_WIDTH / 2)

afterEach(() => {
  for (const pool of pools) pool.dispose()
  for (const mask of masks) mask.dispose()
  pools.length = masks.length = 0
})

function setup() {
  const scene = new Scene()
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1000)
  camera.updateMatrixWorld(true)
  const mask = createCameraSmokeMask(new Texture())
  masks.push(mask)
  return { scene, camera, mask }
}

function smoke(scene: Scene, depth: number, diameter: number, alpha = 0.5, x = 0) {
  const pool = createParticles({
    capacity: 1, life: 10, sizeFrom: diameter, sizeTo: diameter, alphaFrom: alpha,
    gravity: 0, drag: 0, blending: NormalBlending, cameraSmoke: true,
    color: (_age, color) => color.setRGB(0.1, 0.1, 0.1),
  })
  pools.push(pool)
  scene.add(pool.object)
  pool.object.position.x = x
  pool.emit(0, 0, -depth, 0, 0, 0)
  pool.step(0)
  return pool
}

function weight(pool: Particles): number {
  return pool.object.geometry.getAttribute('aCameraSmoke').getX(0)
}

function centreLayers(mask: ReturnType<typeof createCameraSmokeMask>) {
  const result: { depth: number; density: number }[] = []
  const layers = mask.depths.length / CELLS
  for (let layer = 0; layer < layers; layer++) {
    const cell = layer * CELLS + CENTRE
    const density = mask.data[cell * 4 + 3]!
    if (density > 0) result.push({ depth: mask.depths[cell]!, density })
  }
  return result
}

describe('近煙遮罩的深度與容量退回', () => {
  it('前薄煙與後濃煙保留各自深度，中間的不透明物體只受前煙影響', () => {
    const { scene, camera, mask } = setup()
    const front = smoke(scene, 5, 8, 0.01)
    smoke(scene, 8, 12, 0.8)
    mask.update(scene, camera, 1)
    const layers = centreLayers(mask)
    expect(layers.map(layer => layer.depth)).toEqual([5, 8])
    expect(mask.volumeDensity).toBe(0)
    const densityBeforeObject = layers
      .filter(layer => layer.depth < 6)
      .reduce((sum, layer) => sum + layer.density, 0)
    expect(densityBeforeObject).toBeCloseTo(smokeReplacementDensity(0.01, weight(front)), 6)
    expect(densityBeforeObject).toBeLessThan(0.02)
    expect(layers[1]!.density).toBeGreaterThan(1)
  })

  it('五團重疊超出四層容量時，整顆退回原煙片，不留下部分遮罩', () => {
    const { scene, camera, mask } = setup()
    const depths = [5, 6, 7, 8, 9]
    const sources = depths.map(depth => smoke(scene, depth, depth * 1.7))
    mask.update(scene, camera, 1)
    const accepted = sources.filter(pool => weight(pool) > 0)
    expect(accepted).toHaveLength(4)
    expect(centreLayers(mask)).toHaveLength(4)
    for (let i = 0; i < sources.length; i++) {
      const represented = Array.from(mask.depths).some((depth, cell) =>
        depth === depths[i] && mask.data[cell * 4 + 3]! > 0)
      expect(represented).toBe(weight(sources[i]!) > 0)
    }
  })

  it('兩組已交接煙合流溢出時，同幀還原被拒絕原片，不以平滑權重漏掉煙', () => {
    const { scene, camera, mask } = setup()
    const depths = [5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8]
    const sources = depths.map((depth, index) => smoke(scene, depth, 8, 0.5, index < 4 ? -4 : 4))
    // 模擬前一幀已完整交接；左右兩組足跡不重疊，所以能各放四層。
    for (const pool of sources) pool.object.geometry.getAttribute('aCameraSmoke').setX(0, 1)
    mask.update(scene, camera, 0)
    expect(sources.every(pool => weight(pool) === 1)).toBe(true)

    for (const pool of sources) pool.object.position.x = 0
    // 使用緩慢反應，才能抓到「遮罩已拒絕，原煙卻仍保持淡出」的錯誤。
    mask.update(scene, camera, 0.1)
    const layers = centreLayers(mask)
    expect(layers).toHaveLength(4)
    expect(sources.filter(pool => weight(pool) === 0)).toHaveLength(4)
    for (let i = 0; i < sources.length; i++) {
      const represented = layers.some(layer => Math.abs(layer.depth - depths[i]!) < 0.00001)
      expect(represented).toBe(weight(sources[i]!) > 0)
    }

    // 繼續停在同處，既有交接者優先，不每幀輪換成另外四顆。
    const retained = sources.map(pool => weight(pool) > 0)
    mask.update(scene, camera, 0.1)
    expect(sources.map(pool => weight(pool) > 0)).toEqual(retained)
  })
})
