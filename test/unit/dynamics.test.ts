import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  createDiagnostics, createFlightState, stepDynamics,
} from '../../src/physics/dynamics'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { lowSpeedEffectiveness } from '../../src/physics/aero'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { DEG, G0, RAD } from '../../src/core/math'
import type { AircraftSpec } from '../../src/specs/types'
import type { Controls } from '../../src/physics/types'

const IDLE: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: 0, brake: 0 }
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
    // 半隱式 Euler（先更新速度、用新速度更新位置）在等加速度下的解析解是
    // Σ(g·n·dt)·dt = g·dt²·N(N+1)/2，N=240、dt=1/240 時為 4.92375552…，
    // 明顯大於純解析自由落體的 4.903，也明顯不同於顯式 Euler（先位置後速度）
    // 會給出的 4.8829（少了最後一步的速度增量）。用 toBeCloseTo(4.92376, 4)
    // 把容許誤差收緊到 0.00005，遠小於兩種積分順序 0.041 的差距，讓測試真正
    // 鎖定「先速度後位置」這個積分順序，而不只是「數量級對就好」。
    expect(5000 - state.position.y).toBeCloseTo(4.92376, 4)
  })

  it('水平速度在無氣動力時守恆', () => {
    const { state } = run(noAero(P51D), createFlightState(5000, 150), IDLE, 2)
    expect(state.velocity.z).toBeCloseTo(-150, 6)
  })

  it('比能 h + V²/(2g) 在無氣動力、無推力（純重力）下守恆', () => {
    // 5000m、150 m/s 水平，noAero + IDLE，跑 1200 步（5 秒）。
    // 實測相對漂移 −1.6618e-5（見任務報告），純屬半隱式 Euler 在等加速度下
    // 的離散化誤差，數量級遠小於 1（門檻取 1e-4，留約 6 倍安全邊際）。
    const s = createFlightState(5000, 150)
    const diag = createDiagnostics()
    const h0 = s.position.y
    const v0 = s.velocity.length()
    const e0 = h0 + (v0 * v0) / (2 * G0)
    const steps = Math.round(5 / DT)
    for (let i = 0; i < steps; i++) stepDynamics(noAero(P51D), s, IDLE, DT, diag)
    const h1 = s.position.y
    const v1 = s.velocity.length()
    const e1 = h1 + (v1 * v1) / (2 * G0)
    const relDrift = Math.abs((e1 - e0) / e0)
    expect(relDrift).toBeLessThan(1e-4)
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
    run(P51D, s, { aileron: 1, elevator: 1, rudder: 1, throttle: WEP_THROTTLE, brake: 0 }, 3)
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
    run(P51D, s, { ...IDLE, aileron: 1, throttle: 1, brake: 0 }, 0.5)
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
    run(P51D, p, { ...IDLE, aileron: 1, throttle: 1, brake: 0 }, DT)
    run(BF109K4, b, { ...IDLE, aileron: 1, throttle: 1, brake: 0 }, DT)
    expect(Math.abs(b.angularVelocity.z)).toBeGreaterThan(Math.abs(p.angularVelocity.z))
  })

  it('高動壓下 P-51 的滾轉率遠高於 Bf 109（副翼變重效應，非慣量）', () => {
    // ≈600 km/h 海平面：初始 qbar = 0.5·RHO0·V² ≈ 17,014 Pa（RHO0 由
    // atmosphere.ts 精算，非 1.225 的四捨五入值）。滿舵 2 秒內因阻力減速，
    // 實測 t=2s 時 qbar 降到 P-51 ≈16,774 Pa、Bf109 ≈16,450 Pa（stepDynamics
    // 實測值，非解析估計）。全程動壓皆遠超雙方 qRef（P-51 10,884 Pa、
    // Bf109 7,560 Pa），Bf109 的 aileronK=1.5 遠高於 P-51 的 0.35，
    // 使其副翼權限崩得更快。這是 Boom-and-Zoom（P-51）對上纏鬥格鬥
    // （Bf109 低速仍靈活）不對稱性的機械成因，機制是 controlStiffening
    // （aileronK），不是慣量。
    const tas = 600 / 3.6
    const p = createFlightState(0, tas)
    const b = createFlightState(0, tas)
    run(P51D, p, { ...IDLE, aileron: 1, throttle: 1, brake: 0 }, 2)
    run(BF109K4, b, { ...IDLE, aileron: 1, throttle: 1, brake: 0 }, 2)
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

  it('平飛配平點的 loadFactor 應接近 1（而非只檢查有限值）', () => {
    // 平飛配平點（P-51D、3000m、120 m/s）：α=1.456° 時升力剛好平衡重量。
    // 這裡不跑配平求解器（那是 Task 13/17 的範圍），而是直接把姿態設成
    //「機首比世界水平面上仰 1.456°、速度維持世界水平」——這正是「平飛時攻角
    // 非零」的正確幾何構造：飛行路徑水平（速度無垂直分量），機身因需要這個
    // 攻角而略為上仰。throttle=0，因為推力沿機體 −Z，不貢獻 loadFactor 使用的
    // 機體 Y 分量，兩者互不影響。
    //
    // 【這個角度隨質量走】n = qS·clAlpha·(α − α₀) / (mg)，所以配平攻角與
    // 質量成正比地移動。質量若再變，這裡要重解，不是放寬容差：
    //   α = α₀ + mg / (qS·clAlpha)
    const s = createFlightState(3000, 120)
    s.orientation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.456 * DEG)
    const diag = createDiagnostics()
    stepDynamics(P51D, s, IDLE, DT, diag)
    expect(diag.aero.alpha * RAD).toBeCloseTo(1.456, 3)
    expect(diag.loadFactor).toBeCloseTo(1, 2)
  })

  // 原本這裡只有 expect(typeof diag.slatsDeployed).toBe('boolean')——型別系統本來就
  // 保證這件事，任何邏輯錯誤都不會讓它變紅，且原本的軌跡（3000m/70m/s/elevator 0.6）
  // 迎角衝到 47.36° 就再也沒回頭，只展開一次、之後恆為 true，從未真正進入
  // 6°~8° 的遲滯帶。以下兩個測試改為主動構造一個會進出遲滯帶的操縱序列，
  // 直接驗證「diag 同時是輸入與輸出、必須沿用同一物件」這個 brief 明文要求的
  // 契約本身，而不只是型別檢查。
  //
  // Bf109：slatDeployAlpha=8°、slatRetractAlpha=6°。操縱序列：先以 elevator=0.2
  // 拉 60 步（0.25s）把迎角衝過 8°（觸發展開），之後放開升降舵，靠俯仰靜穩定性
  // （cmAlpha<0）讓迎角自然回落。實測（見任務報告）：前 60 步後迎角持續上衝，
  // 於第 147 步左右到達峰值 10.27°（已超過 8° 展開閾值），之後緩降，
  // 第 234 步時迎角回到 7.034°——落在 6°~8° 遲滯帶正中央，且沿用同一個 diag
  // 物件時「記得先前已展開」，故仍應回報 true（若是初次抵達 7.034° 且從未
  // 展開過，7.034°<8° 的展開閾值，應為 false；只有「记得已展開」才會用收回
  // 閾值 6° 判斷，得到 true）。
  const PULL_STEPS = 60
  const PULL_ELEVATOR = 0.2
  const TOTAL_STEPS = 234 // 使迎角落在遲滯帶中央 ≈7.03°（見任務報告的完整軌跡）

  function slatManeuverControls(i: number): Controls {
    return { aileron: 0, rudder: 0, throttle: 1, elevator: i < PULL_STEPS ? PULL_ELEVATOR : 0, brake: 0 }
  }

  it('沿用同一個 diag：迎角衝過 8° 展開後回落至遲滯帶中央，仍記得「已展開」', () => {
    const s = createFlightState(3000, 70)
    const diag = createDiagnostics()
    let maxAlphaDeg = -Infinity
    for (let i = 0; i < TOTAL_STEPS; i++) {
      stepDynamics(BF109K4, s, slatManeuverControls(i), DT, diag)
      maxAlphaDeg = Math.max(maxAlphaDeg, diag.aero.alpha * RAD)
    }
    const alphaDeg = diag.aero.alpha * RAD
    expect(maxAlphaDeg).toBeGreaterThan(8) // 確認真的衝過展開閾值，遲滯機制被觸發過
    expect(alphaDeg).toBeGreaterThanOrEqual(6)
    expect(alphaDeg).toBeLessThan(8) // 確認取樣點落在遲滯帶內，而非展開閾值以上
    expect(diag.slatsDeployed).toBe(true)
  })

  it('每步重建 diag（brief 明文禁止的誤用）：相同瞬間的縫翼狀態不同，證明遲滯真的丟失了', () => {
    const s = createFlightState(3000, 70)
    let diag = createDiagnostics()
    for (let i = 0; i < TOTAL_STEPS; i++) {
      diag = createDiagnostics() // 刻意違反「沿用同一個 diag」的規定
      stepDynamics(BF109K4, s, slatManeuverControls(i), DT, diag)
    }
    // 迎角軌跡與上一個測試在此為止仍是同一個數值（見任務報告：兩者在此
    // 迎角範圍內 CL 走線性公式，slatsDeployed 差異不影響力，軌跡逐位元相同），
    // 差別只在於「是否記得先前已展開」，因此這裡必為 false，與上一測試的
    // true 直接對比。
    expect(diag.aero.alpha * RAD).toBeGreaterThanOrEqual(6)
    expect(diag.aero.alpha * RAD).toBeLessThan(8)
    expect(diag.slatsDeployed).toBe(false)
  })

  it('P-51 的縫翼狀態恆為 false', () => {
    const s = createFlightState(3000, 70)
    const { diag } = run(P51D, s, { ...IDLE, elevator: 0.8, throttle: 1 }, 2)
    expect(diag.slatsDeployed).toBe(false)
  })
})

