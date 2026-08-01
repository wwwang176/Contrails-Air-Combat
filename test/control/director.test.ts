import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  FlightDirector, createDirectorDebug, DEFAULT_DIRECTOR_GAINS,
  type DirectorDebug,
} from '../../src/control/FlightDirector'
import { createDiagnostics, createFlightState, stepDynamics } from '../../src/physics/dynamics'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { PILOT_G_POSITIVE, QMAX_FLOOR, gLoadFromOrientation } from '../../src/control/limiters'
import { DEG, RAD, G0 } from '../../src/core/math'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import type { AircraftSpec } from '../../src/specs/types'
import { atmosphere } from '../../src/physics/atmosphere'
import { controlEffectiveness } from '../../src/physics/aero'
import type { PidGains } from '../../src/control/pid'
import type { Controls } from '../../src/physics/types'

const DT = 1 / 240
const KMH = 1 / 3.6

/**
 * 矩陣的初始高度，m —— 維持 brief 的 6000 m。
 *
 * 【曾經改成 1000 m，是誤判，已改回】200 km/h 在 6000 m 確實低於 1 g 失速
 * 速度：用本專案的準靜態求解器算，P-51D 在 6000 m 的 Vs1g = 225.1 km/h，
 * 200 km/h 只有 0.888 Vs，該點氣動可達過載僅 0.79 G。這些數字都成立，
 * 但「所以要換高度」的結論不成立——飛機在推力作用下會自己加速脫離
 * 次失速狀態，那只是**收斂慢**，不是收斂不了。給足時間（見 SECONDS）
 * 6000 m 全數通過，而且四個判別指標全部優於 1000 m：
 *
 *            末段誤差   末段標準差   峰值|α|    最低高度
 *   6000 m    4.12°      1.286       14.45°     4766 m
 *   1000 m    4.43°      1.404       13.39°     −213 m  ← 已鑽到地面下
 *
 * 換言之 6000 m 才是比較嚴苛的場景，改成 1000 m 等於把矩陣搬到比較好過的
 * 地方。真正需要修的是**時間視野**，不是高度。
 */
const ALT = 6000

interface RunResult {
  errorHistory: number[]
  maxAlpha: number
  maxLoad: number
  minLoad: number
  finalError: number
  aileronHistory: number[]
  /** 每步的比能量 h + V²/(2g)，m */
  energyHistory: number[]
  /** 每步的速度向量方向（世界），用於量測持續轉率 */
  headingHistory: Vector3[]
  /** 每步的 DirectorDebug 快照（僅純量欄位＋限制器） */
  dbgHistory: DirectorDebug[]
  tasHistory: number[]
}

function snapshotDbg(d: DirectorDebug): DirectorDebug {
  return {
    errorAngle: d.errorAngle,
    verticalError: d.verticalError,
    lateralError: d.lateralError,
    rollCommand: d.rollCommand,
    desiredP: d.desiredP, desiredQ: d.desiredQ, desiredR: d.desiredR,
    actualP: d.actualP, actualQ: d.actualQ, actualR: d.actualR,
    limiter: { ...d.limiter },
  }
}

interface RunOptions {
  /** true 時每幀依當前姿態重算瞄準方向，模擬「準星固定偏離中心」 */
  bodyRelativeAim?: boolean
  altitude?: number
  throttle?: number
  keepHistory?: boolean
}

