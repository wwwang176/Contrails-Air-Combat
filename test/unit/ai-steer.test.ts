import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createSituation, evaluateGeometry } from '../../src/ai/assess'
import {
  buildEngageBasis, createEngageBasis, geometryGate, DEFAULT_STEER,
} from '../../src/ai/steer'
import { P51D } from '../../src/specs/p51d'

function place(a: Aircraft, pos: [number, number, number], vel: [number, number, number]) {
  a.state.position.set(...pos)
  a.state.velocity.set(...vel)
  a.prevPosition.copy(a.state.position)
}

/** 平飛、機首朝 −Z 的自機。 */
function flyer(): Aircraft {
  const a = new Aircraft(P51D, 4000, 180)
  a.update(new Vector3(0, 0, -1), 0.7, 1 / 240)
  return a
}

describe('buildEngageBasis', () => {
  const basis = createEngageBasis()

  it('losAxis 由我指向目標且為單位向量', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -400], [0, 0, -180])
    buildEngageBasis(self, target, basis)
    expect(basis.losAxis.length()).toBeCloseTo(1, 12)
    expect(basis.losAxis.z).toBeCloseTo(-1, 6)
  })

  it('verticalAxis 與 losAxis 正交', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [200, 4200, -400], [0, 0, -180])
    buildEngageBasis(self, target, basis)
    expect(basis.verticalAxis.dot(basis.losAxis)).toBeCloseTo(0, 9)
    expect(basis.verticalAxis.length()).toBeCloseTo(1, 12)
  })

  /**
   * 【verticalAxis 為什麼取自身升力方向而不是世界上方】yo-yo 的「拉高」
   * 在物理上就是「多拉一點桿」，那個方向永遠是自己的升力方向。指揮儀是
   * bank-to-turn，大坡度時命令「世界正上方」會要求飛機先滾平再拉——那是
   * 一個做不到的指令，而且滾平的過程中什麼都沒發生。
   */
  it('滾轉時 verticalAxis 跟著機體轉，不是恆指世界上方', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -400], [0, 0, -180])

    buildEngageBasis(self, target, basis)
    const upright = basis.verticalAxis.clone()

    // 繞機首軸滾 90°
    self.state.orientation.setFromAxisAngle(new Vector3(0, 0, -1), Math.PI / 2)
    buildEngageBasis(self, target, basis)
    expect(basis.verticalAxis.angleTo(upright)).toBeGreaterThan(1.0)
  })

  it('目標與我同速時 leadScale 趨近 0（純尾追沒有提前量）', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -400], [0, 0, -180])
    buildEngageBasis(self, target, basis)
    expect(basis.leadScale).toBeLessThan(1)
  })

  it('目標橫向移動時 leadScale 顯著、leadAxis 指向運動方向', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, 0])
    place(target, [0, 4000, -400], [200, 0, 0])
    buildEngageBasis(self, target, basis)
    expect(basis.leadScale).toBeGreaterThan(20)
    expect(basis.leadAxis.x).toBeGreaterThan(0.9)
  })

  it('升力方向平行視線時標記 verticalDegenerate', () => {
    // 目標正在我的升力方向上（正上方），而我平飛 → 升力 ∥ 視線
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4600, 0], [0, 0, -180])
    buildEngageBasis(self, target, basis)
    expect(basis.verticalDegenerate).toBe(true)
  })

  it('兩機重疊時不產生 NaN', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, 0], [0, 0, -180])
    buildEngageBasis(self, target, basis)
    for (const v of [...basis.losAxis.toArray(), ...basis.verticalAxis.toArray(),
      ...basis.leadAxis.toArray(), basis.leadScale]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('geometryGate', () => {
  const basis = createEngageBasis()
  const sit = createSituation()

  const setup = (
    selfPos: [number, number, number], selfVel: [number, number, number],
    targetPos: [number, number, number], targetVel: [number, number, number],
  ) => {
    const self = flyer()
    const target = flyer()
    place(self, selfPos, selfVel)
    place(target, targetPos, targetVel)
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    sit.stallMargin = 2
    return { self, target }
  }

  it('一般幾何 → normal', () => {
    setup([0, 4000, 0], [0, 0, -180], [0, 4000, -500], [0, 0, -180])
    expect(geometryGate(sit, basis)).toBe('normal')
  })

  /**
   * 【超前閘門】極近距離時預瞄點會產生指揮儀兌現不了的角速度需求：
   * 100 m 外、橫向 200 m/s 的目標，視線角速度是 2 rad/s = 115°/s，
   * 而 P-51 的最大滾轉率只有約 100°/s——瞄準點會每格劇烈跳動而飛機跟不上。
   */
  it('極近距離且正在接近 → overshoot', () => {
    setup([0, 4000, 0], [0, 0, -250], [0, 4000, -60], [0, 0, -150])
    expect(geometryGate(sit, basis)).toBe('overshoot')
  })

  it('極近但正在拉開 → 不算超前', () => {
    setup([0, 4000, 0], [0, 0, -150], [0, 4000, -60], [0, 0, -250])
    expect(geometryGate(sit, basis)).not.toBe('overshoot')
  })

  /**
   * 【吊機首閘門】目標在高仰角、而我速度不夠時追上去會失速掛在那裡。
   * 這與平面奇異是**兩件事**：平飛時目標在正上方，速度與視線垂直，
   * 平面定義得很好——壞的是能量不是幾何。
   */
  it('目標在高仰角且失速裕度低 → stallGuard', () => {
    setup([0, 4000, 0], [0, 0, -120], [0, 4800, -200], [0, 0, -120])
    sit.stallMargin = DEFAULT_STEER.stallGuardMargin * 0.8
    expect(geometryGate(sit, basis)).toBe('stallGuard')
  })

  it('目標在高仰角但速度充足 → 不觸發 stallGuard', () => {
    setup([0, 4000, 0], [0, 0, -250], [0, 4800, -200], [0, 0, -250])
    sit.stallMargin = 3
    expect(geometryGate(sit, basis)).not.toBe('stallGuard')
  })

  it('升力方向平行視線 → planeDegenerate', () => {
    setup([0, 4000, 0], [0, 0, -180], [0, 4600, 0], [0, 0, -180])
    sit.stallMargin = 3
    expect(geometryGate(sit, basis)).toBe('planeDegenerate')
  })

  it('超前的優先序高於吊機首（撞上去比失速嚴重）', () => {
    setup([0, 4000, 0], [0, 0, -250], [0, 4050, -50], [0, 0, -150])
    sit.stallMargin = DEFAULT_STEER.stallGuardMargin * 0.5
    expect(geometryGate(sit, basis)).toBe('overshoot')
  })
})
