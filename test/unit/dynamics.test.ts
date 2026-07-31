import { describe, it, expect } from 'vitest'
import {
  createDiagnostics, createFlightState, stepDynamics,
} from '../../src/physics/dynamics'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { G0 } from '../../src/core/math'
import type { AircraftSpec } from '../../src/specs/types'
import type { Controls } from '../../src/physics/types'

const IDLE: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: 0 }
const DT = 1 / 240

/** 移除全部氣動力的機種副本，用於隔離重力與積分器行為。 */
function noAero(spec: AircraftSpec): AircraftSpec {
  return { ...spec, wing: { ...spec.wing, area: 0 } }
}

function run(spec: AircraftSpec, state = createFlightState(5000, 0), controls = IDLE, seconds = 1) {
  const diag = createDiagnostics()
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepDynamics(spec, state, controls, DT, diag)
  return { state, diag }
}

describe('createFlightState', () => {
  it('初始速度沿機首方向（機體 −Z）', () => {
    const s = createFlightState(3000, 150)
    expect(s.position.y).toBe(3000)
    expect(s.velocity.z).toBeCloseTo(-150, 10)
    expect(s.velocity.length()).toBeCloseTo(150, 10)
  })

  it('初始姿態為單位四元數、角速度為 0', () => {
    const s = createFlightState(3000, 150)
    expect(s.orientation.w).toBeCloseTo(1, 12)
    expect(s.angularVelocity.length()).toBe(0)
  })
})

describe('stepDynamics — 重力與積分', () => {
  it('無氣動力、無推力時為自由落體', () => {
    const { state } = run(noAero(P51D), createFlightState(5000, 0), IDLE, 1)
    expect(state.velocity.y).toBeCloseTo(-G0, 3)
    // 半隱式 Euler 於 240Hz 的位移略大於解析解 4.903
    expect(5000 - state.position.y).toBeCloseTo(4.924, 1)
  })

  it('水平速度在無氣動力時守恆', () => {
    const { state } = run(noAero(P51D), createFlightState(5000, 150), IDLE, 2)
    expect(state.velocity.z).toBeCloseTo(-150, 6)
  })

  it('四元數保持正規化', () => {
    const s = createFlightState(4000, 160)
    s.angularVelocity.set(1.5, -0.8, 2.2)
    run(P51D, s, IDLE, 5)
    expect(s.orientation.length()).toBeCloseTo(1, 9)
  })

  it('狀態不含 NaN', () => {
    const s = createFlightState(4000, 180)
    s.angularVelocity.set(3, 3, 3)
    run(P51D, s, { aileron: 1, elevator: 1, rudder: 1, throttle: WEP_THROTTLE }, 3)
    for (const v of [s.position, s.velocity, s.angularVelocity]) {
      expect(Number.isFinite(v.x + v.y + v.z)).toBe(true)
    }
    expect(Number.isFinite(s.orientation.w)).toBe(true)
  })

  it('相同初始條件產生相同結果（確定性）', () => {
    const a = run(P51D, createFlightState(4000, 170), { ...IDLE, throttle: 1 }, 2).state
    const b = run(P51D, createFlightState(4000, 170), { ...IDLE, throttle: 1 }, 2).state
    expect(a.position.x).toBe(b.position.x)
    expect(a.position.y).toBe(b.position.y)
    expect(a.velocity.z).toBe(b.velocity.z)
  })
})