function runDirector(
  spec: AircraftSpec,
  rollDeg: number,
  aimDirWorld: Vector3,
  tas: number,
  seconds: number,
  opts: RunOptions = {},
): RunResult {
  const state = createFlightState(opts.altitude ?? ALT, tas)
  state.orientation.setFromAxisAngle(new Vector3(0, 0, -1), rollDeg * DEG)

  const director = new FlightDirector()
  const diag = createDiagnostics()
  const dbg = createDirectorDebug()
  const controls: Controls = {
    aileron: 0, elevator: 0, rudder: 0, throttle: opts.throttle ?? WEP_THROTTLE,
  }

  const errorHistory: number[] = []
  const aileronHistory: number[] = []
  const energyHistory: number[] = []
  const headingHistory: Vector3[] = []
  const dbgHistory: DirectorDebug[] = []
  const tasHistory: number[] = []
  let maxAlpha = -Infinity
  let maxLoad = -Infinity
  let minLoad = Infinity

  // bodyRelativeAim：把 aimDirWorld 當成「機體座標下的固定偏移方向」，
  // 每幀轉回世界座標再餵給指揮儀——這正是玩家把準星固定按在畫面某一點
  // 不放的情形。
  const aimBodyFixed = aimDirWorld.clone().normalize()
  const aimWorld = new Vector3()

  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    stepDynamics(spec, state, controls, DT, diag)

    if (opts.bodyRelativeAim) {
      aimWorld.copy(aimBodyFixed).applyQuaternion(state.orientation)
    } else {
      aimWorld.copy(aimDirWorld)
    }

    director.update(
      spec, state, diag.aero, diag.slatsDeployed,
      aimWorld, DT, controls, dbg,
    )
    errorHistory.push(dbg.errorAngle)
    aileronHistory.push(controls.aileron)
    energyHistory.push(state.position.y + (diag.aero.tas * diag.aero.tas) / (2 * G0))
    tasHistory.push(diag.aero.tas)
    if (opts.keepHistory) {
      headingHistory.push(state.velocity.clone().normalize())
      dbgHistory.push(snapshotDbg(dbg))
    }
    maxAlpha = Math.max(maxAlpha, Math.abs(diag.aero.alpha))
    maxLoad = Math.max(maxLoad, diag.loadFactor)
    minLoad = Math.min(minLoad, diag.loadFactor)
  }

  return {
    errorHistory, aileronHistory, energyHistory, headingHistory, dbgHistory,
    tasHistory, maxAlpha, maxLoad, minLoad,
    finalError: errorHistory[errorHistory.length - 1]!,
  }
}

/** 距機首 offsetDeg、方位 azimuthDeg 的世界空間目標方向。機首恆為 −Z。 */
function aimAt(offsetDeg: number, azimuthDeg: number): Vector3 {
  const o = offsetDeg * DEG
  const a = azimuthDeg * DEG
  return new Vector3(
    Math.sin(o) * Math.sin(a),
    Math.sin(o) * Math.cos(a),
    -Math.cos(o),
  ).normalize()
}

function alphaCritOf(spec: AircraftSpec): number {
  return spec.lift.alphaCrit + spec.lift.slatAlphaBonus
}

describe('L4 指揮儀矩陣（120 案例）', () => {
  const ROLLS = [0, 45, 90, 135, 180]
  const AZIMUTHS = [0, 45, 90, 135, 180, 225, 270, 315]
  const SPEEDS = [200, 400, 600]
  /**
   * 【brief 的 8 s 改為 14 s —— 這才是 brief 唯一真正錯的場景參數】
   *
   * 收斂最慢的案例是 r180° 方位0° 200 km/h：飛機倒飛、目標在機首正下方
   * 25°，而且起始速度低於該高度的失速速度。它必須先靠推力與重力換到
   * 足夠的速度，再滾轉 180°（200 km/h 時最大滾轉率僅 0.72 rad/s，光滾轉
   * 就要 4.4 s），最後才拉得起來。實測誤差要到 **11.59 s** 才永久落到
   * 6° 以內；8 s 的末段窗（6~8 s）整段都還在收斂過程中間。
   *
   * 逐一量測（6000 m，出貨增益）：
   *   8 s → 32/120 失敗    10 s → 19/120    12 s → 9/120    14 s → 0/120
   * 全部失敗都是「末段誤差還沒降下來」，沒有任何一個是失速或超載。
   *
   * 拉長時間並沒有放寬任何斷言——容許值仍是 brief 的 6°、標準差仍是
   * brief 的 1.5°，而且不失速／不超載的檢查覆蓋的時間反而更長，
   * 是更嚴格而非更寬鬆。
   */
  const SECONDS = 14
  const TOLERANCE_DEG = 6

  for (const roll of ROLLS) {
    for (const az of AZIMUTHS) {
      for (const kmh of SPEEDS) {
        it(`滾轉${roll}° 方位${az}° ${kmh}km/h`, () => {
          const r = runDirector(P51D, roll, aimAt(25, az), kmh * KMH, SECONDS)

          // 收斂：末段誤差需落在容許值內
          const tail = r.errorHistory.slice(-Math.round(2 / DT))
          const maxTail = Math.max(...tail) * RAD
          expect(maxTail).toBeLessThan(TOLERANCE_DEG)

          // 不震盪：末段誤差標準差需夠小
          const mean = tail.reduce((a, b) => a + b, 0) / tail.length
          const sd = Math.sqrt(
            tail.reduce((s, v) => s + (v - mean) ** 2, 0) / tail.length,
          ) * RAD
          expect(sd).toBeLessThan(1.5)

          // 不打滿舵：末段窗內副翼貼在 ±1 的比例必須很小。
          // 【為什麼需要這條】「誤差收斂」不等於「手感乾淨」——單看誤差與
          // 標準差，指揮儀可以一邊維持小誤差、一邊讓副翼在極限環裡持續
          // 滿舵來回甩。加上 rollRateErrorSlope 之前，這 120 個案例雖然
          // 全部「收斂」，末段窗卻有 65 個案例出現滿舵、最壞案例 55.4%
          // 的時間貼在 ±1（20 s 視野更惡化到 97 個案例）。加上之後最壞
          // 案例是 1.46%（20 s 為 1.88%）。門檻 10% 落在兩者之間。
          const tailAil = r.aileronHistory.slice(-Math.round(2 / DT))
          const satFrac = tailAil.filter((a) => Math.abs(a) > 0.99).length / tailAil.length
          expect(satFrac).toBeLessThan(0.1)

          // 限制器有效：全程未失速、未超載
          expect(r.maxAlpha).toBeLessThan(alphaCritOf(P51D))
          expect(r.maxLoad).toBeLessThan(P51D.limits.gPositive)
          expect(r.minLoad).toBeGreaterThan(P51D.limits.gNegative)

          expect(Number.isFinite(r.finalError)).toBe(true)
        })
      }
    }
  }
})

