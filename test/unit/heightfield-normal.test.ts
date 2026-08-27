import { describe, it, expect } from 'vitest'
import { createHeightField, normalAt } from '../../src/world/heightfield'

/**
 * 法線與取樣必須用**同一個三角形**。
 *
 * 【為什麼這件事要有測試】法線的用途是「子彈打在山上時火花往哪裡噴」。
 * 用中央差分或固定 +Y 都能跑，而且看起來也「差不多」—— 但那是憑空多出來
 * 的第三份幾何：`sample` 用的是格內兩個平面三角形（對角線 `tx + tz = 1`），
 * 中央差分算的是跨好幾格的平滑近似。
 *
 * 【怎麼驗】平面的法線與**平面上任兩點的連線**內積為 0。所以在同一個
 * 三角形裡取三點，用 `sample` 的高度組成兩條邊，各與法線內積 —— 都要是 0。
 * 對角線兩側各驗一次，因為那是兩個不同的平面。
 */

const SIZE = 4
const CELL = 40
/** 第 i 個頂點的世界座標。原點在場地中心 */
const at = (i: number): number => (i - (SIZE - 1) / 2) * CELL

/** 四個角高度都不同的一格，兩個三角形因此不共面 */
function tilted(): ReturnType<typeof createHeightField> {
  const f = createHeightField(SIZE, CELL)
  // 格 (col 1, row 1) 的四個角：a 左上、b 右上、c 左下、d 右下
  f.data[1 * SIZE + 1] = 0 // a
  f.data[1 * SIZE + 2] = 100 // b
  f.data[2 * SIZE + 1] = 200 // c
  f.data[2 * SIZE + 2] = 400 // d
  return f
}

const N = { nx: 0, ny: 0, nz: 0 }

/** (x,z) 的法線與 (x,z)→(x2,z2) 這條在同一平面上的邊的內積 */
function dotWithEdge(
  f: ReturnType<typeof createHeightField>,
  x: number, z: number, x2: number, z2: number,
): number {
  normalAt(f, x, z, N)
  const ex = x2 - x
  const ey = f.sample(x2, z2) - f.sample(x, z)
  const ez = z2 - z
  return N.nx * ex + N.ny * ey + N.nz * ez
}

describe('normalAt', () => {
  const f = tilted()
  // 格 (1,1) 的左上角在 (at(1), at(1))，右下角在 (at(2), at(2))
  const x0 = at(1)
  const z0 = at(1)

  it('對角線靠 a 那一側：法線與面上的邊垂直', () => {
    // tx + tz <= 1 的區域。取三個都在裡面的點
    const px = x0 + CELL * 0.2
    const pz = z0 + CELL * 0.2
    expect(dotWithEdge(f, px, pz, x0 + CELL * 0.6, z0 + CELL * 0.2)).toBeCloseTo(0, 6)
    expect(dotWithEdge(f, px, pz, x0 + CELL * 0.2, z0 + CELL * 0.6)).toBeCloseTo(0, 6)
  })

  it('對角線靠 d 那一側：法線與面上的邊垂直', () => {
    // tx + tz > 1 的區域
    const px = x0 + CELL * 0.8
    const pz = z0 + CELL * 0.8
    expect(dotWithEdge(f, px, pz, x0 + CELL * 0.5, z0 + CELL * 0.8)).toBeCloseTo(0, 6)
    expect(dotWithEdge(f, px, pz, x0 + CELL * 0.8, z0 + CELL * 0.5)).toBeCloseTo(0, 6)
  })

  it('兩側的法線不同 —— 四角不共平面時它們本來就是兩個面', () => {
    normalAt(f, x0 + CELL * 0.2, z0 + CELL * 0.2, N)
    const a = { ...N }
    normalAt(f, x0 + CELL * 0.8, z0 + CELL * 0.8, N)
    expect(Math.abs(a.nx - N.nx) + Math.abs(a.nz - N.nz)).toBeGreaterThan(1e-3)
  })

  it('平地的法線朝正上方', () => {
    const flat = createHeightField(SIZE, CELL)
    normalAt(flat, 0, 0, N)
    expect(N.nx).toBeCloseTo(0, 9)
    expect(N.ny).toBeCloseTo(1, 9)
    expect(N.nz).toBeCloseTo(0, 9)
  })

  it('是單位向量', () => {
    normalAt(f, x0 + CELL * 0.3, z0 + CELL * 0.3, N)
    expect(Math.hypot(N.nx, N.ny, N.nz)).toBeCloseTo(1, 9)
  })

  it('場外回正上方，不是 NaN', () => {
    normalAt(f, 1e6, 1e6, N)
    expect(N.ny).toBe(1)
    expect(Number.isNaN(N.nx)).toBe(false)
  })
})
