import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHeightField } from '../../src/world/heightfield'
import {
  addRolling, clearanceOf, flatMask, ROLLING_CLEAR, ROLLING_PEAK_MAX, ROLLING_RAMP,
} from '../../src/world/rollingRelief'
import { FARM_CELL, FARM_SIZE, createFarmland } from '../../src/world/farmland'
import { createAsch } from '../../src/world/asch'
import { createPoltava } from '../../src/world/poltava'
import { createLeuna } from '../../src/world/leuna'
import { createTerrain, rzhevHillAvoid } from '../../src/render/terrain'
import { ASCH_SITE, LEUNA_SITE, POLTAVA_SITE } from '../../src/render/terrainSites'
import { PAD_SKIRT, type SiteLayout } from '../../src/render/siteSurface'
import { preloadPlantScenery } from '../../src/render/geometry/ground/plantScenery'
import { preloadAirfieldScenery } from '../../src/render/geometry/ground/airfieldScenery'
import { preloadGroundModels } from '../../src/render/geometry/ground'
import { leunaRiverPaths, preloadLeunaRivers } from '../../src/render/leunaRiver'
import { preloadLeunaFeatures } from '../../src/render/leunaFeatures'
import type { RiverFile } from '../../src/world/river'
import type { FeatureFile } from '../../src/world/landFeatures'

const field = (): ReturnType<typeof createHeightField> => createHeightField(FARM_SIZE, FARM_CELL)
const half = (FARM_SIZE - 1) / 2
const at = (col: number, row: number): [number, number] => [(col - half) * FARM_CELL, (row - half) * FARM_CELL]

describe('內陸的緩坡（rollingRelief）', () => {
  it('最高 ROLLING_PEAK_MAX，而且鋪滿大半張圖', () => {
    const f = field()
    addRolling(f, 1, [])
    let max = 0
    let raised = 0
    let n = 0
    for (let row = 0; row < FARM_SIZE; row++) {
      for (let col = 0; col < FARM_SIZE; col++) {
        const h = f.data[row * FARM_SIZE + col]!
        max = Math.max(max, h)
        const [x, z] = at(col, row)
        if (Math.abs(x) > 10000 || Math.abs(z) > 10000) continue
        n++
        if (h > 3) raised++
      }
    }
    expect(max).toBeLessThanOrEqual(ROLLING_PEAK_MAX + 1e-6)
    expect(max).toBeGreaterThan(ROLLING_PEAK_MAX * 0.9)
    expect(raised / n).toBeGreaterThan(0.6)
  })

  it('要平的範圍與外面 ROLLING_CLEAR 一圈不動；更外面長得起來', () => {
    const f = field()
    const cx = 2000
    const cz = -3000
    const r = 1500
    addRolling(f, 1, [(x, z) => (x - cx) ** 2 + (z - cz) ** 2 < r * r])
    let ringRaised = 0
    for (let row = 0; row < FARM_SIZE; row++) {
      for (let col = 0; col < FARM_SIZE; col++) {
        const [x, z] = at(col, row)
        const d = Math.hypot(x - cx, z - cz)
        const h = f.data[row * FARM_SIZE + col]!
        // 遮罩是逐格心判斷的：圓緣往內少算一格對角線
        if (d < r + ROLLING_CLEAR - FARM_CELL * Math.SQRT2) expect(h, `${x},${z}`).toBe(0)
        if (d > r + ROLLING_CLEAR + ROLLING_RAMP + 200 && d < r + 3000 && h > 3) ringRaised++
      }
    }
    expect(ringRaised).toBeGreaterThan(50)
  })

  it('佈景的頂點落到的格不動', () => {
    const f = field()
    const pts: number[] = []
    for (let x = 0; x <= 5000; x += 10) pts.push(x, 4000)
    addRolling(f, 1, [], pts)
    for (let x = 0; x <= 5000; x += FARM_CELL) {
      const col = Math.round(x / FARM_CELL + half)
      const row = Math.round(4000 / FARM_CELL + half)
      expect(f.data[row * FARM_SIZE + col]).toBe(0)
    }
  })

  it('只抬高：原本比緩坡高的地方不變', () => {
    const f = field()
    f.data.fill(50)
    addRolling(f, 1, [])
    expect(f.data.every((h) => h === 50)).toBe(true)
  })

  it('到遮罩的距離：直向與斜向', () => {
    const f = field()
    // 格數是偶數，格心落在 ±40 m：(0, 0) 那一點落在第 round(half) 格
    const mask = flatMask(f, [], [0, 0])
    const d = clearanceOf(f, mask)
    const c = Math.round(half)
    expect(d[c * FARM_SIZE + c + 10]).toBeCloseTo(10 * FARM_CELL, 3)
    expect(d[(c + 10) * FARM_SIZE + c + 10]).toBeCloseTo(10 * FARM_CELL * Math.SQRT2, 1)
  })
})

