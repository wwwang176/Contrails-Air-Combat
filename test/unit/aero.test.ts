import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  liftCoefficient, dragCoefficient, inducedDragFactor, controlEffectiveness,
  lowSpeedEffectiveness, stallDynamicPressure, LOW_SPEED_KNEE,
  updateSlatState, computeAeroState, aeroForceMoment,
} from '../../src/physics/aero'
import { stallSpeed } from '../../src/analysis/envelope'
import { atmosphere } from '../../src/physics/atmosphere'
import { derivedClMax } from '../../src/specs/types'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { DEG } from '../../src/core/math'
import type { AeroState, AirData, ForceMoment } from '../../src/physics/types'
import type { AircraftSpec } from '../../src/specs/types'

const air = (h: number): AirData =>
  atmosphere(h, { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 })
const aeroOut = (): AeroState => ({ tas: 0, alpha: 0, beta: 0, qbar: 0, mach: 0 })
const fmOut = (): ForceMoment => ({ force: new Vector3(), moment: new Vector3() })
const NO_CONTROL = { aileron: 0, elevator: 0, rudder: 0, throttle: 0, brake: 0 }

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

  it('升力曲線在整個迎角範圍內連續（兩機種 × 縫翼開合，−180°~180°）', () => {
    const cases: Array<[AircraftSpec, boolean, string]> = [
      [P51D, false, 'P-51D'],
      [BF109G6, false, 'Bf 109 淨形'],
      [BF109G6, true, 'Bf 109 縫翼展開'],
    ]
    const STEP = 0.001 // rad，約 0.057°
    for (const [spec, slats, name] of cases) {
      const clMax = derivedClMax(spec, slats)
      // 門檻依 spec 欄位算出，不寫死常數：若寫死（例如 0.01），一旦有人
      // 把 stallBlend 調短（如 5°），失速崩塌段本身的斜率就會逼近或超過
      // 寫死的門檻，使測試在「沒有真正不連續」時也失敗——門檻必須隨
      // stallBlend 縮放。真正的結構性跳變（縮放前實測 0.098~0.181）
      // 遠大於任何合理 stallBlend 下的斜率，因此仍可清楚區分兩者。
      //   線性段斜率 = clAlpha
      //   崩塌段斜率上限 = 1.5 × (1 − postStallFactor) × CL_max / stallBlend
      //     （smoothstep 導數 6t(1−t) 於 t=0.5 取最大值 1.5，
      //      乘上崩塌段的振幅變化量 (1−postStallFactor)·CL_max，除以 stallBlend）
      // 深失速段（縮放平板模型）在銜接點的斜率恆低於崩塌段斜率上限
      // （已用獨立腳本核對三種情境皆然，見 task-10-report.md），故取
      // 兩者中較大者乘以 3 倍安全係數作為門檻。
      const linearSlope = spec.lift.clAlpha
      const blendSlope = (1.5 * (1 - spec.lift.postStallFactor) * clMax) / spec.lift.stallBlend
      const threshold = 3 * Math.max(linearSlope, blendSlope) * STEP

      let prev = liftCoefficient(spec, -Math.PI, slats)
      for (let a = -Math.PI + STEP; a <= Math.PI; a += STEP) {
        const cl = liftCoefficient(spec, a, slats)
        expect(Math.abs(cl - prev), `${name} @ α=${(a * 180 / Math.PI).toFixed(2)}°`).toBeLessThan(threshold)
        prev = cl
      }
    }
  })

  it('深失速沿用平板模型：不發散、不超過 CL_max、正確變號、α→±90°/±180° 時歸零', () => {
    const cases: Array<[AircraftSpec, boolean, string]> = [
      [P51D, false, 'P-51D'],
      [BF109G6, false, 'Bf 109 淨形'],
      [BF109G6, true, 'Bf 109 縫翼展開'],
    ]
    for (const [spec, slats, name] of cases) {
      const clMax = derivedClMax(spec, slats)
      // blendEnd 的絕對迎角（= 失速崩塌段結束、深失速平板模型開始之處）。
      // 不使用硬編碼角度，直接由 spec 欄位推導，與 liftCoefficient 內部一致。
      // 正負兩側對稱使用同一個量值（critMag、stallBlend 不分邊）。
      const alphaCritEff = spec.lift.alphaCrit + (slats ? spec.lift.slatAlphaBonus : 0)
      // 深失速段的邊界對稱於 alphaZero，不是對稱於 0：liftCoefficient 以
      // rel = α − alphaZero 判斷分支，|rel| ≥ blendEnd 才進入深失速。
      // 正側 alphaZero + blendEnd 恰等於 alphaCritEff + stallBlend（代入即得），
      // 負側卻是 alphaZero − blendEnd，兩者不互為相反數。
      // 【修正】原本負側用 −deepStallStart（P-51D 為 −23.5°）當下界，
      // 那個角度仍落在失速崩塌段內，於是 peakNeg 量到的是崩塌段的一部分
      // 而非深失速峰值；正確下界是 alphaZero − blendEnd（P-51D 為 −30°）。
      const blendEnd = alphaCritEff - spec.lift.alphaZero + spec.lift.stallBlend
      const deepStallStart = spec.lift.alphaZero + blendEnd
      const deepStallStartNeg = spec.lift.alphaZero - blendEnd

      let peakPos = 0
      for (let a = deepStallStart; a <= Math.PI; a += 0.001) {
        peakPos = Math.max(peakPos, Math.abs(liftCoefficient(spec, a, slats)))
      }
      let peakNeg = 0
      for (let a = -Math.PI; a <= deepStallStartNeg; a += 0.001) {
        peakNeg = Math.max(peakNeg, Math.abs(liftCoefficient(spec, a, slats)))
      }
      // 深失速峰值必須低於該機的 CL_max，否則失速後反而比失速前更能產生
      // 升力，物理上不成立。舊的 1.05 上限是未縮放 |sin2α| 的數學上界
      // （該公式恆 ≤1 只是公式的巧合，不是物理要求），已作廢；縮放後的
      // 峰值（1.13~1.22）落在平板理論在 40°~45° 攻角的真實峰值範圍，
      // 反而比舊公式更符合物理。
      expect(peakPos, `${name} 正側峰值 < CL_max`).toBeLessThan(clMax)
      expect(peakNeg, `${name} 負側峰值 < CL_max`).toBeLessThan(clMax)
      // 安全網：守護 postStallFactor·CL_max / flatEnd 的縮放本身不暴衝
      // （並非物理斷言）。flatEnd = |sin(2·blendEnd 絕對迎角)|，當 blendEnd
      // 趨近 0° 或 90° 時 flatEnd → 0，縮放才可能暴衝；45° 反而是 flatEnd
      // 的最大值（=1），是縮放最溫和、不是最危險的情況。
      expect(peakPos, `${name} 正側縮放安全網 < 1.5`).toBeLessThan(1.5)
      expect(peakNeg, `${name} 負側縮放安全網 < 1.5`).toBeLessThan(1.5)

      // 方向必須與真實平板模型 sin(2α) 同號。尾滑、錘頭失速、失速尾旋等
      // 姿態會讓 alphaFrom（atan2 全範圍 ±180°）進到 |α|>90°，若升力方向
      // 反了，會變成主動對抗改出而非幫助改出。
      for (const aDeg of [95, 120, 135, 150, -95, -120, -135, -150]) {
        const a = aDeg * DEG
        const cl = liftCoefficient(spec, a, slats)
        expect(Math.sign(cl), `${name} @ α=${aDeg}°`).toBe(Math.sign(Math.sin(2 * a)))
      }
      // α = ±90°、±180° 時完全失去升力（sin 2α 在此皆為 0）
      for (const aDeg of [90, 180, -90, -180]) {
        expect(Math.abs(liftCoefficient(spec, aDeg * DEG, slats)), `${name} @ α=${aDeg}°`).toBeLessThan(1e-9)
      }
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

  // cl = 0 以隔離誘導阻力，避免污染壓縮性效應的比較（見 task-10-report.md 落差記錄）。
  it('P-51 的臨界馬赫數高於 Bf 109（俯衝優勢）', () => {
    // 0.68（Bf 109）< M < 0.72（P-51）：此區間只有 Bf 109 該吃到壓縮性阻力
    const M = 0.7
    const p51Rise = dragCoefficient(P51D, 0, 0, M) - dragCoefficient(P51D, 0, 0, 0)
    const bfRise = dragCoefficient(BF109G6, 0, 0, M) - dragCoefficient(BF109G6, 0, 0, 0)
    expect(p51Rise).toBe(0)
    expect(bfRise).toBeGreaterThan(0)
  })

  it('超過兩者臨界馬赫後，P-51 的壓縮性阻力增幅仍較小', () => {
    // 只比較「相對於自身 cd0 的增幅」，不混入誘導阻力
    const M = 0.8
    const p51Rel = (dragCoefficient(P51D, 0, 0, M) - P51D.drag.cd0) / P51D.drag.cd0
    const bfRel = (dragCoefficient(BF109G6, 0, 0, M) - BF109G6.drag.cd0) / BF109G6.drag.cd0
    expect(p51Rel).toBeLessThan(bfRel)
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

  it('正方向舵指令產生機首右偏力矩', () => {
    const s = computeAeroState(new Vector3(0, 0, -160), a, aeroOut())
    const right = aeroForceMoment(P51D, s, NO_SPIN, { ...NO_CONTROL, rudder: 1 }, false, fmOut())
    const neutral = aeroForceMoment(P51D, s, NO_SPIN, NO_CONTROL, false, fmOut())
    // 機體軸 Y = 座艙上方，偏航繞 Y 軸；標準氣動軸 n>0（機首右偏，
    // cnDr 依專案慣例為正）經 stdToBody 得 out.moment.y = −n，故正舵
    // 指令使 moment.y 變得更負。
    expect(right.moment.y).toBeLessThan(neutral.moment.y)
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

describe('stallDynamicPressure', () => {
  /**
   * 【這是整個設計成立的關鍵性質】1 G 失速時的動壓與高度無關：
   *
   *   Vs(1G) = √( 2W / (ρ·S·CLmax) )
   *   q      = ½ρ·Vs² = W / (S·CLmax)      ← ρ 消掉了
   *
   * 所以拐點是每機種一個常數，不必查大氣、不必開根號。而且它自動處理
   * 高度——9,000 m 要 268 km/h 才有同樣的動壓，這正是真實情況。
   */
  it('與高度無關：對照 stallSpeed() 在四個高度算出的 ½ρVs²', () => {
    for (const spec of [P51D, BF109G6]) {
      const expected = stallDynamicPressure(spec)
      for (const alt of [0, 3000, 6000, 9000]) {
        const vs = stallSpeed(spec, alt, 1)
        const a = air(alt)
        expect(0.5 * a.density * vs * vs).toBeCloseTo(expected, 6)
      }
    }
  })

  /**
   * 【CL_max 的慣例必須與 stallSpeed() 對齊】上面那條測試同時驗了這件事：
   * 若這裡用了不含縫翼加成的 CL_max，109 的值會與 stallSpeed() 差一截，
   * 對照就會失敗。這不是巧合，是刻意讓兩者互相釘死（spec §4.3）。
   */
  it('等於 W / (S · CLmax)，且兩台的實測值', () => {
    expect(stallDynamicPressure(P51D)).toBeCloseTo(
      (P51D.mass * 9.80665) / (P51D.wing.area * derivedClMax(P51D, P51D.lift.slatAlphaBonus > 0)),
      9,
    )
    // 實測值，供日後改參數時一眼看出量級是否跑掉
    expect(stallDynamicPressure(P51D)).toBeCloseTo(1289.9, 0)
    expect(stallDynamicPressure(BF109G6)).toBeCloseTo(1239.0, 0)
  })
})

describe('lowSpeedEffectiveness', () => {
  const knee = (spec: AircraftSpec) => LOW_SPEED_KNEE * stallDynamicPressure(spec)

  it('拐點以上恆為 1', () => {
    for (const spec of [P51D, BF109G6]) {
      const q = knee(spec)
      expect(lowSpeedEffectiveness(spec, q)).toBe(1)
      expect(lowSpeedEffectiveness(spec, q * 1.5)).toBe(1)
      expect(lowSpeedEffectiveness(spec, q * 100)).toBe(1)
    }
  })

  it('拐點以下等於 q / q_low', () => {
    for (const spec of [P51D, BF109G6]) {
      const q = knee(spec)
      expect(lowSpeedEffectiveness(spec, q * 0.5)).toBeCloseTo(0.5, 12)
      expect(lowSpeedEffectiveness(spec, q * 0.25)).toBeCloseTo(0.25, 12)
    }
  })

  it('在拐點連續（左右極限相等）', () => {
    for (const spec of [P51D, BF109G6]) {
      const q = knee(spec)
      const below = lowSpeedEffectiveness(spec, q * (1 - 1e-9))
      expect(below).toBeCloseTo(1, 8)
      expect(lowSpeedEffectiveness(spec, q)).toBe(1)
    }
  })

  it('q = 0 時為 0，不是 NaN', () => {
    // 【為什麼不必設下限】力矩 = 動壓 × 面積 × 係數，動壓為 0 時力矩本來
    // 就是 0。乘數再小也不會除出無限大（spec §4.5）。
    for (const spec of [P51D, BF109G6]) {
      expect(lowSpeedEffectiveness(spec, 0)).toBe(0)
      expect(Number.isFinite(lowSpeedEffectiveness(spec, 0))).toBe(true)
    }
  })

  it('單調遞增', () => {
    const q = knee(P51D)
    let prev = -1
    for (let f = 0; f <= 1.5; f += 0.05) {
      const v = lowSpeedEffectiveness(P51D, q * f)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  /**
   * 【拐點以上到高速變重之間有一大段完全不受影響】P-51D 的 q_low 是
   * 1858 Pa、q_ref 是 10884 Pa，相隔 5.9 倍。兩個機制不會同時作用。
   */
  it('低速端與高速端的作用區間不重疊', () => {
    for (const spec of [P51D, BF109G6]) {
      expect(knee(spec)).toBeLessThan(spec.controlStiffening.qRef)
      // 在兩者中間取一點，兩個乘數都應該是 1
      const mid = Math.sqrt(knee(spec) * spec.controlStiffening.qRef)
      expect(lowSpeedEffectiveness(spec, mid)).toBe(1)
      expect(controlEffectiveness(
        spec.controlStiffening.elevatorK, spec.controlStiffening.qRef, mid,
      )).toBe(1)
    }
  })
})