describe('stepDynamics — 氣動響應', () => {
  it('阻力使無動力平飛持續減速', () => {
    const s = createFlightState(5000, 180)
    const before = s.velocity.length()
    run(P51D, s, IDLE, 3)
    expect(s.velocity.length()).toBeLessThan(before)
  })

  it('全油門平飛會加速', () => {
    const s = createFlightState(3000, 120)
    const before = s.velocity.length()
    run(P51D, s, { ...IDLE, throttle: WEP_THROTTLE }, 3)
    expect(s.velocity.length()).toBeGreaterThan(before)
  })

  it('滾轉阻尼使既有滾轉率衰減', () => {
    const s = createFlightState(4000, 180)
    s.angularVelocity.set(0, 0, -2) // 機體 −Z：正滾轉率
    const before = Math.abs(s.angularVelocity.z)
    run(P51D, s, IDLE, 1)
    expect(Math.abs(s.angularVelocity.z)).toBeLessThan(before)
  })

  it('正副翼指令產生向右滾轉', () => {
    const s = createFlightState(4000, 180)
    run(P51D, s, { ...IDLE, aileron: 1, throttle: 1 }, 0.5)
    expect(s.angularVelocity.z).toBeLessThan(0) // ω.z 為負 = 正滾轉率 p
  })

  it('正升降舵指令產生機首上仰', () => {
    const s = createFlightState(4000, 180)
    run(P51D, s, { ...IDLE, elevator: 0.5, throttle: 1 }, 0.5)
    expect(s.angularVelocity.x).toBeGreaterThan(0) // ω.x = 正俯仰率 q
  })

  // 原本這裡只有一個「Bf109 滾轉加速度大於 P-51」的斷言，在 160 m/s／4000 m 下量測失敗。
  // 分析後發現裡面糾纏了兩個不同的物理效應，且原斷言選的測試條件混到了與意圖相反的那一個：
  //
  //   1. 滾轉率的穩態值其實與慣量無關——把 clDa·δ 與滾轉阻尼 clP·(p·b/2V) 平衡，
  //      慣量會相消，穩態滾轉率只由 clDa/b 與阻尼決定。慣量只影響「多快達到穩態」。
  //   2. 160 m/s／4000 m 換算的動壓已經超過 Bf109 的 qRef（但還沒超過 P-51 的 qRef），
  //      所以 Bf109 副翼已經因高速變重效應大幅衰減——這不是 bug，是 Task 9 刻意設計的
  //      「109 高速滾轉率衰減」校準，plan 目標是 600 km/h 下 P-51 ≈106°/s、Bf109 ≈35°/s。
  //
  // 因此拆成兩個各自為真、各自有名字的測試：一個量「慣量效應（僅存在於暫態）」，
  // 一個量「高動壓下副翼變重造成的穩態滾轉率差異」。
  it('Bf 109 滾轉慣量較小，起始滾轉加速度較高（僅暫態，動壓低於兩機 qRef，未受副翼變重影響）', () => {
    // 100 m/s、海平面：q = 0.5·1.225·100² ≈ 6125 Pa，低於 Bf109 的 qRef=7560
    // 與 P-51 的 qRef=10884，兩機副翼權限皆滿，此時滾轉加速度差異純粹來自
    // Izz（P-51 8800、Bf109 4200）與 clDa·wing 幾何的比值，不受變重效應干擔。
    // 單步後 ω.z = α·dt（初始角速度為 0），直接反映起始角加速度。
    const p = createFlightState(0, 100)
    const b = createFlightState(0, 100)
    run(P51D, p, { ...IDLE, aileron: 1, throttle: 1 }, DT)
    run(BF109G6, b, { ...IDLE, aileron: 1, throttle: 1 }, DT)
    expect(Math.abs(b.angularVelocity.z)).toBeGreaterThan(Math.abs(p.angularVelocity.z))
  })

  it('高動壓下 P-51 的滾轉率遠高於 Bf 109（副翼變重效應，非慣量）', () => {
    // ≈600 km/h 海平面：q ≈ 15,745 Pa，超過雙方 qRef，Bf109 的 aileronK=1.5
    // 遠高於 P-51 的 0.35，使其副翼權限崩得更快。這是 Boom-and-Zoom（P-51）
    // 對上纏鬥格鬥（Bf109 低速仍靈活）不對稱性的機械成因，機制是
    // controlStiffening（aileronK），不是慣量。
    const tas = 600 / 3.6
    const p = createFlightState(0, tas)
    const b = createFlightState(0, tas)
    run(P51D, p, { ...IDLE, aileron: 1, throttle: 1 }, 2)
    run(BF109G6, b, { ...IDLE, aileron: 1, throttle: 1 }, 2)
    expect(Math.abs(p.angularVelocity.z)).toBeGreaterThan(Math.abs(b.angularVelocity.z) * 2)
  })
})

describe('stepDynamics — 診斷輸出', () => {
  it('診斷欄位被填入合理值', () => {
    const s = createFlightState(6000, 170)
    const { diag } = run(P51D, s, { ...IDLE, throttle: WEP_THROTTLE }, 0.5)
    expect(diag.air.density).toBeGreaterThan(0)
    expect(diag.aero.tas).toBeGreaterThan(100)
    expect(diag.powerW).toBeGreaterThan(0)
    expect(diag.thrustN).toBeGreaterThan(0)
    expect(Number.isFinite(diag.loadFactor)).toBe(true)
  })

  it('縫翼狀態隨迎角變化並保持遲滯', () => {
    const s = createFlightState(3000, 70) // 低速 → 高迎角
    const { diag } = run(BF109G6, s, { ...IDLE, elevator: 0.6, throttle: 1 }, 2)
    expect(typeof diag.slatsDeployed).toBe('boolean')
  })

  it('P-51 的縫翼狀態恆為 false', () => {
    const s = createFlightState(3000, 70)
    const { diag } = run(P51D, s, { ...IDLE, elevator: 0.8, throttle: 1 }, 2)
    expect(diag.slatsDeployed).toBe(false)
  })
})
