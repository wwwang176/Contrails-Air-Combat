import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  createDiagnostics, createFlightState, stepDynamics,
} from '../../src/physics/dynamics'
import {
  alphaForCl, maxLevelSpeed, specificExcessPower, stallSpeed, thrustAt,
} from '../../src/analysis/envelope'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { atmosphere } from '../../src/physics/atmosphere'
import { DEG, G0, clamp } from '../../src/core/math'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import type { AircraftSpec } from '../../src/specs/types'
import type { AirData, Controls, FlightState } from '../../src/physics/types'

const DT = 1 / 240
const air: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }

/** 比能量 Es = h + V²/(2g)，公尺。 */
function specificEnergy(altitude: number, speed: number): number {
  return altitude + (speed * speed) / (2 * G0)
}

/**
 * 建立指定高度、速度、過載、姿態的狀態，回傳狀態與其反解出的迎角
 * （迎角要另外回傳，因為下方 Ps 一致性測試需要它來算推力軸修正項——見該處說明）。
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
 * 另外加入大角度爬升、俯衝、滾轉傾斜的案例，讓姿態四元數非平凡，
 * 真正跑過旋轉鏈。經 counterfactual 驗證：把 `accel.applyQuaternion`
 * 的參數換成反向四元數，本檔案的姿態構造下 13 個案例差異達 6.6%~3893%，
 * 但退回「姿態恆為 identity、只斜切速度向量」的寫法，同一個 bug 完全
 * 測不出來（差異維持在 0.15%，與無 bug 時相同）——見 task-16-report.md。
 */
function stateAt(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  n: number,
  gamma = 0,
  bank = 0,
): { state: FlightState; alpha: number } {
  atmosphere(altitude, air)
  const qS = 0.5 * air.density * tas * tas * spec.wing.area
  const cl = (n * spec.mass * G0) / qS
  const alpha = alphaForCl(spec, cl)
  const theta = gamma + alpha

  const state = createFlightState(altitude, tas)
  const pitchQ = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), theta)
  const rollQ = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), bank)
  state.orientation.copy(pitchQ).multiply(rollQ)

  const velBody = new Vector3(0, -tas * Math.sin(alpha), -tas * Math.cos(alpha))
  state.velocity.copy(velBody).applyQuaternion(state.orientation)
  return { state, alpha }
}

interface Case {
  spec: AircraftSpec
  altitude: number
  tas: number
  n: number
  /** 飛行路徑角，rad。正值爬升，負值俯衝。 */
  gamma?: number
  /** 滾轉角，rad，用於構造傾斜姿態快照。 */
  bank?: number
  /** 案例標籤，未提供時視為平飛基準案例。 */
  attitude?: string
}

/**
 * 【範圍聲明——複審發現的結構性盲區，見 task-16-report.md Important 1】
 *
 * 這組測試比較的是比能量變化率 Ps = dEs/dt。可以嚴格代數證明：把風軸下的
 * 速度 v = (V·cosα·cosβ, V·sinβ, V·sinα·cosβ) 與 aero.ts 的力分解
 * F = (−D·ca·cb − Y·ca·sb + L·sa, −D·sb + Y·cb, −D·sa·cb − Y·sa·sb − L·ca)
 * 做內積，展開後 L（升力）與 Y（側力）的項恆為 0，只留下 v·F ≡ −D·V，
 * 對任意 α、β 都成立，不是巧合。也就是說：
 *
 *   Ps 一致性這組測試驗證的是阻力量級、推力量級與軸向投影、
 *   機體↔世界旋轉、以及 stdToBody 的「前向/垂直」分量映射——
 *   但結構上完全測不到升力方向、也測不到側力分支（本檔案全部案例
 *   β=0，側力分支從未被跑過一次）。這不是本檔案原先聲稱的
 *   「氣動、推進、座標轉換、積分四者完全一致」；升力方向與側力方向
 *   是這個恆等式測不到的兩個符號，需要另外的直接斷言（見下方
 *   「升力與側力方向」）才能補上。
 *
 * 【另一個結構性差異——不是 bug，是可精確算出的建模差異，見 Important 3】
 * 加上推力後，v_body · F_total,body = V·(T·cosα·cosβ − D)（同樣可代數精確
 * 推導）。求解器 specificExcessPower 用的是 V·(T − D)/W（假設推力沿飛行
 * 路徑），積分器則是把推力沿機體 −Z 施加——兩者相差
 * ΔPs = V·T·(1 − cosα·cosβ)/W。本檔案全部案例 β=0，故只需 (1 − cosα)。
 * 這一項用求解器同一個 thrustAt 算出來後直接扣掉，而不是吸收進容差裡
 * 含糊帶過；扣除後的殘差隨 dt 線性收斂到 0（dt=1/240→1/2400→1/24000
 * 時 n=3 案例殘差 0.164→0.016→0.0016），確認是半隱式 Euler 的離散化
 * 誤差，不是還有第二個未解釋的建模差異。
 */