/** 墊面、附加墊面、衛星設施往外 `margin` 以內的格點（世界座標） */
function sitePoints(site: SiteLayout, margin: number): [number, number][] {
  const rects = [...(site.pad === undefined ? [] : [site.pad]), ...(site.padLobes ?? []), ...(site.outposts ?? [])]
  const c = Math.cos(site.heading ?? 0)
  const s = Math.sin(site.heading ?? 0)
  const px = site.pivot?.x ?? 0
  const pz = site.pivot?.z ?? 0
  const out: [number, number][] = []
  for (const r of rects) {
    for (let lx = r.x0 - margin; lx <= r.x1 + margin; lx += 100) {
      for (let lz = r.z0 - margin; lz <= r.z1 + margin; lz += 100) {
        // 局部轉世界：地色著色器的 local 轉換的反向
        out.push([px + lx * c - lz * s, pz + lx * s + lz * c])
      }
    }
  }
  return out
}

/**
 * 每一點的地面高度與原本的高度場相同；而且圖上別處真的有起伏。比的是陸地的高度場
 * （`land.field`）—— `collisionHeightAt` 在河上是水面
 */
function expectFlatAndRolling(
  t: ReturnType<typeof createTerrain>, base: { sample(x: number, z: number): number },
  pts: readonly (readonly [number, number])[],
): void {
  const ground = t.land!.field
  for (const [x, z] of pts) {
    expect(ground.sample(x, z), `${x.toFixed(0)},${z.toFixed(0)}`).toBeCloseTo(base.sample(x, z), 6)
  }
  let raised = 0
  for (let x = -12000; x <= 12000; x += 500) {
    for (let z = -12000; z <= 12000; z += 500) if (ground.sample(x, z) - base.sample(x, z) > 5) raised++
  }
  expect(raised).toBeGreaterThan(200)
}

const villageCentres = (): [number, number][] => rzhevHillAvoid().map((v) => [v.x, v.z])
const readPublic = (url: string): Promise<ArrayBuffer> => {
  const buf = readFileSync('public' + url)
  return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
}

describe('各地圖的緩坡避開要平的地方', () => {
  it('農地：村與小聚落', () => {
    const t = createTerrain('farmland')
    expectFlatAndRolling(t, createFarmland().field, villageCentres())
    t.dispose()
  })

  it('農地（選單短片）：動作圈整圈不動', () => {
    const flat = { x: 3000, z: -2000, r: 3500 }
    const t = createTerrain('farmland', undefined, () => ({ roads: [], roadWidth: 0, flat }))
    const pts: [number, number][] = []
    for (let a = 0; a < 24; a++) {
      for (const k of [0, 0.5, 0.95]) {
        pts.push([flat.x + Math.cos(a / 24 * Math.PI * 2) * flat.r * k, flat.z + Math.sin(a / 24 * Math.PI * 2) * flat.r * k])
      }
    }
    expectFlatAndRolling(t, createFarmland().field, pts)
    t.dispose()
  })

  it('德 M3 艾希：機場墊面與砲位那一圈、村', async () => {
    // 營房與車場的佈景要先載車輛的模型
    await preloadGroundModels(readPublic)
    const t = createTerrain('asch')
    expectFlatAndRolling(t, createAsch().field,
      [...sitePoints(ASCH_SITE, PAD_SKIRT + (ASCH_SITE.treeClear ?? 0)), ...villageCentres()])
    t.dispose()
  })

  describe('要載佈景的兩張', () => {
    beforeAll(async () => {
      await preloadAirfieldScenery(readPublic)
      await preloadPlantScenery(readPublic)
      await preloadLeunaRivers((url) => Promise.resolve(JSON.parse(readFileSync('public' + url, 'utf8')) as RiverFile))
      await preloadLeunaFeatures((url) => Promise.resolve(JSON.parse(readFileSync('public' + url, 'utf8')) as FeatureFile))
    })

    it('波爾塔瓦：機場墊面、村', () => {
      const t = createTerrain('poltava')
      expectFlatAndRolling(t, createPoltava().field,
        [...sitePoints(POLTAVA_SITE, PAD_SKIRT + (POLTAVA_SITE.treeClear ?? 0)), ...villageCentres()])
      t.dispose()
    })

    let leuna: ReturnType<typeof createTerrain>
    beforeAll(() => { leuna = createTerrain('leuna') })
    afterAll(() => { leuna.dispose() })

    it('洛伊納：河兩側 450 m、廠區墊面', () => {
      const pts: [number, number][] = []
      for (const l of leunaRiverPaths()) {
        for (let i = 0; i < l.points.length; i += 4) {
          const [x, z] = l.points[i]!
          if (Math.abs(x) > 14000 || Math.abs(z) > 14000) continue
          for (const off of [-450, 0, 450]) pts.push([x + off, z], [x, z + off])
        }
      }
      expectFlatAndRolling(leuna, createLeuna().field, [...pts, ...sitePoints(LEUNA_SITE, PAD_SKIRT)])
    })
  })
})
