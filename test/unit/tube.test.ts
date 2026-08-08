import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { ringBasis, tubeIndices, tubeVertexCount, type RingBasis } from '../../src/render/tube'

const B: RingBasis = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 }

describe('ringBasis', () => {
  /**
   * 【它算什麼】給一段管軸方向，回傳兩個與它垂直、而且彼此垂直的單位向量
   * —— 環上的頂點就是 `p + r·(cos θ·a + sin θ·b)`。
   *
   * 【為什麼不做平行搬運】管身會沿著扭轉，但它是無光照的單色半透明管，
   * 扭轉看不出來（spec §13.5）。這裡只要求「垂直、正交、單位長」。
   */
  for (const [name, d] of [
    ['沿 +X', [1, 0, 0]],
    ['沿 +Y（爬升）', [0, 1, 0]],
    ['沿 −Y（俯衝）', [0, -1, 0]],
    ['沿 +Z', [0, 0, 1]],
    ['三軸等分', [0.5773, 0.5773, 0.5773]],
    ['斜的、很長的', [300, -900, 310]],
  ] as const) {
    it(`${name}：兩軸與管軸垂直、彼此正交、且是單位長`, () => {
      ringBasis(d[0], d[1], d[2], B)
      const dir = new Vector3(d[0], d[1], d[2]).normalize()
      const a = new Vector3(B.ax, B.ay, B.az)
      const b = new Vector3(B.bx, B.by, B.bz)
      expect(a.length()).toBeCloseTo(1, 6)
      expect(b.length()).toBeCloseTo(1, 6)
      expect(a.dot(dir)).toBeCloseTo(0, 6)
      expect(b.dot(dir)).toBeCloseTo(0, 6)
      expect(a.dot(b)).toBeCloseTo(0, 6)
    })
  }

  /**
   * 【參考向量不可以固定】固定用 (0,1,0) 的話，管軸剛好垂直向上時
   * `u × r` 是零向量，正規化得到 NaN —— 而**爬升與俯衝正好是那個方向**。
   * 上面「沿 ±Y」那兩條就是守這件事的：挑的參考軸必須是與管軸最不平行的。
   */
  it('沿 ±Y 時叉積不會退化（挑的是與管軸最不平行的參考軸）', () => {
    ringBasis(0, 1, 0, B)
    expect(Number.isNaN(B.ax + B.ay + B.az + B.bx + B.by + B.bz)).toBe(false)
  })

  /**
   * 【零向量必須有定義】兩個節點在同一個位置時（斷開處的退化環，
   * spec §13.5）方向是零向量。回傳 NaN 的話**整條管子會消失** —— 而那正是
   * 最難察覺的情形：只有在 G 掉下去又拉起來的那一瞬間才會發生。
   */
  it('零向量回傳一組合法的基底，不是 NaN', () => {
    ringBasis(0, 0, 0, B)
    for (const v of [B.ax, B.ay, B.az, B.bx, B.by, B.bz]) {
      expect(Number.isFinite(v)).toBe(true)
    }
    expect(new Vector3(B.ax, B.ay, B.az).length()).toBeCloseTo(1, 6)
    expect(new Vector3(B.bx, B.by, B.bz).length()).toBeCloseTo(1, 6)
  })

  it('是純函數：同樣的輸入寫出同樣的結果，不累積', () => {
    ringBasis(1, 0, 0, B)
    const first = [B.ax, B.ay, B.az, B.bx, B.by, B.bz]
    ringBasis(1, 0, 0, B)
    expect([B.ax, B.ay, B.az, B.bx, B.by, B.bz]).toEqual(first)
  })
})

describe('tubeVertexCount', () => {
  it('是 條數 × 環數 × 邊數', () => {
    expect(tubeVertexCount(3, 5, 4)).toBe(60)
  })
})

describe('tubeIndices', () => {
  /**
   * 【索引建一次就不動】管子畫好之後不會移動（粒子的發射速度本來就是 0），
   * 所以每一條尾跡在共用幾何裡擁有固定的一段，環 `i` 與 `i+1` 之間一圈
   * 四邊形。
   */
  it('三角形數是 條數 × (環數−1) × 邊數 × 2', () => {
    expect(tubeIndices(3, 5, 4).length).toBe(3 * 4 * 4 * 2 * 3)
  })

  it('每一個索引都落在頂點範圍內', () => {
    const [trails, nodes, sides] = [3, 5, 4]
    const idx = tubeIndices(trails, nodes, sides)
    const max = tubeVertexCount(trails, nodes, sides)
    for (const i of idx) {
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(max)
    }
  })

  /**
   * 【不可以跨越尾跡的邊界】第 0 條的最後一環若接到第 1 條的第一環，畫面上
   * 會出現**一條橫跨兩架飛機的管子**。而它只在兩條尾跡同時活著時才看得到，
   * 所以很容易漏。
   */
  it('沒有任何三角形跨越兩條尾跡', () => {
    const [trails, nodes, sides] = [3, 5, 4]
    const per = nodes * sides
    const idx = tubeIndices(trails, nodes, sides)
    for (let t = 0; t < idx.length; t += 3) {
      const owner = Math.floor(idx[t]! / per)
      expect(Math.floor(idx[t + 1]! / per)).toBe(owner)
      expect(Math.floor(idx[t + 2]! / per)).toBe(owner)
    }
  })

  /**
   * 【每一環都要真的被縫起來】只檢查範圍與歸屬的話，一個「全部指向頂點 0」
   * 的索引緩衝也會過。這條確認每一對相鄰環之間都有三角形。
   */
  it('每一對相鄰環都有三角形接起來', () => {
    const [nodes, sides] = [5, 4]
    const idx = tubeIndices(1, nodes, sides)
    const bands = new Set<number>()
    for (let t = 0; t < idx.length; t += 3) {
      const rings = [
        Math.floor(idx[t]! / sides),
        Math.floor(idx[t + 1]! / sides),
        Math.floor(idx[t + 2]! / sides),
      ]
      bands.add(Math.min(...rings))
    }
    for (let i = 0; i < nodes - 1; i++) expect(bands.has(i)).toBe(true)
  })

  /**
   * 【每一個側面都要被縫】上一條只看「有沒有這一帶」，一個只縫第 0 面的
   * 索引緩衝仍然會過 —— 畫面上會是一條被剖開的半管。
   */
  it('每一環的每一個側面都有三角形', () => {
    const [nodes, sides] = [4, 5]
    const idx = tubeIndices(1, nodes, sides)
    const seen = new Set<number>()
    for (const v of idx) seen.add(v % sides)
    for (let s = 0; s < sides; s++) expect(seen.has(s)).toBe(true)
  })

  /**
   * 【環要合起來】側面 `sides−1` 必須接回側面 0，否則管子沿著長邊裂開一條縫。
   * 檢查有沒有同時含 `sides−1` 與 `0` 的三角形。
   */
  it('最後一個側面接回第一個（管子是閉合的）', () => {
    const sides = 5
    const idx = tubeIndices(1, 4, sides)
    let closed = false
    for (let t = 0; t < idx.length; t += 3) {
      const m = [idx[t]! % sides, idx[t + 1]! % sides, idx[t + 2]! % sides]
      if (m.includes(sides - 1) && m.includes(0)) closed = true
    }
    expect(closed).toBe(true)
  })
})
