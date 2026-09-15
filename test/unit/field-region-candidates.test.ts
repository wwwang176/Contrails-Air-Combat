import { describe, expect, it } from 'vitest'
import {
  buildRegionCandidates, regionAt, regionAtPruned, REGION_CANDIDATE_CELL, REGION_SPACING,
  type RegionSample,
} from '../../src/render/fields'

const sample = (): RegionSample => ({ id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0, r1: 0, r2: 0 })

/** 可重現的亂數，測試不吃 Math.random */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('區塊候選表', () => {
  const origin = { x: -4 * REGION_SPACING, z: -3 * REGION_SPACING }
  const cols = 7 * (REGION_SPACING / REGION_CANDIDATE_CELL)
  const rows = 6 * (REGION_SPACING / REGION_CANDIDATE_CELL)
  const table = buildRegionCandidates(origin.x, origin.z, cols, rows)

  /**
   * 【候選表只是剪枝，答案必須與完整搜尋一模一樣】id、r1、r2 任何一個不同，
   * 田的歸屬或樹籬／凹路的位置就會跟著變 —— 畫面上是一片田換了顏色。
   */
  it('隨機點：剪枝後的 id、r1、r2 與 3×3 完整搜尋相同', () => {
    const next = rng(12345)
    const a = sample()
    const b = sample()
    for (let k = 0; k < 20000; k++) {
      const x = origin.x + next() * cols * REGION_CANDIDATE_CELL
      const z = origin.z + next() * rows * REGION_CANDIDATE_CELL
      regionAt(x, z, a)
      regionAtPruned(x, z, table, b)
      expect([x, z, b.id, b.r1, b.r2]).toEqual([x, z, a.id, a.r1, a.r2])
    }
  })

  /** 【邊界最容易出錯】小格邊、區塊格邊的兩側各取一點 */
  it('貼著小格邊界與區塊格邊界的點也相同', () => {
    const a = sample()
    const b = sample()
    const eps = [0, 1e-6, -1e-6, 0.25, -0.25]
    for (let i = 1; i < cols; i += 3) {
      for (let j = 1; j < rows; j += 5) {
        for (const ex of eps) {
          for (const ez of eps) {
            const x = origin.x + i * REGION_CANDIDATE_CELL + ex
            const z = origin.z + j * REGION_CANDIDATE_CELL + ez
            regionAt(x, z, a)
            regionAtPruned(x, z, table, b)
            expect([x, z, b.id, b.r1, b.r2]).toEqual([x, z, a.id, a.r1, a.r2])
          }
        }
      }
    }
  })

  it('範圍外的點照樣相同（走完整搜尋）', () => {
    const a = sample()
    const b = sample()
    for (const [x, z] of [[origin.x - 500, origin.z], [origin.x + cols * REGION_CANDIDATE_CELL + 10, 0], [0, origin.z - 1]] as const) {
      regionAt(x, z, a)
      regionAtPruned(x, z, table, b)
      expect([b.id, b.r1, b.r2]).toEqual([a.id, a.r1, a.r2])
    }
  })

  /** 【剪枝要真的有剪】全部九顆都留著的話，著色器一點都沒省 */
  it('平均每格留下的候選少於九顆的一半', () => {
    let sum = 0
    let full = 0
    for (let i = 0; i < cols * rows; i++) {
      const n = table.data[i * 4]! & 15
      if (n === 15) full++
      else sum += n
    }
    const avg = sum / (cols * rows - full)
    expect(avg).toBeLessThan(4.5)
  })
})
