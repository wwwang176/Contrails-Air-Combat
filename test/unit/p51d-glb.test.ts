import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { BufferGeometry, Mesh, MeshStandardMaterial, Object3D } from 'three'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { glbTemplate, parseGlbTemplate } from '../../src/render/geometry/glb'
import { P51D_MODEL } from '../../src/render/geometry/p51d.model'
import { P51D } from '../../src/specs/p51d'
import { loadGlbTemplatesForNode } from '../fixtures/glb'

/**
 * **P-51D 的 GLB 路。** 外型本身對不對是機庫疊圖與 `p51-ref.verify.ts` 的事
 * （專案不寫外形的測試）；這裡守的是載入這條路把該帶的都帶到了：
 *
 *   - 建出來的飛機是**樣板的複製**（幾何共用），不是另一條路悄悄接回來
 *   - 四種材質都在、各自有頂點；座艙內裝標了 inwardShell
 *   - 翼板的 `part='wingN'` 標記從 Blender 的 extras 一路傳到合併後的 mesh
 *     （`geometry.test.ts` 的四分之一弦線守衛靠它）
 *   - 槳葉四片都認得出來、槳盤是載入時重做的
 *   - 樣板持有的每一份幾何 dispose 剛好一次（合併掉的來源在 parse 時就放）
 */
beforeAll(async () => { await loadGlbTemplatesForNode() })

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = []
  root.traverse((o) => { if ((o as Mesh).isMesh) out.push(o as Mesh) })
  return out
}

describe('P-51D 走 GLB', () => {
  it('建出來的飛機與樣板共用幾何 —— 那是 GLB 路的特徵', () => {
    const t = glbTemplate('p51d')
    expect(t).toBeDefined()
    const own = new Set(meshes(t!.group).map((m) => m.geometry))
    const built = meshes(buildAircraft(P51D).group)
    expect(built.length).toBeGreaterThan(0)
    for (const m of built) expect(own.has(m.geometry)).toBe(true)
  })

  it('四種材質都有頂點，座艙內裝標了 inwardShell', () => {
    const byKey = new Map<string, number>()
    for (const m of meshes(buildAircraft(P51D).group)) {
      if (m.userData['spinning']) continue
      const mat = m.material as MeshStandardMaterial
      const key = `${mat.color.getHexString()}/${mat.flatShading ? 'flat' : 'smooth'}/${mat.transparent ? 'glass' : 'solid'}`
      byKey.set(key, (byKey.get(key) ?? 0) + m.geometry.getAttribute('position').count)
      if (mat.color.getHex() === 0x191d1a) expect(m.userData['inwardShell']).toBe(true)
    }
    expect([...byKey.keys()].sort()).toEqual([
      `${P51D_MODEL.bodyColor.toString(16)}/flat/solid`,
      `${P51D_MODEL.accentColor.toString(16)}/flat/solid`,
      '9fd4e8/flat/glass',
      '191d1a/smooth/solid',
    ].sort())
    for (const n of byKey.values()) expect(n).toBeGreaterThan(0)
  })

  it('三對翼板各自是一個 mesh，帶 part 標記', () => {
    const parts = meshes(buildAircraft(P51D).group)
      .map((m) => m.userData['part']).filter((p): p is string => typeof p === 'string').sort()
    expect(parts).toEqual(['wing0', 'wing1', 'wing2'])
  })

  it('四片槳葉加一個載入時重做的槳盤', () => {
    const spinning = meshes(buildAircraft(P51D).group).filter((m) => m.userData['spinning'])
    const discs = spinning.filter((m) => m.geometry.type === 'CircleGeometry')
    expect(discs.length).toBe(1)
    expect(spinning.length - discs.length).toBe(4)
  })

  it('樣板的每一份幾何 dispose 剛好一次', async () => {
    const buf = readFileSync(`public${P51D_MODEL.url}`)
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const t = await parseGlbTemplate(bytes, P51D_MODEL)
    const counts = new Map<BufferGeometry, number>()
    for (const m of meshes(t.group)) {
      counts.set(m.geometry, 0)
      m.geometry.addEventListener('dispose', () => counts.set(m.geometry, counts.get(m.geometry)! + 1))
    }
    t.dispose()
    expect(counts.size).toBeGreaterThan(0)
    for (const n of counts.values()) expect(n).toBe(1)
  })
})
