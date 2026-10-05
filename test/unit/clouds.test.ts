import { describe, expect, it } from 'vitest'
import { Color, ShaderLib, Texture } from 'three'
import {
  CLOUD_ATLAS_SIDE, CLOUD_TILES, CLOUD_PUFFS_MAX, CLOUD_PUFFS_MIN, cloudColorOf, cloudPuff, cloudPuffCount, createClouds,
  injectCloudPuff, type CloudPuff,
} from '../../src/render/clouds'
import { DAY_PALETTES } from '../../src/render/timeOfDay'

const blank = (): CloudPuff => ({ dx: 0, dy: 0, dz: 0, size: 0, shade: 0, tile: 0, flip: false, rank: 0 })

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
    // 幾乎透明的雲塊整塊移出裁切範圍，不進光柵化
    expect(shader.vertexShader).toMatch(/if \(vCloudDist < [\d.]+ \|\| vAlpha <= 0\.0\) gl_Position = vec4\(2\.0, 2\.0, 2\.0, 1\.0\)/)
    // 每張雲塊照自己的長方形縮放、偏移
    expect(shader.vertexShader).toContain('attribute vec4 aExtent')
    expect(shader.vertexShader).toContain('position.x * aExtent.x')
    // 遠處只留名次高的雲塊、再遠整片淡出；淡到 0 的整塊移出
    expect(shader.vertexShader).toContain('attribute float aRank')
    expect(shader.vertexShader).toContain('vAlpha = aAlpha * lodFade * farFade')
    expect(shader.vertexShader).toContain('|| vAlpha <= 0.0)')
    expect(shader.fragmentShader).toContain('smoothstep(')
    expect(shader.fragmentShader).toContain('vCloudDist')
  })

  it('深度那一遍：透明度不到門檻的柔邊丟掉、不寫深度', () => {
    const shader = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader }
    injectCloudPuff(shader, true)
    expect(shader.fragmentShader).toMatch(/diffuseColor\.a \* vAlpha \* smoothstep\([^)]*\) < [\d.]+\) discard;/)
  })

  it('雲塊長方形表與貼圖集一組：筆數等於格數、寬高不超過原正方形、長方形不超出正方形', () => {
    expect(CLOUD_TILES.length).toBe(CLOUD_ATLAS_SIDE * CLOUD_ATLAS_SIDE)
    for (const [w, h, ox, oy] of CLOUD_TILES) {
      expect(w).toBeGreaterThan(0)
      expect(h).toBeGreaterThan(0)
      expect(Math.abs(ox) + w / 2).toBeLessThanOrEqual(0.5 + 1e-3)
      expect(Math.abs(oy) + h / 2).toBeLessThanOrEqual(0.5 + 1e-3)
    }
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

  it('大小名次在 0～1、名次越高的雲塊越大（遠處先丟小的）', () => {
    const puffs = Array.from({ length: 30 }, (_, k) => ({ ...cloudPuff(c, 2, k, p) }))
    for (const q of puffs) {
      expect(q.rank).toBeGreaterThanOrEqual(0)
      expect(q.rank).toBeLessThan(1)
    }
    puffs.sort((u, v) => u.rank - v.rank)
    for (let k = 1; k < puffs.length; k++) expect(puffs[k]!.size).toBeGreaterThanOrEqual(puffs[k - 1]!.size)
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

  it('黃昏偏橘（紅明顯多於藍）、暴雨偏黑（比夜間以外的時段都暗）', () => {
    const dusk = cloudColorOf(DAY_PALETTES.dusk, new Color())
    expect(dusk.r).toBeGreaterThan(dusk.g)
    expect(dusk.g).toBeGreaterThan(dusk.b)
    expect(dusk.b / dusk.r).toBeLessThan(0.3)
    for (const id of ['dawn', 'noon', 'dusk', 'novemberNoon'] as const) expect(lum('storm')).toBeLessThan(lum(id) * 0.6)
  })
})

describe('createClouds：一顆 InstancedMesh', () => {
  it('畫的團數是全部雲的團數總和，超過容量就截掉；clear 歸零', () => {
    const clouds = createClouds(new Texture(), 20)
    clouds.set([{ x: 0, y: 1000, z: 0, radius: 40 }], new Color(1, 1, 1))
    expect(clouds.mesh.count).toBe(cloudPuffCount(40))
    clouds.set([{ x: 0, y: 1000, z: 0, radius: 200 }, { x: 500, y: 1000, z: 0, radius: 200 }], new Color(1, 1, 1))
    expect(clouds.mesh.count).toBe(20)
    clouds.clear()
    expect(clouds.mesh.count).toBe(0)
    clouds.dispose()
  })

  it('深度那一遍與顏色那一遍是同一批雲塊：同一份矩陣、同樣的團數；深度那一遍是實心物件', () => {
    const clouds = createClouds(new Texture(), 64)
    clouds.set([{ x: 0, y: 1000, z: 0, radius: 60 }], new Color(1, 1, 1))
    expect(clouds.depth.count).toBe(clouds.mesh.count)
    expect(clouds.depth.instanceMatrix).toBe(clouds.mesh.instanceMatrix)
    const m = clouds.depth.material as { transparent: boolean, colorWrite: boolean, depthWrite: boolean }
    expect(m.transparent).toBe(false)
    expect(m.colorWrite).toBe(false)
    expect(m.depthWrite).toBe(true)
    clouds.dispose()
  })
})
