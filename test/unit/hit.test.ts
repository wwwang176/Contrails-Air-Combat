import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  createHitResult, hitAircraft, makeHitBox, segmentBox,
  HIT_PARTS, NO_HIT, PART_MULTIPLIER, type HitBox,
} from '../../src/world/hit'
import { DEG } from '../../src/core/math'

const UNIT = makeHitBox('fuselage', [-1, -1, -1], [1, 1, 1])

describe('PART_MULTIPLIER', () => {
  it('六個部位齊全，數值對得上 spec §6.2', () => {
    expect(HIT_PARTS).toHaveLength(6)
    expect(PART_MULTIPLIER.cockpit).toBe(2.5)
    expect(PART_MULTIPLIER.engine).toBe(2.0)
    expect(PART_MULTIPLIER.tail).toBe(1.2)
    expect(PART_MULTIPLIER.fuselage).toBe(1.0)
    expect(PART_MULTIPLIER.wingLeft).toBe(0.7)
    expect(PART_MULTIPLIER.wingRight).toBe(0.7)
  })

  it('座艙是最高倍率，機翼是最低', () => {
    const vals = HIT_PARTS.map((p) => PART_MULTIPLIER[p])
    expect(Math.max(...vals)).toBe(PART_MULTIPLIER.cockpit)
    expect(Math.min(...vals)).toBe(PART_MULTIPLIER.wingLeft)
  })
})

describe('makeHitBox', () => {
  it('以 min/max 描述，內部存中心與半尺寸', () => {
    const b = makeHitBox('tail', [-2, 0, 4], [2, 1, 6])
    expect(b.center.toArray()).toEqual([0, 0.5, 5])
    expect(b.half.toArray()).toEqual([2, 0.5, 1])
  })
})

describe('segmentBox（slab 法）', () => {
  it('正面穿過盒心：t 等於進入面的參數', () => {
    // 由 z = −5 走到 z = +5，盒面在 z = −1 → t = 4/10
    expect(segmentBox(0, 0, -5, 0, 0, 5, UNIT)).toBeCloseTo(0.4, 9)
  })

  it('起點在盒內回傳 0', () => {
    expect(segmentBox(0, 0, 0, 0, 0, 5, UNIT)).toBe(0)
  })

  it('線段完全在盒內回傳 0', () => {
    expect(segmentBox(-0.5, 0, 0, 0.5, 0, 0, UNIT)).toBe(0)
  })

  it('線段太短、還沒走到盒子 → 未命中', () => {
    // 這是彈丸判定最常見的情形：一步只走 3.7 m，目標還在 500 m 外。
    expect(segmentBox(0, 0, -5, 0, 0, -2, UNIT)).toBe(NO_HIT)
  })

  it('線段從盒子另一側之外開始且方向背離 → 未命中', () => {
    expect(segmentBox(0, 0, 5, 0, 0, 2, UNIT)).toBe(NO_HIT)
  })

  it('正好擦過角落算命中', () => {
    // 沿 z 穿過 (x, y) = (1, 1) 這條稜線
    expect(segmentBox(1, 1, -5, 1, 1, 5, UNIT)).toBeCloseTo(0.4, 9)
  })

  it('擦過角落外側一絲即未命中', () => {
    expect(segmentBox(1.0001, 1, -5, 1.0001, 1, 5, UNIT)).toBe(NO_HIT)
  })

  it('平行於某軸且該軸在盒外 → 未命中（不可退化成除以 0）', () => {
    // dx = dy = 0，y = 2 永遠在 [−1, 1] 之外。缺陷版本會得到 NaN 比較，
    // 而 NaN 的比較恆為 false，於是靜靜地回報命中。
    const t = segmentBox(0, 2, -5, 0, 2, 5, UNIT)
    expect(t).toBe(NO_HIT)
  })

  it('平行於某軸且該軸在盒內 → 照常判定其餘兩軸', () => {
    expect(segmentBox(0, 0.5, -5, 0, 0.5, 5, UNIT)).toBeCloseTo(0.4, 9)
  })

  it('零長度線段：在盒內命中、在盒外未命中', () => {
    expect(segmentBox(0, 0, 0, 0, 0, 0, UNIT)).toBe(0)
    expect(segmentBox(0, 0, 5, 0, 0, 5, UNIT)).toBe(NO_HIT)
  })
})

