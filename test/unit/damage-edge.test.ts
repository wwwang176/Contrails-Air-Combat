import { describe, it, expect } from 'vitest'
import { DEG } from '../../src/core/math'
import { borderPoint, type BorderPoint } from '../../src/hud/widgets/damageEdge'

/** 1600×900 的畫面（16:9） */
const W = 1600
const H = 900
const CX = W / 2
const CY = H / 2

function at(theta: number): BorderPoint {
  const out: BorderPoint = { x: 0, y: 0, dx: 0, dy: 0 }
  borderPoint(theta, CX, CY, out)
  return out
}

describe('borderPoint', () => {
  it('正右打在右緣的中點', () => {
    const p = at(0)
    expect(p.x).toBeCloseTo(W, 6)
    expect(p.y).toBeCloseTo(CY, 6)
  })

  it('正上打在上緣的中點 —— 螢幕 y 向下，所以 y = 0', () => {
    const p = at(90 * DEG)
    expect(p.x).toBeCloseTo(CX, 6)
    expect(p.y).toBeCloseTo(0, 6)
  })

  it('正左打在左緣的中點', () => {
    const p = at(180 * DEG)
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.y).toBeCloseTo(CY, 6)
  })

  it('正下打在下緣的中點', () => {
    const p = at(-90 * DEG)
    expect(p.x).toBeCloseTo(CX, 6)
    expect(p.y).toBeCloseTo(H, 6)
  })

  it('16:9 下的 45° 打在**上緣**而不是右緣', () => {
    // 【這一條擋的是「用圓當邊界」那個經典錯誤】圓會讓四個角空掉，
    // 而 45° 正是角落的方向（spec §5）。取 min(tx, ty) 才會打在真正的
    // 矩形邊上：16:9 下 cy/|sin| 比 cx/|cos| 小，所以先碰到上緣。
    const p = at(45 * DEG)
    expect(p.y).toBeCloseTo(0, 6)
    expect(p.x).toBeCloseTo(CX + CY, 6)
    expect(p.x).toBeLessThan(W)
  })

  it('任何角度算出來的點都落在矩形邊界上', () => {
    for (let a = -180; a <= 180; a += 3) {
      const p = at(a * DEG)
      expect(p.x).toBeGreaterThanOrEqual(-1e-9)
      expect(p.x).toBeLessThanOrEqual(W + 1e-9)
      expect(p.y).toBeGreaterThanOrEqual(-1e-9)
      expect(p.y).toBeLessThanOrEqual(H + 1e-9)
      // 至少貼在四條邊的其中一條上
      const onEdge = Math.abs(p.x) < 1e-6 || Math.abs(p.x - W) < 1e-6
        || Math.abs(p.y) < 1e-6 || Math.abs(p.y - H) < 1e-6
      expect(onEdge).toBe(true)
    }
  })

  it('回傳的方向是由中心指向邊界的單位向量', () => {
    // 【為什麼要一起回傳】繪製要用它把邊界點往**內**推一個固定距離，
    // 而那個方向必須與求交用的是同一個，不能各算一次。
    for (let a = -180; a <= 180; a += 11) {
      const p = at(a * DEG)
      expect(Math.hypot(p.dx, p.dy)).toBeCloseTo(1, 9)
      const r = Math.hypot(p.x - CX, p.y - CY)
      expect(p.x - CX).toBeCloseTo(p.dx * r, 6)
      expect(p.y - CY).toBeCloseTo(p.dy * r, 6)
    }
  })
})
