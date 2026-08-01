import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { CRASH_CLEARANCE, isCrashed } from '../../src/aircraft/crash'
import { maxAimAngle, slewAimWorld } from '../../src/input/aim'
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
const HALF_FOV = FOV / 2
/** 與 main.ts 相同的幀結構：60 fps，每幀 4 個 240 Hz 子步。 */
const FRAME_HZ = 60
const SUBSTEPS = 4
/** 世界軸對齊的相機，與目前的暫時跟隨相機一致。 */
const CAM = new Quaternion()

const noseScratch = new Vector3()
const noseOf = (ac: Aircraft) =>
  noseScratch.set(0, 0, -1).applyQuaternion(ac.state.orientation)
const errDeg = (ac: Aircraft, aim: Vector3) => aim.angleTo(noseOf(ac)) * RAD
const headingDeg = (ac: Aircraft) =>
  Math.atan2(ac.state.velocity.x, -ac.state.velocity.z) * RAD

/**
 * 一幀：先依滑鼠位移移動世界瞄準點（含圓錐夾制），再跑 4 個物理步。
 * 順序與 main.ts 逐行相同——遊戲怎麼跑，測試就怎麼跑。
 */
function frame(ac: Aircraft, aim: Vector3, dx: number, dy: number, throttle: number) {
  slewAimWorld(aim, dx, dy, CAM, noseOf(ac), FOV)
  for (let s = 0; s < SUBSTEPS; s++) ac.update(aim, throttle, DT)
}

/** 飛 seconds 秒；dx/dy 為每幀的滑鼠位移（0 = 放著不動）。 */
function fly(
  ac: Aircraft, aim: Vector3, throttle: number, seconds: number, dx = 0, dy = 0,
) {
  const frames = Math.round(seconds * FRAME_HZ)
  for (let f = 0; f < frames; f++) frame(ac, aim, dx, dy, throttle)
}

/** 世界座標的瞄準點：由機首（單位姿態）甩出指定角度。超過夾制會被夾住。 */
function aimOffsetBy(rightRad: number, upRad: number): Vector3 {
  const aim = new Vector3(0, 0, -1)
  return slewAimWorld(
    aim, rightRad / HALF_FOV, upRad / HALF_FOV, CAM, new Vector3(0, 0, -1), FOV,
  )
}

/** 瞄準點就放在機首上（＝準星置中）。 */
const onNose = () => new Vector3(0, 0, -1)

describe('Aircraft', () => {
  it('瞄準點在機首上時維持直線飛行', () => {
    const ac = new Aircraft(P51D, 5000, 170)
    fly(ac, onNose(), 0.8, 5)
    expect(Math.abs(ac.state.position.x)).toBeLessThan(60)
    expect(ac.dbg.errorAngle).toBeLessThan(5 * DEG)
  })

  it('比能量在無動力時遞減', () => {
    const ac = new Aircraft(P51D, 6000, 200)
    const before = ac.specificEnergy
    fly(ac, onNose(), 0, 10)
    expect(ac.specificEnergy).toBeLessThan(before)
  })

  it('全油門平飛時 Ps 為正', () => {
    const ac = new Aircraft(P51D, 5000, 140)
    fly(ac, onNose(), WEP_THROTTLE, 3)
    expect(ac.specificExcessPowerActual).toBeGreaterThan(0)
  })

  it('實測 Ps 與求解器在穩定平飛時接近', () => {
    const ac = new Aircraft(P51D, 5000, 160)
    fly(ac, onNose(), WEP_THROTTLE, 2)
    const expected = specificExcessPower(
      P51D, ac.state.position.y, ac.state.velocity.length(), 1, WEP_THROTTLE,
    )
    expect(Math.abs(ac.specificExcessPowerActual - expected)).toBeLessThan(6)
  })

  it('setSpec 切換機種並重置控制器', () => {
    const ac = new Aircraft(P51D, 5000, 180)
    fly(ac, aimOffsetBy(6 * DEG, 4 * DEG), 1, 2)
    ac.setSpec(BF109G6)
    expect(ac.spec.id).toBe('bf109g6')
    ac.update(onNose(), 1, DT)
    expect(Number.isFinite(ac.state.velocity.length())).toBe(true)
  })

  it('reset 恢復初始狀態', () => {
    const ac = new Aircraft(P51D, 5000, 180)
    fly(ac, aimOffsetBy(10 * DEG, 0), 1, 4)
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
    ac.update(onNose(), 1, DT)
    const p1 = ac.prevPosition.clone()
    ac.update(onNose(), 1, DT)
    expect(ac.prevPosition.equals(p1)).toBe(false)
  })

  it('長時間連續機動不產生 NaN', () => {
    const ac = new Aircraft(BF109G6, 5000, 200)
    const aim = onNose()
    const frames = Math.round(60 * FRAME_HZ)
    for (let f = 0; f < frames; f++) {
      const t = f / FRAME_HZ
      // 玩家持續繞圈揮動滑鼠
      frame(ac, aim, 0.4 * Math.sin(t * 0.5), 0.3 * Math.cos(t * 0.3), WEP_THROTTLE)
      if (ac.state.position.y < 200) {
        ac.reset(5000, 200)
        aim.set(0, 0, -1)
      }
    }
    expect(Number.isFinite(ac.state.position.length())).toBe(true)
    expect(ac.state.orientation.length()).toBeCloseTo(1, 9)
  })
})

