import { describe, it, expect } from 'vitest'
import { clamp, lerp, smoothstep, DEG, RAD, G0 } from '../../src/core/math'
import { makeScratch } from '../../src/core/pool'
import { Vector3, Quaternion } from 'three'

describe('math', () => {
  it('clamp 夾制在區間內', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })

  it('lerp 線性內插', () => {
    expect(lerp(0, 10, 0)).toBe(0)
    expect(lerp(0, 10, 1)).toBe(10)
    expect(lerp(0, 10, 0.25)).toBe(2.5)
  })

  it('smoothstep 在端點為 0 與 1，中點為 0.5', () => {
    expect(smoothstep(0, 1, 0)).toBe(0)
    expect(smoothstep(0, 1, 1)).toBe(1)
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 10)
  })

  it('smoothstep 在區間外夾制', () => {
    expect(smoothstep(0, 1, -5)).toBe(0)
    expect(smoothstep(0, 1, 5)).toBe(1)
  })

  it('角度常數正確', () => {
    expect(90 * DEG).toBeCloseTo(Math.PI / 2, 12)
    expect((Math.PI / 2) * RAD).toBeCloseTo(90, 12)
    expect(G0).toBeCloseTo(9.80665, 6)
  })
})

describe('pool', () => {
  it('配置指定數量的暫存物件', () => {
    const s = makeScratch(3, 2)
    expect(s.v).toHaveLength(3)
    expect(s.q).toHaveLength(2)
    expect(s.v[0]).toBeInstanceOf(Vector3)
    expect(s.q[0]).toBeInstanceOf(Quaternion)
  })

  it('quatCount 預設為 0', () => {
    const s = makeScratch(2)
    expect(s.q).toHaveLength(0)
  })

  it('每個暫存物件都是獨立實例', () => {
    const s = makeScratch(2)
    s.v[0]!.set(1, 2, 3)
    expect(s.v[1]!.x).toBe(0)
  })
})
