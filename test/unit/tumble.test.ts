import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { tumble } from '../../src/render/tumble'

describe('tumble —— 年齡決定姿態的純函數（M8 spec §7、§8.2）', () => {
  it('t = 0 就是初始姿態', () => {
    const base = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.2)
    const out = new Quaternion()
    tumble(2, -3, 1.5, 0, base, out)
    expect(out.angleTo(base)).toBeCloseTo(0, 9)
  })

  it('恆為單位四元數 —— 積分漂移在這裡結構上不存在', () => {
    // 【為什麼用「年齡的函數」而不是每幀累加】每幀 q += 0.5·ω⊗q·dt 會漂移，
    // 要定期正規化；而姿態寫成 t 的純函數之後，第 10000 幀與第 1 幀一樣精確，
    // 而且測得起來。
    const base = new Quaternion()
    const out = new Quaternion()
    for (let i = 0; i <= 600; i++) {
      tumble(2.1, -1.3, 0.7, i * 0.1, base, out)
      expect(out.length()).toBeCloseTo(1, 9)
    }
  })

  it('角速度為零時姿態不動', () => {
    const base = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.4)
    const out = new Quaternion()
    tumble(0, 0, 0, 12.5, base, out)
    expect(out.angleTo(base)).toBeCloseTo(0, 9)
  })

  it('單軸時就是繞該軸的等速旋轉', () => {
    const out = new Quaternion()
    tumble(0, Math.PI / 2, 0, 1, new Quaternion(), out)
    const expected = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    expect(out.angleTo(expected)).toBeCloseTo(0, 6)
  })

  it('三軸同時轉時，短時間內的姿態變化率接近角速度的模', () => {
    // 【為什麼只測「接近」】三個軸的旋轉不可交換，合成的瞬時角速度不會
    // 恰好等於三者的向量和。但在小角度下兩者一致，而這就是「轉得多快」
    // 這個參數真正的意思。
    const out = new Quaternion()
    const dt = 0.001
    tumble(1, 2, 2, dt, new Quaternion(), out)
    // |ω| = 3 rad/s → dt 之後轉過約 0.003 rad
    expect(out.angleTo(new Quaternion())).toBeCloseTo(3 * dt, 4)
  })

  it('不同的角速度給出不同的姿態 —— 每一具殘骸翻得不一樣', () => {
    const a = new Quaternion()
    const b = new Quaternion()
    tumble(2, -1, 0.5, 1.7, new Quaternion(), a)
    tumble(-1, 2, 1.5, 1.7, new Quaternion(), b)
    expect(a.angleTo(b)).toBeGreaterThan(0.5)
  })
})
