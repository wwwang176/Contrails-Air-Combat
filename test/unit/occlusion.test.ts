import { describe, it, expect } from 'vitest'
import { createHeightField, type HeightFieldData } from '../../src/world/heightfield'
import { losBlocked, landHitT, type LandField } from '../../src/world/occlusion'
import { createArchipelago, PEAK_MAX } from '../../src/world/archipelago'
import { findOcclusionCase } from '../fixtures/occlusion-case'

/**
 * 視線與彈丸的遮蔽。
 *
 * 【兩個函式為什麼不合成一個】它們的失效方向不同，精度要求因此不同：
 *
 * ```
 *   losBlocked   AI 用。漏判 = 多開一輪空槍，彈丸那一側仍然會收掉子彈
 *   landHitT     彈丸用。漏判 = 子彈穿過山，那是正確性問題
 * ```
 *
 * 【陸地的判準是 h > 0】高度場沒有島的地方是 `SEA_FLOOR = −8`
 * （`archipelago.ts`）。少了這一半，一發入海的子彈會在水下 8 m 被當成
 * 撞地 —— 而現行行為是在 y = 0 推水柱、到 `SEA_KILL_Y = −20` 才回收。
 */

/** 包一層計數器，用來證明 ceiling 早退真的沒有查高度場 */
function counted(f: HeightFieldData): { field: HeightFieldData; calls: () => number } {
  let n = 0
  return {
    field: {
      size: f.size,
      cell: f.cell,
      data: f.data,
      sample(x, z) { n++; return f.sample(x, z) },
    },
    calls: () => n,
  }
}

const arch = createArchipelago()
const LAND: LandField = { field: arch.field, ceiling: PEAK_MAX, landAbove: 0 }

/**
 * spec §1.2 的考題：兩架同高，連線從山頂之下穿過。
 *
 * 【座標是在真的高度場上搜出來的】見 `test/fixtures/occlusion-case.ts`。
 * 山改矮改緩這裡跟著動；下面三條自我驗證的斷言（離地、距離、山頂高出
 * 多少）在幾何不再成立時直接紅 —— 那比一組寫死的數字誠實。
 */
const CASE = findOcclusionCase(arch.field, arch.islands)
const D = CASE.d
const Y = CASE.y
const AX = CASE.ax
const AZ = CASE.az
const BX = CASE.bx
const BZ = CASE.bz

describe('考題本身要成立', () => {
  it('兩架都在飛 —— 離地不低於考題的 120 m', () => {
    expect(Y - arch.field.sample(AX, AZ)).toBeGreaterThanOrEqual(120 - 1e-9)
    expect(Y - arch.field.sample(BX, BZ)).toBeGreaterThanOrEqual(120 - 1e-9)
  })

  it('在有效射程之內', () => {
    expect(Math.hypot(BX - AX, BZ - AZ)).toBeCloseTo(2 * D, 6)
    expect(2 * D).toBeLessThanOrEqual(1000)
  })

  it('山頂確實比兩者的連線高', () => {
    console.log(JSON.stringify({
      半弦: D, 高度: Y.toFixed(1), 稜線: CASE.ridge.toFixed(1), 高出: CASE.drop.toFixed(1),
    }))
    expect(CASE.ridge).toBeGreaterThan(Y)
  })
})