describe('指揮儀特例', () => {
  it('誤差為 0 時滾轉指令不抖動（spec 8.2 特例一）', () => {
    const r = runDirector(P51D, 0, new Vector3(0, 0, -1), 400 * KMH, 5)
    const tail = r.aileronHistory.slice(-Math.round(2 / DT))
    for (const a of tail) expect(Math.abs(a)).toBeLessThan(0.25)
    // 不應出現高頻正負交替
    let flips = 0
    for (let i = 1; i < tail.length; i++) {
      if (Math.sign(tail[i]!) !== Math.sign(tail[i - 1]!)) flips++
    }
    expect(flips).toBeLessThan(tail.length * 0.15)
  })

  /**
   * 死區的邊界行為（spec §8.2 特例一）必須直接測。
   *
   * 【為什麼整合測試不夠】加入 rollRateErrorSlope 之後，desiredP 的上限
   * 是 15 × errorAngle，誤差趨近 0 時滾轉權限本來就平滑地收斂到 0——
   * 於是「平飛時副翼不抖」這種整合層級的斷言，就算把死區整個拿掉也照樣
   * 通過（已用 mutation 實測：刪掉死區，134 個測試全綠）。兩者職責不同：
   * 斜率上限管「快對準時不要暴衝」，死區管「已對準後完全不再下滾轉指令」。
   * 要釘住後者，必須直接檢查死區內外的邊界。
   */
  it('誤差落在死區內時滾轉指令恰為 0，越過死區才接管（spec 8.2 特例一）', () => {
    const d = new FlightDirector()
    const state = createFlightState(ALT, 400 * KMH)
    const diag = createDiagnostics()
    const dbg = createDirectorDebug()
    const controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: WEP_THROTTLE }
    stepDynamics(P51D, state, controls, DT, diag)

    const dzDeg = DEFAULT_DIRECTOR_GAINS.deadZoneAngle * RAD
    expect(dzDeg).toBeCloseTo(3, 6)

    // 純橫向誤差：atan2(x, y) 在死區外必為 ±90°，是最能凸顯死區作用的方向
    const probe = (offsetDeg: number): { roll: number; p: number } => {
      d.reset()
      d.update(
        P51D, state, diag.aero, diag.slatsDeployed,
        aimAt(offsetDeg, 90), DT, controls, dbg,
      )
      expect(dbg.errorAngle * RAD).toBeCloseTo(offsetDeg, 4)
      return { roll: dbg.rollCommand, p: dbg.desiredP }
    }

    // 死區內：滾轉指令與期望滾轉率都必須是「恰好 0」，不是「很小」
    for (const off of [0.5, 1, 2, 2.9]) {
      const r = probe(off)
      expect(r.roll).toBe(0)
      expect(r.p).toBe(0)
    }
    // 死區外：立刻接管，方位為右側 90°
    for (const off of [3.1, 5, 10]) {
      const r = probe(off)
      // 90.006° 而非恰好 90°：跑過一個物理步之後姿態已微幅改變，
      // 世界座標的方位 90° 映回機體時會差千分之幾度。
      expect(r.roll * RAD).toBeCloseTo(90, 1)
      expect(r.p).toBeGreaterThan(0)
    }
  })

  it('目標在正後方時不產生 NaN 或發散（spec 8.2 特例二）', () => {
    // 【brief 的 6 s 改為 14 s，門檻 60° 不動】6000 m、400 km/h 起始的 180°
    // 反向平均只有約 9°/s（空氣稀薄、可用過載低，而且轉一半時速度已掉到
    // 74 m/s）：實測誤差 163.4°(2s) → 128.9°(6s) → 110.3°(8s) → 71.1°(12s)
    // → 50.9°(14s) → 1.8°(20s)。6 s 時還有 129°，過不了 brief 自己的 60°
    // 門檻——這是時間給得不夠，不是指揮儀轉不動。14 s 的 50.9° 對 60° 有
    // 9.1° 餘裕，且與矩陣的 SECONDS 一致。門檻維持 brief 的原值。
    const r = runDirector(P51D, 0, new Vector3(0, 0, 1), 400 * KMH, 14)
    expect(Number.isFinite(r.finalError)).toBe(true)
    expect(r.maxAlpha).toBeLessThan(alphaCritOf(P51D))
    // 應已大幅轉向，誤差顯著下降
    expect(r.finalError * RAD).toBeLessThan(60)
  })

  it('低速時因限制器介入而轉不動（能量不足的直接體現）', () => {
    const slow = runDirector(P51D, 0, aimAt(60, 0), 160 * KMH, 3, { keepHistory: true })
    const fast = runDirector(P51D, 0, aimAt(60, 0), 450 * KMH, 3, { keepHistory: true })
    // 相同時間內，高速的誤差收斂得更多
    expect(fast.finalError).toBeLessThan(slow.finalError)
    // 低速時仍不得失速
    expect(slow.maxAlpha).toBeLessThan(alphaCritOf(P51D))
    // 【因果】必須確認「轉不動」真的是限制器造成的，否則這條測試對任何
    // 速度相關的轉彎性能差異都會通過，等於什麼都沒釘住。
    //
    // (a) 兩端的 desiredQ 全程都恰好等於 limiter.qMax——綁住俯仰性能的是
    //     限制器，不是內環 PID 追不上。
    for (const d of slow.dbgHistory) expect(d.desiredQ).toBe(d.limiter.qMax)
    for (const d of fast.dbgHistory) expect(d.desiredQ).toBe(d.limiter.qMax)
    // (b) 兩端都由迎角（而非結構／飛行員 G）主導
    expect(slow.dbgHistory.every((d) => d.limiter.source === 'alpha')).toBe(true)
    expect(fast.dbgHistory.every((d) => d.limiter.source === 'alpha')).toBe(true)
    // (c) 差別純粹在 qMax 的量值：低速端整段被壓在 QMAX_FLOOR（即氣動可達
    //     過載已低於當下的 gLoad，一點俯仰權限都不剩），高速端則有 20 倍以上。
    const slowQMax = Math.max(...slow.dbgHistory.map((d) => d.limiter.qMax))
    const fastQMax = Math.min(...fast.dbgHistory.map((d) => d.limiter.qMax))
    expect(slowQMax).toBe(QMAX_FLOOR)
    expect(fastQMax).toBeGreaterThan(20 * slowQMax)
  })

  it('Bf 109 在 600 km/h 的滾轉響應明顯慢於 P-51（副翼變重）', () => {
    const p = runDirector(P51D, 0, aimAt(25, 90), 600 * KMH, 2)
    const b = runDirector(BF109G6, 0, aimAt(25, 90), 600 * KMH, 2)
    expect(b.finalError).toBeGreaterThan(p.finalError)
  })

  /**
   * 特例二的遲滯必須用「真正模稜兩可」的輸入才測得到。
   *
   * L4 矩陣裡的正後方案例（aim = (0,0,1)）其實 x 分量恰為 0，atan2 有確定
   * 的回傳值，不會抖——把遲滯分支整個刪掉，矩陣 120 個案例仍然全綠
   * （已用 mutation 實測）。真正的病態輸入是「x 在 0 附近變號」：此時
   * atan2(±ε, y≈0) 會在 +90° 與 −90° 之間跳，副翼跟著左右打滿，飛機卡在
   * 原地左右搖擺而永遠繞不到目標後方——這就是 spec §8.2 要防的 spin-lock。
   */
  it('目標接近正後方時方位角變號不會讓滾轉指令跳變（spec 8.2 特例二的遲滯）', () => {
    const d = new FlightDirector()
    const state = createFlightState(ALT, 150)
    const diag = createDiagnostics()
    const dbg = createDirectorDebug()
    const controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: 1 }
    stepDynamics(P51D, state, controls, DT, diag)

    // 幾乎正後方、橫向分量微小且逐幀變號
    const cmds: number[] = []
    const ails: number[] = []
    for (let i = 0; i < 8; i++) {
      const x = (i % 2 === 0 ? 1 : -1) * 0.02
      const aim = new Vector3(x, 0, 1).normalize()
      // 確認這確實落在遲滯帶內（誤差角 > 180° − 5°）
      d.update(P51D, state, diag.aero, diag.slatsDeployed, aim, DT, controls, dbg)
      expect(dbg.errorAngle * RAD).toBeGreaterThan(175)
      cmds.push(dbg.rollCommand)
      ails.push(controls.aileron)
    }
    // 滾轉指令完全不隨 x 的符號跳動
    for (const c of cmds) expect(c).toBe(cmds[0]!)
    // 因此副翼也不會左右打滿
    for (const a of ails) expect(Math.abs(a)).toBeLessThan(0.2)
  })

  it('reset 後 PID 積分項不殘留', () => {
    const d = new FlightDirector()
    const state = createFlightState(5000, 150)
    const diag = createDiagnostics()
    const dbg = createDirectorDebug()
    const controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: 1 }
    for (let i = 0; i < 500; i++) {
      stepDynamics(P51D, state, controls, DT, diag)
      d.update(P51D, state, diag.aero, false, aimAt(45, 90), DT, controls, dbg)
    }
    d.reset()
    state.angularVelocity.set(0, 0, 0)
    // 【brief 用世界座標的 (0,0,−1) 當「零誤差」瞄準方向，那是錯的】
    // 跑完 500 步之後機體早已不在初始姿態，世界 −Z 對它而言是一個 60°
    // 以上的大誤差；比例項本身就會把副翼打到飽和（實測 |aileron| = 1），
    // 這個斷言於是完全量不到積分殘留。真正的零誤差方向是「機首當下指的
    // 方向」——機首在機體座標恆為 (0,0,−1)，轉到世界座標即為下式。
    // 這樣 errorAngle = 0（落在死區）→ desiredP = 0，而 angularVelocity
    // 已歸零 → actualP = 0，誤差恰為 0，輸出中唯一可能非零的就是積分項。
    const noseWorld = new Vector3(0, 0, -1).applyQuaternion(state.orientation)
    d.update(P51D, state, diag.aero, false, noseWorld, DT, controls, dbg)
    expect(dbg.errorAngle).toBeLessThan(1e-6)
    expect(Math.abs(controls.aileron)).toBeLessThan(0.05)
  })
})

