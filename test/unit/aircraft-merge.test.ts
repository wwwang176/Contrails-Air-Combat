import { describe, it, expect } from 'vitest'
import { BufferGeometry, Material, Matrix4, Mesh, Object3D, Vector3 } from 'three'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { PROP_DISC_RENDER_ORDER } from '../../src/render/geometry/assembly'

/**
 * **靜態零件按材質合併。**
 *
 * 【它在買什麼】一架戰鬥機是三十幾個 `Mesh`，20v20 就是 1,220 次 draw call。
 * 把不會動的那些按材質併起來，40 架省下約兩百次。
 *
 * 【為什麼只併「局部矩陣是單位矩陣」的】要併不同座標系的零件就得把變換烘進
 * 頂點（`clone().applyMatrix4(matrixWorld)`）。那一步一定改像素：CPU 用
 * float64 算完存成 float32，GPU 是 float32 矩陣乘 float32 頂點，最低位不同，
 * 三角形邊緣的像素必然翻動。**局部矩陣是單位矩陣的零件不必烘** —— 併出來的
 * mesh 仍然掛在 `hull` 底下，世界矩陣一模一樣，頂點資料一個 bit 都沒動。
 */

const IDS = ['p51d', 'bf109k4', 'he111', 'b17g'] as const

/**
 * 合併後每一架剩幾個 `Mesh`。**這是量出來的，不是訂出來的**
 * （`test/tools/merge-groups.probe.ts`）。
 *
 * ```
 *    機種      合併前   合併後
 *    p51d          30      27
 *    bf109k4       31      29
 *    he111         46      36
 *    b17g          52      40
 * ```
 *
 * 【翼板逐 `wingPair` 呼叫各自一組】併成一塊之後「哪一個 mesh 是主翼」就認
 * 不出來，而 `geometry.test.ts` 的「四分之一弦線壓在重心上」正是靠主翼的
 * 翼根弦量的。代價是每一架多兩三個 draw call。
 */
const MESHES: Record<string, number> = { p51d: 27, bf109k4: 29, he111: 36, b17g: 40 }

/** 合併出來的 mesh 有幾個（＝實際併起來的組數，只有一株的組不併）。 */
const MERGED: Record<string, number> = { p51d: 3, bf109k4: 2, he111: 5, b17g: 5 }

/**
 * 合併前量到的頂點數與世界座標＋法線的雜湊。
 *
 * 【為什麼釘雜湊而不是比兩份模型】合併寫在 `finish()` 裡，沒有「不合併」的
 * 建構路徑可以拿來當對照。這兩個數字是在合併上線**之前**量的，所以它們就是
 * 對照組：合併若掉了頂點、或動了任何一個座標的最低位，兩個都會變。
 */
const BEFORE: Record<string, { vertices: number, hash: number }> = {
  p51d: { vertices: 7874, hash: 0x94beb9c6 },
  bf109k4: { vertices: 6041, hash: 0x3d99c36d },
  he111: { vertices: 38272, hash: 0x1e182c4 },
  b17g: { vertices: 57854, hash: 0x4c0133f },
}

/** 全部頂點的世界座標＋法線，排序後的 FNV-1a。 */
function fingerprint(root: Object3D): { vertices: number, hash: number } {
  root.updateMatrixWorld(true)
  const v = new Vector3()
  const rows: string[] = []
  root.traverse((o) => {
    const m = o as Mesh
    const pos = m.geometry?.getAttribute?.('position')
    if (!pos) return
    const nor = m.geometry.getAttribute('normal')
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m.matrixWorld)
      const n = nor ? `${nor.getX(i)},${nor.getY(i)},${nor.getZ(i)}` : ''
      rows.push(`${v.x},${v.y},${v.z}|${n}`)
    }
  })
  rows.sort()
  let h = 2166136261 >>> 0
  for (const s of rows) {
    for (let k = 0; k < s.length; k++) {
      h ^= s.charCodeAt(k)
      h = Math.imul(h, 16777619) >>> 0
    }
  }
  return { vertices: rows.length, hash: h }
}

function meshCount(root: Object3D): number {
  let n = 0
  root.traverse((o) => { if ((o as Mesh).isMesh) n++ })
  return n
}

describe('飛機靜態零件合併', () => {
  it.each(IDS)('%s 的 mesh 數降到實測值', (id) => {
    const model = buildAircraft({ id } as never)
    expect(meshCount(model.group)).toBe(MESHES[id]!)
    model.dispose()
  })

  it.each(IDS)('%s 的頂點一個 bit 都沒動', (id) => {
    const model = buildAircraft({ id } as never)
    expect(fingerprint(model.group)).toEqual(BEFORE[id]!)
    model.dispose()
  })

  it.each(IDS)('%s 併出來的 mesh 掛在 hull 底下、局部矩陣是單位矩陣', (id) => {
    // 【這一條是「不必烘變換」的前提】併出來的 mesh 若帶了變換或換了父節點，
    // 它的頂點就不在原本的座標系上，畫面必然移位
    const model = buildAircraft({ id } as never)
    model.group.updateMatrixWorld(true)
    const I = new Matrix4()
    const hull = model.group.children[0]!
    let merged = 0
    model.group.traverse((o) => {
      if ((o as Mesh).userData['merged'] !== true) return
      merged++
      expect(o.parent).toBe(hull)
      expect([...o.matrix.elements]).toEqual([...I.elements])
      expect((o as Mesh).material).toBeDefined()
      expect(((o as Mesh).material as Material).transparent).toBe(false)
    })
    expect(merged).toBe(MERGED[id]!)
    model.dispose()
  })

  it.each(IDS)('%s 的半透明零件沒有被併掉', (id) => {
    // 半透明要逐物件排序，併起來就失去排序 —— 座艙罩會透出錯誤的層次
    const before = TRANSLUCENT[id]!
    const model = buildAircraft({ id } as never)
    let n = 0
    model.group.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh && (m.material as Material).transparent) n++
    })
    expect(n).toBe(before)
    model.dispose()
  })

  it('setPropSpin 仍然有效', () => {
    const model = buildAircraft({ id: 'p51d' } as never)
    model.setPropSpin(1.5, true)
    let disc = 0
    let hub = 0
    model.group.traverse((o) => {
      if (o.renderOrder === PROP_DISC_RENDER_ORDER && o.visible) disc++
      if (o.rotation.z === 1.5) hub++
    })
    expect(disc).toBe(1)
    expect(hub).toBeGreaterThan(0)
    model.setPropSpin(0, false)
    let blades = 0
    model.group.traverse((o) => { if (o.userData['spinning'] === true && o.visible) blades++ })
    expect(blades).toBeGreaterThan(0)
    model.dispose()
  })

  it.each(IDS)('%s 的每一份幾何 dispose 剛好一次', (id) => {
    // 【為什麼會漏】被併掉的原始幾何在合併當下就釋放了，若沒有從
    // `disposables` 移除，`model.dispose()` 會再放一次
    const model = buildAircraft({ id } as never)
    const counts = new Map<BufferGeometry, number>()
    model.group.traverse((o) => {
      const g = (o as Mesh).geometry
      if (!g) return
      counts.set(g, 0)
      g.addEventListener('dispose', () => counts.set(g, counts.get(g)! + 1))
    })
    model.dispose()
    for (const n of counts.values()) expect(n).toBe(1)
  })
})

/** 每一架有幾個半透明 mesh（玻璃與座艙內裝）。合併前量的。 */
const TRANSLUCENT: Record<string, number> = { p51d: 2, bf109k4: 2, he111: 6, b17g: 9 }
