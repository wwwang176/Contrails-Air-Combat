import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  createDiagnostics, createFlightState, stepDynamics,
} from '../../src/physics/dynamics'
import {
  alphaForCl, maxLevelSpeed, specificExcessPower, stallSpeed,
} from '../../src/analysis/envelope'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { atmosphere } from '../../src/physics/atmosphere'
import { DEG, G0, clamp } from '../../src/core/math'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import type { AircraftSpec } from '../../src/specs/types'
import type { AirData, Controls, FlightState } from '../../src/physics/types'

const DT = 1 / 240
const air: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }

/** 比能量 Es = h + V²/(2g)，公尺。 */
function specificEnergy(altitude: number, speed: number): number {
  return altitude + (speed * speed) / (2 * G0)
}

/**
 * 建立指定高度、速度、過載、姿態的狀態。
 *
 * 先由目標過載反解迎角 α（與求解器 dragAt 用的是同一條 CL = n·W/qS 公式），
 * 再以「路徑角 γ + α」構造機身姿態四元數 R，將機體座標下的相對風
 * velBody = (0, −V sinα, −V cosα) 一次性旋轉到世界座標：velWorld = R·velBody。
 *
 * 這個構造的關鍵性質：對任意單位四元數 R，stepDynamics 內部一定會用
 * R⁻¹ 把 velWorld 轉回機體座標算迎角，而 R⁻¹(R·v) = v 恆成立——
 * 所以無論 γ、bank 取什麼值，積分器量到的迎角永遠精確等於這裡指定的
 * α，n、cl 也就永遠與求解器一致。這保證了「姿態不同、Ps 應該仍然相等」
 * 這件事測的是物理本身，不是巧合湊出來的。
 *
 * 若姿態恆為恆等四元數（R = I），R⁻¹ 與 R 是同一個旋轉，任何把
 * `accel.applyQuaternion(orientation)` 寫反（例如誤用共軛或反向）的
 * 符號錯誤在恆等姿態下完全測不出來。因此除了 γ=bank=0 的基準案例外，
 * 另外加入大角度爬升、俯衝、滾轉盤旋的案例，讓姿態四元數非平凡，
 * 真正跑過旋轉鏈。
 */
interface Case {
  spec: AircraftSpec
  altitude: number
  tas: number
  n: number
  /** 飛行路徑角，rad。正值爬升，負值俯衝。 */
  gamma?: number
  /** 滾轉角，rad，用於構造傾斜／盤旋姿態。 */
  bank?: number
  /** 案例標籤，未提供時視為平飛基準案例。 */
  attitude?: string
}

function stateAt(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  n: number,
  gamma = 0,
  bank = 0,
): FlightState {
  atmosphere(altitude, air)
  const qS = 0.5 * air.density * tas * tas * spec.wing.area
  const cl = (n * spec.mass * G0) / qS
  const alpha = alphaForCl(spec, cl)
  const theta = gamma + alpha

  const s = createFlightState(altitude, tas)
  const pitchQ = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), theta)
  const rollQ = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), bank)
  s.orientation.copy(pitchQ).multiply(rollQ)

  const velBody = new Vector3(0, -tas * Math.sin(alpha), -tas * Math.cos(alpha))
  s.velocity.copy(velBody).applyQuaternion(s.orientation)
  return s
}

describe('積分器 vs 求解器：Ps 一致性', () => {
  const CASES: Case[] = [
    // 平飛基準案例（γ=0，但姿態仍因配平攻角而非恆等四元數——見 stateAt 說明）
    { spec: P51D, altitude: 0, tas: 150, n: 1 },
    { spec: P51D, altitude: 3000, tas: 180, n: 1 },
    { spec: P51D, altitude: 7600, tas: 190, n: 1 },
    { spec: P51D, altitude: 3000, tas: 180, n: 3 },
    { spec: BF109G6, altitude: 0, tas: 140, n: 1 },
    { spec: BF109G6, altitude: 6300, tas: 175, n: 1 },
    { spec: BF109G6, altitude: 2000, tas: 160, n: 4 },
    // 爬升：機首大幅上仰（路徑角 +15°~+20°），姿態四元數非平凡
    { spec: P51D, altitude: 3000, tas: 170, n: 1, gamma: 20 * DEG, attitude: '爬升 20°' },
    { spec: BF109G6, altitude: 2000, tas: 150, n: 1, gamma: 15 * DEG, attitude: '爬升 15°' },
    // 俯衝：路徑角為負
    { spec: P51D, altitude: 3000, tas: 220, n: 1, gamma: -25 * DEG, attitude: '俯衝 25°' },
    { spec: BF109G6, altitude: 2000, tas: 200, n: 1, gamma: -20 * DEG, attitude: '俯衝 20°' },
    // 盤旋：大幅滾轉 + 過載，姿態同時含俯仰與滾轉兩個旋轉軸
    { spec: P51D, altitude: 3000, tas: 180, n: 3, bank: 50 * DEG, attitude: '盤旋 bank50° n=3' },
    { spec: BF109G6, altitude: 2000, tas: 160, n: 4, bank: 60 * DEG, attitude: '盤旋 bank60° n=4' },
  ]

  for (const c of CASES) {
    const gamma = c.gamma ?? 0
    const bank = c.bank ?? 0
    const label = c.attitude
      ? `${c.spec.name} @ ${c.altitude}m ${Math.round(c.tas * 3.6)}km/h n=${c.n} [${c.attitude}]`
      : `${c.spec.name} @ ${c.altitude}m ${Math.round(c.tas * 3.6)}km/h n=${c.n}`

    it(label, () => {
      const s = stateAt(c.spec, c.altitude, c.tas, c.n, gamma, bank)
      const diag = createDiagnostics()
      const before = specificEnergy(s.position.y, s.velocity.length())

      stepDynamics(c.spec, s, { aileron: 0, elevator: 0, rudder: 0, throttle: WEP_THROTTLE }, DT, diag)
      const after = specificEnergy(s.position.y, s.velocity.length())
      const measured = (after - before) / DT

      const expected = specificExcessPower(c.spec, c.altitude, c.tas, c.n, WEP_THROTTLE)

      expect(Number.isFinite(measured)).toBe(true)
      expect(measured).toBeCloseTo(expected, 0)
      expect(Math.abs(measured - expected)).toBeLessThan(Math.max(1, Math.abs(expected) * 0.03))
    })
  }
})

