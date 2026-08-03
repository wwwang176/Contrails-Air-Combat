import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createSituation, evaluateGeometry } from '../../src/ai/assess'
import { buildEngageBasis, createEngageBasis } from '../../src/ai/steer'
import { shouldFire, DEFAULT_FIRE } from '../../src/ai/fire'
import { P51D } from '../../src/specs/p51d'

function place(a: Aircraft, pos: [number, number, number], vel: [number, number, number]) {
  a.state.position.set(...pos)
  a.state.velocity.set(...vel)
  a.prevPosition.copy(a.state.position)
}

function face(a: Aircraft, dir: Vector3) {
  a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir.clone().normalize())
  a.prevOrientation.copy(a.state.orientation)
}

function flyer(): Aircraft {
  const a = new Aircraft(P51D, 4000, 180)
  a.update(new Vector3(0, 0, -1), 0.7, 1 / 240)
  return a
}

describe('shouldFire', () => {
  const basis = createEngageBasis()
  const sit = createSituation()

  /** 標準的良好射擊態勢：尾追 300 m、同速、機首對正。 */
  const goodShot = () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -300], [0, 0, -180])
    face(self, new Vector3(0, 0, -1))
    face(target, new Vector3(0, 0, -1))
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    return self
  }

  it('良好態勢下開火', () => {
    const self = goodShot()
    expect(shouldFire(sit, basis, self)).toBe(true)
  })

  it('機首偏離預瞄方向超過跟蹤錐 → 不開火', () => {
    const self = goodShot()
    face(self, new Vector3(1, 0, -1))
    expect(shouldFire(sit, basis, self)).toBe(false)
  })

  it('距離過近 → 不開火（避免撞上去）', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -DEFAULT_FIRE.minRange * 0.5], [0, 0, -180])
    face(self, new Vector3(0, 0, -1))
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    expect(shouldFire(sit, basis, self)).toBe(false)
  })

  it('無攔截解 → 不開火', () => {
    const self = flyer()
    const target = flyer()
    // 目標以遠高於彈速的速度沿視線遠離
    place(self, [0, 4000, 0], [0, 0, 0])
    place(target, [0, 4000, -600], [0, 0, -1500])
    face(self, new Vector3(0, 0, -1))
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    expect(shouldFire(sit, basis, self)).toBe(false)
  })

  it('攔截時間超過彈丸壽命 → 不開火', () => {
    // 【這個條件與玩家的預瞄環是同一個】M2 spec §5.1.1：回收條件與顯示
    // 條件用同一個數字，所以「看得到預瞄環」精確等於「打得到」。AI 用
    // 同一條規則，才不會出現「AI 打得到但玩家看不到環」的不對稱。
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -1500], [0, 0, -300])
    face(self, new Vector3(0, 0, -1))
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    expect(shouldFire(sit, basis, self)).toBe(false)
  })

  it('視線角速度過大 → 不開火（劇烈掃過時命中機率極低）', () => {
    const self = goodShot()
    sit.losRate = DEFAULT_FIRE.maxLosRate * 2
    expect(shouldFire(sit, basis, self)).toBe(false)
  })

  /**
   * 【為什麼要有紀律而不是「有解就開火」】無限彈藥（M2 §2 裁決）所以不必
   * 省彈，但濫射有兩個實際壞處：AI 看起來很笨，而且曳光彈會蓋滿畫面讓
   * 玩家看不到自己在打哪。
   */
  it('遠距離大角度掃射時不開火', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [700, 4000, -700], [-200, 0, 0])
    face(self, new Vector3(0, 0, -1))
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    expect(shouldFire(sit, basis, self)).toBe(false)
  })
})