describe('losBlocked', () => {
  it('兩端都高於 ceiling → 不擋，而且一次高度場都沒查', () => {
    const c = counted(arch.field)
    const land: LandField = { field: c.field, ceiling: PEAK_MAX, landAbove: 0 }
    expect(losBlocked(AX, 4000, AZ, BX, 4000, BZ, land)).toBe(false)
    expect(c.calls()).toBe(0)
  })

  it('考題被擋住', () => {
    expect(losBlocked(AX, Y, AZ, BX, Y, BZ, LAND)).toBe(true)
  })

  it('兩架抬到山頂之上 20 m 就通了 —— 擋住的只是山頂高出連線的那一段', () => {
    const up = CASE.drop + 20
    expect(losBlocked(AX, Y + up, AZ, BX, Y + up, BZ, LAND)).toBe(false)
  })

  it('開闊海面上的低空視線不算被擋 —— 海床是 −8，不是陸地', () => {
    // 場地中心往北 12 km 是開闊海面（島散布在 ±15 km，這一帶沒有）
    expect(losBlocked(0, 5, 12000, 800, 5, 12000, LAND)).toBe(false)
  })

  it('起點在山裡也不會回 NaN 式的結果', () => {
    expect(losBlocked(CASE.cx, 10, CASE.cz, BX, Y, BZ, LAND)).toBe(true)
  })
})

describe('landHitT', () => {
  it('沒有交點回 Infinity', () => {
    expect(landHitT(AX, 4000, AZ, BX, 4000, BZ, LAND)).toBe(Infinity)
  })

  it('往山裡飛的一小段：t 落在 [0,1]，而且那一點在地形之下', () => {
    // 從島心正上方往下走一步（一個彈丸步長的量級）
    const x = CASE.cx
    const z = CASE.cz
    const top = arch.field.sample(x, z)
    const t = landHitT(x, top + 3, z, x, top - 3, z, LAND)
    expect(t).toBeGreaterThanOrEqual(0)
    expect(t).toBeLessThanOrEqual(1)
    const y = top + 3 + (top - 3 - (top + 3)) * t
    expect(y).toBeLessThanOrEqual(arch.field.sample(x, z) + 1e-6)
  })

  it('入海的一步不算撞地 —— 海床 −8 不是陸地', () => {
    expect(landHitT(0, 2, 12000, 0, -6, 12000, LAND)).toBe(Infinity)
  })

  it('平地（全場沒有陸地）恆不撞', () => {
    const flat = createHeightField(8, 40)
    flat.data.fill(-8)
    const land: LandField = { field: flat, ceiling: -8, landAbove: 0 }
    expect(landHitT(0, 5, 0, 0, -7, 0, land)).toBe(Infinity)
    expect(losBlocked(0, 5, 0, 100, 5, 0, land)).toBe(false)
  })
})

/**
 * 地面的判準由 `landAbove` 決定。
 *
 * 【為什麼需要它】群島的判準是「高過海平面」，而內陸農地的基準平原**正好
 * 等於 0** —— `h > 0` 對它恆為假，平地上的視線與彈丸會完全不被擋。症狀是
 * 子彈鑽進田裡不噴土、飛到 `SEA_KILL_Y = −20` 才靜靜消失。
 */
describe('地面的判準由 landAbove 決定', () => {
  /** 全零的高度場 —— 那就是內陸的基準平原 */
  const flat = createHeightField(9, 100)

  it('農地：貼著地面的視線被平地擋住', () => {
    const land: LandField = { field: flat, ceiling: 120, landAbove: -Infinity }
    expect(losBlocked(-300, -1, 0, 300, -1, 0, land)).toBe(true)
  })

  it('群島：同一條視線不被海面擋住', () => {
    const land: LandField = { field: flat, ceiling: 120, landAbove: 0 }
    expect(losBlocked(-300, -1, 0, 300, -1, 0, land)).toBe(false)
  })

  it('農地：彈丸打進平地會回一個有限的 t', () => {
    const land: LandField = { field: flat, ceiling: 120, landAbove: -Infinity }
    const t = landHitT(0, 50, 0, 0, -50, 300, land)
    expect(Number.isFinite(t)).toBe(true)
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThanOrEqual(1)
  })

  it('群島：同一發子彈穿過海面不算撞地', () => {
    const land: LandField = { field: flat, ceiling: 120, landAbove: 0 }
    expect(landHitT(0, 50, 0, 0, -50, 300, land)).toBe(Infinity)
  })
})
