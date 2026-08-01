import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { CRASH_CLEARANCE, isCrashed } from '../../src/aircraft/crash'
import { aimDirectionBody } from '../../src/input/aim'
import { AIM_RADIUS } from '../../src/input/InputState'
import { specificExcessPower } from '../../src/analysis/envelope'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { createDiagnostics, createFlightState, stepDynamics } from '../../src/physics/dynamics'
import { gerstnerHeight } from '../../src/render/ocean'
import { DEG, RAD } from '../../src/core/math'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

const DT = 1 / 240
const FOV = 65 * DEG
const centre = aimDirectionBody(0, 0, FOV, new Vector3())

function fly(ac: Aircraft, aim: Vector3, throttle: number, seconds: number) {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) ac.update(aim, throttle, DT)
}

describe('Aircraft', () => {
  it('準星置中時大致維持直線飛行', () => {
    const ac = new Aircraft(P51D, 5000, 170)
    fly(ac, centre, 0.8, 5)
    expect(Math.abs(ac.state.position.x)).toBeLessThan(60)
    expect(ac.dbg.errorAngle).toBeLessThan(5 * DEG)
  })

  it('準星偏右時建立穩定右轉（航向持續改變）', () => {
    const ac = new Aircraft(P51D, 5000, 180)
    const right = aimDirectionBody(0.3, 0, FOV, new Vector3())
    fly(ac, right, 1.0, 3)
    const headingA = Math.atan2(ac.state.velocity.x, -ac.state.velocity.z)
    fly(ac, right, 1.0, 2)
    const headingB = Math.atan2(ac.state.velocity.x, -ac.state.velocity.z)
    expect(headingB).not.toBeCloseTo(headingA, 2)
  })

  it('比能量在無動力時遞減', () => {
    const ac = new Aircraft(P51D, 6000, 200)
    const before = ac.specificEnergy
    fly(ac, centre, 0, 10)
    expect(ac.specificEnergy).toBeLessThan(before)
  })

  it('全油門平飛時 Ps 為正', () => {
    const ac = new Aircraft(P51D, 5000, 140)
    fly(ac, centre, WEP_THROTTLE, 3)
    expect(ac.specificExcessPowerActual).toBeGreaterThan(0)
  })

  it('大 G 轉彎時 Ps 顯著為負（能量戰的核心體感）', () => {
    const ac = new Aircraft(P51D, 4000, 250)
    const hardTurn = aimDirectionBody(0.35, 0.15, FOV, new Vector3())
    fly(ac, hardTurn, WEP_THROTTLE, 6)
    expect(ac.specificExcessPowerActual).toBeLessThan(-10)
    expect(ac.state.velocity.length()).toBeLessThan(250)
  })

  it('實測 Ps 與求解器在穩定平飛時接近', () => {
    const ac = new Aircraft(P51D, 5000, 160)
    fly(ac, centre, WEP_THROTTLE, 2)
    const expected = specificExcessPower(
      P51D, ac.state.position.y, ac.state.velocity.length(), 1, WEP_THROTTLE,
    )
    expect(Math.abs(ac.specificExcessPowerActual - expected)).toBeLessThan(6)
  })

  it('setSpec 切換機種並重置控制器', () => {
    const ac = new Aircraft(P51D, 5000, 180)
    fly(ac, aimDirectionBody(0.3, 0.2, FOV, new Vector3()), 1, 2)
    ac.setSpec(BF109G6)
    expect(ac.spec.id).toBe('bf109g6')
    ac.update(centre, 1, DT)
    expect(Number.isFinite(ac.state.velocity.length())).toBe(true)
  })

  it('reset 恢復初始狀態', () => {
    const ac = new Aircraft(P51D, 5000, 180)
    fly(ac, aimDirectionBody(0.3, 0, FOV, new Vector3()), 1, 4)
    ac.reset(3000, 150)
    expect(ac.state.position.y).toBe(3000)
    expect(ac.state.velocity.length()).toBeCloseTo(150, 6)
    expect(ac.state.angularVelocity.length()).toBe(0)
    expect(ac.controls.aileron).toBe(0)
    expect(ac.controls.elevator).toBe(0)
    expect(ac.controls.rudder).toBe(0)
  })

  it('prevPosition 在每步更新，供渲染插值使用', () => {
    const ac = new Aircraft(P51D, 5000, 180)
    ac.update(centre, 1, DT)
    const p1 = ac.prevPosition.clone()
    ac.update(centre, 1, DT)
    expect(ac.prevPosition.equals(p1)).toBe(false)
  })

  it('長時間連續機動不產生 NaN', () => {
    const ac = new Aircraft(BF109G6, 5000, 200)
    for (let i = 0; i < Math.round(60 / DT); i++) {
      const t = i * DT
      const aim = aimDirectionBody(0.3 * Math.sin(t * 0.5), 0.25 * Math.cos(t * 0.3), FOV, new Vector3())
      ac.update(aim, WEP_THROTTLE, DT)
      if (ac.state.position.y < 200) ac.reset(5000, 200)
    }
    expect(Number.isFinite(ac.state.position.length())).toBe(true)
    expect(ac.state.orientation.length()).toBeCloseTo(1, 9)
  })
})

