import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { obbOverlap } from '../../src/world/obb'
import { DEG } from '../../src/core/math'

const I = new Quaternion()
const half = (x: number, y: number, z: number) => new Vector3(x, y, z)

describe('obbOverlap', () => {
  it('分開的兩個軸對齊盒不相交', () => {
    expect(obbOverlap(
      new Vector3(0, 0, 0), half(1, 1, 1), I,
      new Vector3(3, 0, 0), half(1, 1, 1), I,
    )).toBe(false)
  })

  it('重疊的兩個軸對齊盒相交', () => {
    expect(obbOverlap(
      new Vector3(0, 0, 0), half(1, 1, 1), I,
      new Vector3(1.5, 0, 0), half(1, 1, 1), I,
    )).toBe(true)
  })

  /**
   * 【這一條才是真正要守的】兩個盒的**面**都分不開它們，只有「A 的某一軸
   * 叉乘 B 的某一軸」那九條軸分得開。只測前六軸的實作會在這裡回傳 true。
   *
   * 兩根細長棒十字交叉、錯開一點高度：不相交，但六個面軸投影全部重疊。
   */
  it('十字交叉但錯開高度的兩根細棒 —— 只有叉乘軸分得開', () => {
    const b = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 90 * DEG)
    expect(obbOverlap(
      new Vector3(0, 0, 0), half(5, 0.2, 0.2), I,
      new Vector3(0, 0.5, 0), half(5, 0.2, 0.2), b,
    )).toBe(false)
  })

  it('十字交叉且同高度的兩根細棒相交', () => {
    const b = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 90 * DEG)
    expect(obbOverlap(
      new Vector3(0, 0, 0), half(5, 0.2, 0.2), I,
      new Vector3(0, 0, 0), half(5, 0.2, 0.2), b,
    )).toBe(true)
  })

  /**
   * 【世界 AABB 會騙人】A 是邊長 2 的立方體轉 45°，它的世界 AABB 在 X 與 Z
   * 上各撐到 ±1.414；B 這個小盒整個落在那個範圍內。但沿著 A 的面法線
   * (0.707, 0, 0.707) 投影，兩者分得開 —— 用世界 AABB 判定會誤判成相交。
   *
   * 這正是 `hit.ts` 的 `HitBox` 註解拒絕世界 AABB 的同一個理由。
   */
  it('世界 AABB 相交但實際不相交', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 45 * DEG)
    expect(obbOverlap(
      new Vector3(0, 0, 0), half(1, 1, 1), q,
      new Vector3(1.3, 0, 1.3), half(0.2, 0.2, 0.2), I,
    )).toBe(false)
  })

  /** 同樣的一對，把小盒挪進 A 的面之內 —— 這時是真的相交。 */
  it('同一對挪近之後相交', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 45 * DEG)
    expect(obbOverlap(
      new Vector3(0, 0, 0), half(1, 1, 1), q,
      new Vector3(0.5, 0, 0.5), half(0.2, 0.2, 0.2), I,
    )).toBe(true)
  })

  it('一個盒完全在另一個盒內 —— 相交', () => {
    expect(obbOverlap(
      new Vector3(0, 0, 0), half(10, 10, 10), I,
      new Vector3(1, 1, 1), half(0.5, 0.5, 0.5), I,
    )).toBe(true)
  })

  /**
   * 【輸入不可以被改動】兩邊傳進來的都是呼叫端持有的向量與姿態 ——
   * `World` 那一側傳的是 `c.aircraft.state.position` 本人。就地改動的話
   * 飛機會被這個純判定函數搬走，而症狀離成因非常遠。
   */
  it('不修改任何輸入', () => {
    const ac = new Vector3(1, 2, 3)
    const ah = half(1, 1, 1)
    const aq = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 30 * DEG)
    const bc = new Vector3(4, 5, 6)
    const bh = half(2, 2, 2)
    const bq = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 20 * DEG)
    const snap = [ac.clone(), ah.clone(), aq.clone(), bc.clone(), bh.clone(), bq.clone()]
    obbOverlap(ac, ah, aq, bc, bh, bq)
    expect(ac.equals(snap[0] as Vector3)).toBe(true)
    expect(ah.equals(snap[1] as Vector3)).toBe(true)
    expect(aq.equals(snap[2] as Quaternion)).toBe(true)
    expect(bc.equals(snap[3] as Vector3)).toBe(true)
    expect(bh.equals(snap[4] as Vector3)).toBe(true)
    expect(bq.equals(snap[5] as Quaternion)).toBe(true)
  })
})
