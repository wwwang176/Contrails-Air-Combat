import { describe, it, expect, beforeAll } from 'vitest'
import { Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three'
import { buildP51D } from '../../src/render/geometry/p51d'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { glbTemplate } from '../../src/render/geometry/glb'
import { P51D } from '../../src/specs/p51d'
import { loadGlbTemplatesForNode } from '../fixtures/glb'

/**
 * **P-51D 搬到 GLB 之後，外型必須與程式版逐頂點相同。**
 *
 * 【這一支守什麼】`public/models/p51d.glb` 是用 `GLTFExporter` 從
 * `buildP51D()` 吐出來的（`test/tools/p51-export.ts`）。搬家的承諾是「外型
 * 一個頂點都不變」—— 匯出、載回、烘變換、按材質合併這一串任何一步掉了
 * 頂點、丟了零件、或把座艙內裝當成機身色，這裡都要紅。
 *
 * 【不寫外形的測試】這裡沒有任何「機翼應該多長」的斷言，比的是兩條路的
 * **一致性**。外形本身對不對，是機庫疊圖與 `ref/p51d.glb` 的事。
 *
 * 【多數逐 bit 相同，其餘 1e-6 m 內一一對應】機身、機翼這些零件在 GLB 裡的
 * 節點矩陣是單位矩陣，`glb.ts` 烘進去等於什麼都沒做，世界座標逐 bit 相同。
 * 有自己位移／旋轉的零件（blister、整流罩錐、槳葉）被烘過一次 float32，
 * 最低位會動 —— 實測 7,760 個靜態頂點裡 659 個差 ≤ 1.2e-7 m。先做精確的
 * 多重集合比對，對不上的那些再找最近鄰，容差 1e-6。
 */
beforeAll(async () => { await loadGlbTemplatesForNode() })

interface Split { statics: Vector3[]; spinning: Vector3[] }

function collect(root: Object3D): Split {
  root.updateMatrixWorld(true)
  const v = new Vector3()
  const statics: Vector3[] = []
  const spinning: Vector3[] = []
  root.traverse((o) => {
    const m = o as Mesh
    const pos = m.geometry?.getAttribute?.('position')
    if (!pos) return
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m.matrixWorld)
      ;(o.userData['spinning'] ? spinning : statics).push(v.clone())
    }
  })
  return { statics, spinning }
}

/**
 * 兩堆點要一一對應：先把逐 bit 相同的配掉，剩下的找最近鄰，距離要在
 * `tol` 內。回傳精確配對的數量與最遠的那一對。
 */
function match(a: Vector3[], b: Vector3[], tol: number): { exact: number; worst: number } {
  expect(a.length).toBe(b.length)
  const key = (p: Vector3): string => `${p.x},${p.y},${p.z}`
  const pool = new Map<string, number>()
  for (const p of b) pool.set(key(p), (pool.get(key(p)) ?? 0) + 1)
  const left: Vector3[] = []
  for (const p of a) {
    const n = pool.get(key(p))
    if (n) pool.set(key(p), n - 1)
    else left.push(p)
  }
  const rest: Vector3[] = []
  for (const p of b) {
    const n = pool.get(key(p))
    if (n) { pool.set(key(p), n - 1); rest.push(p) }
  }
  let worst = 0
  for (const p of left) {
    let best = -1, bestD = Infinity
    for (let i = 0; i < rest.length; i++) {
      const d = rest[i]!.distanceTo(p)
      if (d < bestD) { bestD = d; best = i }
    }
    expect(bestD).toBeLessThan(tol)
    worst = Math.max(worst, bestD)
    rest.splice(best, 1)
  }
  expect(rest).toEqual([])
  return { exact: a.length - left.length, worst }
}

describe('P-51D 走 GLB', () => {
  /**
   * 【先確認比的是兩條不同的路】沒有這一條，底下每一條在「p51d 還走程式版」
   * 時全部是綠的 —— 兩邊拿到的是同一份東西，比什麼都相同。
   */
  it('p51d 是由 GLB 樣板建出來的', () => {
    expect(glbTemplate('p51d')).toBeDefined()
  })

  it('靜態零件的世界座標：多數逐 bit 相同，其餘 1e-6 m 內一一對應', () => {
    const glb = collect(buildAircraft(P51D).group)
    const src = collect(buildP51D().group)
    const { exact } = match(glb.statics, src.statics, 1e-6)
    // 單位矩陣的那些零件（機身、機翼、玻璃、內裝）佔了絕大多數
    expect(exact).toBeGreaterThan(src.statics.length * 0.9)
  })

  it('槳葉與槳盤的頂點在 1e-6 m 內一一對應', () => {
    const glb = collect(buildAircraft(P51D).group)
    const src = collect(buildP51D().group)
    match(glb.spinning, src.spinning, 1e-6)
  })

  it('HullMetrics 與程式版一致', () => {
    const glb = buildAircraft(P51D).metrics
    const src = buildP51D().metrics
    expect(glb.realLength).toBe(src.realLength)
    expect(glb.noseZ).toBeCloseTo(src.noseZ, 6)
    expect(glb.noseY).toBeCloseTo(src.noseY, 6)
    expect(glb.tipY).toBeCloseTo(src.tipY, 6)
  })

  it('眼點與翼尖照抄程式版', () => {
    const glb = buildAircraft(P51D)
    const src = buildP51D()
    expect(glb.eyePoint.toArray()).toEqual(src.eyePoint.toArray())
    expect(glb.wingTip.toArray()).toEqual(src.wingTip.toArray())
  })

  /**
   * 座艙內裝是暗色、平滑著色、刻意朝內的殼。GLB 那條路原本只認三種材質
   * （機身色／暗色／玻璃），沒有這一種 —— 缺了它，內裝要嘛被拒載、要嘛被
   * 貼成整流罩的暗色。四種材質的頂點數都要跟程式版一樣。
   */
  it('四種材質各自的頂點數與程式版相同（含座艙內裝）', () => {
    const count = (root: Object3D): Record<string, number> => {
      const out: Record<string, number> = {}
      root.traverse((o) => {
        const m = o as Mesh
        if (!m.isMesh || o.userData['spinning']) return
        const mat = m.material as MeshStandardMaterial
        const key = `${mat.color.getHexString()}/${mat.flatShading ? 'flat' : 'smooth'}/${mat.transparent ? 'glass' : 'solid'}`
        out[key] = (out[key] ?? 0) + m.geometry.getAttribute('position').count
      })
      return out
    }
    expect(count(buildAircraft(P51D).group)).toEqual(count(buildP51D().group))
  })

  it('座艙內裝標了 inwardShell（法線朝外的檢查要略過它）', () => {
    let seen = false
    buildAircraft(P51D).group.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      if ((m.material as MeshStandardMaterial).color.getHex() === 0x191d1a) {
        expect(o.userData['inwardShell']).toBe(true)
        seen = true
      }
    })
    expect(seen).toBe(true)
  })
})
