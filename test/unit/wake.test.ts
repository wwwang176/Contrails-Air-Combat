import { describe, it, expect } from 'vitest'
import {
  WAKE_ALPHA, WAKE_HALF_FROM, WAKE_HALF_TO, WAKE_LIFE, WAKE_LIFT, WAKE_NODES,
  WAKE_NODE_SPACING, WAKE_REAL_NODES, createWakes, ribbonIndices, wakeAlpha,
  wakeEmitCount, wakeHalfWidth,
} from '../../src/render/wake'

/**
 * # 魚雷的航跡
 *
 * **它是一條線，不是一串點。** 專案為凝結尾解過同一個問題：粒子池畫的是
 * 團狀的東西，連續的線要用幾何（`render/vortex.ts` 的註解記著負責人的
 * 原話「煙霧沒辦法連續，看起來就會像是一點一點的圈圈」）。
 */

/** 平海 */
const FLAT = (): number => 0

describe('wakeAlpha', () => {
  it('出生最濃、到壽命歸零', () => {
    expect(wakeAlpha(0)).toBeCloseTo(WAKE_ALPHA, 9)
    expect(wakeAlpha(WAKE_LIFE)).toBe(0)
  })

  it('壽命之外一律 0 —— 負的年齡也是', () => {
    expect(wakeAlpha(WAKE_LIFE + 1)).toBe(0)
    expect(wakeAlpha(-1)).toBe(0)
  })

  it('單調遞減', () => {
    let prev = Infinity
    for (let t = 0; t <= WAKE_LIFE; t += WAKE_LIFE / 40) {
      const a = wakeAlpha(t)
      expect(a).toBeLessThanOrEqual(prev + 1e-12)
      prev = a
    }
  })

  /**
   * 【前段要掉得比線性快】線性之下尾端與頭端在深色海面上讀起來一樣白，
   * 整條看起來像一根沒有方向的白棍。
   */
  it('掉得比線性快 —— 一眼看得出哪一端是新的', () => {
    for (const k of [0.25, 0.5, 0.75]) {
      const t = WAKE_LIFE * k
      expect(wakeAlpha(t)).toBeLessThan(WAKE_ALPHA * (1 - k))
    }
    // 半條命之內就掉掉四分之三
    expect(wakeAlpha(WAKE_LIFE / 2)).toBeCloseTo(WAKE_ALPHA * 0.25, 9)
  })
})

describe('wakeHalfWidth', () => {
  it('由窄變寬 —— 泡沫會散開', () => {
    expect(wakeHalfWidth(0)).toBeCloseTo(WAKE_HALF_FROM, 9)
    expect(wakeHalfWidth(WAKE_LIFE)).toBeCloseTo(WAKE_HALF_TO, 9)
    expect(WAKE_HALF_TO).toBeGreaterThan(WAKE_HALF_FROM)
  })

  it('壽命之外不再長', () => {
    expect(wakeHalfWidth(WAKE_LIFE * 2)).toBeCloseTo(WAKE_HALF_TO, 9)
  })
})

describe('wakeEmitCount', () => {
  it('走滿一個間隔才落一個節點', () => {
    expect(wakeEmitCount(0)).toBe(0)
    expect(wakeEmitCount(WAKE_NODE_SPACING * 0.99)).toBe(0)
    expect(wakeEmitCount(WAKE_NODE_SPACING)).toBe(1)
    expect(wakeEmitCount(WAKE_NODE_SPACING * 3.5)).toBe(3)
  })
})