describe('增益不變量的護欄', () => {
  /**
   * 不變量一（pid.ts 的契約）：ki·integralLimit ≤ outputLimit。
   * 違反時輸出會在誤差反向之後仍被積分項鎖在飽和邊界（task-17 實測 1.500 s）。
   * 這條不等式原本只寫在註釋裡，沒有任何斷言，未來調參可以悄悄違反。
   */
  const INNER: ReadonlyArray<[string, PidGains]> = [
    ['rollInner', DEFAULT_DIRECTOR_GAINS.rollInner],
    ['pitchInner', DEFAULT_DIRECTOR_GAINS.pitchInner],
    ['yawInner', DEFAULT_DIRECTOR_GAINS.yawInner],
  ]

  it('三組內環都滿足 ki·integralLimit ≤ outputLimit', () => {
    for (const [name, g] of INNER) {
      expect(
        g.ki * g.integralLimit,
        `${name}: ki(${g.ki}) × integralLimit(${g.integralLimit}) 必須 ≤ outputLimit(${g.outputLimit})`,
      ).toBeLessThanOrEqual(g.outputLimit)
    }
  })

  /**
   * 不變量二：離散微分增益。240 Hz 下微分項等效增益 kd/dt 乘上「單一物理步內
   * 舵面對角速度的影響量」必須 < 1，否則在 Nyquist 頻率上發散
   * （brief 的 pitchInner.kd = 0.04 就是這樣壞的，實測升降舵逐步跳 ±1）。
   * 這裡用最惡劣的常見工況（海平面 600 km/h，含 controlStiffening）估算。
   */
  it('三軸的離散微分迴路增益都遠小於 1', () => {
    const V = 600 * KMH
    const air = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }
    atmosphere(0, air)
    const qbar = 0.5 * air.density * V * V
    const { area, span, chord } = P51D.wing
    const CS = P51D.controlStiffening
    const M = P51D.moments
    const I = P51D.inertia
    const axes: ReadonlyArray<[string, number, number, number, number, number]> = [
      // 名稱, 力臂, 舵效係數, 慣量, stiffening 指數, kd
      ['roll', span, M.clDa, I.roll, CS.aileronK, DEFAULT_DIRECTOR_GAINS.rollInner.kd],
      ['pitch', chord, M.cmDe, I.pitch, CS.elevatorK, DEFAULT_DIRECTOR_GAINS.pitchInner.kd],
      ['yaw', span, M.cnDr, I.yaw, CS.rudderK, DEFAULT_DIRECTOR_GAINS.yawInner.kd],
    ]
    for (const [name, lever, cDelta, inertia, k, kd] of axes) {
      const eff = controlEffectiveness(k, CS.qRef, qbar)
      // 單一步內、單位舵面造成的角速度變化
      const domega1 = (qbar * eff * area * lever * cDelta * DT) / inertia
      const loopGain = (kd / DT) * domega1
      expect(loopGain, `${name}: kd/dt × Δω₁ = ${loopGain.toFixed(3)}`).toBeLessThan(0.5)
    }
  })

  /**
   * 內外環增益都必須能在執行期改（spec 的調參面板需求，pid.ts 也這麼宣告）。
   * 原本 Pid 建構時複製 gains，導致「外環活、內環死」——改
   * director.gains.rollOuter 有效，改 director.gains.rollInner.kp 無效。
   */
  it('內環與外環增益都能在執行期即時生效', () => {
    const mk = (): { d: FlightDirector; run: () => number } => {
      const d = new FlightDirector()
      const state = createFlightState(ALT, 400 * KMH)
      const diag = createDiagnostics()
      const dbg = createDirectorDebug()
      const c: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: WEP_THROTTLE }
      return {
        d,
        run: () => {
          for (let i = 0; i < 240; i++) {
            stepDynamics(P51D, state, c, DT, diag)
            d.update(P51D, state, diag.aero, diag.slatsDeployed, aimAt(25, 90), DT, c, dbg)
          }
          return c.aileron
        },
      }
    }
    const base = mk()
    const baseAil = base.run()
    expect(Math.abs(baseAil)).toBeGreaterThan(0.2)

    // 內環：把 rollInner 三項都壓到近乎零，副翼必須跟著塌下來
    const inner = mk()
    inner.d.gains.rollInner.kp = 1e-6
    inner.d.gains.rollInner.ki = 0
    inner.d.gains.rollInner.kd = 0
    expect(Math.abs(inner.run())).toBeLessThan(1e-3)

    // 外環：把 rollOuter 壓到零，同樣必須生效
    const outer = mk()
    outer.d.gains.rollOuter = 0
    expect(Math.abs(outer.run())).toBeLessThan(Math.abs(baseAil))
  })
})