describe('積分器 vs 求解器：Ps 一致性', () => {
  const CASES: Case[] = [
    // 平飛基準案例（γ=0，但姿態仍因配平攻角而非恆等四元數——見 stateAt 說明）
    { spec: P51D, altitude: 0, tas: 150, n: 1 },
    { spec: P51D, altitude: 3000, tas: 180, n: 1 },
    { spec: P51D, altitude: 7600, tas: 190, n: 1 },
    { spec: P51D, altitude: 3000, tas: 180, n: 3 },
    { spec: BF109K4, altitude: 0, tas: 140, n: 1 },
    { spec: BF109K4, altitude: 6300, tas: 175, n: 1 },
    { spec: BF109K4, altitude: 2000, tas: 160, n: 4 },
    // 爬升：機首大幅上仰（路徑角 +15°~+20°），姿態四元數非平凡
    { spec: P51D, altitude: 3000, tas: 170, n: 1, gamma: 20 * DEG, attitude: '爬升 20°' },
    { spec: BF109K4, altitude: 2000, tas: 150, n: 1, gamma: 15 * DEG, attitude: '爬升 15°' },
    // 俯衝：路徑角為負
    { spec: P51D, altitude: 3000, tas: 220, n: 1, gamma: -25 * DEG, attitude: '俯衝 25°' },
    { spec: BF109K4, altitude: 2000, tas: 200, n: 1, gamma: -20 * DEG, attitude: '俯衝 20°' },
    // 傾斜快照：大幅滾轉 + 過載，姿態同時含俯仰與滾轉兩個旋轉軸。
    // 【命名澄清】未設定 angularVelocity，只是瞬時傾斜姿態的快照，不是真正
    // 持續的盤旋運動（世界路徑角實際只有 0.94°/2.83°，見 task-16-report.md）。
    // 即便如此仍有測試價值：counterfactual 1 下 bank50° 案例差異 692%，
    // 比它對應的平飛 n=3 案例（493%）更大，證明滾轉確實讓旋轉鏈跑得更完整。
    { spec: P51D, altitude: 3000, tas: 180, n: 3, bank: 50 * DEG, attitude: '傾斜快照 bank50° n=3' },
    { spec: BF109K4, altitude: 2000, tas: 160, n: 4, bank: 60 * DEG, attitude: '傾斜快照 bank60° n=4' },
  ]

  for (const c of CASES) {
    const gamma = c.gamma ?? 0
    const bank = c.bank ?? 0
    const label = c.attitude
      ? `${c.spec.name} @ ${c.altitude}m ${Math.round(c.tas * 3.6)}km/h n=${c.n} [${c.attitude}]`
      : `${c.spec.name} @ ${c.altitude}m ${Math.round(c.tas * 3.6)}km/h n=${c.n}`

    it(label, () => {
      const { state: s, alpha } = stateAt(c.spec, c.altitude, c.tas, c.n, gamma, bank)
      const diag = createDiagnostics()
      const before = specificEnergy(s.position.y, s.velocity.length())

      stepDynamics(c.spec, s, { aileron: 0, elevator: 0, rudder: 0, throttle: WEP_THROTTLE, brake: 0 }, DT, diag)
      const after = specificEnergy(s.position.y, s.velocity.length())
      const measured = (after - before) / DT

      const solverPs = specificExcessPower(c.spec, c.altitude, c.tas, c.n, WEP_THROTTLE)
      // 推力軸修正：β=0 時 ΔPs = V·T·(1−cosα)/W，見上方檔案頭部推導。
      const thrust = thrustAt(c.spec, c.altitude, c.tas, WEP_THROTTLE)
      const thrustAxisTerm = (c.tas * thrust * (1 - Math.cos(alpha))) / (c.spec.mass * G0)
      const expected = solverPs - thrustAxisTerm

      expect(Number.isFinite(measured)).toBe(true)
      // 0.02 的絕對下限只用來吸收 dt=1/240 的半隱式 Euler 離散化雜訊
      // （實測全部案例扣除推力軸修正後的殘差介於 9e-6~3.7e-4，遠低於此值），
      // 3% 相對值則涵蓋大迎角案例（n=3/n=4）在 dt=1/240 下仍殘留的
      // O(dt) 積分截斷誤差（實測 0.164／0.310，仍在 3% 相對值的一半以內）。
      expect(Math.abs(measured - expected)).toBeLessThan(Math.max(0.02, Math.abs(expected) * 0.03))
    })
  }
})