/**
 * 【世界固定瞄準點的核心行為】（專案負責人裁決，見 task-20-report.md §13）
 *
 * 瞄準點存的是世界方向。玩家甩一下滑鼠再放手，飛機會轉到那個方向**並停住**
 * ——十字追得上圓圈。這是與前一版（機體固定）最根本的差別：機體固定時純橫向
 * 的偏移讓 rollCommand 恆為 ±90°，飛機以 2.5 rad/s 無止盡滾轉、8 秒航向只變
 * 3°（實測見報告 §8）。
 */
describe('Aircraft：世界固定瞄準點會收斂（沒有滾轉跑步機）', () => {
  it('甩到夾制邊緣再放手：誤差收斂、航向改變後穩住', () => {
    const ac = new Aircraft(P51D, 4000, 220)
    const aim = onNose()
    const h0 = headingDeg(ac)

    // 一幀之內把滑鼠推滿 AIM_RADIUS：瞄準點落在圓錐邊界 11.38°
    frame(ac, aim, AIM_RADIUS, 0, WEP_THROTTLE)
    expect(errDeg(ac, aim)).toBeCloseTo(maxAimAngle(FOV) * RAD, 1)

    // 放手，讓飛機自己追
    let minErr = Infinity
    let rollIntegral = 0 // ∫|p|dt：滾轉跑步機的直接量度
    const frames = Math.round(8 * FRAME_HZ)
    for (let f = 0; f < frames; f++) {
      frame(ac, aim, 0, 0, WEP_THROTTLE)
      minErr = Math.min(minErr, errDeg(ac, aim))
      rollIntegral += Math.abs(ac.state.angularVelocity.z) * (SUBSTEPS * DT)
    }

    // 真的追到了（實測最小誤差 1.2°）
    expect(minErr).toBeLessThan(2)
    // 末態仍在 Task 18 L4 矩陣的 6° 容許值內（實測末段在 1.9°~5.5° 之間緩慢徘徊）
    expect(errDeg(ac, aim)).toBeLessThan(6)
    // 沒有滾轉跑步機：8 秒累積滾轉量遠小於一圈（舊模型是 2.5 rad/s × 8 s ≈ 20 rad）
    expect(rollIntegral).toBeLessThan(6)
    // 航向確實改變了，量級與指令偏移相當（不是舊模型的「滾了三圈、航向不動」）
    const dh = Math.abs(headingDeg(ac) - h0)
    expect(dh).toBeGreaterThan(5)
    expect(dh).toBeLessThan(40)
  })

  it.each([
    { deg: 2, label: '死區內' },
    { deg: 6, label: '中等' },
    { deg: maxAimAngle(FOV) * RAD, label: '貼夾制' },
  ])('偏移 $deg°（$label）不出現滾轉跑步機', ({ deg }) => {
    const ac = new Aircraft(P51D, 4000, 220)
    const aim = onNose()
    frame(ac, aim, (deg * DEG) / HALF_FOV, 0, WEP_THROTTLE)

    let rollIntegral = 0
    const frames = Math.round(8 * FRAME_HZ)
    for (let f = 0; f < frames; f++) {
      frame(ac, aim, 0, 0, WEP_THROTTLE)
      rollIntegral += Math.abs(ac.state.angularVelocity.z) * (SUBSTEPS * DT)
    }
    expect(rollIntegral).toBeLessThan(6)
    expect(errDeg(ac, aim)).toBeLessThan(6)
    // 末態滾轉率必須已經落下來（舊模型在此恆為 2.5 rad/s）
    expect(Math.abs(ac.state.angularVelocity.z)).toBeLessThan(1.5)
  })

  it('往上甩再放手：乾淨的拉升，完全不滾轉', () => {
    const ac = new Aircraft(P51D, 4000, 220)
    const aim = onNose()
    frame(ac, aim, 0, (8 * DEG) / HALF_FOV, WEP_THROTTLE)
    const h0 = ac.state.position.y

    fly(ac, aim, WEP_THROTTLE, 6)
    expect(errDeg(ac, aim)).toBeLessThan(1)
    expect(ac.state.position.y).toBeGreaterThan(h0 + 100)
    expect(Math.abs(ac.state.angularVelocity.z)).toBeLessThan(0.01)
  })

  it('滑鼠不動時瞄準點原地不動——自由視角不影響飛行的前提', () => {
    const ac = new Aircraft(P51D, 4000, 220)
    const aim = onNose()
    frame(ac, aim, 0.2, 0.1, WEP_THROTTLE)
    const parked = aim.clone()
    // 飛機接下來會轉向瞄準點，但瞄準點自己不能被機體拖著走
    fly(ac, aim, WEP_THROTTLE, 3)
    expect(aim.distanceTo(parked)).toBeLessThan(1e-9)
  })

  it('持續移動滑鼠可維持轉彎（世界固定模型下維持轉彎的方式）', () => {
    const ac = new Aircraft(P51D, 4000, 250)
    const aim = onNose()
    const h0 = headingDeg(ac)
    fly(ac, aim, WEP_THROTTLE, 8, 0.5)
    // 瞄準點被持續推在圓錐邊界上，誤差角維持不墜
    expect(errDeg(ac, aim)).toBeGreaterThan(8)
    // 航向持續改變（實測 10 秒轉 139°，約 14°/s）
    const dh = Math.abs(headingDeg(ac) - h0)
    expect(dh).toBeGreaterThan(60)
  })
})

