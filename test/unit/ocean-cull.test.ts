import { afterEach, describe, expect, it } from 'vitest'
import { Frustum, Matrix4, PerspectiveCamera, Vector3, type Mesh } from 'three'
import { createOcean } from '../../src/render/ocean'
import {
  oceanBlockRank, OCEAN_BLOCK_GRID, OCEAN_CULL, OCEAN_RING_SEGMENTS,
} from '../../src/render/oceanGeometry'
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

const GRIDS = [2, 4, 8]
const DEFAULT_GRID = OCEAN_CULL.grid

afterEach(() => {
  CULL.enabled = true
  OCEAN_CULL.grid = DEFAULT_GRID
})

describe('近海切塊', () => {
  /**
   * 【索引依塊排】沿索引走，三角形所在的塊的次序只增不減 —— 每一塊是連續的一段。
   * 排錯了剔除就剔錯塊
   */
  it('每一層的索引依塊的次序排', () => {
    const o = createOcean(null)
    const side = OCEAN_RING_SEGMENTS / OCEAN_BLOCK_GRID
    for (const [l, level] of (o.mesh.children as Mesh[]).entries()) {
      const idx = level.geometry.index!
      const pos = level.geometry.getAttribute('position')
      const cell = 30 * 2 ** l
      const half = (OCEAN_RING_SEGMENTS / 2) * cell
      let prev = -1
      for (let t = 0; t < idx.count; t += 3 * 7) {
        let cx = 0
        let cz = 0
        for (let k = 0; k < 3; k++) {
          cx += pos.getX(idx.getX(t + k)) / 3
          cz += pos.getZ(idx.getX(t + k)) / 3
        }
        const bi = Math.floor((cx + half) / cell / side)
        const bj = Math.floor((cz + half) / cell / side)
        const rank = oceanBlockRank(bi, bj)
        expect([l, t, rank >= prev]).toEqual([l, t, true])
        prev = rank
      }
    }
    o.dispose()
  })

  /**
   * 【一塊都不能漏】重心在視錐內的三角形都要畫到，三種粗細都驗。只取水面（y = 0）
   * 的重心 —— 浪高由塊的盒子上下緣負責
   */
  it('看得到的三角形都在畫出去的段裡；背後那一半不畫', () => {
    const o = createOcean(null)
    o.update(0, 130, -70)
    const f = new Frustum()
    const c = new Vector3()
    for (const grid of GRIDS) {
      OCEAN_CULL.grid = grid
      for (const cam of [camera(0, -5, 130, 300, -70), camera(225, -20, 100, 800, -100),
        camera(90, 80, 130, 300, -70), camera(30, -60, 130, 2000, -70)]) {
        o.cull(cam)
        f.setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
        for (const level of o.mesh.children as Mesh[]) {
          const ranges = drawn(level)
          expect(ranges.length).toBeLessThanOrEqual(4)
          const idx = level.geometry.index!
          const pos = level.geometry.getAttribute('position')
          for (let t = 0; t < idx.count; t += 3 * 29) {
            c.set(0, 0, 0)
            for (let k = 0; k < 3; k++) {
              c.x += (pos.getX(idx.getX(t + k)) + o.mesh.position.x) / 3
              c.z += (pos.getZ(idx.getX(t + k)) + o.mesh.position.z) / 3
            }
            if (!f.containsPoint(c)) continue
            expect([grid, t, ranges.some(([a, b]) => t >= a && t < b)]).toEqual([grid, t, true])
          }
        }
      }
      // 平視朝 +X：每一層畫出去的不超過一半
      o.cull(camera(0, -5, 130, 300, -70))
      for (const level of o.mesh.children as Mesh[]) {
        let total = 0
        for (const [a, b] of drawn(level)) total += b - a
        expect([grid, total <= level.geometry.index!.count / 2]).toEqual([grid, true])
      }
    }
    o.dispose()
  })

  /** 【切得越細畫得越少】同一個平視鏡頭，4×4 畫出去的比 2×2 少 */
  it('切細之後平視畫出去的比較少', () => {
    const o = createOcean(null)
    const cam = camera(20, -5)
    const sum = (grid: number) => {
      OCEAN_CULL.grid = grid
      o.cull(cam)
      let s = 0
      for (const level of o.mesh.children as Mesh[]) for (const [a, b] of drawn(level)) s += b - a
      return s
    }
    expect(sum(4)).toBeLessThan(sum(2))
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