describe('升力與側力方向（Ps 恆等式結構上測不到的兩個符號）', () => {
  it('升力方向：正迎角、零推力時，垂直加速度應小於自由落體，機體 Y（座艙上方）分量為正', () => {
    // P-51D、3000m、120 m/s、n=1：手解配平攻角 α=1.343°（見
    // test/unit/dynamics.test.ts「平飛配平點」測試），throttle=0 排除推力干擾。
    const { state: s, alpha } = stateAt(P51D, 3000, 120, 1, 0, 0)
    expect(alpha).toBeGreaterThan(0) // 確認這確實是正迎角案例
    const diag = createDiagnostics()
    const vyBefore = s.velocity.y
    stepDynamics(P51D, s, { aileron: 0, elevator: 0, rudder: 0, throttle: 0, brake: 0 }, DT, diag)
    const accelY = (s.velocity.y - vyBefore) / DT
    // 升力抵抗重力：實際下沉加速度應小於（沒有升力時的）自由落體 g。
    expect(accelY).toBeGreaterThan(-G0)
    // 機體座標 Y 分量（座艙上方）為正，即升力真的朝「上」而非朝「下」。
    expect(diag.loadFactor).toBeGreaterThan(0)
    // counterfactual（見 task-16-report.md）：把 aero.ts:161/163 的升力項
    // 符號反過來後，同一條件下 loadFactor 變成 −0.997~−1.000（四個測試速度都
    // 翻負），上面兩個斷言都會轉紅——確認這組斷言真的在釘住升力方向,而非
    // 湊巧通過。
  })

  it('側力方向：側滑角 β>0（相對風從機體右側來）應把飛機推向機體左（−X）', () => {
    // Task 10 複審手算過 β=+7.13° 時 force.x=−31247（負＝向左），這裡用同方向
    // 的側滑角重新從 stepDynamics 量測加速度符號，直接釘住符號而非只驗證量級。
    const beta = 7 * DEG
    const tas = 150
    const s = createFlightState(3000, tas)
    s.velocity.set(tas * Math.sin(beta), 0, -tas * Math.cos(beta)) // 純側滑，α=0
    const diag = createDiagnostics()
    const vxBefore = s.velocity.x
    stepDynamics(P51D, s, { aileron: 0, elevator: 0, rudder: 0, throttle: 0, brake: 0 }, DT, diag)
    expect(diag.aero.beta).toBeCloseTo(beta, 6) // 確認建構出的 β 確實如預期
    expect(diag.aero.alpha).toBeCloseTo(0, 6) // 確認 α=0，側力不與升力糾纏
    const accelX = (s.velocity.x - vxBefore) / DT
    expect(accelX).toBeLessThan(0) // 機體 −X（左）方向的加速度
    // counterfactual（見 task-16-report.md）：把側力分支的符號反過來後，
    // 同一條件下機體 X 方向的力變成正值（10884~26863 N，隨 β 增大），
    // 上面 accelX<0 的斷言會轉紅。
  })
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
   * 求解器本身一致。加入角速度回饋項（kQ）壓制振盪後可以收斂，
   * 這是調整測試用控制器的增益，不是調整任何 spec 參數或放寬物理容差。
   *
   * 【複審發現 2】P 項為純比例控制，穩態必然帶一個固定的高度偏差
   * （實測 300s 後穩定在目標上方 26~58 m），連帶使穩態速度比較的
   * 基準高度也偏高，貢獻了 +0.09%~+0.31% 的速度正偏差（見 task-16-report.md
   * 的殘差歸納）。這不影響下面的收斂性判定（誤差門檻仍遠留有餘裕），
   * 但列入殘差帳目以求誠實。
   */
  function altitudeHold(targetAlt: number, altitude: number, vy: number, pitchRate: number): number {
    return clamp(0.0005 * (targetAlt - altitude) - 0.02 * vy - 0.3 * pitchRate, -1, 1)
  }

  const SECONDS = 600
  // 【複審發現 4】300 秒時 7,600 m 案例仍在爬升途中被取樣：t=300s 誤差 1.404%
  // （門檻 2%，壓線通過但不是真正收斂），t=400/500/600s 誤差降到
  // 0.296%/0.022%/0.114%。延長到 600 秒，並直接斷言收斂性本身
  // （最後 20 秒的平均 dV/dt 必須夠小），而不是只靠「取樣點剛好落在門檻內」
  // 這種偶然性。三個案例都採用同一套延長時限與收斂斷言，不只是 7,600 m。
  const CASES = [
    { spec: P51D, altitude: 3000 },
    { spec: P51D, altitude: 7600 },
    { spec: BF109K4, altitude: 6300 },
  ]

  for (const c of CASES) {
    it(`${c.spec.name} @ ${c.altitude}m 平飛極速誤差 < 2% 且已真正收斂`, () => {
      const target = maxLevelSpeed(c.spec, c.altitude)
      // 由失速速度上方起飛，全油門加速
      const s = createFlightState(c.altitude, stallSpeed(c.spec, c.altitude, 1) * 1.3)
      const diag = createDiagnostics()
      const controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: WEP_THROTTLE, brake: 0 }

      const steps = Math.round(SECONDS / DT)
      const tailWindowSteps = Math.round(20 / DT) // 最後 20 秒用來量測是否已收斂
      let speedAtTailStart = 0
      for (let i = 0; i < steps; i++) {
        controls.elevator = altitudeHold(c.altitude, s.position.y, s.velocity.y, s.angularVelocity.x)
        stepDynamics(c.spec, s, controls, DT, diag)
        if (i === steps - tailWindowSteps) speedAtTailStart = s.velocity.length()
      }

      // 高度必須保持住，否則測的不是平飛極速
      expect(Math.abs(s.position.y - c.altitude)).toBeLessThan(300)

      const err = Math.abs(s.velocity.length() - target) / target
      expect(err).toBeLessThan(0.02)

      // 收斂性本身：最後 20 秒的平均 dV/dt 必須夠小，證明取樣點不是
      // 「剛好落在門檻內的暫態值」，而是真的已經趨於穩態（見上方三案例
      // 於 300/400/500/600 秒的完整軌跡，記錄在 task-16-report.md）。
      const dVdt = (s.velocity.length() - speedAtTailStart) / 20
      expect(Math.abs(dVdt)).toBeLessThan(0.01)
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
        throttle: WEP_THROTTLE, brake: 0,
      }, DT, diag)
      if (s.position.y < 100) s.position.y = 5000 // 撞海即重置高度，維持測試進行
    }
    expect(Number.isFinite(s.position.length())).toBe(true)
    expect(Number.isFinite(s.velocity.length())).toBe(true)
    expect(s.orientation.length()).toBeCloseTo(1, 9)
    expect(s.angularVelocity.length()).toBeLessThan(20)
  })

  // 【複審發現：命名】這裡量的是既有角速度隨阻尼衰減的速度，不是靜穩定性
  // （靜穩定要看的是力矩對迎角擾動的恢復力方向，例如 cmAlpha<0，不是角速度
  // 衰減率）。改名以準確反映測的是什麼。
  it('無控輸入時既有角速度因阻尼大幅衰減（角速度阻尼，非靜穩定量測）', () => {
    const s = createFlightState(5000, 170)
    s.angularVelocity.set(0.3, 0.2, 0.4)
    const diag = createDiagnostics()
    const steps = Math.round(20 / DT)
    for (let i = 0; i < steps; i++) {
      stepDynamics(P51D, s, { aileron: 0, elevator: 0, rudder: 0, throttle: 1, brake: 0 }, DT, diag)
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
      stepDynamics(noWing, s, { aileron: 0, elevator: 0, rudder: 0, throttle: 0, brake: 0 }, DT, diag)
    }
    expect(s.position.y).toBeLessThan(0)
  })
})