describe('容量與索引', () => {
  /**
   * 【看得見的那一段要放得下】22 m/s × 25 s = 550 m。節點數不夠的話，
   * 尾端會在還沒淡完之前就被覆蓋掉 —— 症狀是航跡的長度被硬切一刀。
   */
  it('節點數蓋得住一整條看得見的航跡', () => {
    expect(WAKE_REAL_NODES * WAKE_NODE_SPACING).toBeGreaterThanOrEqual(22 * WAKE_LIFE)
  })

  it('正式節點比總數少一 —— 那一格留給頭端', () => {
    expect(WAKE_REAL_NODES).toBe(WAKE_NODES - 1)
  })

  it('索引全部落在頂點範圍內', () => {
    const slots = 3
    const idx = ribbonIndices(slots, WAKE_NODES)
    expect(idx.length).toBe(slots * (WAKE_NODES - 1) * 6)
    for (const v of idx) expect(v).toBeLessThan(slots * WAKE_NODES * 2)
  })

  /** 【三角形不得跨格】跨過去會畫出一條橫跨兩枚魚雷的白帶 */
  it('三角形一律落在同一格之內', () => {
    const slots = 3
    const per = WAKE_NODES * 2
    const idx = ribbonIndices(slots, WAKE_NODES)
    for (let i = 0; i < idx.length; i += 3) {
      const a = Math.floor(idx[i]! / per)
      expect(Math.floor(idx[i + 1]! / per)).toBe(a)
      expect(Math.floor(idx[i + 2]! / per)).toBe(a)
    }
  })
})

describe('沿著一條直線鋪節點', () => {
  /** 從原點往 −Z 餵，每次走 `step` 公尺 */
  function run(w: ReturnType<typeof createWakes>, metres: number, step = 1): void {
    let z = 0
    let travelled = 0
    w.emit(0, 0, 0, 0)
    while (travelled < metres) {
      z -= step
      travelled += step
      w.emit(0, 0, z, travelled)
    }
  }

  it('第一幀不落正式節點 —— 沒有上一個位置就沒有線段', () => {
    const w = createWakes(2)
    w.emit(0, 0, 0, 0)
    expect(w.live).toBe(0)
    w.dispose()
  })

  it('走 10 個間隔就有 10 個節點', () => {
    const w = createWakes(2)
    run(w, WAKE_NODE_SPACING * 10)
    expect(w.live).toBe(10)
    w.dispose()
  })

  it('超過容量之後節點數封頂在正式節點的上限', () => {
    const w = createWakes(2)
    run(w, WAKE_NODE_SPACING * (WAKE_NODES + 40), 3)
    expect(w.live).toBeLessThanOrEqual(WAKE_REAL_NODES)
    expect(w.live).toBeGreaterThan(WAKE_REAL_NODES - 3)
    w.dispose()
  })

  /**
   * 【航程倒退就是換了一枚】池子的格子會重用，而上一枚的航跡接到新的一枚
   * 身上會畫出一條橫跨半張海圖的線。`run` 單調遞增，所以它就是身分。
   */
  it('航程倒退時整條重來', () => {
    const w = createWakes(2)
    run(w, WAKE_NODE_SPACING * 10)
    expect(w.live).toBe(10)
    w.emit(0, 500, 500, 0)
    expect(w.live).toBe(0)
    w.dispose()
  })

  it('各格互不相干', () => {
    const w = createWakes(2)
    run(w, WAKE_NODE_SPACING * 10)
    w.emit(1, 900, 0, 0)
    w.emit(1, 900, -WAKE_NODE_SPACING * 2, WAKE_NODE_SPACING * 2)
    expect(w.live).toBe(12)
    w.dispose()
  })

  it('老到超過壽命就不算活著了', () => {
    const w = createWakes(2)
    run(w, WAKE_NODE_SPACING * 10)
    w.step(WAKE_LIFE + 1, 0, FLAT)
    expect(w.live).toBe(0)
    w.dispose()
  })

  it('reset 清得乾淨', () => {
    const w = createWakes(2)
    run(w, WAKE_NODE_SPACING * 10)
    w.reset()
    expect(w.live).toBe(0)
    w.emit(0, 0, 0, 0)
    expect(w.live).toBe(0)
    w.dispose()
  })

  it('格子超出範圍不丟例外', () => {
    const w = createWakes(2)
    expect(() => w.emit(99, 0, 0, 0)).not.toThrow()
    expect(() => w.emit(-1, 0, 0, 0)).not.toThrow()
    expect(w.live).toBe(0)
    w.dispose()
  })
})

