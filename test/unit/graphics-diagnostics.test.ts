import { afterEach, describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D } from 'three'
import { createGraphicsDiagnostics, type GraphicsDiagnosticsSource } from '../../src/app/graphicsDiagnostics'
import { CULL } from '../../src/render/cullRuns'
import { OCEAN_CULL } from '../../src/render/ocean'
import { FAR_LAND_NAME } from '../../src/render/leyteGround'
import { PROP_DISC_RENDER_ORDER } from '../../src/render/geometry/assembly'
import { SKY_RENDER_ORDER } from '../../src/render/sky'

const originalCull = CULL.enabled
const originalGrid = OCEAN_CULL.grid
afterEach(() => { CULL.enabled = originalCull; OCEAN_CULL.grid = originalGrid })

function fixture(groups: GraphicsDiagnosticsSource['groups'] = {}) {
  const scene = new Group()
  const object = new Group()
  object.add(new Group(), new Group(), new Group())
  const current: ReturnType<GraphicsDiagnosticsSource['terrain']> = { object, fieldClip: null }
  const source = {
    scene,
    renderer: { info: { render: { calls: 5, triangles: 20 }, programs: [1, 2] } },
    terrain: vi.fn(() => current),
    groups,
  }
  return { source, probe: createGraphicsDiagnostics(source) }
}

describe('圖形診斷', () => {
  it('安裝不掃場景，呼叫時才解析新場景的群組，遞迴設定圖層且不改 visible', () => {
    const first = new Group()
    const child = new Object3D()
    first.add(child)
    let current = first
    const picker = vi.fn(() => [current])
    const { source, probe } = fixture({ aircraft: picker })
    expect(picker).not.toHaveBeenCalled()
    expect(source.terrain).not.toHaveBeenCalled()
    expect(probe.__gfx({ aircraft: false, missing: false }).applied).toEqual(['aircraft=off'])
    expect(first.layers.isEnabled(0)).toBe(false)
    expect(child.layers.isEnabled(0)).toBe(false)
    expect(child.visible).toBe(true)

    current = new Group()
    const replacement = new Object3D()
    current.add(replacement)
    probe.__gfx({ aircraft: false })
    expect(replacement.layers.isEnabled(0)).toBe(false)
    probe.__gfx({ aircraft: true })
    expect(replacement.layers.isEnabled(0)).toBe(true)
    expect(child.layers.isEnabled(0)).toBe(false)
  })

  it('換地形後解析新地形，純海的空植被組也能關閉', () => {
    const { source, probe } = fixture()
    const old = source.terrain().object
    const next = new Group()
    next.add(new Group(), new Group(), new Group())
    source.terrain.mockReturnValue({ object: next, fieldClip: null })
    expect(probe.__gfx({ nearSea: false, flora: false }).applied).toEqual(['nearSea=off', 'flora=off'])
    expect(next.children[1]!.layers.isEnabled(0)).toBe(false)
    expect(old.children[1]!.layers.isEnabled(0)).toBe(true)
    expect(next.children[0]!.layers.isEnabled(0)).toBe(true)
  })

  it('依名字與 renderOrder 找到遠景、天空及槳盤，不波及其他物件', () => {
    const { source, probe } = fixture()
    const far = new Group()
    far.name = FAR_LAND_NAME
    source.terrain().object.children[2]!.add(far)
    const sky = new Group()
    sky.renderOrder = SKY_RENDER_ORDER
    const prop = new Group()
    prop.renderOrder = PROP_DISC_RENDER_ORDER
    const ordinary = new Group()
    source.scene.add(sky, prop, ordinary)
    probe.__gfx({ farLand: false, sky: false, propDisc: false })
    for (const o of [far, sky, prop]) expect(o.layers.isEnabled(0)).toBe(false)
    expect(ordinary.layers.isEnabled(0)).toBe(true)
  })

  it('場景清單正確計算實例與非索引幾何、世界尺寸，略過隱藏物件', () => {
    const { source, probe } = fixture()
    const indexed = new BoxGeometry(2, 2, 2)
    const plain = indexed.toNonIndexed()
    const material = new MeshBasicMaterial({ transparent: true })
    const instanced = new InstancedMesh(indexed, material, 3)
    instanced.name = 'instances'
    const mesh = new Mesh(plain, [material])
    mesh.name = 'plain'
    mesh.position.y = 7
    mesh.scale.setScalar(2)
    const hidden = new Mesh(indexed, material)
    hidden.visible = false
    const otherLayer = new Mesh(indexed, material)
    otherLayer.layers.set(31)
    source.scene.name = 'root'
    source.scene.position.y = 10
    source.scene.add(instanced, mesh, hidden, otherLayer)
    try {
      const rows = probe.__sceneList()
      expect(rows.map(r => [r.name, r.tris])).toEqual([['instances', 36], ['plain', 12]])
      expect(rows[1]).toMatchObject({ parent: 'root', radius: 3, y: 17, transparent: true, material: 'MeshBasicMaterial' })
    } finally {
      indexed.dispose(); plain.dispose(); material.dispose()
    }
  })

  it('讀取最新繪製統計，clipmap 操作跟著地形切換並回傳統計複本', () => {
    const { source, probe } = fixture()
    expect(probe.__fieldClip()).toBeNull()
    expect(probe.__fieldBake()).toBeNull()
    const clip = {
      stats: { recentres: 1, pieces: 2, texels: 3 },
      setInnerRadius: vi.fn(),
      benchFarBake: vi.fn(() => 12.5),
    }
    source.terrain.mockReturnValue({ object: new Group(), fieldClip: clip })
    const stats = probe.__fieldClip(500)
    expect(clip.setInnerRadius).toHaveBeenCalledWith(500)
    expect(stats).toEqual(clip.stats)
    expect(stats).not.toBe(clip.stats)
    expect(probe.__fieldBake(false)).toBe(12.5)
    expect(clip.benchFarBake).toHaveBeenCalledWith(false)
    source.renderer.info.render.calls = 99
    expect(probe.__renderInfo()).toEqual({ calls: 99, triangles: 20, programs: 2 })
    expect(probe.__cull(false)).toBe(false)
    expect(CULL.enabled).toBe(false)
    expect(probe.__oceanGrid(8)).toBe(8)
    expect(OCEAN_CULL.grid).toBe(8)
  })
})
