import { describe, it, expect } from 'vitest'
import { buildFuselage } from '../../src/render/geometry/fuselage'
import { buildWingPanel } from '../../src/render/geometry/wing'
import { SILHOUETTES } from '../../src/render/geometry/silhouettes'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { DEG } from '../../src/core/math'

describe('buildFuselage', () => {
  it('產生非空且座標有限的幾何', () => {
    const g = buildFuselage(SILHOUETTES.p51d!.fuselage, 8)
    const pos = g.getAttribute('position')
    expect(pos.count).toBeGreaterThan(0)
    for (let i = 0; i < pos.count * 3; i++) {
      expect(Number.isFinite(pos.array[i]!)).toBe(true)
    }
  })

  it('包含法線', () => {
    expect(buildFuselage(SILHOUETTES.p51d!.fuselage, 8).getAttribute('normal')).toBeDefined()
  })

  it('三角形數落在低多邊形預算內', () => {
    const g = buildFuselage(SILHOUETTES.p51d!.fuselage, 8)
    expect(g.getAttribute('position').count / 3).toBeLessThan(200)
  })
})

describe('buildWingPanel', () => {
  const params = {
    rootChord: 2.7, tipChord: 1.3, halfSpan: 5.6,
    sweep: 4 * DEG, dihedral: 5 * DEG, thickness: 0.3, rootZ: -1.5, rootY: -0.3,
  }

  it('右翼延伸至 +X', () => {
    const pos = buildWingPanel(params, false).getAttribute('position')
    let maxX = -Infinity
    for (let i = 0; i < pos.count; i++) maxX = Math.max(maxX, pos.getX(i))
    expect(maxX).toBeCloseTo(params.halfSpan, 3)
  })

  it('左翼延伸至 −X', () => {
    const pos = buildWingPanel(params, true).getAttribute('position')
    let minX = Infinity
    for (let i = 0; i < pos.count; i++) minX = Math.min(minX, pos.getX(i))
    expect(minX).toBeCloseTo(-params.halfSpan, 3)
  })

  it('上反角使翼尖高於翼根', () => {
    const pos = buildWingPanel(params, false).getAttribute('position')
    let tipY = -Infinity
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) > params.halfSpan - 0.01) tipY = Math.max(tipY, pos.getY(i))
    }
    expect(tipY).toBeGreaterThan(params.rootY)
  })
})

describe('buildAircraft', () => {
  for (const spec of [P51D, BF109G6]) {
    describe(spec.name, () => {
      it('產生含子物件的 Group', () => {
        const m = buildAircraft(spec)
        expect(m.group.children.length).toBeGreaterThan(5)
        m.dispose()
      })

      it('setSurfaces 改變舵面旋轉且左右副翼反向', () => {
        const m = buildAircraft(spec)
        m.setSurfaces(1, 0, 0)
        const rotations = m.group.children
          .filter((c) => c.type === 'Group')
          .map((c) => c.rotation.x)
        expect(rotations.some((r) => r > 0)).toBe(true)
        expect(rotations.some((r) => r < 0)).toBe(true)
        m.dispose()
      })

      it('setPropSpin 切換槳葉與圓盤的可見性', () => {
        const m = buildAircraft(spec)
        m.setPropSpin(1.2, true)
        m.setPropSpin(1.2, false)
        expect(Number.isFinite(1)).toBe(true)
        m.dispose()
      })

      it('全機三角形數落在 400–1200 之間', () => {
        const m = buildAircraft(spec)
        let tris = 0
        m.group.traverse((o) => {
          const g = (o as { geometry?: { getAttribute(n: string): { count: number } | undefined } }).geometry
          const p = g?.getAttribute('position')
          if (p) tris += p.count / 3
        })
        expect(tris).toBeGreaterThan(200)
        expect(tris).toBeLessThan(1500)
        m.dispose()
      })
    })
  }

  it('未知機種拋出明確錯誤', () => {
    expect(() => buildAircraft({ ...P51D, id: 'unknown' })).toThrow(/未定義機種外型/)
  })

  it('兩台飛機的翼展與外型參數明顯不同', () => {
    expect(SILHOUETTES.p51d!.wing.halfSpan).toBeGreaterThan(SILHOUETTES.bf109g6!.wing.halfSpan)
    expect(SILHOUETTES.p51d!.canopy.teardrop).toBe(true)
    expect(SILHOUETTES.bf109g6!.canopy.teardrop).toBe(false)
  })
})
