import { describe, it, expect, beforeAll } from 'vitest'
import { Mesh, MeshStandardMaterial, Object3D, Vector3, DoubleSide } from 'three'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { HE111_MODEL } from '../../src/render/geometry/he111.model'
import { B17G_MODEL } from '../../src/render/geometry/b17g.model'
import { HE111 } from '../../src/specs/he111'
import { B17G } from '../../src/specs/b17g'
import { loadGlbTemplatesForNode } from '../fixtures/glb'

/**
 * **多發機走 GLB 路。** He 111 雙發、B-17G 四發 —— `glb.ts` 原本只認一具
 * 螺旋槳，這兩台搬過來時開了 `props` 陣列與兩種雙面材質。這裡守的是：
 *
 *   - 每一具都有自己的轉軸 Group，位置與 manifest 的 `(hubX, hubY, hubZ)` 相同
 *   - 每具三片槳葉、一個載入時重做的槳盤；`setPropSpin` 一次驅動全部
 *   - 六種材質都有頂點；雙面的那兩種真的是雙面（骨架從機外看得到背面、
 *     碗從開口看得到內壁）
 *   - 翼板的 `part` 標記從 Blender 的 extras 帶到合併後的 mesh
 */
beforeAll(async () => { await loadGlbTemplatesForNode() })

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = []
  root.traverse((o) => { if ((o as Mesh).isMesh) out.push(o as Mesh) })
  return out
}

const CASES = [
  { spec: HE111, def: HE111_MODEL, wings: ['wing0', 'wing1', 'wing2'] },
  { spec: B17G, def: B17G_MODEL, wings: ['wing0', 'wing1'] },
] as const

describe.each(CASES)('$spec.id 走 GLB', ({ spec, def, wings }) => {
  it('每一具螺旋槳各有轉軸、三片槳葉與一個槳盤，位置照 manifest', () => {
    const model = buildAircraft(spec)
    model.group.updateMatrixWorld(true)
    const spinning = meshes(model.group).filter((m) => m.userData['spinning'])
    const hubs = [...new Set(spinning.map((m) => m.parent!))]
    expect(hubs.length).toBe(def.props.length)
    const got = hubs.map((h) => h.getWorldPosition(new Vector3()).toArray().map((v) => +v.toFixed(6)))
    const want = def.props.map((p) => [p.hubX ?? 0, p.hubY, p.hubZ])
    expect(got.sort()).toEqual(want.sort())
    for (const h of hubs) {
      const kids = h.children.filter((c) => c.userData['spinning']) as Mesh[]
      expect(kids.filter((m) => m.geometry.type === 'CircleGeometry').length).toBe(1)
      expect(kids.filter((m) => m.geometry.type !== 'CircleGeometry').length).toBe(3)
    }
  })

  it('setPropSpin 一次驅動全部轉軸，槳盤與槳葉互斥可見', () => {
    const model = buildAircraft(spec)
    model.setPropSpin(1.5, true)
    const spinning = meshes(model.group).filter((m) => m.userData['spinning'])
    const discs = spinning.filter((m) => m.geometry.type === 'CircleGeometry')
    const blades = spinning.filter((m) => m.geometry.type !== 'CircleGeometry')
    expect(discs.length).toBe(def.props.length)
    expect(discs.every((d) => d.visible)).toBe(true)
    expect(blades.every((b) => !b.visible)).toBe(true)
    expect(discs.every((d) => Math.abs(d.parent!.rotation.z - 1.5) < 1e-9)).toBe(true)
    model.setPropSpin(0, false)
    expect(discs.every((d) => !d.visible)).toBe(true)
    expect(blades.every((b) => b.visible)).toBe(true)
  })

  it('六種材質都有頂點；骨架與碗是雙面的，其餘單面', () => {
    const byKey = new Map<string, { n: number; side: number }>()
    for (const m of meshes(buildAircraft(spec).group)) {
      if (m.userData['spinning']) continue
      const mat = m.material as MeshStandardMaterial
      const key = `${mat.color.getHexString()}/${mat.flatShading ? 'flat' : 'smooth'}`
        + `/${mat.transparent ? 'glass' : 'solid'}/${mat.side === DoubleSide ? 'both' : 'front'}`
      const cur = byKey.get(key) ?? { n: 0, side: mat.side }
      cur.n += m.geometry.getAttribute('position').count
      byKey.set(key, cur)
    }
    const body = def.bodyColor.toString(16), accent = def.accentColor.toString(16)
    expect([...byKey.keys()].sort()).toEqual([
      `${body}/flat/solid/front`,      // body
      `${accent}/flat/solid/front`,    // accent
      '9fd4e8/flat/glass/front',       // glass
      '191d1a/smooth/solid/front',     // cockpit
      `${body}/flat/solid/both`,       // frame
      '191d1a/smooth/solid/both',      // inner
    ].sort())
    for (const { n } of byKey.values()) expect(n).toBeGreaterThan(0)
  })

  it('翼板各自是一個 mesh，帶 part 標記', () => {
    const parts = meshes(buildAircraft(spec).group)
      .map((m) => m.userData['part']).filter((p): p is string => typeof p === 'string').sort()
    expect(parts).toEqual([...wings])
  })
})
