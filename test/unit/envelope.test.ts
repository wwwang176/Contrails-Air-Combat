import { describe, it, expect } from 'vitest'
import {
  maxLoadFactorAero, stallSpeed, dragAt, thrustAt, specificExcessPower,
  maxLevelSpeed, maxClimbRate, serviceCeiling, instantaneousTurnRate,
  sustainedTurnRate, cornerSpeed, maxRollRate,
} from '../../src/analysis/envelope'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

const KMH = 1 / 3.6
const RAD2DEG = 180 / Math.PI

describe('stallSpeed', () => {
  it('隨過載開根號成長', () => {
    const v1 = stallSpeed(P51D, 0, 1)
    const v4 = stallSpeed(P51D, 0, 4)
    expect(v4 / v1).toBeCloseTo(2, 6)
  })

  it('隨高度上升（密度下降）', () => {
    expect(stallSpeed(P51D, 6000, 1)).toBeGreaterThan(stallSpeed(P51D, 0, 1))
  })
})

describe('maxLoadFactorAero', () => {
  it('速度為失速速度時過載為 1', () => {
    const vs = stallSpeed(P51D, 0, 1)
    expect(maxLoadFactorAero(P51D, 0, vs)).toBeCloseTo(1, 6)
  })

  it('隨速度平方成長', () => {
    const vs = stallSpeed(P51D, 0, 1)
    expect(maxLoadFactorAero(P51D, 0, vs * 2)).toBeCloseTo(4, 6)
  })
})

describe('dragAt', () => {
  it('過載超出氣動極限時回傳 Infinity', () => {
    const vs = stallSpeed(P51D, 0, 1)
    expect(dragAt(P51D, 0, vs, 3)).toBe(Infinity)
  })

  it('相同速度下過載愈高阻力愈大（誘導阻力）', () => {
    expect(dragAt(P51D, 3000, 200, 4)).toBeGreaterThan(dragAt(P51D, 3000, 200, 1))
  })
})

describe('maxLevelSpeed 與 Ps 的一致性', () => {
  it('極速處的 Ps 接近 0', () => {
    const v = maxLevelSpeed(P51D, 7600)
    expect(Math.abs(specificExcessPower(P51D, 7600, v, 1))).toBeLessThan(0.5)
  })

  it('極速以下 Ps 為正、以上為負', () => {
    const v = maxLevelSpeed(P51D, 5000)
    expect(specificExcessPower(P51D, 5000, v * 0.9, 1)).toBeGreaterThan(0)
    expect(specificExcessPower(P51D, 5000, v * 1.05, 1)).toBeLessThan(0)
  })

  it('推力在極速處等於阻力', () => {
    const v = maxLevelSpeed(BF109G6, 6300)
    expect(thrustAt(BF109G6, 6300, v)).toBeCloseTo(dragAt(BF109G6, 6300, v, 1), 0)
  })
})

describe('maxClimbRate', () => {
  it('最佳爬升速度介於失速速度與極速之間', () => {
    const { speed } = maxClimbRate(P51D, 0)
    expect(speed).toBeGreaterThan(stallSpeed(P51D, 0, 1))
    expect(speed).toBeLessThan(maxLevelSpeed(P51D, 0))
  })

  it('爬升率隨高度下降', () => {
    expect(maxClimbRate(P51D, 8000).rate).toBeLessThan(maxClimbRate(P51D, 0).rate)
  })
})

describe('serviceCeiling', () => {
  it('落在合理區間並高於 8,000 m', () => {
    const c = serviceCeiling(P51D)
    expect(c).toBeGreaterThan(8000)
    expect(c).toBeLessThan(16000)
  })

  it('升限處爬升率接近判定門檻', () => {
    const c = serviceCeiling(P51D)
    expect(maxClimbRate(P51D, c).rate).toBeCloseTo(0.5, 1)
  })
})

