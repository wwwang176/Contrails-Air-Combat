import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildAschScenery, hutGeometry } from '../../src/render/aschScenery'
import { buildingGeometry, createFloraGeometries, disposeFloraGeometries } from '../../src/render/floraShapes'
import { preloadGroundModels } from '../../src/render/geometry/ground'
import { InstancedMesh, Matrix4 } from 'three'
import { ASCH_SITE, createTerrain, LEUNA_SITE, POLTAVA_SITE, siteClearances } from '../../src/render/terrain'
import { PLANT_TREE_CLEAR } from '../../src/world/leuna'
import {
  createAsch, FIELD_BUILDING_CLEAR, FIELD_CENTER, FIELD_LOBES, FIELD_PAD, FIELD_TREE_CLEAR, HUTS, TREE_CLUMPS,
} from '../../src/world/asch'

/** 佈景裡的車用地面單位的 GLB 樣板 —— 瀏覽器開場載，這裡直接讀 `public/` */
async function readPublic(url: string): Promise<ArrayBuffer> {
  const buf = readFileSync(`public${url}`)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

describe('Y-29 的佈景', () => {
  const { field } = createAsch()
  const heightAt = (x: number, z: number): number => field.sample(x, z)
  beforeAll(() => preloadGroundModels(readPublic))

  it('營房、木箱與車都站在地上 —— 沒有一個頂點低於腳下的地面', () => {
    const g = buildAschScenery(heightAt)
    const pos = g.getAttribute('position')
    let below = 0
    for (let i = 0; i < pos.count; i += 7) {
      if (pos.getY(i) < heightAt(pos.getX(i), pos.getZ(i)) - 0.1) below++
    }
    expect(below).toBe(0)
    g.dispose()
  })

  it('營房壓低成一層：最高的頂點不超過 6 m', () => {
    const g = buildAschScenery(heightAt)
    const pos = g.getAttribute('position')
    let top = 0
    for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i))
    expect(top).toBeGreaterThan(4)
    expect(top).toBeLessThan(6)
    expect(HUTS.length).toBeGreaterThan(0)
    g.dispose()
  })

  it('營房的屋脊順著長邊：heading 0 沿 z、π/2 沿 x，長度就是 length', () => {
    const template = buildingGeometry(0x76593c, 0x4a4946)
    for (const [heading, along] of [[0, 'z'], [Math.PI / 2, 'x']] as const) {
      const g = hutGeometry(template, { x: 0, z: 0, heading, length: 20, width: 7 }, 0, 1)
      const pos = g.getAttribute('position')
      let top = 0
      for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i))
      let lo = Infinity
      let hi = -Infinity
      let across = 0
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < top - 1e-6) continue
        const a = along === 'z' ? pos.getZ(i) : pos.getX(i)
        const b = along === 'z' ? pos.getX(i) : pos.getZ(i)
        lo = Math.min(lo, a)
        hi = Math.max(hi, a)
        across = Math.max(across, Math.abs(b))
      }
      // 屋頂比牆多出簷口，所以屋脊比 length 長一點
      expect(hi - lo, `heading ${heading}`).toBeGreaterThan(20)
      expect(hi - lo, `heading ${heading}`).toBeLessThan(23)
      expect(across, `heading ${heading}`).toBeLessThan(1e-6)
      g.dispose()
    }
    template.dispose()
  })

  /**
   * 【樹 100 m、村莊 300 m】墊面外 100 m 內一株都沒有；100～300 m 之間長得出樹，
   * 但一棟房子都沒有。池的頂點數分得出建築：房子與教堂各一個數，樹的每一級都不同
   */
  it('樹長到墊面外 100 m，村莊留在 300 m 外', () => {
    const terrain = createTerrain('asch')
    terrain.update(0, FIELD_CENTER.x, FIELD_CENTER.z)
    terrain.settle?.()
    const rects = [FIELD_PAD, ...FIELD_LOBES]
    const beyond = (x: number, z: number): number => {
      const lx = x - FIELD_CENTER.x
      const lz = z - FIELD_CENTER.z
      return Math.min(...rects.map((r) => Math.hypot(
        Math.max(0, r.x0 - lx, lx - r.x1), Math.max(0, r.z0 - lz, lz - r.z1),
      )))
    }
    const pools = createFloraGeometries('lateAutumn')
    const verts = (k: keyof typeof pools): number => pools[k].getAttribute('position').count
    const buildingVerts = new Set([verts('house'), verts('church')])
    for (const k of ['broadNear', 'broadMid', 'coneNear', 'coneMid', 'bushNear'] as const) {
      expect(buildingVerts.has(verts(k)), k).toBe(false)
    }
    disposeFloraGeometries(pools)
    const planned = TREE_CLUMPS.flatMap((c) => c.plants)
    let band = 0
    let stray = 0
    let clumpTrees = 0
    let buildingsNear = 0
    let treesInBand = 0
    const m = new Matrix4()
    terrain.object.traverse((o) => {
      const mesh = o as InstancedMesh
      if (!mesh.isInstancedMesh) return
      const building = buildingVerts.has(mesh.geometry.getAttribute('position').count)
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m)
        const x = m.elements[12]!
        const z = m.elements[14]!
        const d = beyond(x, z)
        // 【墊面裡只有樹叢】每一株都要對得上 `TREE_CLUMPS` 的一株
        if (d === 0) {
          if (!building && planned.some((t) => Math.abs(t.x - x) < 0.01 && Math.abs(t.z - z) < 0.01)) clumpTrees++
          else stray++
        } else if (d < FIELD_TREE_CLEAR) band++
        if (building && d < FIELD_BUILDING_CLEAR) buildingsNear++
        if (!building && d >= FIELD_TREE_CLEAR && d < FIELD_BUILDING_CLEAR) treesInBand++
      }
    })
    terrain.dispose()
    expect(FIELD_TREE_CLEAR).toBeLessThan(FIELD_BUILDING_CLEAR)
    expect(band).toBe(0)
    expect(stray).toBe(0)
    expect(clumpTrees).toBeGreaterThan(0)
    expect(buildingsNear).toBe(0)
    expect(treesInBand).toBeGreaterThan(0)
  })

  /**
   * 【只有 Y-29 分開】上面那一條量的是實際長出來的東西，但這張圖剛好沒有村莊落在
   * 100～300 m 之間 —— 村莊那一圈沒接上它也看不出來。這裡直接驗兩圈的值
   */
  it('淨空帶：Y-29 樹 100 m、村莊 300 m；波爾塔瓦與洛伊納兩者相同、不變', () => {
    expect(siteClearances(ASCH_SITE)).toEqual({ trees: FIELD_TREE_CLEAR, buildings: FIELD_BUILDING_CLEAR })
    expect(siteClearances(POLTAVA_SITE)).toEqual({ trees: 300, buildings: 300 })
    expect(siteClearances(LEUNA_SITE)).toEqual({ trees: PLANT_TREE_CLEAR, buildings: PLANT_TREE_CLEAR })
    expect(siteClearances()).toEqual({ trees: 0, buildings: 0 })
  })

  it('一顆網格、三角形數在預算內', () => {
    const g = buildAschScenery(heightAt)
    const tris = g.getAttribute('position').count / 3
    // 【上限是防爆量，不是畫質】一顆網格一個 draw call；擺位的迴圈寫錯時面數會
    // 暴增到這條擋得住的量級
    expect(tris).toBeGreaterThan(5_000)
    expect(tris).toBeLessThan(250_000)
    g.dispose()
  })
})
