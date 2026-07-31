import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  liftCoefficient, dragCoefficient, inducedDragFactor, controlEffectiveness,
  updateSlatState, computeAeroState, aeroForceMoment,
} from '../../src/physics/aero'
import { atmosphere } from '../../src/physics/atmosphere'
import { derivedClMax } from '../../src/specs/types'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { DEG } from '../../src/core/math'
import type { AeroState, AirData, ForceMoment } from '../../src/physics/types'

const air = (h: number): AirData =>
  atmosphere(h, { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 })
const aeroOut = (): AeroState => ({ tas: 0, alpha: 0, beta: 0, qbar: 0, mach: 0 })
const fmOut = (): ForceMoment => ({ force: new Vector3(), moment: new Vector3() })
const NO_CONTROL = { aileron: 0, elevator: 0, rudder: 0, throttle: 0 }

describe('liftCoefficient', () => {
  it('零升迎角處 CL 為 0', () => {
    expect(liftCoefficient(P51D, P51D.lift.alphaZero, false)).toBeCloseTo(0, 12)
  })

  it('線性段斜率等於 clAlpha', () => {
    const a1 = 2 * DEG
    const a2 = 6 * DEG
    const slope =
      (liftCoefficient(P51D, a2, false) - liftCoefficient(P51D, a1, false)) / (a2 - a1)
    expect(slope).toBeCloseTo(P51D.lift.clAlpha, 6)
  })

  it('在失速迎角處達到推導的 CL_max', () => {
    expect(liftCoefficient(P51D, P51D.lift.alphaCrit, false)).toBeCloseTo(
      derivedClMax(P51D, false), 6,
    )
  })

  it('失速後 CL 下降', () => {
    const peak = liftCoefficient(P51D, P51D.lift.alphaCrit, false)
    expect(liftCoefficient(P51D, P51D.lift.alphaCrit + 5 * DEG, false)).toBeLessThan(peak)
    expect(liftCoefficient(P51D, P51D.lift.alphaCrit + 10 * DEG, false)).toBeLessThan(peak)
  })

  it('CL 曲線連續，無跳變', () => {
    let prev = liftCoefficient(P51D, -30 * DEG, false)
    for (let a = -30; a <= 60; a += 0.25) {
      const cl = liftCoefficient(P51D, a * DEG, false)
      expect(Math.abs(cl - prev)).toBeLessThan(0.06)
      prev = cl
    }
  })

  it('深失速沿用平板模型，不發散', () => {
    for (const a of [45, 70, 90, 120, 180]) {
      const cl = liftCoefficient(P51D, a * DEG, false)
      expect(Math.abs(cl)).toBeLessThanOrEqual(1.05)
    }
  })

  it('負迎角對稱', () => {
    const a = 10 * DEG
    const offset = P51D.lift.alphaZero
    expect(liftCoefficient(P51D, offset + a, false)).toBeCloseTo(
      -liftCoefficient(P51D, offset - a, false), 6,
    )
  })

  it('Bf 109 縫翼展開後失速迎角與 CL_max 提高', () => {
    const clean = liftCoefficient(BF109G6, BF109G6.lift.alphaCrit, false)
    const slats = liftCoefficient(BF109G6, BF109G6.lift.alphaCrit + 2.5 * DEG, true)
    expect(slats).toBeGreaterThan(clean)
  })
})

describe('updateSlatState', () => {
  it('迎角超過展開閾值時展開', () => {
    expect(updateSlatState(BF109G6, 9 * DEG, false)).toBe(true)
  })

  it('迎角低於收回閾值時收回', () => {
    expect(updateSlatState(BF109G6, 5 * DEG, true)).toBe(false)
  })

  it('遲滯區間內維持原狀態', () => {
    expect(updateSlatState(BF109G6, 7 * DEG, true)).toBe(true)
    expect(updateSlatState(BF109G6, 7 * DEG, false)).toBe(false)
  })

  it('P-51 無縫翼，永不展開', () => {
    expect(updateSlatState(P51D, 30 * DEG, false)).toBe(false)
    expect(updateSlatState(P51D, 30 * DEG, true)).toBe(false)
  })
})

