import { afterEach, describe, expect, it } from 'vitest'
import { Frustum, Matrix4, PerspectiveCamera, Vector3, type Mesh } from 'three'
import { createOcean, OCEAN_QUADRANTS } from '../../src/render/ocean'
import { CULL } from '../../src/render/cullRuns'

function camera(yawDeg: number, pitchDeg: number, x = 0, y = 300, z = 0): PerspectiveCamera {
  const c = new PerspectiveCamera(60, 16 / 9, 1, 60000)
  c.position.set(x, y, z)
  c.rotation.order = 'YXZ'
  c.rotation.set((pitchDeg * Math.PI) / 180, ((yawDeg - 90) * Math.PI) / 180, 0)
  c.updateMatrixWorld(true)
  return c
}

/** 一層此刻畫出去的索引區間（第 0 段是那一層本身，其餘是它的孩子） */
function drawn(level: Mesh): [number, number][] {
  const out: [number, number][] = []
  for (const m of [level, ...level.children] as Mesh[]) {
    if (!m.visible) continue
    const r = m.geometry.drawRange
    const n = Math.min(r.count, m.geometry.index!.count - r.start)
    if (n > 0) out.push([r.start, r.start + n])
  }
  return out
}

afterEach(() => { CULL.enabled = true })

describe('近海切象限', () => {
  /** 【索引依象限排】第 q 段的每一個三角形都落在第 q 個象限裡 —— 排錯了剔除就剔錯塊 */
  it('每一層的索引四等分，每一段的三角形都在自己的象限', () => {
    const o = createOcean(null)
    for (const level of o.mesh.children as Mesh[]) {
      const idx = level.geometry.index!
      const pos = level.geometry.getAttribute('position')
      const quarter = idx.count / OCEAN_QUADRANTS.length
      expect(Number.isInteger(quarter / 3)).toBe(true)
      for (let q = 0; q < OCEAN_QUADRANTS.length; q++) {
        const [qi, qj] = OCEAN_QUADRANTS[q]!
        for (let t = q * quarter; t < (q + 1) * quarter; t += 3 * 17) {
          let cx = 0
          let cz = 0
          for (let k = 0; k < 3; k++) {
            cx += pos.getX(idx.getX(t + k)) / 3
            cz += pos.getZ(idx.getX(t + k)) / 3
          }
          expect([q, cx > 0, cz > 0]).toEqual([q, qi === 1, qj === 1])
        }
      }
    }
    o.dispose()
  })

  /**
   * 【一塊都不能漏】重心在視錐內的三角形都要畫到。只取水面（y = 0）的重心 ——
   * 浪高由象限盒子的上下緣負責
   */
  it('看得到的三角形都在畫出去的段裡；背後的象限不畫', () => {
    const o = createOcean(null)
    o.update(0, 130, -70)
    const f = new Frustum()
    const c = new Vector3()
    for (const cam of [camera(0, -5, 130, 300, -70), camera(225, -20, 100, 800, -100),
      camera(90, 80, 130, 300, -70)]) {
      o.cull(cam)
      f.setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
      for (const level of o.mesh.children as Mesh[]) {
        const ranges = drawn(level)
        const idx = level.geometry.index!
        const pos = level.geometry.getAttribute('position')
        for (let t = 0; t < idx.count; t += 3 * 29) {
          c.set(0, 0, 0)
          for (let k = 0; k < 3; k++) {
            c.x += (pos.getX(idx.getX(t + k)) + o.mesh.position.x) / 3
            c.z += (pos.getZ(idx.getX(t + k)) + o.mesh.position.z) / 3
          }
          if (!f.containsPoint(c)) continue
          expect([t, ranges.some(([a, b]) => t >= a && t < b)]).toEqual([t, true])
        }
      }
    }
    // 平視朝 +X：每一層 x < 0 的那兩個象限整塊不畫
    o.cull(camera(0, -5, 130, 300, -70))
    for (const level of o.mesh.children as Mesh[]) {
      const quarter = level.geometry.index!.count / 4
      let total = 0
      for (const [a, b] of drawn(level)) total += b - a
      expect(total).toBeLessThanOrEqual(quarter * 2)
    }
    o.dispose()
  })

  it('總開關關掉時每一層整條畫一次', () => {
    const o = createOcean(null)
    CULL.enabled = false
    o.cull(camera(0, -5))
    for (const level of o.mesh.children as Mesh[]) {
      expect(drawn(level)).toEqual([[0, level.geometry.index!.count]])
    }
    o.dispose()
  })
})
