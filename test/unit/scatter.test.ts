import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { coneDirection, hash01 } from '../../src/render/scatter'

describe('hash01', () => {
  it('恆在 [0, 1)', () => {
    for (let i = -50; i < 5000; i++) {
      const v = hash01(i)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('同一個索引恆得同一個值 —— 這是不用 Math.random() 的全部理由', () => {
    for (let i = 0; i < 100; i++) expect(hash01(i)).toBe(hash01(i))
  })

  it('相鄰索引不相關 —— 不會整批粒子往同一邊噴', () => {
    let sum = 0
    for (let i = 0; i < 1000; i++) sum += hash01(i)
    // 均勻分布的平均應該接近 0.5
    expect(sum / 1000).toBeGreaterThan(0.45)
    expect(sum / 1000).toBeLessThan(0.55)
  })
})

describe('coneDirection', () => {
  const out = new Vector3()

  it('恆為單位向量', () => {
    for (let i = 0; i < 500; i++) {
      coneDirection(0, 1, 0, 0.6, i, out)
      expect(out.length()).toBeCloseTo(1, 6)
    }
  })

  it('恆落在指定的半角之內', () => {
    const cone = 35 * (Math.PI / 180)
    const axis = new Vector3(0.3, -0.5, 0.81).normalize()
    for (let i = 0; i < 500; i++) {
      coneDirection(axis.x, axis.y, axis.z, cone, i, out)
      expect(out.dot(axis)).toBeGreaterThanOrEqual(Math.cos(cone) - 1e-6)
    }
  })

  it('半角 π 就是等向 —— 火球用這個', () => {
    let minDot = 1
    for (let i = 0; i < 2000; i++) {
      coneDirection(0, 1, 0, Math.PI, i, out)
      minDot = Math.min(minDot, out.y)
    }
    // 等向的話一定有粒子往正下方噴
    expect(minDot).toBeLessThan(-0.9)
  })

  it('零向量的軸不會產生 NaN', () => {
    // 【為什麼要防】NaN 一旦進入實例矩陣，整批粒子會靜靜地消失而且完全
    // 不報錯。與 sparks.ts 原本的防護同一個理由。
    coneDirection(0, 0, 0, 0.5, 3, out)
    expect(Number.isFinite(out.length())).toBe(true)
    expect(out.length()).toBeCloseTo(1, 6)
  })

  it('同一個索引恆得同一個方向', () => {
    const a = new Vector3()
    const b = new Vector3()
    coneDirection(0, 1, 0, 0.5, 42, a)
    coneDirection(0, 1, 0, 0.5, 42, b)
    expect(a.distanceTo(b)).toBe(0)
  })
})
