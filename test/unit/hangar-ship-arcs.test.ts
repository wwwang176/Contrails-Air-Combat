import { describe, expect, it, vi } from 'vitest'
import { LineSegments, Mesh, Vector3, type BufferGeometry, type Material } from 'three'
import { buildShipArcs, selectShipArc, shipArcLimits } from '../../src/tools/hangarShipArcs'
import { SHIP_GUN_LAYOUTS } from '../../src/specs/shipGunLayouts'
import { disposeHangarShip } from '../../src/tools/hangarShipLoading'

describe('physical ship mount arc visualization', () => {
  it.each(['fletcher', 'wichita', 'essex', 'lst'] as const)('%s never joins separate yaw sectors across a dead zone', id => {
    const arcs = buildShipArcs(id), mounts = SHIP_GUN_LAYOUTS[id]!.mounts
    const center = new Vector3(), vertex = new Vector3(), violations: string[] = []
    try {
      for (const group of arcs.children) {
        const limits = shipArcLimits(mounts[group.name]!)
        group.traverse(o => {
          if (!(o instanceof Mesh) || o.name === 'pivot') return
          const positions = o.geometry.getAttribute('position')
          for (let i = 0; i < positions.count; i += 3) {
            center.set(0, 0, 0)
            for (let j = 0; j < 3; j++) center.add(vertex.fromBufferAttribute(positions, i + j))
            const yaw = Math.atan2(-center.x, -center.z)
            if (!limits.yaw.some(([lo, hi]) => yaw >= lo - 1e-6 && yaw <= hi + 1e-6)) violations.push(`${group.name}: yaw ${yaw}`)
          }
          for (let i = 0; i < positions.count; i++) {
            center.fromBufferAttribute(positions, i)
            const distance = center.length()
            if (!Number.isFinite(distance) || distance > 22.001) violations.push(`${group.name}: radius ${distance}`)
            if (distance < 1e-6) continue
            const pitch = Math.atan2(center.y, Math.hypot(center.x, center.z))
            if (pitch < limits.pitch[0] - 1e-6 || pitch > limits.pitch[1] + 1e-6) violations.push(`${group.name}: pitch ${pitch}`)
          }
        })
      }
      expect(violations).toEqual([])
    } finally { disposeHangarShip(arcs) }
  })

  it('selects one mount and restores all without allocating or modifying the source mounts', () => {
    const arcs = buildShipArcs('fletcher'), children = [...arcs.children]
    try {
      selectShipArc(arcs, 'flak_c3')
      expect(arcs.children.filter(c => c.visible).map(c => c.name)).toEqual(['flak_c3'])
      selectShipArc(arcs, '')
      expect(arcs.children.every(c => c.visible)).toBe(true)
      expect(arcs.children).toEqual(children)
    } finally { disposeHangarShip(arcs) }
  })

  it('disposes nested sector surfaces, outlines and shared materials exactly once', () => {
    const arcs = buildShipArcs('lst'), resources = new Set<BufferGeometry | Material>()
    arcs.traverse(o => {
      if (!(o instanceof Mesh) && !(o instanceof LineSegments)) return
      resources.add(o.geometry)
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) resources.add(material)
    })
    const spies = [...resources].map(r => vi.spyOn(r, 'dispose'))
    disposeHangarShip(arcs)
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce()
  })
})
