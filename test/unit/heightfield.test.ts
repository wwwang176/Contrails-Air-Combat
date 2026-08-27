import { describe, it, expect } from 'vitest'
import { createHeightField } from '../../src/world/heightfield'

/**
 * 高度場的取樣恆等式。
 *
 * 【為什麼這幾條就夠】這個模組只有一件事要對：**畫面上那個斜面，與撞地
 * 判定插出來的斜面，必須是同一個**（`render/terrain.ts` 的鐵律）。而兩邊
 * 共用的是同一個 `data` 與同一個 `sample`，所以只要釘住「格點上取樣回格點
 * 值」與「格點之間是線性的」，那條鐵律在這一層就成立了。
 *
 * 剩下的風險全在座標對應上 —— 差半格、差一格都會讓島在畫面上與碰撞上錯開，
 * 而那種錯位在遊戲裡看起來像「撞到看不見的東西」。所以邊界的**精確**跨度
 * 也是一條斷言，不是四捨五入的比較。
 */

const SIZE = 8
const CELL = 40

/** 第 i 個頂點的世界座標。原點在場地中心，所以中心落在 (SIZE−1)/2 */
const at = (i: number): number => (i - (SIZE - 1) / 2) * CELL

describe('HeightFieldData', () => {
  it('格點上取樣回格點值', () => {
    const f = createHeightField(SIZE, CELL)
    f.data[3 * SIZE + 5] = 123.5
    expect(f.sample(at(5), at(3))).toBeCloseTo(123.5, 6)
  })

  it('兩個格點之間是線性的 —— 中點等於兩端平均', () => {
    const f = createHeightField(SIZE, CELL)
    f.data[3 * SIZE + 5] = 100
    f.data[3 * SIZE + 6] = 200
    expect(f.sample((at(5) + at(6)) / 2, at(3))).toBeCloseTo(150, 6)
  })

  /**
   * 【內插必須跟著 mesh 的三角形，不是雙線性】畫面上那一格是**兩個平面
   * 三角形**。四個角不共平面時，雙線性曲面與三角形在格子內部不相等 ——
   * 這組 0/100/200/400 的中心，雙線性是 175，三角形是 150。
   *
   * 差 25 m 的「看不見的地形」正是那條鐵律要防的東西。
   */
  it('格子內部走的是三角形平面，不是雙線性曲面', () => {
    const f = createHeightField(SIZE, CELL)
    f.data[3 * SIZE + 5] = 0      // a 左上
    f.data[3 * SIZE + 6] = 100    // b 右上
    f.data[4 * SIZE + 5] = 200    // c 左下
    f.data[4 * SIZE + 6] = 400    // d 右下
    const x0 = at(5), x1 = at(6), z0 = at(3), z1 = at(4)
    const lerp = (u: number, v: number, t: number) => u + (v - u) * t

    // 對角線上（tx + tz = 1）：a–c–b 那一面
    expect(f.sample((x0 + x1) / 2, (z0 + z1) / 2)).toBeCloseTo(150, 6)
    // 三角形 a–c–b 內部
    expect(f.sample(lerp(x0, x1, 0.25), lerp(z0, z1, 0.25))).toBeCloseTo(75, 6)
    // 三角形 b–c–d 內部
    expect(f.sample(lerp(x0, x1, 0.75), lerp(z0, z1, 0.75))).toBeCloseTo(275, 6)
  })

  /**
   * 【為什麼跨度是 (size−1)·cell 而不是 size·cell】`size` 是**頂點數**，
   * 格子數比它少一個。寫錯會讓整張圖偏移半格到一格，而那正是「撞到看不見的
   * 島」的成因。
   */
  it('跨度是 (size−1)·cell，而且兩端都取得到值', () => {
    const f = createHeightField(SIZE, CELL)
    expect(at(SIZE - 1) - at(0)).toBe((SIZE - 1) * CELL)
    f.data[0] = 7
    f.data[SIZE * SIZE - 1] = 9
    expect(f.sample(at(0), at(0))).toBeCloseTo(7, 6)
    expect(f.sample(at(SIZE - 1), at(SIZE - 1))).toBeCloseTo(9, 6)
  })

  it('出界回 −Infinity —— 四個方向都要', () => {
    const f = createHeightField(SIZE, CELL)
    const lo = at(0), hi = at(SIZE - 1)
    for (const [x, z] of [
      [lo - 0.001, 0], [hi + 0.001, 0], [0, lo - 0.001], [0, hi + 0.001],
    ] as const) {
      expect(f.sample(x, z)).toBe(-Infinity)
    }
  })

  /**
   * 【這一條只驗回傳形狀，不驗零配置】它擋的是「不小心回了一個
   * {height, normal}」那種改動。真正的零配置由 code review 與 perf-gate 守
   * —— 就算 sample 每次先配置十個物件再回一個 number，這一條照樣綠。
   */
  it('sample 回的是純數值', () => {
    const f = createHeightField(SIZE, CELL)
    expect(typeof f.sample(0, 0)).toBe('number')
  })
})
