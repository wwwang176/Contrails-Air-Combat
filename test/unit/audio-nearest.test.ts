import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { nearestN } from '../../src/audio/nearest'

const at = (xs: number[]): Vector3[] => xs.map((x) => new Vector3(x, 0, 0))

describe('挑最近的 N 個', () => {
  const pos = at([100, 10, 50, 5, 1000])

  it('依距離排序、略過無效的，數量上限是 out 的長度', () => {
    const valid = new Uint8Array([1, 1, 1, 0, 1])
    const out = new Int32Array(3)
    expect(nearestN(pos, valid, 5, 0, 0, 0, out)).toBe(3)
    expect([...out]).toEqual([1, 2, 0])
  })

  it('候選不夠時回實際數量', () => {
    const valid = new Uint8Array([0, 1, 0, 0, 0])
    const out = new Int32Array(3)
    expect(nearestN(pos, valid, 5, 0, 0, 0, out)).toBe(1)
    expect(out[0]).toBe(1)
  })

  it('比目前最遠的還近才擠進來', () => {
    const valid = new Uint8Array([1, 1, 1, 1, 1])
    const out = new Int32Array(2)
    expect(nearestN(pos, valid, 5, 0, 0, 0, out)).toBe(2)
    expect([...out]).toEqual([3, 1])
  })
})