describe('轉彎性能', () => {
  it('持續轉彎率永不超過瞬間轉彎率', () => {
    for (const v of [120, 160, 200, 250, 300]) {
      expect(sustainedTurnRate(P51D, 0, v)).toBeLessThanOrEqual(
        instantaneousTurnRate(P51D, 0, v) + 1e-9,
      )
    }
  })

  // V_corner = V_stall × √n_limit。
  // P-51D：停轉 ~172 km/h（史實 160）× √8   = 486 km/h
  // Bf 109：停轉 ~162 km/h（史實 170）× √7.5 = 443 km/h
  // 二戰戰機在 7~8 G 結構限制下，corner speed 本來就落在 450~500 km/h 附近。
  // 計畫原本寫的 250~400 km/h 對本專案任何一架飛機都不成立
  // （見 Task 13 報告的協調者裁決：獨立手算與本模型的 486.4 km/h 完全吻合）。
  it('角落速度落在 400–550 km/h 的合理區間', () => {
    const vcP51 = cornerSpeed(P51D, 0) / KMH
    const vcBf = cornerSpeed(BF109G6, 0) / KMH
    expect(vcP51).toBeGreaterThan(400)
    expect(vcP51).toBeLessThan(550)
    expect(vcBf).toBeGreaterThan(400)
    expect(vcBf).toBeLessThan(550)
  })

  it('角落速度處瞬間轉彎率達到峰值附近', () => {
    const vc = cornerSpeed(P51D, 0)
    const peak = instantaneousTurnRate(P51D, 0, vc)
    expect(instantaneousTurnRate(P51D, 0, vc * 0.8)).toBeLessThan(peak)
    expect(instantaneousTurnRate(P51D, 0, vc * 1.3)).toBeLessThan(peak)
  })

  // 角落速度的定義就是「瞬間轉彎率峰值所在的速度」——氣動過載曲線（隨速度平方上升）
  // 與結構過載上限的交點以下轉彎率隨速度上升，以上則因過載被夾在常數 gPositive
  // 而隨速度增加反而下降，兩段恰在 cornerSpeed 交接。這裡用細掃描直接驗證峰值
  // 落點與 cornerSpeed 的解析解一致，把兩個獨立求解器（instantaneousTurnRate 與
  // cornerSpeed）串起來做交叉驗證，而不只是猜一個合理區間。
  it('cornerSpeed 與 instantaneousTurnRate 的峰值交叉驗證', () => {
    for (const spec of [P51D, BF109G6]) {
      const vc = cornerSpeed(spec, 0)
      let bestV = 0
      let bestRate = -Infinity
      const N = 400
      for (let i = 0; i <= N; i++) {
        const v = vc * 0.5 + vc * (i / N)
        const r = instantaneousTurnRate(spec, 0, v)
        if (r > bestRate) {
          bestRate = r
          bestV = v
        }
      }
      expect(Math.abs(bestV - vc) / vc).toBeLessThan(0.01)
    }
  })

  it('低速持續轉彎率為正且落在合理範圍', () => {
    const rate = sustainedTurnRate(BF109G6, 0, 300 * KMH) * RAD2DEG
    expect(rate).toBeGreaterThan(5)
    expect(rate).toBeLessThan(35)
  })
})

describe('maxRollRate', () => {
  it('P-51 在 480 km/h 約 100 度/秒', () => {
    expect(maxRollRate(P51D, 0, 480 * KMH) * RAD2DEG).toBeCloseTo(100, -1)
  })

  it('Bf 109 在 400 km/h 約 80 度/秒', () => {
    expect(maxRollRate(BF109G6, 0, 400 * KMH) * RAD2DEG).toBeCloseTo(80, -1)
  })

  it('Bf 109 在 650 km/h 因副翼變重而大幅衰減', () => {
    const r = maxRollRate(BF109G6, 0, 650 * KMH) * RAD2DEG
    expect(r).toBeGreaterThan(20)
    expect(r).toBeLessThan(45)
  })
})
