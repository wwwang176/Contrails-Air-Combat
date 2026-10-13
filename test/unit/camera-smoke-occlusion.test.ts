import { afterEach, describe, expect, it } from 'vitest'
import { Color, NormalBlending, PerspectiveCamera, Scene, Texture } from 'three'
import { createParticles, type Particles } from '../../src/render/particles'
import {
  createCameraSmokeMask, smokeReplacementDensity, SMOKE_MASK_WIDTH, SMOKE_MASK_HEIGHT,
} from '../../src/render/cameraSmokeMask'
import { createCameraSmokeProjection } from '../../src/render/cameraSmokeProjection'

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

function smoke(scene: Scene, depth: number, alpha = 0.5, color = new Color(0.1, 0.1, 0.1)) {
  const pool = createParticles({
    capacity: 1, life: 10, sizeFrom: depth * 1.7, sizeTo: depth * 1.7, alphaFrom: alpha,
    gravity: 0, drag: 0, blending: NormalBlending, cameraSmoke: true,
    color: (_age, out) => out.copy(color),
  })
  pools.push(pool); scene.add(pool.object)
  pool.emit(0, 0, -depth, 0, 0, 0); pool.step(0)
  return pool
}

describe('近煙遮罩的濃度混合', () => {
  it('兩團半透明煙累積透光率，色彩按光學厚度混合，深度保留最近有效煙', () => {
    const { scene, camera, mask } = setup()
    smoke(scene, 5, 0.5, new Color(0, 0, 0))
    smoke(scene, 8, 0.5, new Color(1, 1, 1))
    mask.update(scene, camera, 1)
    const at = CENTRE * 4, density = mask.data[at + 3]!
    expect(1 - Math.exp(-density)).toBeCloseTo(0.75, 6)
    expect(mask.data[at]! / density).toBeCloseTo(0.5, 6)
    expect(mask.depths[CENTRE]).toBe(5)
    expect(mask.volumeDensity).toBe(0)
  })

  it('打亂煙的前後與拜訪順序不改變混合顏色或濃度', () => {
    const { scene, camera, mask } = setup()
    smoke(scene, 5, 0.2, new Color(0, 0, 0))
    smoke(scene, 8, 0.7, new Color(1, 1, 1))
    mask.update(scene, camera, 1)
    const before = mask.data.slice()
    // 以反向建立粒子池改變來源註冊順序，並交換前後位置；投影尺寸維持相同。
    const reversed = setup()
    smoke(reversed.scene, 5, 0.7, new Color(1, 1, 1))
    smoke(reversed.scene, 8, 0.2, new Color(0, 0, 0))
    reversed.mask.update(reversed.scene, reversed.camera, 1)
    for (let i = 0; i < before.length; i++) expect(reversed.mask.data[i]).toBeCloseTo(before[i]!, 5)
  })

  it('超過五十團重疊煙仍可全部接手，遮罩容量不隨煙數增加', () => {
    const { scene, camera, mask } = setup()
    const sources = Array.from({ length: 100 }, (_, i) => smoke(scene, 5 + i * 0.05, 0.02))
    mask.update(scene, camera, 1)
    expect(mask.stats.culled).toBe(100)
    expect(sources.every(pool => pool.object.geometry.getAttribute('aCameraSmoke').getX(0) === 1)).toBe(true)
    expect(mask.data).toHaveLength(CELLS * 4)
    expect(mask.data[CENTRE * 4 + 3]).toBeCloseTo(100 * smokeReplacementDensity(0.02, 1), 5)
    mask.update(scene, camera, 0.1)
    expect(mask.stats.culled).toBe(100)
  })

  it('相鄰煙格共用相同角落色彩與深度，外圍空格保留平滑淡出', () => {
    const projection = createCameraSmokeProjection()
    try {
      const data = new Float32Array(CELLS * 4), depths = new Float32Array(CELLS).fill(1000)
      data[CENTRE * 4 + 3] = 1; depths[CENTRE] = 5
      data[(CENTRE + 1) * 4] = 2; data[(CENTRE + 1) * 4 + 3] = 2; depths[CENTRE + 1] = 8
      projection.update({ data, depths }, 0.1, 1000)
      const geometry = projection.object.geometry
      const positions = geometry.getAttribute('position'), fields = geometry.getAttribute('aSmokeField')
      const corners = new Map<string, number[]>()
      const vertices = geometry.drawRange.count / 6 * 4
      expect(vertices).toBeGreaterThan(8)
      expect(vertices).toBeLessThanOrEqual(CELLS * 4)
      for (let i = 0; i < vertices; i++) {
        const key = `${positions.getX(i)},${positions.getY(i)}`
        const value = [positions.getZ(i), fields.getX(i), fields.getY(i), fields.getZ(i), fields.getW(i)]
        if (corners.has(key)) expect(value).toEqual(corners.get(key))
        else corners.set(key, value)
      }
      projection.update({ data: new Float32Array(CELLS * 4), depths }, 0.1, 1000)
      expect(projection.object.visible).toBe(false)
      expect(geometry.drawRange.count).toBe(0)
    } finally { projection.dispose() }
  })
})
