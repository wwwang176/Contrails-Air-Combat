import { describe, expect, it, vi } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { buildArcs, buildBarrels, buildShipArcs, disposeBarrels } from '../../src/tools/hangarWeapons'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import { turretPivot } from '../../src/weapons/turret'
import { SHIP_AA_ZONES } from '../../src/world/shipAA'

describe('hangar weapon geometry', () => {
  it('places aircraft arcs at each actual turret pivot with finite, bounded geometry', () => {
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

  it('creates no barrel resources for an aircraft without turrets and releases shared resources once', () => {
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

  it('uses the ship gun-zone positions and safely handles unknown ships', () => {
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
