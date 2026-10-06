import { describe, expect, it, vi } from 'vitest'
import { Color, Group, Mesh, Vector3 } from 'three'
import { createReelDecor } from '../../src/app/reel/reelDecor'
import { buildDecor } from '../../src/render/geometry/ground/plantDecor'
import type { ReelDecor } from '../../src/app/reelShots'

const ITEM: ReelDecor = { kind: 'warehouse', x: 0, z: 0, heading: 0, w: 6, d: 8, h: 4 }
const FLAT = { collisionHeightAt: () => 12 }
const IDENTITY = (v: Vector3) => v

function fixture() {
  const group = new Group()
  const fx = { groundKill: vi.fn() }
  const decor = createReelDecor(group, fx, 15)
  const mesh = () => {
    const child = group.children.find((item) => item instanceof Mesh)
    if (!(child instanceof Mesh)) throw new Error('missing decor mesh')
    return child
  }
  return { group, fx, decor, mesh }
}

describe('reel scenery ownership', () => {
  it('merges buildings into one mesh and burns only nearby vertex ranges in place', () => {
    const f = fixture()
    f.decor.build([ITEM, { ...ITEM, x: 100 }], FLAT, IDENTITY, 0)
    expect(f.group.children).toHaveLength(1)
    const mesh = f.mesh()
    const source = buildDecor(ITEM.kind, ITEM.w, ITEM.d, ITEM.h)
    const count = source.getAttribute('position').count
    source.dispose()
    expect(mesh.geometry.getAttribute('position').count).toBe(count * 2)
    const colors = mesh.geometry.getAttribute('color')
    const buffer = colors.array
    const farColors = buffer.slice(count * 3)
    f.decor.burn(0, 0)
    expect(f.fx.groundKill).toHaveBeenCalledTimes(1)
    expect(f.fx.groundKill).toHaveBeenCalledWith(0, 12, 0, 2)
    expect(mesh.geometry.getAttribute('color')).toBe(colors)
    expect(colors.array).toBe(buffer)
    expect(buffer.slice(count * 3)).toEqual(farColors)
    const burnt = new Color(0x2a2421)
    for (let i = 0; i < count; i++) {
      expect(colors.getX(i)).toBeCloseTo(burnt.r)
      expect(colors.getY(i)).toBeCloseTo(burnt.g)
      expect(colors.getZ(i)).toBeCloseTo(burnt.b)
    }
    f.decor.burn(0, 0)
    expect(f.fx.groundKill).toHaveBeenCalledTimes(1)
  })

  it('uses the shot transform and terrain height for fire positions', () => {
    const f = fixture()
    const toWorld = (v: Vector3) => v.applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
      .add(new Vector3(100, 0, 200))
    f.decor.build([{ ...ITEM, x: 10, z: 20 }], FLAT, toWorld, Math.PI / 2)
    const geometry = f.mesh().geometry
    geometry.computeBoundingBox()
    const bounds = geometry.boundingBox!
    expect(bounds.min.y).toBeCloseTo(12)
    expect((bounds.min.x + bounds.max.x) / 2).toBeCloseTo(120)
    expect((bounds.min.z + bounds.max.z) / 2).toBeCloseTo(190)
    f.decor.burn(120, 190)
    expect(f.fx.groundKill).toHaveBeenCalledWith(120, 12, 190, 2)
  })

  it('preserves the strict explosion radius boundary', () => {
    const f = fixture()
    f.decor.build([ITEM], FLAT, IDENTITY, 0)
    f.decor.burn(20, 0)
    expect(f.fx.groundKill).not.toHaveBeenCalled()
    f.decor.burn(19.999, 0)
    expect(f.fx.groundKill).toHaveBeenCalledTimes(1)
  })

  it('releases old geometry once, retains siblings, and reuses material across shots', () => {
    const f = fixture()
    const sibling = new Group()
    f.group.add(sibling)
    f.decor.build([ITEM], FLAT, IDENTITY, 0)
    const first = f.mesh()
    const dispose = vi.spyOn(first.geometry, 'dispose')
    f.decor.burn(0, 0)
    f.decor.clear()
    f.decor.clear()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(f.group.children).toEqual([sibling])
    f.decor.build([ITEM], FLAT, IDENTITY, 0)
    expect(f.mesh().material).toBe(first.material)
    f.decor.burn(0, 0)
    expect(f.fx.groundKill).toHaveBeenCalledTimes(2)
    const nextDispose = vi.spyOn(f.mesh().geometry, 'dispose')
    f.decor.build([], FLAT, IDENTITY, 0)
    expect(nextDispose).toHaveBeenCalledTimes(1)
    expect(f.group.children).toEqual([sibling])
    f.decor.burn(0, 0)
    expect(f.fx.groundKill).toHaveBeenCalledTimes(2)
  })
})
