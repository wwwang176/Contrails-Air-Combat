import { describe, it, expect } from 'vitest'
import {
  createFarmland, FARM_CELL, FARM_EXTENT, FARM_SIZE, HILL_LIMIT, HILL_PEAK_MAX,
} from '../../src/world/farmland'
import { bakeRelief, WOBBLE_MAX } from '../../src/world/archipelago'
import { createHeightField } from '../../src/world/heightfield'

const farm = createFarmland()

describe('內陸農地的高度場', () => {
  it('尺寸就是 30 km 見方', () => {
    expect(FARM_SIZE).toBe(376)
    expect(FARM_CELL).toBe(80)
    expect(FARM_EXTENT).toBe((FARM_SIZE - 1) * FARM_CELL)
    expect(FARM_EXTENT).toBe(30000)
  })

  it('沒有丘陵的地方恰好是 0', () => {
    for (const [x, z] of [[-14900, -14900], [14900, -14900], [-14900, 14900], [14900, 14900]]) {
      expect(farm.field.sample(x!, z!)).toBe(0)
    }
  })

  it('沒有一格是負的', () => {
    let min = Infinity
    for (const h of farm.field.data) if (h < min) min = h
    expect(min).toBe(0)
  })

  it('峰不超過上限', () => {
    let max = -Infinity
    for (const h of farm.field.data) if (h > max) max = h
    console.log(JSON.stringify({ 最高: max.toFixed(1) + ' m', 丘陵數: farm.hills.length }))
    expect(max).toBeLessThanOrEqual(HILL_PEAK_MAX)
    expect(max).toBeGreaterThan(30)
  })

  /**
   * 【坡度的上限是常數，因為峰高由半徑推得】獨立抽會抽出又小又高的尖丘。
   * 這一條直接驗那件事成立，而不是驗某一顆丘陵的數字。
   */
  it('沒有一顆丘陵陡過 HILL_SLOPE 的上限', () => {
    let steepest = 0
    for (const h of farm.hills) steepest = Math.max(steepest, h.peak / h.radius)
    console.log(JSON.stringify({
      最陡: (Math.atan(1.5 * steepest) * 180 / Math.PI).toFixed(1) + '°',
    }))
    expect(steepest).toBeLessThanOrEqual(0.10 + 1e-9)
  })

  /**
   * 【AI 的硬約束】`findThreat` 只保留航跡上最早撞到的那一座，`senseTerrain`
   * 也只對它做爬升判斷 —— 圓盤重疊的話，前面一顆矮丘會把後面一顆高丘整個
   * 遮掉。這一條就是那個假設。
   */
  it('沒有任何兩顆丘陵的膨脹圓重疊', () => {
    let closest = Infinity
    for (let i = 0; i < farm.hills.length; i++) {
      for (let j = i + 1; j < farm.hills.length; j++) {
        const a = farm.hills[i]!
        const b = farm.hills[j]!
        closest = Math.min(closest, Math.hypot(a.cx - b.cx, a.cz - b.cz)
          - a.outerRadius - b.outerRadius)
      }
    }
    console.log(JSON.stringify({ 最小間隙: closest.toFixed(1) + ' m' }))
    expect(closest).toBeGreaterThan(0)
  })

  /**
   * 【為什麼需要它】丘陵被場地邊界切掉的話，外圈會出現一道垂直的崖，
   * 而遠景環是平的 —— 接縫會變成畫面上一條看得見的線。
   */
  it('每一顆丘陵的地形都在 HILL_LIMIT 之內', () => {
    let worst = -Infinity
    for (const h of farm.hills) {
      worst = Math.max(worst, Math.hypot(h.cx, h.cz) + h.outerRadius - HILL_LIMIT)
    }
    console.log(JSON.stringify({ 最大溢出: worst.toFixed(1) + ' m' }))
    expect(worst).toBeLessThanOrEqual(0)
  })

  it('丘陵的每一瓣都放得下', () => {
    let worst = -Infinity
    for (const h of farm.hills) {
      for (const lo of h.lobes) {
        worst = Math.max(worst, lo.offset + lo.radius * WOBBLE_MAX - h.outerRadius)
      }
    }
    expect(worst).toBeLessThanOrEqual(1e-6)
  })

  /**
   * 【為什麼要烘到一張隔離的場，不是量成品】成品是所有丘陵取 max 之後的
   * 結果，鄰居會替一顆沒有副瓣的丘陵製造出二次上升 —— Codex 實測把
   * `HILL_LOBES` 改成 0 之後，在成品上量的版本**仍然全綠**。隔離之後
   * 「這一顆有沒有起伏」才問得清楚。
   *
   * 【用細格】丘陵半徑 700～1,300 m，80 m 的格只有十幾格，鞍部會被格距吃掉。
   */
  it('每一顆丘陵單獨烘出來都有一條半徑不是單調遞減的', () => {
    let flat = 0
    for (const h of farm.hills) {
      const n = 129
      const solo = createHeightField(n, (h.outerRadius * 2) / (n - 1))
      bakeRelief(solo, [{
        ...h,
        cx: 0,
        cz: 0,
        lobes: h.lobes.map((lo) => ({ ...lo, cx: lo.cx - h.cx, cz: lo.cz - h.cz })),
      }], 0)
      let rose = false
      for (let a = 0; a < Math.PI * 2 && !rose; a += Math.PI / 24) {
        let min = Infinity
        for (let r = 0; r <= h.outerRadius; r += 5) {
          const v = solo.sample(Math.cos(a) * r, Math.sin(a) * r)
          if (v > min + 0.5) { rose = true; break }
          if (v < min) min = v
        }
      }
      if (!rose) flat++
    }
    console.log(JSON.stringify({ 沒有起伏的丘陵: flat, 總數: farm.hills.length }))
    expect(flat).toBe(0)
  })

  it('每一顆丘陵都有主瓣加 HILL_LOBES 個副瓣', () => {
    for (const h of farm.hills) expect(h.lobes.length).toBe(5)
  })

  /**
   * 【釘住丘陵數】候選是 9 × 9 = 81 個，扣掉超出 `HILL_LIMIT` 的與膨脹圓
   * 相撞的之後剩多少，是這組常數的結果，不是設計的輸入。釘住它是為了讓
   * 「以後有人動了間距」變成一件看得見的事 —— 只寫 `> 30` 的話，31 座也會
   * 過，而那時地圖已經空掉了。
   */
  it('丘陵數就是這組常數算出來的那個數', () => {
    expect(farm.hills.length).toBe(40)
  })

  /**
   * 【這一條記錄的是「地圖有多平」】膨脹圓不得重疊是 AI 的硬約束（見
   * `HILL_GAP`），而不重疊的圓在網格上最多只能鋪到三成多 —— 也就是說
   * **連綿的起伏在這個約束下做不出來**，這是幾何，不是參數沒調好。
   *
   * 界內（半徑 12 km）高於 1 m 的地是 20.6%，其餘是絕對平的。截圖驗收要
   * 回答的正是「這樣夠不夠像歐洲」。
   */
  it('起伏的覆蓋率', () => {
    const half = (farm.field.size - 1) / 2
    let inArena = 0
    let relief = 0
    for (let r = 0; r < farm.field.size; r++) {
      for (let c = 0; c < farm.field.size; c++) {
        const x = (c - half) * FARM_CELL
        const z = (r - half) * FARM_CELL
        if (Math.hypot(x, z) > 12000) continue
        inArena++
        if (farm.field.data[r * farm.field.size + c]! > 1) relief++
      }
    }
    const pct = (100 * relief) / inArena
    console.log(JSON.stringify({ 界內有起伏: pct.toFixed(1) + '%' }))
    expect(pct).toBeGreaterThan(15)
    expect(pct).toBeLessThan(30)
  })

  it('決定性 —— 兩次生成逐位元相同', () => {
    const b = createFarmland()
    expect(b.hills.length).toBe(farm.hills.length)
    for (let i = 0; i < farm.field.data.length; i++) {
      expect(b.field.data[i]).toBe(farm.field.data[i])
    }
  })
})
