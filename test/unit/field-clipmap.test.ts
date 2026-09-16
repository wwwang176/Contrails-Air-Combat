import { describe, it, expect } from 'vitest'
import {
  RECENTRE_FRACTION, needsRecentre, newCellRects, torusPieces, windowOriginFor,
  type CellRect,
} from '../../src/render/fieldClipmap'

/**
 * # 田色 clipmap 的純函式
 *
 * 【這一支守的是什麼】挪窗時少烘一條格子不會報錯 —— 那一條留著上一次的內容，
 * 畫面上是一道錯位的田，而且只在飛過那個方向時出現。所以「新窗減舊窗」用
 * 暴力法逐格對照，不信任矩形算法自己的說法。
 */

/** 把一個窗的格子列成 "x,z" 的集合 */
function cellsOfWindow(ox: number, oz: number, n: number): Set<string> {
  const s = new Set<string>()
  for (let z = oz; z < oz + n; z++) for (let x = ox; x < ox + n; x++) s.add(`${x},${z}`)
  return s
}

function cellsOfRects(rects: readonly CellRect[]): { cells: Set<string>; overlaps: number } {
  const cells = new Set<string>()
  let overlaps = 0
  for (const r of rects) {
    for (let z = r.z0; z < r.z1; z++) {
      for (let x = r.x0; x < r.x1; x++) {
        const k = `${x},${z}`
        if (cells.has(k)) overlaps++
        cells.add(k)
      }
    }
  }
  return { cells, overlaps }
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const k of a) if (!b.has(k)) return false
  return true
}

describe('windowOriginFor / needsRecentre', () => {
  it('新窗以鏡頭所在的格為中心', () => {
    expect(windowOriginFor(100, 16)).toBe(92)
    expect(windowOriginFor(-3, 16)).toBe(-11)
  })

  it('離窗中心不到 N/8 不挪，超過就挪', () => {
    const n = 64
    const ox = windowOriginFor(0, n)
    const limit = n * RECENTRE_FRACTION
    expect(needsRecentre(ox, limit, n)).toBe(false)
    expect(needsRecentre(ox, -limit, n)).toBe(false)
    expect(needsRecentre(ox, limit + 1, n)).toBe(true)
    expect(needsRecentre(ox, -limit - 1, n)).toBe(true)
  })
})

describe('newCellRects：新窗減舊窗', () => {
  const N = [8, 16] as const
  const shifts = (n: number): number[] =>
    [0, 1, -1, n / 8, -n / 8, n / 2, -n / 2, n, -n, n + 3, -(n + 3)]

  it('沒動就沒有東西要烘', () => {
    expect(newCellRects({ ox: 5, oz: -7 }, { ox: 5, oz: -7 }, 8)).toEqual([])
  })

  it('矩形的聯集恰好是新窗減舊窗，而且互不重疊', () => {
    let checked = 0
    for (const n of N) {
      for (const dx of shifts(n)) {
        for (const dz of shifts(n)) {
          const prev = { ox: 3, oz: -5 }
          const next = { ox: prev.ox + dx, oz: prev.oz + dz }
          const rects = newCellRects(prev, next, n)
          const want = cellsOfWindow(next.ox, next.oz, n)
          for (const k of cellsOfWindow(prev.ox, prev.oz, n)) want.delete(k)
          const got = cellsOfRects(rects)
          expect(got.overlaps, `n=${n} dx=${dx} dz=${dz} 重疊`).toBe(0)
          expect(sameSet(got.cells, want), `n=${n} dx=${dx} dz=${dz} 覆蓋`).toBe(true)
          checked++
        }
      }
    }
    expect(checked).toBe(N.length * 11 * 11)
  })

  it('位移不小於 N 就是整張一塊', () => {
    const rects = newCellRects({ ox: 0, oz: 0 }, { ox: 8, oz: 0 }, 8)
    expect(rects).toEqual([{ x0: 8, z0: 0, x1: 16, z1: 8 }])
  })

  it('每塊矩形都落在新窗裡', () => {
    const rects = newCellRects({ ox: 0, oz: 0 }, { ox: 3, oz: -2 }, 16)
    for (const r of rects) {
      expect(r.x0).toBeGreaterThanOrEqual(3)
      expect(r.x1).toBeLessThanOrEqual(19)
      expect(r.z0).toBeGreaterThanOrEqual(-2)
      expect(r.z1).toBeLessThanOrEqual(14)
      expect(r.x1).toBeGreaterThan(r.x0)
      expect(r.z1).toBeGreaterThan(r.z0)
    }
  })
})

describe('torusPieces：矩形映到環面', () => {
  const mod = (v: number, n: number): number => ((v % n) + n) % n

  it('不跨邊界就是一片，貼圖座標是取模後的位置', () => {
    const pieces = torusPieces({ x0: 17, z0: -3, x1: 20, z1: -1 }, 16)
    expect(pieces).toEqual([{ tx: 1, tz: 13, w: 3, h: 2, cx0: 17, cz0: -3 }])
  })

  it('每一片都落在 [0, N)，聯集恰好是原矩形取模，互不重疊', () => {
    const n = 16
    const rects: CellRect[] = [
      { x0: 14, z0: 0, x1: 18, z1: 4 },      // 跨 x
      { x0: 0, z0: 15, x1: 4, z1: 19 },      // 跨 z
      { x0: 30, z0: -2, x1: 34, z1: 2 },     // 兩軸都跨
      { x0: -20, z0: -20, x1: -4, z1: -4 },  // 整張、負的
    ]
    for (const r of rects) {
      const pieces = torusPieces(r, n)
      const seen = new Set<string>()
      let overlaps = 0
      for (const p of pieces) {
        expect(p.tx).toBeGreaterThanOrEqual(0)
        expect(p.tz).toBeGreaterThanOrEqual(0)
        expect(p.tx + p.w).toBeLessThanOrEqual(n)
        expect(p.tz + p.h).toBeLessThanOrEqual(n)
        // 片左下那一格的世界格要對得上貼圖格
        expect(mod(p.cx0, n)).toBe(p.tx)
        expect(mod(p.cz0, n)).toBe(p.tz)
        for (let j = 0; j < p.h; j++) {
          for (let i = 0; i < p.w; i++) {
            const k = `${p.tx + i},${p.tz + j}`
            if (seen.has(k)) overlaps++
            seen.add(k)
          }
        }
      }
      const want = new Set<string>()
      for (let z = r.z0; z < r.z1; z++) for (let x = r.x0; x < r.x1; x++) want.add(`${mod(x, n)},${mod(z, n)}`)
      expect(overlaps, JSON.stringify(r)).toBe(0)
      expect(sameSet(seen, want), JSON.stringify(r)).toBe(true)
      expect(pieces.length).toBeLessThanOrEqual(4)
    }
  })
})