describe('Aircraft：一步的順序', () => {
  /**
   * 【為什麼要驗這件事】stepDynamics 先、director.update 後，指揮儀的輸出
   * 因此套用於「下一步」。這與 Task 18 L4 矩陣驗證時的順序一致；順序若相反，
   * 第一步的物理就會吃到當步才算出的舵面，測試與遊戲的動力學不再是同一個。
   *
   * 驗法：偏離中心的準星讓指揮儀在第一次 update 就必然輸出非零副翼。
   * 若順序正確，第一步的積分必定是用建構時的零舵面跑的——狀態必須與手動
   * 用零舵面跑一步的參考完全逐位元相同；同時 controls 已被寫成非零，
   * 證明指揮儀確實跑過（不是「根本沒呼叫」造成的假通過）。
   */
  it('stepDynamics 先於 director.update：首步使用前一步的舵面', () => {
    const right = aimDirectionBody(0.3, 0.1, FOV, new Vector3())
    const ac = new Aircraft(P51D, 5000, 180)
    ac.update(right, 0.8, DT)

    const ref = createFlightState(5000, 180)
    const refDiag = createDiagnostics()
    stepDynamics(
      P51D, ref, { aileron: 0, elevator: 0, rudder: 0, throttle: 0.8 }, DT, refDiag,
    )

    expect(ac.state.position.equals(ref.position)).toBe(true)
    expect(ac.state.velocity.equals(ref.velocity)).toBe(true)
    expect(ac.state.angularVelocity.equals(ref.angularVelocity)).toBe(true)
    expect(ac.state.orientation.equals(ref.orientation)).toBe(true)

    // 指揮儀確實跑了，而且輸出留給下一步用
    expect(Math.abs(ac.controls.aileron)).toBeGreaterThan(0)
    expect(ac.controls.throttle).toBe(0.8)
  })
})

