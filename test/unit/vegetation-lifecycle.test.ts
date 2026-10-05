import { describe, expect, it } from 'vitest'
import { BufferGeometry, InstancedMesh, Points, type Material } from 'three'
import { createVegetation, type Vegetation } from '../../src/render/vegetation'
import { POOL_NAMES } from '../../src/render/vegetationPolicy'

function observeDisposal(v: Vegetation) {
  const resources = new Set<BufferGeometry | Material | InstancedMesh>()
  v.object.traverse((o) => {
    if (!(o instanceof InstancedMesh || o instanceof Points)) return
    resources.add(o.geometry)
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) resources.add(m)
    if (o instanceof InstancedMesh) resources.add(o)
  })
  const counts = new Map([...resources].map((r) => [r, 0]))
  for (const r of resources) {
    const record = () => { counts.set(r, counts.get(r)! + 1) }
    if (r instanceof InstancedMesh) r.addEventListener('dispose', record)
    else if (r instanceof BufferGeometry) r.addEventListener('dispose', record)
    else r.addEventListener('dispose', record)
  }
  return counts
}

describe('植被場景的資源所有權', () => {
  it('各場景只釋放自己的幾何、材質與實例池，且每個資源恰好一次', () => {
    const capacity = Object.fromEntries(POOL_NAMES.map(n => [n, 4]))
    const a = createVegetation([], () => 0, { capacity, radius: 250, season: 'summer' })
    const b = createVegetation([], () => 0, { capacity, radius: 250, season: 'winterSteppe' })
    const ownedA = observeDisposal(a)
    const ownedB = observeDisposal(b)
    expect(ownedA.size).toBeGreaterThan(POOL_NAMES.length)
    expect([...ownedA.keys()].some(r => ownedB.has(r))).toBe(false)

    a.dispose()
    expect([...ownedA.values()]).toEqual([...ownedA].map(() => 1))
    expect([...ownedB.values()]).toEqual([...ownedB].map(() => 0))

    b.settle()
    b.dispose()
    expect([...ownedB.values()]).toEqual([...ownedB].map(() => 1))
    expect([...ownedA.values()]).toEqual([...ownedA].map(() => 1))
  })
})