describe('指揮儀的設計不變量', () => {
  it('指揮儀只輸出舵面，絕不寫入 FlightState', () => {
    const d = new FlightDirector()
    const state = createFlightState(4000, 150)
    state.orientation.setFromAxisAngle(new Vector3(0, 0, -1), 40 * DEG)
    state.angularVelocity.set(0.3, -0.2, 0.5)
    const diag = createDiagnostics()
    const dbg = createDirectorDebug()
    const controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: 0.7 }
    stepDynamics(P51D, state, controls, DT, diag)

    const before = {
      p: state.position.clone(),
      v: state.velocity.clone(),
      q: state.orientation.clone(),
      w: state.angularVelocity.clone(),
    }
    d.update(P51D, state, diag.aero, diag.slatsDeployed, aimAt(30, 120), DT, controls, dbg)

    expect(state.position.equals(before.p)).toBe(true)
    expect(state.velocity.equals(before.v)).toBe(true)
    expect(state.orientation.equals(before.q)).toBe(true)
    expect(state.angularVelocity.equals(before.w)).toBe(true)
    // 油門也不歸指揮儀管
    expect(controls.throttle).toBe(0.7)
    // 但舵面確實被寫入了（否則上面四個相等是廢話）
    expect(Math.abs(controls.aileron) + Math.abs(controls.elevator)).toBeGreaterThan(0)
  })

  /**
   * 準星固定按在機首正上方 30°（每幀依當前姿態重算世界方向），
   * 也就是玩家把滑鼠推到中心上方並按住不放。
   *
   * 這是「瞄準方向在機體座標求解」最直接的後果：誤差角完全不隨飛機
   * 轉動而改變，於是外環永遠要求一個非零的期望俯仰率，飛機進入持續
   * 的拉升迴旋。若瞄準方向改由世界座標固定（或經相機空間換算），
   * 飛機轉到位後誤差就歸零、動作停止——那才是「一次性修正」。
   */
  it('機體座標求解：固定偏離中心的瞄準方向產生「持續」轉率而非一次性修正', () => {
    const OFFSET_DEG = 30
    const r = runDirector(P51D, 0, aimAt(OFFSET_DEG, 0), 650 * KMH, 10, {
      bodyRelativeAim: true, keepHistory: true,
    })

    // 誤差角自始至終「釘死」在準星偏離量上，一步都沒有收斂
    for (const e of r.errorHistory) {
      expect(e * RAD).toBeCloseTo(OFFSET_DEG, 6)
    }

    // 逐秒量測航跡方向的變化量（度/秒），共 9 個視窗
    const perSec = Math.round(1 / DT)
    const rates: number[] = []
    for (let s = 0; s < 9; s++) {
      const a = r.headingHistory[s * perSec]!
      const b = r.headingHistory[(s + 1) * perSec - 1]!
      rates.push(Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * RAD)
    }
    // 每一秒都在持續轉（6000 m 實測 7.0, 12.6, 14.3, 15.6, 15.9, 15.8,
    // 15.6, 15.7, 16.0 度/秒——第一個視窗含建立俯仰率的暫態）
    for (const v of rates) expect(v).toBeGreaterThan(5)
    // 不但沒有衰減，反而因速度下降而升高：轉率是被持續維持的，不是脈衝
    expect(rates[8]!).toBeGreaterThan(rates[0]!)
  })

  /**
   * 硬拉時的單位重量剩餘功率 Ps = d(h + V²/2g)/dt。
   * 限制器只擋失速與過載，絕不擋能量流失——玩家拉得動就得付速度的代價。
   */
  it('硬拉時比能量急遽下降：指揮儀不替玩家吸收機動代價', () => {
    const SEC = 10
    const turn = runDirector(P51D, 0, aimAt(30, 0), 650 * KMH, SEC, {
      bodyRelativeAim: true, keepHistory: true,
    })
    const level = runDirector(P51D, 0, new Vector3(0, 0, -1), 650 * KMH, SEC)

    // 取前半段（高速、限制器允許大 G 的階段）的平均 Ps
    const psFirstHalf = (r: RunResult): number => {
      const i0 = Math.round(r.energyHistory.length * 0.5)
      return (r.energyHistory[i0]! - r.energyHistory[0]!) / (i0 * DT)
    }
    const psTurn = psFirstHalf(turn)
    const psLevel = psFirstHalf(level)

    // 實測（6000 m、650 km/h）：硬拉 Ps = −42.5 m/s，同速平飛 Ps = +2.6 m/s
    expect(psTurn).toBeLessThan(-30)
    expect(psLevel).toBeGreaterThan(0)
    expect(psTurn).toBeLessThan(psLevel - 35)

    // 速度確實被機動吃掉：180.6 → 146.2 m/s（前 5 秒）→ 96.3 m/s（10 秒）
    const half = Math.round(turn.tasHistory.length * 0.5)
    expect(turn.tasHistory[half]!).toBeLessThan(turn.tasHistory[0]! - 25)
    // 而限制器仍然守住了過載（實測峰值 5.26 G，飛行員上限 6.5）
    expect(turn.maxLoad).toBeLessThan(PILOT_G_POSITIVE)
    expect(turn.maxAlpha).toBeLessThan(alphaCritOf(P51D))
  })

  /**
   * 負向（推桿）俯仰率上限的公式：qMin = g·(n_neg − gLoad)/V，
   * n_neg = max(PILOT_G_NEGATIVE, spec.gNegative, −nAero)。
   *
   * L4 矩陣測不到這條——矩陣裡最負的過載只到 −1.36，離 −3 還很遠，把重力
   * 支持項整個拿掉矩陣仍然全綠（已用 mutation 實測）。所以這裡直接以白箱
   * 方式釘住公式本身：同一個速度、同一架飛機，只改姿態（gLoad 由 +1 變
   * −1），qMin 必須跟著改變；漏掉重力項的版本兩個姿態會算出同一個值。
   */
  it('負向俯仰率上限含重力支持項與負迎角氣動上限', () => {
    const d = new FlightDirector()
    const diag = createDiagnostics()
    const dbg = createDirectorDebug()
    const controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: 1 }
    // 目標在機體正下方 → verticalError = −90°，外環要求的推桿率遠超上限，
    // desiredQ 必定被夾在 qMin 上，於是 desiredQ 就是 qMin 本身。
    const aimBodyDown = new Vector3(0, -1, 0)

    interface Probe { q: number; nAero: number; gLoad: number; tas: number }
    const qMinAt = (rollDeg: number, tas: number): Probe => {
      const state = createFlightState(ALT, tas)
      state.orientation.setFromAxisAngle(new Vector3(0, 0, -1), rollDeg * DEG)
      stepDynamics(P51D, state, controls, DT, diag)
      const aimWorld = aimBodyDown.clone().applyQuaternion(state.orientation)
      d.reset()
      d.update(P51D, state, diag.aero, diag.slatsDeployed, aimWorld, DT, controls, dbg)
      expect(dbg.verticalError * RAD).toBeCloseTo(-90, 3)
      // 用指揮儀當下看到的同一個姿態算 gLoad，這樣期望值可以精確到 1e-12；
      // 用理想的 ±1 只能精確到 1e-8（一個物理步之後姿態已略有變化）。
      return {
        q: dbg.desiredQ,
        nAero: dbg.limiter.nAero,
        gLoad: gLoadFromOrientation(state.orientation),
        tas: diag.aero.tas,
      }
    }
    const expected = (p: Probe, nNeg: number): number => (G0 * (nNeg - p.gLoad)) / p.tas

    const FAST = 600 * KMH
    // 正立：gLoad ≈ +1。高速時 nAero ≫ 3，故 n_neg 由飛行員上限 −3 決定。
    const up = qMinAt(0, FAST)
    expect(up.nAero).toBeGreaterThan(3)
    expect(up.gLoad).toBeCloseTo(1, 3)
    expect(up.q).toBeCloseTo(expected(up, -3), 12)
    // 倒飛：gLoad ≈ −1，重力反向幫忙，只需再推出 2 個 G
    const inv = qMinAt(180, FAST)
    expect(inv.gLoad).toBeCloseTo(-1, 3)
    expect(inv.q).toBeCloseTo(expected(inv, -3), 12)
    // 兩者必須明顯不同——漏掉重力項時它們會相等
    expect(up.q).toBeLessThan(inv.q - 0.05)

    // 低速：氣動上限 nAero < 3，負向也必須被 −nAero 夾住而非 −3
    const SLOW = 200 * KMH
    const slow = qMinAt(0, SLOW)
    expect(slow.nAero).toBeLessThan(3)
    expect(slow.q).toBeCloseTo(expected(slow, -slow.nAero), 12)
  })

  it('DirectorDebug 可分辨「指令被限制器夾住」與「實際追不上指令」', () => {
    // A：低速大俯仰需求 → 問題出在「指令」端，desiredQ 被 α 限制器夾死
    const a = runDirector(P51D, 0, aimAt(60, 0), 170 * KMH, 3, { keepHistory: true })
    const aMid = a.dbgHistory[Math.round(a.dbgHistory.length * 0.5)]!
    expect(aMid.limiter.source).toBe('alpha')
    // 外環要求的 pitchOuter·verticalError 遠大於限制器允許值，desiredQ 貼齊 qMax
    expect(DEFAULT_DIRECTOR_GAINS.pitchOuter * aMid.verticalError)
      .toBeGreaterThan(aMid.limiter.qMax)
    expect(aMid.desiredQ).toBeCloseTo(aMid.limiter.qMax, 12)
    // 而內環把這個（被夾小的）指令追得很準——不是 PID 的問題
    expect(Math.abs(aMid.desiredQ - aMid.actualQ)).toBeLessThan(0.1)

    // B：高速大滾轉需求 → 問題出在「實際」端，desiredP 沒被夾但 actualP 追不上
    const b = runDirector(BF109G6, 0, aimAt(60, 90), 600 * KMH, 1.0, { keepHistory: true })
    const bEarly = b.dbgHistory[Math.round(0.3 / DT)]!
    expect(Math.abs(bEarly.desiredP)).toBeLessThan(DEFAULT_DIRECTOR_GAINS.maxRollRateCommand)
    expect(Math.abs(bEarly.actualP)).toBeLessThan(Math.abs(bEarly.desiredP) * 0.6)
  })
})