describe('Aircraft：機種切換與重置不洩漏狀態', () => {
  const hard = aimDirectionBody(0.32, 0.2, FOV, new Vector3())

  it('setSpec 後的行為與「同狀態的全新飛機」逐步一致（PID 積分未洩漏）', () => {
    const a = new Aircraft(P51D, 5000, 220)
    fly(a, hard, WEP_THROTTLE, 4)
    a.setSpec(BF109G6)

    const b = new Aircraft(BF109G6, 5000, 220)
    b.state.position.copy(a.state.position)
    b.state.velocity.copy(a.state.velocity)
    b.state.orientation.copy(a.state.orientation)
    b.state.angularVelocity.copy(a.state.angularVelocity)
    b.diag.slatsDeployed = a.diag.slatsDeployed
    // setSpec 刻意不歸零舵面（換的是飛機不是處境，何況指揮儀下一步就會
    // 覆寫它）。把這一項也對齊，剩下的差異才只剩「指揮儀的內部狀態」，
    // 也就是本測試真正要驗的東西。實測若不對齊，1.5 s 後兩者相差 0.086 m
    // ——那是一步的殘留舵面，不是積分洩漏。
    b.controls.aileron = a.controls.aileron
    b.controls.elevator = a.controls.elevator
    b.controls.rudder = a.controls.rudder

    fly(a, hard, WEP_THROTTLE, 1.5)
    fly(b, hard, WEP_THROTTLE, 1.5)

    expect(a.state.position.distanceTo(b.state.position)).toBeLessThan(1e-6)
    expect(Math.abs(a.controls.aileron - b.controls.aileron)).toBeLessThan(1e-9)
    expect(Math.abs(a.controls.elevator - b.controls.elevator)).toBeLessThan(1e-9)
  })

  it('setSpec 清掉前緣縫翼的遲滯旗標', () => {
    const ac = new Aircraft(BF109G6, 3000, 130)
    // 低速大迎角把縫翼逼出來
    fly(ac, aimDirectionBody(0, 0.34, FOV, new Vector3()), WEP_THROTTLE, 3)
    expect(ac.diag.slatsDeployed).toBe(true)

    ac.setSpec(P51D)
    expect(ac.diag.slatsDeployed).toBe(false)
  })

  it('reset 後的行為與全新飛機逐步一致（PID 積分未洩漏）', () => {
    const a = new Aircraft(P51D, 5000, 200)
    fly(a, hard, WEP_THROTTLE, 4)
    a.reset(3000, 150)

    const b = new Aircraft(P51D, 3000, 150)
    fly(a, hard, WEP_THROTTLE, 2)
    fly(b, hard, WEP_THROTTLE, 2)

    expect(a.state.position.distanceTo(b.state.position)).toBeLessThan(1e-6)
    expect(Math.abs(a.controls.elevator - b.controls.elevator)).toBeLessThan(1e-9)
  })
})

/**
 * 【現況特性測試（characterization），不是設計背書】
 *
 * 準星產生的是「機體座標」的瞄準方向（input/aim.ts 的明文契約），而
 * Aircraft.update 每一步都用「當下的姿態」把它轉回世界座標再餵給指揮儀，
 * 所以指揮儀看到的誤差方向完全不隨飛機轉動而改變。後果分兩種：
 *
 *   準星在正上方 → verticalError 固定為正 → 持續拉升。收斂、好用，
 *     Task 18 的 `bodyRelativeAim: true` 測過的就是這一種。
 *   準星在正右方 → rollCommand = atan2(x, 0) 恆為 +90°，而且飛機再怎麼
 *     滾轉，準星在機體座標裡還是在正右方 → 滾轉指令永遠不會歸零，
 *     飛機持續滾轉；同時 verticalError 恆為 0，俯仰外環主動把俯仰率壓在
 *     0。淨結果是「橫滾」，不是「水平轉彎」。
 *
 * 也就是說，這套操控實際上是一支「虛擬搖桿」：水平量 = 滾轉率指令，
 * 垂直量 = 俯仰率指令（附帶失速／過載保護）。要做水平轉彎必須像真搖桿
 * 一樣「先橫向壓出坡度，再把橫向回中、改拉垂直」。
 *
 * 這兩個測試把上述行為釘住，讓它不會在無人察覺的情況下改變。若未來決定
 * 改成「準星＝世界空間目標、機體轉到位後誤差歸零」，這兩個測試必須被
 * 有意識地改寫，而不是意外地變紅。詳見 task-20-report.md。
 */
