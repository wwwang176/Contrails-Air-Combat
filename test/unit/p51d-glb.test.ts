import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { BufferGeometry, Material, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three'
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
 *   - 樣板持有的每一份幾何與材質 dispose 剛好一次 —— **包括合併時就放掉的
 *     來源**，那些在 parse 完之後已經摸不到，所以要在 parse 期間就攔截
 */
beforeAll(async () => { await loadGlbTemplatesForNode() })

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = []
  root.traverse((o) => { if ((o as Mesh).isMesh) out.push(o as Mesh) })
  return out
}

describe('P-51D 走 GLB', () => {
  it('建出來的飛機是樣板的複製：Object3D 各自一份、幾何共用', () => {
    const t = glbTemplate('p51d')
    expect(t).toBeDefined()
    const own = new Set(meshes(t!.group).map((m) => m.geometry))
    const a = buildAircraft(P51D), b = buildAircraft(P51D)
    const ma = meshes(a.group), mb = meshes(b.group)
    expect(ma.length).toBeGreaterThan(0)
    expect(a.group).not.toBe(t!.group)
    expect(a.group).not.toBe(b.group)
    for (let i = 0; i < ma.length; i++) {
      expect(ma[i]).not.toBe(mb[i])
      expect(own.has(ma[i]!.geometry)).toBe(true)
    }
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

  it('四片槳葉加一個載入時重做的槳盤，掛在轉軸位置的 hub 底下', () => {
    const model = buildAircraft(P51D)
    model.group.updateMatrixWorld(true)
    const spinning = meshes(model.group).filter((m) => m.userData['spinning'])
    const discs = spinning.filter((m) => m.geometry.type === 'CircleGeometry')
    expect(discs.length).toBe(1)
    expect(spinning.length - discs.length).toBe(4)
    const hubs = new Set(spinning.map((m) => m.parent))
    expect(hubs.size).toBe(1)
    const p = [...hubs][0]!.getWorldPosition(new Vector3())
    expect(p.toArray().map((v) => +v.toFixed(6))).toEqual([0, P51D_MODEL.props[0]!.hubY, P51D_MODEL.props[0]!.hubZ])
  })

  /**
   * 【為什麼要攔 clone】`parseGlbTemplate` 對每個來源 mesh 先 `geometry.clone()`
   * 再烘變換；被併掉的那些 clone 在 parse 途中就 dispose 並從 owned 移除，
   * parse 完之後從樣板摸不到它們。只監聽最後可達的幾何，會放過「合併來源
   * 忘了 dispose」這個漏洞。所以在 parse 期間把每一個 clone 都記下來。
   */
  it('parse 期間 clone 出來的每一份幾何、以及五份材質，dispose 剛好一次', async () => {
    const buf = readFileSync(`public${P51D_MODEL.url}`)
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const geoCounts = new Map<BufferGeometry, number>()
    const origClone = BufferGeometry.prototype.clone
    const origDispose = BufferGeometry.prototype.dispose
    BufferGeometry.prototype.clone = function (this: BufferGeometry) {
      const g = origClone.call(this)
      geoCounts.set(g, 0)
      return g
    }
    BufferGeometry.prototype.dispose = function (this: BufferGeometry) {
      if (geoCounts.has(this)) geoCounts.set(this, geoCounts.get(this)! + 1)
      return origDispose.call(this)
    }
    let t: Awaited<ReturnType<typeof parseGlbTemplate>>
    try {
      t = await parseGlbTemplate(bytes, P51D_MODEL)
    } finally {
      BufferGeometry.prototype.clone = origClone
    }
    try {
      // 最後可達的（併出來的、單株的、槳盤）也一併納入
      const reach = meshes(t.group)
      for (const m of reach) if (!geoCounts.has(m.geometry)) geoCounts.set(m.geometry, 0)
      const matCounts = new Map<Material, number>()
      for (const m of reach) {
        const mat = m.material as Material
        if (matCounts.has(mat)) continue
        matCounts.set(mat, 0)
        mat.addEventListener('dispose', () => matCounts.set(mat, matCounts.get(mat)! + 1))
      }
      expect(matCounts.size).toBe(5)   // body、accent、glass、cockpit、槳盤的 blur
      const before = [...geoCounts.values()].filter((n) => n === 1).length
      expect(before).toBeGreaterThan(0)   // 併掉的來源在 parse 時就放了
      t.dispose()
      for (const n of geoCounts.values()) expect(n).toBe(1)
      for (const n of matCounts.values()) expect(n).toBe(1)
    } finally {
      BufferGeometry.prototype.dispose = origDispose
    }
  })
})