describe('dragCoefficient', () => {
  it('CL 為 0 且無側滑時等於 cd0', () => {
    expect(dragCoefficient(P51D, 0, 0, 0.3)).toBeCloseTo(P51D.drag.cd0, 12)
  })

  it('誘導阻力隨 CL 平方成長', () => {
    const k = inducedDragFactor(P51D)
    expect(dragCoefficient(P51D, 1.0, 0, 0.3) - P51D.drag.cd0).toBeCloseTo(k, 10)
    expect(dragCoefficient(P51D, 2.0, 0, 0.3) - P51D.drag.cd0).toBeCloseTo(4 * k, 10)
  })

  it('誘導阻力因子等於 1/(π·e·AR)', () => {
    const ar = (P51D.wing.span ** 2) / P51D.wing.area
    expect(inducedDragFactor(P51D)).toBeCloseTo(1 / (Math.PI * P51D.wing.oswald * ar), 12)
  })

  it('臨界馬赫數以下不受壓縮性影響', () => {
    expect(dragCoefficient(P51D, 0, 0, 0.5)).toBeCloseTo(
      dragCoefficient(P51D, 0, 0, 0.7), 12,
    )
  })

  it('超過臨界馬赫數後阻力上升', () => {
    expect(dragCoefficient(P51D, 0, 0, 0.8)).toBeGreaterThan(dragCoefficient(P51D, 0, 0, 0.7))
  })

  it('P-51 的臨界馬赫數高於 Bf 109（俯衝優勢）', () => {
    const p51 = dragCoefficient(P51D, 0.2, 0, 0.71) / P51D.drag.cd0
    const bf = dragCoefficient(BF109G6, 0.2, 0, 0.71) / BF109G6.drag.cd0
    expect(p51).toBeLessThan(bf)
  })

  it('側滑增加阻力', () => {
    expect(dragCoefficient(P51D, 0.3, 10 * DEG, 0.3)).toBeGreaterThan(
      dragCoefficient(P51D, 0.3, 0, 0.3),
    )
  })
})

describe('controlEffectiveness', () => {
  it('動壓低於 qRef 時權限為滿', () => {
    expect(controlEffectiveness(1.5, 7560, 3000)).toBe(1)
  })

  it('動壓等於 qRef 時權限為滿', () => {
    expect(controlEffectiveness(1.5, 7560, 7560)).toBeCloseTo(1, 10)
  })

  it('動壓高於 qRef 時權限衰減', () => {
    expect(controlEffectiveness(1.5, 7560, 20000)).toBeLessThan(1)
  })

  it('Bf 109 在 650 km/h 的副翼權限遠低於 P-51', () => {
    const q650 = 0.5 * 1.225 * (650 / 3.6) ** 2
    const bf = controlEffectiveness(
      BF109G6.controlStiffening.aileronK, BF109G6.controlStiffening.qRef, q650,
    )
    const p51 = controlEffectiveness(
      P51D.controlStiffening.aileronK, P51D.controlStiffening.qRef, q650,
    )
    expect(bf).toBeLessThan(p51 * 0.45)
  })
})