describe('stepDynamics 的 controlAuthority', () => {
  const CONTROLS = { aileron: 0, elevator: 0, rudder: 0, throttle: 0.7, brake: 0 }

  it('createDiagnostics 的初值是 1（完全有效）', () => {
    expect(createDiagnostics().controlAuthority).toBe(1)
  })

  it('巡航速度下為 1', () => {
    const state = createFlightState(3000, 150)
    const diag = createDiagnostics()
    stepDynamics(P51D, state, CONTROLS, 1 / 240, diag)
    expect(diag.controlAuthority).toBe(1)
  })

  it('低速時等於 lowSpeedEffectiveness(spec, 當前動壓)', () => {
    const state = createFlightState(3000, 40)
    const diag = createDiagnostics()
    stepDynamics(P51D, state, CONTROLS, 1 / 240, diag)
    expect(diag.controlAuthority).toBeCloseTo(
      lowSpeedEffectiveness(P51D, diag.aero.qbar), 12,
    )
    expect(diag.controlAuthority).toBeLessThan(1)
    expect(diag.controlAuthority).toBeGreaterThan(0)
  })

  it('速度為 0 時為 0，且不產生 NaN', () => {
    const state = createFlightState(3000, 0)
    state.velocity.set(0, 0, 0)
    const diag = createDiagnostics()
    stepDynamics(P51D, state, CONTROLS, 1 / 240, diag)
    expect(diag.controlAuthority).toBe(0)
    expect(Number.isFinite(state.position.y)).toBe(true)
  })
})