describe('Aircraft：一步的順序', () => {
  /**
   * 【為什麼要驗這件事】stepDynamics 先、director.update 後，指揮儀的輸出
   * 因此套用於「下一步」。這與 Task 18 L4 矩陣驗證時的順序一致；順序若相反，
   * 第一步的物理就會吃到當步才算出的舵面，測試與遊戲的動力學不再是同一個。
   *
   * 驗法：偏離機首的瞄準點讓指揮儀在第一次 update 就必然輸出非零副翼。
   * 若順序正確，第一步的積分必定是用建構時的零舵面跑的——狀態必須與手動
   * 用零舵面跑一步的參考完全逐位元相同；同時 controls 已被寫成非零，
   * 證明指揮儀確實跑過（不是「根本沒呼叫」造成的假通過）。
   */
  it('stepDynamics 先於 director.update：首步使用前一步的舵面', () => {
    const ac = new Aircraft(P51D, 5000, 180)
    ac.update(aimOffsetBy(9 * DEG, 3 * DEG), 0.8, DT)

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

  /**
   * 【雙重轉換防呆】指揮儀的第五參數是世界方向，它自己每步做 world → body。
   * 若 Aircraft 在傳入前先轉一次，方向會被姿態旋轉兩次。在單位姿態下兩者
   * 相同，所以必須用一個「已經轉離單位姿態」的飛機來抓。
   */
  it('傳給指揮儀的是世界方向：飛機側滾後，瞄準點仍被解讀為世界方向', () => {
    const ac = new Aircraft(P51D, 5000, 200)
    // 側滾 90°：body 與 world 不再重合
    ac.state.orientation.setFromAxisAngle(new Vector3(0, 0, -1), Math.PI / 2)
    // 世界座標「機首正上方 10°」的瞄準點
    const aim = new Vector3(0, Math.sin(10 * DEG), -Math.cos(10 * DEG))
    ac.update(aim, 0.8, DT)

    // 機首在世界仍指向 −Z，所以誤差角必須是 10°。若被轉了兩次，
    // 指揮儀看到的方向會落在完全不同的位置，誤差角不會是 10°。
    expect(ac.dbg.errorAngle * RAD).toBeCloseTo(10, 2)
    // 側滾 90° 時，世界的「上」在機體座標是「右」→ 應為橫向誤差而非垂直誤差
    expect(Math.abs(ac.dbg.lateralError * RAD)).toBeCloseTo(10, 2)
    expect(Math.abs(ac.dbg.verticalError * RAD)).toBeLessThan(0.1)
  })
})

describe('Aircraft：機種切換與重置不洩漏狀態', () => {
  it('setSpec 後的行為與「同狀態的全新飛機」逐步一致（PID 積分未洩漏）', () => {
    const a = new Aircraft(P51D, 5000, 220)
    const aimA = onNose()
    fly(a, aimA, WEP_THROTTLE, 4, 0.5) // 持續轉彎把積分項灌滿
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
    const aimB = aimA.clone()

    fly(a, aimA, WEP_THROTTLE, 1.5)
    fly(b, aimB, WEP_THROTTLE, 1.5)

    expect(a.state.position.distanceTo(b.state.position)).toBeLessThan(1e-6)
    expect(Math.abs(a.controls.aileron - b.controls.aileron)).toBeLessThan(1e-9)
    expect(Math.abs(a.controls.elevator - b.controls.elevator)).toBeLessThan(1e-9)
  })

  it('setSpec 清掉前緣縫翼的遲滯旗標', () => {
    const ac = new Aircraft(BF109G6, 3000, 130)
    // 低速持續拉升把縫翼逼出來
    fly(ac, onNose(), WEP_THROTTLE, 3, 0, 0.5)
    expect(ac.diag.slatsDeployed).toBe(true)

    ac.setSpec(P51D)
    expect(ac.diag.slatsDeployed).toBe(false)
  })

  it('reset 後的行為與全新飛機逐步一致（PID 積分未洩漏）', () => {
    const a = new Aircraft(P51D, 5000, 200)
    fly(a, onNose(), WEP_THROTTLE, 4, 0.5)
    a.reset(3000, 150)

    const b = new Aircraft(P51D, 3000, 150)
    const aimA = onNose()
    const aimB = onNose()
    fly(a, aimA, WEP_THROTTLE, 2, 0.3)
    fly(b, aimB, WEP_THROTTLE, 2, 0.3)

    expect(a.state.position.distanceTo(b.state.position)).toBeLessThan(1e-6)
    expect(Math.abs(a.controls.elevator - b.controls.elevator)).toBeLessThan(1e-9)
  })
})

describe('能量：大 G 轉彎必須付出速度的代價', () => {
  it('持續大 G 轉彎時 Ps 顯著為負且比能量大量流失', () => {
    const ac = new Aircraft(P51D, 4000, 250)
    const e0 = ac.specificEnergy
    const aim = onNose()
    let maxG = -Infinity
    const frames = Math.round(8 * FRAME_HZ)
    for (let f = 0; f < frames; f++) {
      frame(ac, aim, 0.5, 0, WEP_THROTTLE)
      maxG = Math.max(maxG, ac.diag.loadFactor)
    }
    // 實測平均 Ps ≈ −67 m/s、末段 −68 m/s、峰值 6.35 G
    expect(ac.specificExcessPowerActual).toBeLessThan(-30)
    expect(maxG).toBeGreaterThan(4)
    expect(ac.specificEnergy).toBeLessThan(e0 - 300)
  })

  it('同高度同速度的平飛對照組 Ps 明顯較高', () => {
    const turn = new Aircraft(P51D, 4000, 180)
    fly(turn, onNose(), WEP_THROTTLE, 8, 0.5)
    const level = new Aircraft(P51D, 4000, 180)
    fly(level, onNose(), WEP_THROTTLE, 8)

    // 實測：轉彎 −55.5、平飛 +4.4
    expect(level.specificExcessPowerActual).toBeGreaterThan(0)
    expect(turn.specificExcessPowerActual).toBeLessThan(level.specificExcessPowerActual - 30)
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
    const aim = onNose()
    let t = 0
    let crashed = false
    const frames = Math.round(30 * FRAME_HZ)
    for (let f = 0; f < frames; f++) {
      frame(ac, aim, 0, -0.5, 0.5) // 滑鼠持續往下推
      t += 1 / FRAME_HZ
      if (isCrashed(ac.state.position, gerstnerHeight, t)) {
        crashed = true
        break
      }
    }
    expect(crashed).toBe(true)

    ac.reset(4000, 160)
    // R 同時把瞄準點放回機首（main.ts 的 parkAimOnNose）
    aim.set(0, 0, -1).applyQuaternion(ac.state.orientation)
    expect(ac.state.position.y).toBe(4000)
    fly(ac, aim, 0.8, 5)
    expect(Number.isFinite(ac.state.position.length())).toBe(true)
    expect(Math.abs(ac.state.position.y - 4000)).toBeLessThan(200)
    expect(ac.dbg.errorAngle).toBeLessThan(5 * DEG)
  })
})