describe('computeAeroState', () => {
  it('純前向飛行時迎角與側滑為 0', () => {
    const s = computeAeroState(new Vector3(0, 0, -150), air(0), aeroOut())
    expect(s.alpha).toBeCloseTo(0, 12)
    expect(s.beta).toBeCloseTo(0, 12)
    expect(s.tas).toBeCloseTo(150, 10)
  })

  it('動壓為 ½ρV²', () => {
    const a = air(0)
    const s = computeAeroState(new Vector3(0, 0, -150), a, aeroOut())
    expect(s.qbar).toBeCloseTo(0.5 * a.density * 150 * 150, 6)
  })

  it('馬赫數為 tas / 音速', () => {
    const a = air(6000)
    const s = computeAeroState(new Vector3(0, 0, -200), a, aeroOut())
    expect(s.mach).toBeCloseTo(200 / a.soundSpeed, 10)
  })

  it('零速度不產生 NaN', () => {
    const s = computeAeroState(new Vector3(0, 0, 0), air(0), aeroOut())
    expect(Number.isFinite(s.alpha)).toBe(true)
    expect(Number.isFinite(s.beta)).toBe(true)
    expect(s.qbar).toBe(0)
  })
})

describe('aeroForceMoment', () => {
  const vel = new Vector3(0, -8, -160) // 略帶正迎角
  const a = air(0)
  const NO_SPIN = new Vector3()

  it('升力方向為機體 +Y（正迎角時向上）', () => {
    const s = computeAeroState(vel, a, aeroOut())
    const fm = aeroForceMoment(P51D, s, NO_SPIN, NO_CONTROL, false, fmOut())
    expect(fm.force.y).toBeGreaterThan(0)
  })

  it('阻力方向為機體 +Z（減速）', () => {
    const s = computeAeroState(vel, a, aeroOut())
    const fm = aeroForceMoment(P51D, s, NO_SPIN, NO_CONTROL, false, fmOut())
    expect(fm.force.z).toBeGreaterThan(0)
  })

  it('正迎角產生機首下壓力矩（縱向靜穩定）', () => {
    const s = computeAeroState(new Vector3(0, -20, -160), a, aeroOut())
    const fm = aeroForceMoment(P51D, s, NO_SPIN, NO_CONTROL, false, fmOut())
    // 機首下壓 = 繞機體 +X 軸的負力矩
    expect(fm.moment.x).toBeLessThan(0)
  })

  it('正升降舵指令產生機首上仰力矩', () => {
    const s = computeAeroState(new Vector3(0, 0, -160), a, aeroOut())
    const up = aeroForceMoment(P51D, s, NO_SPIN, { ...NO_CONTROL, elevator: 1 }, false, fmOut())
    const neutral = aeroForceMoment(P51D, s, NO_SPIN, NO_CONTROL, false, fmOut())
    expect(up.moment.x).toBeGreaterThan(neutral.moment.x)
  })

  it('正副翼指令產生向右滾轉力矩（機體 −Z 方向為正）', () => {
    const s = computeAeroState(new Vector3(0, 0, -160), a, aeroOut())
    const fm = aeroForceMoment(P51D, s, NO_SPIN, { ...NO_CONTROL, aileron: 1 }, false, fmOut())
    expect(fm.moment.z).toBeLessThan(0) // M.z = −l，正 l（右滾）→ 負 M.z
  })

  it('滾轉阻尼抵抗既有滾轉率', () => {
    const s = computeAeroState(new Vector3(0, 0, -160), a, aeroOut())
    // 機體 −Z 方向的角速度 = 正滾轉率 p
    const fm = aeroForceMoment(P51D, s, new Vector3(0, 0, -3), NO_CONTROL, false, fmOut())
    expect(fm.moment.z).toBeGreaterThan(0) // 阻尼力矩與滾轉方向相反
  })

  it('零速度時力與力矩皆為 0', () => {
    const s = computeAeroState(new Vector3(0, 0, 0), a, aeroOut())
    const fm = aeroForceMoment(P51D, s, NO_SPIN, NO_CONTROL, false, fmOut())
    expect(fm.force.length()).toBeCloseTo(0, 10)
    expect(fm.moment.length()).toBeCloseTo(0, 10)
  })

  it('寫入傳入的 out 並回傳同一參考（零配置）', () => {
    const out = fmOut()
    const s = computeAeroState(vel, a, aeroOut())
    expect(aeroForceMoment(P51D, s, NO_SPIN, NO_CONTROL, false, out)).toBe(out)
  })
})