describe('積分器收斂至求解器的極速', () => {
  /**
   * 高度保持 PD 控制器，僅用於本測試。
   *
   * 【調整】brief 原始版本只回饋 (targetAlt−altitude) 與 vy 兩項，
   * 缺角速度阻尼；實測（見 task-16-report.md）P-51D @ 3000m 在該增益下
   * 俯仰角速度於 −3~+4 rad/s 間持續振盪、速度卡在 103 m/s（誤差 44%，
   * 遠超 2% 門檻），7600 m／Bf109 兩案例甚至發散到高度誤差達數千公尺。
   * 這是控制器本身缺乏阻尼造成的極限環，不是物理模型的問題——同一批
   * 狀態在「Ps 一致性」測試（不經過此控制器）全數通過，證明積分器與
   * 求解器本身一致。加入角速度回饋項（kQ）壓制振盪後，三案例都能在
   * 300 秒內收斂到 2% 誤差內（實測 0.14%／1.40%／0.09%，見報告）。
   * 這是調整測試用控制器的增益，不是調整任何 spec 參數或放寬物理容差。
   */
  function altitudeHold(targetAlt: number, altitude: number, vy: number, pitchRate: number): number {
    return clamp(0.0005 * (targetAlt - altitude) - 0.02 * vy - 0.3 * pitchRate, -1, 1)
  }

  const CASES = [
    { spec: P51D, altitude: 3000 },
    { spec: P51D, altitude: 7600 },
    { spec: BF109G6, altitude: 6300 },
  ]

  for (const c of CASES) {
    it(`${c.spec.name} @ ${c.altitude}m 平飛極速誤差 < 2%`, () => {
      const target = maxLevelSpeed(c.spec, c.altitude)
      // 由失速速度上方起飛，全油門加速 300 秒
      const s = createFlightState(c.altitude, stallSpeed(c.spec, c.altitude, 1) * 1.3)
      const diag = createDiagnostics()
      const controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: WEP_THROTTLE }

      const steps = Math.round(300 / DT)
      for (let i = 0; i < steps; i++) {
        controls.elevator = altitudeHold(c.altitude, s.position.y, s.velocity.y, s.angularVelocity.x)
        stepDynamics(c.spec, s, controls, DT, diag)
      }

      // 高度必須保持住，否則測的不是平飛極速
      expect(Math.abs(s.position.y - c.altitude)).toBeLessThan(300)

      const err = Math.abs(s.velocity.length() - target) / target
      expect(err).toBeLessThan(0.02)
    })
  }
})

describe('積分器長時間穩定性', () => {
  it('連續機動 120 秒後狀態仍為有限值且四元數正規化', () => {
    const s = createFlightState(5000, 180)
    const diag = createDiagnostics()
    const steps = Math.round(120 / DT)
    for (let i = 0; i < steps; i++) {
      const t = i * DT
      stepDynamics(P51D, s, {
        aileron: Math.sin(t * 0.7),
        elevator: 0.4 * Math.sin(t * 0.31) + 0.2,
        rudder: 0.2 * Math.sin(t * 0.17),
        throttle: WEP_THROTTLE,
      }, DT, diag)
      if (s.position.y < 100) s.position.y = 5000 // 撞海即重置高度，維持測試進行
    }
    expect(Number.isFinite(s.position.length())).toBe(true)
    expect(Number.isFinite(s.velocity.length())).toBe(true)
    expect(s.orientation.length()).toBeCloseTo(1, 9)
    expect(s.angularVelocity.length()).toBeLessThan(20)
  })

  it('無控輸入時姿態不會自發發散（靜穩定）', () => {
    const s = createFlightState(5000, 170)
    s.angularVelocity.set(0.3, 0.2, 0.4)
    const diag = createDiagnostics()
    const steps = Math.round(20 / DT)
    for (let i = 0; i < steps; i++) {
      stepDynamics(P51D, s, { aileron: 0, elevator: 0, rudder: 0, throttle: 1 }, DT, diag)
    }
    // 阻尼應使角速度大幅衰減
    expect(s.angularVelocity.length()).toBeLessThan(0.5)
  })
})

describe('海面碰撞前提', () => {
  it('無升力時飛機會下墜至海平面以下（供 Task 20 的墜毀判定使用）', () => {
    const s = createFlightState(200, 0)
    const diag = createDiagnostics()
    const noWing: AircraftSpec = { ...P51D, wing: { ...P51D.wing, area: 0 } }
    for (let i = 0; i < Math.round(10 / DT); i++) {
      stepDynamics(noWing, s, { aileron: 0, elevator: 0, rudder: 0, throttle: 0 }, DT, diag)
    }
    expect(s.position.y).toBeLessThan(0)
  })
})
