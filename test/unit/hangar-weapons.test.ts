import { describe, expect, it, vi } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { buildArcs, buildBarrels, buildShipArcs, disposeBarrels } from '../../src/tools/hangarWeapons'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import { turretPivot } from '../../src/weapons/turret'
import { SHIP_AA_ZONES } from '../../src/world/shipAA'

describe('機庫的武器幾何', () => {
  it('飛機的射界弧放在每一座砲塔真正的轉軸上，幾何有限而且有界', () => {
    const group = buildArcs({ turrets: B17G.turrets })
    expect(group.children).toHaveLength(B17G.turrets.length)
    const pivot = new Vector3()
    for (let i = 0; i < group.children.length; i++) {
      const mesh = group.children[i] as Mesh
      expect(mesh.position.distanceTo(turretPivot(B17G.turrets[i]!, pivot))).toBeLessThan(1e-10)
      mesh.geometry.computeBoundingSphere()
      const p = mesh.geometry.getAttribute('position')
      for (let j = 0; j < p.count; j++) {
        const distance = Math.hypot(p.getX(j), p.getY(j), p.getZ(j))
        expect(Number.isFinite(distance)).toBe(true)
        expect(distance).toBeLessThanOrEqual(8.000001)
      }
    }
    disposeBarrels(group)
  })

  it('沒有砲塔的飛機不建砲管；共用的資源只釋放一次', () => {
    expect(buildBarrels({ turrets: P51D.turrets }).children).toHaveLength(0)
    const group = buildBarrels({ turrets: B17G.turrets })
    expect(group.children).toHaveLength(B17G.turrets.reduce((n, t) => n + t.guns, 0))
    const meshes = group.children as Mesh[]
    const geometries = new Set(meshes.map(m => m.geometry))
    const materials = new Set(meshes.flatMap(m => Array.isArray(m.material) ? m.material : [m.material]))
    const resources = [...geometries, ...materials]
    const disposed = resources.map(r => vi.spyOn(r, 'dispose'))
    disposeBarrels(group)
    for (const spy of disposed) expect(spy).toHaveBeenCalledOnce()
  })

  it('船用砲區的位置；不認得的船回空的群組', () => {
    expect(buildShipArcs('unknown').children).toHaveLength(0)
    for (const id of ['essex', 'fletcher', 'wichita', 'lst']) {
      const group = buildShipArcs(id)
      const zones = SHIP_AA_ZONES[id] ?? []
      expect(group.children).toHaveLength(zones.length)
      for (let i = 0; i < zones.length; i++) {
        expect(group.children[i]!.position.equals(zones[i]!.position)).toBe(true)
        expect(group.children[i]!.quaternion.length()).toBeCloseTo(1, 10)
      }
      disposeBarrels(group)
    }
  })
})