describe('hitAircraft', () => {
  /** 一組刻意巢狀的盒子：座艙整個包在機身裡面。 */
  const NESTED: HitBox[] = [
    makeHitBox('fuselage', [-1, -1, -4], [1, 1, 4]),
    makeHitBox('cockpit', [-0.5, 0, -0.5], [0.5, 1, 0.5]),
    makeHitBox('wingRight', [1, -0.3, -1], [5, 0.3, 1]),
  ]
  const ORIGIN = new Vector3()
  const IDENTITY = new Quaternion()
  const out = createHitResult()

  it('打不到就回傳 false，且不動 out', () => {
    out.t = 123
    expect(hitAircraft(NESTED, ORIGIN, IDENTITY, new Vector3(0, 10, -5), new Vector3(0, 10, 5), out))
      .toBe(false)
    expect(out.t).toBe(123)
  })

  it('t 取最近的進入點', () => {
    hitAircraft(NESTED, ORIGIN, IDENTITY, new Vector3(0, 0.5, -10), new Vector3(0, 0.5, 10), out)
    // 機身盒面在 z = −4 → t = 6/20 = 0.3
    expect(out.t).toBeCloseTo(0.3, 9)
  })

  it('巢狀盒取**最高倍率**，否則座艙的 ×2.5 是死碼', () => {
    // 【這是本專案偏離 spec §6.1「取最近命中」的地方】座艙盒整個包在機身
    // 盒裡面，從正面來的彈丸一定先進機身盒。取最近的話座艙倍率永遠選不到
    // ——與 M1 那次「黑視起點等於過載限制器上限」是同一類死碼缺陷。
    hitAircraft(NESTED, ORIGIN, IDENTITY, new Vector3(0, 0.5, -10), new Vector3(0, 0.5, 10), out)
    expect(out.part).toBe('cockpit')
    expect(out.multiplier).toBe(2.5)
  })

  it('只穿過機身下半（座艙盒之外）時倍率是機身的', () => {
    hitAircraft(NESTED, ORIGIN, IDENTITY, new Vector3(0, -0.5, -10), new Vector3(0, -0.5, 10), out)
    expect(out.part).toBe('fuselage')
    expect(out.multiplier).toBe(1.0)
  })

  it('打在機翼上就是機翼', () => {
    hitAircraft(NESTED, ORIGIN, IDENTITY, new Vector3(3, 0, -10), new Vector3(3, 0, 10), out)
    expect(out.part).toBe('wingRight')
  })

  it('平移：判定跟著飛機走', () => {
    const pos = new Vector3(1000, 200, -3000)
    const s0 = new Vector3(1000, 0.5, -3010)
    const s1 = new Vector3(1000, 0.5, -2990)
    expect(hitAircraft(NESTED, pos, IDENTITY, s0, s1, out)).toBe(false)
    s0.y += 200
    s1.y += 200
    expect(hitAircraft(NESTED, pos, IDENTITY, s0, s1, out)).toBe(true)
  })

  /**
   * 【這一條是「AABB 定義在機體座標」的核心行為】盒子是機體固定的，
   * 判定前要把線段轉進機體座標——等價於世界座標的 OBB。若忘了轉，
   * 飛機一滾轉，機翼的判定就會失真（薄板轉成斜的，AABB 會漲大）。
   */
  it('滾轉 90° 之後，原本打中右翼的世界線段改為打不到', () => {
    const rolled = new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), 90 * DEG)
    const s0 = new Vector3(3, 0, -10)
    const s1 = new Vector3(3, 0, 10)
    expect(hitAircraft(NESTED, ORIGIN, IDENTITY, s0, s1, out)).toBe(true)
    expect(hitAircraft(NESTED, ORIGIN, rolled, s0, s1, out)).toBe(false)
    // 右翼轉到了正下方（機體 +X → 世界 −Y）
    expect(hitAircraft(NESTED, ORIGIN, rolled, new Vector3(0, -3, -10), new Vector3(0, -3, 10), out))
      .toBe(true)
    expect(out.part).toBe('wingRight')
  })

  it('連續呼叫不配置：重複一萬次不拋錯且結果一致', () => {
    const s0 = new Vector3(0, 0.5, -10)
    const s1 = new Vector3(0, 0.5, 10)
    let last = -1
    for (let i = 0; i < 10000; i++) {
      hitAircraft(NESTED, ORIGIN, IDENTITY, s0, s1, out)
      if (i > 0) expect(out.t).toBe(last)
      last = out.t
    }
  })
})