describe('Aircraft：準星是機體固定的（水平＝滾轉、垂直＝俯仰）', () => {
  const heading = (ac: Aircraft) => Math.atan2(ac.state.velocity.x, -ac.state.velocity.z)

  it('純水平偏移產生持續滾轉，航向幾乎不變', () => {
    const ac = new Aircraft(P51D, 4000, 220)
    const right = aimDirectionBody(AIM_RADIUS, 0, FOV, new Vector3())
    const h0 = heading(ac)
    fly(ac, right, WEP_THROTTLE, 8)

    // 滾轉指令釘死在「誤差角斜率上限」上，一步都沒有收斂
    expect(ac.dbg.rollCommand).toBeCloseTo(Math.PI / 2, 6)
    expect(ac.dbg.desiredP).toBeGreaterThan(3)
    expect(-ac.state.angularVelocity.z).toBeGreaterThan(2) // 實測 ≈2.5 rad/s

    // 橫向誤差不產生任何俯仰指令
    expect(Math.abs(ac.dbg.desiredQ)).toBeLessThan(0.02)

    // 8 秒（約 3 圈滾轉）後航向只變了幾度——這不是轉彎
    const dh = Math.abs(((heading(ac) - h0 + Math.PI) % (2 * Math.PI)) - Math.PI)
    expect(dh * RAD).toBeLessThan(10)
  })

  it('純垂直偏移產生持續大 G 拉升，速度顯著流失', () => {
    const ac = new Aircraft(P51D, 4000, 250)
    const up = aimDirectionBody(0, AIM_RADIUS, FOV, new Vector3())
    fly(ac, up, WEP_THROTTLE, 8)

    expect(ac.dbg.rollCommand).toBe(0)
    expect(ac.dbg.desiredQ).toBeGreaterThan(0.1)
    // 實測 250 → 180 m/s（8 秒），末段 Ps ≈ −52 m/s
    expect(ac.state.velocity.length()).toBeLessThan(200)
    expect(ac.specificExcessPowerActual).toBeLessThan(-30)
  })
})

describe('撞海判定', () => {
  it('以真實波高判定，不是以平面 y=0 判定', () => {
    const time = 3.7
    // 找出兩個同高度但判定相反的點：只有波高真的參與判定才可能存在
    let crashedAt: { x: number; z: number } | null = null
    let clearAt: { x: number; z: number } | null = null
    const y = CRASH_CLEARANCE // 略高於平均海平面 + 餘裕的下緣
    for (let i = 0; i < 400 && (!crashedAt || !clearAt); i++) {
      const x = i * 3.1
      const z = i * 1.7
      const p = new Vector3(x, y, z)
      if (isCrashed(p, gerstnerHeight, time)) crashedAt ??= { x, z }
      else clearAt ??= { x, z }
    }
    expect(crashedAt).not.toBeNull()
    expect(clearAt).not.toBeNull()
    expect(gerstnerHeight(crashedAt!.x, crashedAt!.z, time))
      .toBeGreaterThan(gerstnerHeight(clearAt!.x, clearAt!.z, time))
  })

  it('與 heightAt + 餘裕的門檻完全一致', () => {
    // 餘裕必須是正值：機身有厚度，浪頂碰到機腹就算撞，不必等機體中心點
    // 沉到水面下。確切數值等 Task 21 有了機體幾何再由 spec 推導，故此處
    // 只釘住「>0」而不是釘住 2。
    expect(CRASH_CLEARANCE).toBeGreaterThan(0)
    const t = 1.25
    const h = gerstnerHeight(120, -80, t)
    expect(isCrashed(new Vector3(120, h + CRASH_CLEARANCE - 0.01, -80), gerstnerHeight, t)).toBe(true)
    expect(isCrashed(new Vector3(120, h + CRASH_CLEARANCE + 0.01, -80), gerstnerHeight, t)).toBe(false)
  })

  it('高空不觸發', () => {
    expect(isCrashed(new Vector3(0, 4000, 0), gerstnerHeight, 0)).toBe(false)
  })

  it('俯衝入海會被判定撞海，reset 後可繼續正常飛行', () => {
    const ac = new Aircraft(P51D, 300, 180)
    const down = aimDirectionBody(0, -0.35, FOV, new Vector3())
    let t = 0
    let crashed = false
    for (let i = 0; i < Math.round(30 / DT); i++) {
      ac.update(down, 0.5, DT)
      t += DT
      if (isCrashed(ac.state.position, gerstnerHeight, t)) {
        crashed = true
        break
      }
    }
    expect(crashed).toBe(true)

    ac.reset(4000, 160)
    expect(ac.state.position.y).toBe(4000)
    fly(ac, centre, 0.8, 5)
    expect(Number.isFinite(ac.state.position.length())).toBe(true)
    expect(Math.abs(ac.state.position.y - 4000)).toBeLessThan(200)
    expect(ac.dbg.errorAngle).toBeLessThan(5 * DEG)
  })
})
