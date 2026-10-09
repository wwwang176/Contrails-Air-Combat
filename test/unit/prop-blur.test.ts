import { describe, expect, it } from 'vitest'
import { countBlades } from '../../src/render/propBlur'

/** 合成的槳葉頂點：`n` 片、每片從槳根到槳尖一排點，加一點寬度與起始角 */
function blades(n: number, radius: number, start = 0, width = 0.12): Float32Array {
  const out: number[] = []
  for (let b = 0; b < n; b++) {
    const a0 = start + (b / n) * Math.PI * 2
    for (let r = 0.1; r <= 1.0001; r += 0.05) {
      for (const w of [-width / 2, 0, width / 2]) {
        const a = a0 + w / Math.max(r, 0.2)
        out.push(Math.cos(a) * r * radius, Math.sin(a) * r * radius, (Math.random() - 0.5) * 0.05)
      }
    }
  }
  // 轂心那一團：每個方向都有點，不能被算成槳葉
  for (let k = 0; k < 24; k++) out.push(Math.cos(k / 4) * 0.12, Math.sin(k / 4) * 0.12, 0)
  return new Float32Array(out)
}

describe('從槳葉幾何數出槳葉數', () => {
  it.each([2, 3, 4, 5])('%i 片', (n) => {
    expect(countBlades(blades(n, 1.7), 1.7)).toBe(n)
  })

  /** 【跨過 ±180°】有一片剛好落在 atan2 的接縫上，不能被拆成兩片 */
  it('有一片跨在 ±180° 的接縫上', () => {
    expect(countBlades(blades(3, 1.5, Math.PI), 1.5)).toBe(3)
    expect(countBlades(blades(4, 1.5, Math.PI - 0.02), 1.5)).toBe(4)
  })

  it('沒有槳葉頂點時退回 3 片', () => {
    expect(countBlades(new Float32Array([0, 0, 0, 0.1, 0, 0]), 1.7)).toBe(3)
  })
})