/** 頂點的實際位置。`slot` 的第 `j` 個節點、左緣（0）或右緣（1） */
function vertex(
  w: ReturnType<typeof createWakes>, slot: number, j: number, side: 0 | 1,
): [number, number, number] {
  const a = w.object.geometry.getAttribute('position')
  const i = slot * WAKE_NODES * 2 + j * 2 + side
  return [a.getX(i), a.getY(i), a.getZ(i)]
}

function alphaAt(
  w: ReturnType<typeof createWakes>, slot: number, j: number,
): number {
  const a = w.object.geometry.getAttribute('aAlpha')
  return a.getX(slot * WAKE_NODES * 2 + j * 2)
}

describe('頭端', () => {
  /**
   * 【這一條守的是「一段一段長出來」】正式節點每 6 m 才落一個，所以最新的
   * 節點永遠落後魚雷最多 6 m。少了頭端，帶子的前端會一格一格地跳。
   */
  it('帶子的前端就在魚雷身上，不落後一個間隔', () => {
    const w = createWakes(2)
    w.emit(0, 0, 0, 0)
    w.emit(0, 0, -WAKE_NODE_SPACING, WAKE_NODE_SPACING)
    // 再往前走半個間隔 —— 不會落新的正式節點
    w.emit(0, 0, -WAKE_NODE_SPACING * 1.5, WAKE_NODE_SPACING * 1.5)
    expect(w.live).toBe(1)
    w.step(0, 0, FLAT)
    // 節點 0 是那一個正式節點，節點 1 是頭端
    const [, , z1] = vertex(w, 0, 1, 0)
    expect(z1).toBeCloseTo(-WAKE_NODE_SPACING * 1.5, 6)
    w.dispose()
  })

  it('只有頭端、還沒有正式節點時什麼都不畫', () => {
    const w = createWakes(2)
    w.emit(0, 0, 0, 0)
    w.step(0, 0, FLAT)
    expect(alphaAt(w, 0, 0)).toBe(0)
    expect(alphaAt(w, 0, 1)).toBe(0)
    w.dispose()
  })
})

describe('貼著浪面', () => {
  /**
   * 【高度每幀重算】`terrain.waterAt` 給的是**時間 0** 的浪高，拿它當節點
   * 高度的話帶子會被真正在動的浪蓋掉一段一段的。
   */
  it('節點的高度跟著浪高場走，而且浮起 WAKE_LIFT', () => {
    const w = createWakes(2)
    w.emit(0, 0, 0, 0)
    w.emit(0, 0, -WAKE_NODE_SPACING * 2, WAKE_NODE_SPACING * 2)
    w.step(0, 0, () => 3.5)
    expect(vertex(w, 0, 0, 0)[1]).toBeCloseTo(3.5 + WAKE_LIFT, 5)
    // 同一個節點，換一個時間就換一個高度
    w.step(0, 1, () => -2)
    expect(vertex(w, 0, 0, 0)[1]).toBeCloseTo(-2 + WAKE_LIFT, 5)
    w.dispose()
  })

  it('帶子是平的 —— 同一個節點的左右緣等高', () => {
    const w = createWakes(2)
    w.emit(0, 0, 0, 0)
    w.emit(0, 0, -WAKE_NODE_SPACING * 2, WAKE_NODE_SPACING * 2)
    w.step(0, 0, (x, z) => x * 0.1 + z * 0.1)
    for (let j = 0; j < 3; j++) {
      expect(vertex(w, 0, j, 0)[1]).toBeCloseTo(vertex(w, 0, j, 1)[1], 9)
    }
    w.dispose()
  })

  it('橫向垂直於航向 —— 往 −Z 走時左右緣分在 ±X', () => {
    const w = createWakes(2)
    w.emit(0, 0, 0, 0)
    w.emit(0, 0, -WAKE_NODE_SPACING * 2, WAKE_NODE_SPACING * 2)
    w.step(0, 0, FLAT)
    const [lx, , lz] = vertex(w, 0, 0, 0)
    const [rx, , rz] = vertex(w, 0, 0, 1)
    expect(Math.abs(lx - rx)).toBeCloseTo(wakeHalfWidth(0) * 2, 5)
    expect(lz).toBeCloseTo(rz, 6)
    w.dispose()
  })
})
