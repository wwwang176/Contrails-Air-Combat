import { describe, expect, it } from 'vitest'
import { Color, ShaderLib, Texture } from 'three'
import {
  CLOUD_ATLAS_SIDE, CLOUD_PUFFS_MAX, CLOUD_PUFFS_MIN, cloudColorOf, cloudPuff, cloudPuffCount, createClouds,
  injectCloudPuff, type CloudPuff,
} from '../../src/render/clouds'
import { DAY_PALETTES } from '../../src/render/timeOfDay'

const blank = (): CloudPuff => ({ dx: 0, dy: 0, dz: 0, size: 0, shade: 0, tile: 0, flip: false })

describe('injectCloudPuff：雲塊的著色器', () => {
  it('對 three 真正的 basic 著色器有作用：貼圖集取張、上方對齊世界上方、靠近淡出', () => {
    const shader = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader }
    const beforeV = shader.vertexShader
    const beforeF = shader.fragmentShader
    injectCloudPuff(shader)
    expect(shader.vertexShader).not.toBe(beforeV)
    expect(shader.fragmentShader).not.toBe(beforeF)
    expect(shader.vertexShader).not.toContain('#include <project_vertex>')
    expect(shader.vertexShader).toContain('vMapUv = (tuv')
    expect(shader.vertexShader).toContain('viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)')
    expect(shader.vertexShader).toContain('vCloudDist = -mvPosition.z')
    // 淡到 0 的雲塊整塊移出裁切範圍，不進光柵化
    expect(shader.vertexShader).toMatch(/if \(vCloudDist < [\d.]+\) gl_Position = vec4\(2\.0, 2\.0, 2\.0, 1\.0\)/)
    expect(shader.fragmentShader).toContain('smoothstep(')
    expect(shader.fragmentShader).toContain('vCloudDist')
  })
})

describe('cloudPuff：一朵雲的雲塊', () => {
  const c = { x: 100, y: 1500, z: -40, radius: 80 }
  const p = blank()

  it('同一個種子每次一樣；都在雲底以上、水平不超過 0.75 倍半徑；貼圖在貼圖集範圍內', () => {
    for (let k = 0; k < cloudPuffCount(c.radius); k++) {
      const a = { ...cloudPuff(c, 3, k, p) }
      const b = cloudPuff(c, 3, k, blank())
      expect(b).toEqual(a)
      expect(a.dy).toBeGreaterThanOrEqual(0)
      expect(Math.hypot(a.dx, a.dz)).toBeLessThanOrEqual(0.75 * c.radius + 1e-9)
      expect(a.size).toBeGreaterThan(0)
      expect(a.tile).toBeGreaterThanOrEqual(0)
      expect(a.tile).toBeLessThan(CLOUD_ATLAS_SIDE * CLOUD_ATLAS_SIDE)
    }
  })

  it('越高的煙團越亮（雲底暗）', () => {
    const puffs = Array.from({ length: 20 }, (_, k) => ({ ...cloudPuff(c, 1, k, p) }))
    puffs.sort((u, v) => u.dy - v.dy)
    expect(puffs[0]!.shade).toBeLessThan(puffs[puffs.length - 1]!.shade)
  })

  it('團數照半徑、夾在上下限之間', () => {
    expect(cloudPuffCount(1)).toBe(CLOUD_PUFFS_MIN)
    expect(cloudPuffCount(10_000)).toBe(CLOUD_PUFFS_MAX)
    expect(cloudPuffCount(120)).toBeGreaterThan(cloudPuffCount(60))
  })
})

describe('cloudColorOf：雲色照時段', () => {
  const lum = (id: keyof typeof DAY_PALETTES): number => {
    const c = cloudColorOf(DAY_PALETTES[id], new Color())
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  }
  it('正午接近白、清晨暗一點、暴雨更暗；每個分量不超過 1', () => {
    expect(lum('noon')).toBeGreaterThan(0.8)
    expect(lum('dawn')).toBeLessThan(lum('noon'))
    expect(lum('storm')).toBeLessThan(lum('dawn'))
    const c = cloudColorOf(DAY_PALETTES.noon, new Color())
    expect(Math.max(c.r, c.g, c.b)).toBeLessThanOrEqual(1)
  })
})

describe('createClouds：一顆 InstancedMesh', () => {
  it('畫的團數是全部雲的團數總和，超過容量就截掉；clear 歸零', () => {
    const clouds = createClouds(new Texture(), 20)
    clouds.set([{ x: 0, y: 1000, z: 0, radius: 40 }], new Color(1, 1, 1))
    expect(clouds.object.count).toBe(cloudPuffCount(40))
    clouds.set([{ x: 0, y: 1000, z: 0, radius: 200 }, { x: 500, y: 1000, z: 0, radius: 200 }], new Color(1, 1, 1))
    expect(clouds.object.count).toBe(20)
    clouds.clear()
    expect(clouds.object.count).toBe(0)
    clouds.dispose()
  })
})
