import { describe, expect, it } from 'vitest'
import { createFloraBuffer, pushFlora, FLORA_STRIDE, FloraKind, type FloraSource } from '../../src/render/flora'
import { excluding } from '../../src/render/floraExclude'

/** 一個每 10 m 放一株的假散佈器 */
const grid: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
  for (let x = x0; x < x1; x += 10) {
    for (let z = z0; z < z1; z += 10) {
      pushFlora(out, x, heightAt(x, z), z, 0, 1, 0, FloraKind.BroadTree)
    }
  }
}

function positions(out: ReturnType<typeof createFloraBuffer>): { x: number; z: number }[] {
  const list: { x: number; z: number }[] = []
  for (let i = 0; i < out.count; i++) {
    list.push({ x: out.data[i * FLORA_STRIDE]!, z: out.data[i * FLORA_STRIDE + 2]! })
  }
  return list
}

describe('excluding', () => {
  const rect = { x0: 20, z0: 20, x1: 60, z1: 60 }

  it('矩形內零株，矩形外的株與沒包時相同', () => {
    const plain = createFloraBuffer(1000)
    grid(0, 0, 100, 100, () => 0, plain)
    const wrapped = createFloraBuffer(1000)
    excluding(grid, rect)(0, 0, 100, 100, () => 0, wrapped)
    const inside = positions(wrapped).filter((p) => p.x >= 20 && p.x < 60 && p.z >= 20 && p.z < 60)
    expect(inside).toHaveLength(0)
    const expectedOutside = positions(plain).filter((p) => !(p.x >= 20 && p.x < 60 && p.z >= 20 && p.z < 60))
    expect(positions(wrapped)).toEqual(expectedOutside)
    expect(wrapped.dropped).toBe(0)
  })

  it('格子整個在矩形外時原樣透傳', () => {
    const plain = createFloraBuffer(1000)
    grid(200, 200, 300, 300, () => 0, plain)
    const wrapped = createFloraBuffer(1000)
    excluding(grid, rect)(200, 200, 300, 300, () => 0, wrapped)
    expect(positions(wrapped)).toEqual(positions(plain))
  })

  it('容量不足時照樣回報 dropped', () => {
    const wrapped = createFloraBuffer(5)
    excluding(grid, rect)(0, 0, 100, 100, () => 0, wrapped)
    expect(wrapped.count).toBe(5)
    expect(wrapped.dropped).toBeGreaterThan(0)
  })
})
