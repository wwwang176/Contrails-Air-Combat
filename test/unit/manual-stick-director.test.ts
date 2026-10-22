import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import {
  DEFAULT_DIRECTOR_GAINS, FlightDirector, createDirectorDebug, type ManualStick,
} from '../../src/control/FlightDirector'
import { BF109K4 } from '../../src/specs/bf109k4'
import { G0 } from '../../src/core/math'
import { PILOT_G_NEGATIVE, gLoadFromOrientation } from '../../src/control/limiters'
import { P51D } from '../../src/specs/p51d'
import type { Controls } from '../../src/physics/types'
import type { Controller } from '../../src/control/Controller'
import { World } from '../../src/world/World'

const DT = 1 / 240
const DEG = Math.PI / 180

/** 4000 m 平飛的 P-51D，跑一步讓 `diag.aero` 有值 */
function cruise(bankDeg = 0, tas = 160): Aircraft {
  const a = new Aircraft(P51D, 4000, tas)
  // 右坡度＝右翼往下：繞機首方向（−Z）轉正角
  a.state.orientation.setFromAxisAngle(new Vector3(0, 0, -1), bankDeg * DEG)
  a.update(new Vector3(0, 0, -1).applyQuaternion(a.state.orientation), 0.7, DT)
  return a
}

function stick(stickRoll = 0, stickPitch = 0, stickYaw = 0): ManualStick {
  return { stickRoll, stickPitch, stickYaw }
}

function controls(): Controls {
  return { aileron: 0, elevator: 0, rudder: 0, throttle: 0, brake: 0 }
}

/** 對同一個狀態跑一次 `updateManual`，回傳那一步的歸因資料 */
function manual(a: Aircraft, s: ManualStick, aero = a.diag.aero) {
  const d = new FlightDirector()
  const dbg = createDirectorDebug()
  d.updateManual(a.spec, a.state, aero, a.diag.slatsDeployed, s, DT, controls(), dbg)
  return dbg
}

describe('FlightDirector.updateManual：俯仰', () => {
  /** 搖桿置中＝1 G 配平：正飛平飛時重力已經給了 1 G，不必再拉 */
  it('正飛平飛、搖桿置中：期望俯仰率 0', () => {
    expect(manual(cruise(), stick()).desiredQ).toBeCloseTo(0, 4)
  })

  /**
   * 【置中是 1 G 不是 q = 0】帶坡度時機身法向只分到 cos(坡度) 的重力，補足到 1 G 要一個正的
   * 俯仰率 —— 機首自己跟著轉彎。q = 0 的話機首停在慣性空間裡，速度向量被重力往下拉
   */
  it('60° 坡度、搖桿置中：期望俯仰率讓法向過載 = 1 G', () => {
    const a = cruise(60)
    const gLoad = gLoadFromOrientation(a.state.orientation)
    expect(gLoad).toBeCloseTo(Math.cos(60 * DEG), 3)
    const q = manual(a, stick()).desiredQ
    expect(q).toBeCloseTo(G0 * (1 - gLoad) / a.diag.aero.tas, 12)
  })

  /**
   * 【拉滿只擋結構、不擋失速】低速時結構過載對應的俯仰率遠大於失速前的上限 `limiter.qMax`，
   * 拉滿就拉得過失速迎角。推滿同理，下限是飛行員與結構的負過載
   */
  it('低速拉滿 = 結構過載的俯仰率（超過失速上限）；推滿 = 負過載上限', () => {
    const a = cruise(0, 90)
    const gLoad = gLoadFromOrientation(a.state.orientation)
    const tas = a.diag.aero.tas
    const pull = manual(a, stick(0, 1))
    expect(pull.limiter.source).toBe('alpha')
    expect(pull.desiredQ).toBe(G0 * (a.spec.limits.gPositive - gLoad) / tas)
    expect(pull.desiredQ).toBeGreaterThan(1.5 * pull.limiter.qMax)
    const push = manual(a, stick(0, -1))
    expect(push.desiredQ).toBe(G0 * (Math.max(PILOT_G_NEGATIVE, a.spec.limits.gNegative) - gLoad) / tas)
    expect(push.desiredQ).toBeLessThan(push.qMin)
  })

  /** 結構先夾住的速度，拉滿與瞄準模式的上限是同一個數 */
  it('高速拉滿 = 限制器的上限（結構）', () => {
    const pull = manual(cruise(0, 230), stick(0, 1))
    expect(pull.limiter.source).toBe('structure')
    expect(pull.desiredQ).toBe(pull.limiter.qMax)
  })

  /**
   * 【置中的 1 G 配平照樣擋失速】1 G 失速速度以下，置中要求 1 G 的話放著不動就一路拉進失速。
   * 配平夾在失速前的上限裡
   */
  it('1 G 失速速度以下、搖桿置中：期望俯仰率不超過失速上限', () => {
    const a = cruise(60, 40)
    const dbg = manual(a, stick())
    expect(dbg.limiter.nAero).toBeLessThan(1)
    expect(dbg.desiredQ).toBeLessThanOrEqual(dbg.limiter.qMax)
  })

  it('半桿落在配平與拉滿／推滿的正中間', () => {
    const a = cruise(30)
    const trim = manual(a, stick()).desiredQ
    const full = manual(a, stick(0, 1)).desiredQ
    const half = manual(a, stick(0, 0.5))
    expect(half.desiredQ).toBeCloseTo((trim + full) / 2, 9)
    const fullPush = manual(a, stick(0, -1)).desiredQ
    const halfPush = manual(a, stick(0, -0.5))
    expect(halfPush.desiredQ).toBeCloseTo((trim + fullPush) / 2, 9)
  })
})

describe('FlightDirector.updateManual：滾轉與偏航', () => {
  /**
   * 【副翼直接等於桿量】穩態滾轉率本來就正比於副翼（p = clDa·δa / −clP · 2V/b），滿桿就是
   * 副翼打滿、這架飛機這個速度下的物理極限。拿估計的滾轉率當目標再用內環追的話，估計偏低、
   * 內環又追不上，滿桿只有瞄準模式的六七成
   */
  it('滾轉：壓桿時副翼指令直接等於桿量', () => {
    const a = cruise()
    for (const r of [1, -1, 0.4]) {
      const out = controls()
      new FlightDirector().updateManual(a.spec, a.state, a.diag.aero, false, stick(r), DT, out, createDirectorDebug())
      expect(out.aileron, String(r)).toBe(r)
    }
  })

  /** 正的 r 是機首往右（與自動模式的 `rAim` 同號） */
  it('方向舵：沒有側滑時 D 給正的偏航率，A 給負的', () => {
    const a = cruise()
    const aero = { ...a.diag.aero, beta: 0 }
    const g = DEFAULT_DIRECTOR_GAINS
    expect(manual(a, stick(0, 0, 1), aero).desiredR).toBeCloseTo(g.maxYawRateCommand, 12)
    expect(manual(a, stick(0, 0, -1), aero).desiredR).toBeCloseTo(-g.maxYawRateCommand, 12)
  })

  /**
   * 【側滑上限照自動模式】正的 r 把 β 推向負方向；β 已經過 −betaMax 時再往右踩沒有權限，
   * 只剩消側滑那一項。反方向（往回踩）照樣有權限
   */
  it('側滑超過上限時往那邊踩沒有權限，往回踩有', () => {
    const a = cruise()
    const g = DEFAULT_DIRECTOR_GAINS
    const beta = -(g.betaMax + 2 * DEG)
    const aero = { ...a.diag.aero, beta }
    const right = manual(a, stick(0, 0, 1), aero)
    expect(right.betaAuthority).toBe(0)
    expect(right.desiredR).toBeCloseTo(g.yawOuter * beta, 12)
    const left = manual(a, stick(0, 0, -1), aero)
    expect(left.betaAuthority).toBe(1)
    expect(left.desiredR).toBeCloseTo(g.yawOuter * beta - g.maxYawRateCommand, 12)
  })

  /** 不踩舵時消側滑那一項照樣作用 —— 協調轉彎 */
  it('不踩舵：期望偏航率只剩消側滑項', () => {
    const a = cruise()
    const beta = 3 * DEG
    const r = manual(a, stick(), { ...a.diag.aero, beta }).desiredR
    expect(r).toBeCloseTo(DEFAULT_DIRECTOR_GAINS.yawOuter * beta, 12)
  })
})

describe('FlightDirector：模式切換', () => {
  /** 外環的五格（`writeState` 的最後五格）：滾轉指令、推頭旗標、三個外環積分 */
  function outerTail(d: FlightDirector): number[] {
    const buf = new Float64Array(64)
    const end = d.writeState(buf, 0)
    return Array.from(buf.slice(end - 5, end))
  }

  /**
   * 【換模式的那一步清外環】搖桿飛一陣子按 `I`，AI 接手的第一步不能帶著上一次自動模式
   * 留下的積分；反過來也一樣
   */
  it('自動 → 搖桿 → 自動：外環積分與滾轉指令清成 0', () => {
    const a = cruise()
    const d = a.director
    // 偏右上 30° 的瞄準方向飛兩秒，外環積分長出來
    const aim = new Vector3(0.4, 0.3, -1).normalize()
    for (let i = 0; i < 480; i++) a.update(aim, 0.7, DT)
    expect(outerTail(d).some((v) => v !== 0)).toBe(true)
    d.updateManual(a.spec, a.state, a.diag.aero, false, stick(), DT, controls(), createDirectorDebug())
    expect(outerTail(d)).toEqual([0, 0, 0, 0, 0])
    // 回到自動的那一步從零開始累積：一步的積分量遠小於兩秒累積的量
    const dbg = createDirectorDebug()
    d.update(a.spec, a.state, a.diag.aero, false, aim, DT, controls(), dbg, false, true)
    expect(Math.abs(dbg.yawAimIntegral)).toBeLessThan(DEFAULT_DIRECTOR_GAINS.yawAimI * Math.PI * DT + 1e-12)
  })

  /**
   * 【連續的搖桿步不清內環】桿量小、升降舵不飽和，第二步的積分多累積一步。每步都重設的話
   * 第二步會等於「重設之後再跑一步」
   */
  it('連續的搖桿步不清俯仰內環', () => {
    const a = cruise()
    const run = (resetBetween: boolean) => {
      const d = new FlightDirector()
      const out = controls()
      const dbg = createDirectorDebug()
      d.updateManual(a.spec, a.state, a.diag.aero, false, stick(0, 0.05), DT, out, dbg)
      if (resetBetween) d.reset()
      d.updateManual(a.spec, a.state, a.diag.aero, false, stick(0, 0.05), DT, out, dbg)
      return out.elevator
    }
    const kept = run(false)
    expect(Math.abs(kept)).toBeLessThan(1)
    expect(kept).not.toBe(run(true))
  })
})

/** 坡度，度。右翼往下為正（與 `__probe().bk` 同一個式子） */
function bank(a: Aircraft): number {
  const right = new Vector3(1, 0, 0).applyQuaternion(a.state.orientation)
  const up = new Vector3(0, 1, 0).applyQuaternion(a.state.orientation)
  return Math.atan2(-right.y, up.y) / DEG
}

function fly(a: Aircraft, s: ManualStick, seconds: number, each?: () => void): void {
  const unused = new Vector3(0, 0, -1)
  for (let i = 0; i < seconds * 240; i++) {
    a.update(unused, 0.8, DT, 0, false, false, false, s)
    each?.()
  }
}

describe('搖桿飛起來（P-51D，4000 m，160 m/s）', () => {
  it('右滾桿 1 秒坡度往右；放開之後坡度保持', () => {
    const a = new Aircraft(P51D, 4000, 160)
    fly(a, stick(1), 1)
    expect(bank(a)).toBeGreaterThan(20)
    // 放開之後滾轉率要先收掉，量的是收掉之後的五秒
    fly(a, stick(), 0.5)
    const held = bank(a)
    fly(a, stick(), 5)
    expect(Math.abs(bank(a) - held)).toBeLessThan(5)
  })

  /**
   * 【滿桿 = 副翼打滿】瞄準模式滾的時候會自己踩舵，側滑經上反角再多給一截滾轉。所以搖桿要
   * 滿桿加滿舵才比得上；只壓桿是副翼本身的極限（P-51D 約八成多、Bf 109 160 m/s 約六成 ——
   * 它的滾轉很吃舵）
   */
  it('滿桿加舵的滾轉率追得上瞄準模式；只壓桿至少六成', () => {
    for (const [spec, tas] of [[P51D, 110], [P51D, 220], [BF109K4, 160]] as const) {
      const peak = (mode: 'aim' | 'stick' | 'stickRudder') => {
        const a = new Aircraft(spec, 3000, tas)
        const aim = new Vector3(1, 0, -0.0001).normalize()
        let p = 0
        for (let i = 0; i < 240; i++) {
          if (mode === 'aim') a.update(aim, 0.9, DT, 0, false, true)
          else a.update(aim, 0.9, DT, 0, false, false, false, stick(1, 0, mode === 'stickRudder' ? 1 : 0))
          p = Math.max(p, Math.abs(a.state.angularVelocity.z))
        }
        return p
      }
      const aim = peak('aim')
      expect(peak('stickRudder'), `${spec.id} ${tas}`).toBeGreaterThan(0.95 * aim)
      expect(peak('stick'), `${spec.id} ${tas}`).toBeGreaterThan(0.6 * aim)
    }
  })

  it('左滾桿往左', () => {
    const a = new Aircraft(P51D, 4000, 160)
    fly(a, stick(-1), 1)
    expect(bank(a)).toBeLessThan(-20)
  })

  it('拉桿 2 秒：過載 > 1.5、往上爬', () => {
    const a = new Aircraft(P51D, 4000, 160)
    fly(a, stick(0, 0.6), 2)
    expect(a.diag.loadFactor).toBeGreaterThan(1.5)
    expect(a.state.velocity.y).toBeGreaterThan(0)
  })

  it('推桿 1 秒：往下', () => {
    const a = new Aircraft(P51D, 4000, 160)
    fly(a, stick(0, -0.6), 1)
    expect(a.state.velocity.y).toBeLessThan(0)
  })

  /**
   * 【不擋失速】低速拉滿一秒內越過臨界迎角。【放桿就脫離】置中的 1 G 配平會把機首撐在大迎角，
   * 超過的迎角要由置中那一份壓回去；少了它放桿近三秒才回到臨界以下
   */
  it('低速拉滿會失速；放開之後 1.2 秒內回到臨界以下', () => {
    const a = new Aircraft(P51D, 3000, 110)
    const crit = a.spec.lift.alphaCrit
    let alphaMax = 0
    fly(a, stick(0, 1), 2, () => { alphaMax = Math.max(alphaMax, a.diag.aero.alpha) })
    expect(alphaMax).toBeGreaterThan(crit + 10 * DEG)
    let recovered = -1
    let t = 0
    fly(a, stick(), 2, () => {
      t += DT
      if (recovered < 0 && a.diag.aero.alpha < crit) recovered = t
    })
    expect(recovered).toBeGreaterThan(0)
    expect(recovered).toBeLessThan(1.2)
  })

  /** 【結構上限保留】高速拉滿十秒，速度一路掉、過載始終不超過結構上限 */
  it('高速拉滿 10 秒：過載不超過結構上限', () => {
    const a = new Aircraft(P51D, 3000, 230)
    let nMax = 0
    fly(a, stick(0, 1), 10, () => { nMax = Math.max(nMax, a.diag.loadFactor) })
    expect(nMax).toBeGreaterThan(6)
    expect(nMax).toBeLessThan(a.spec.limits.gPositive + 0.3)
  })

  it('踩右舵：機首往右偏', () => {
    const a = new Aircraft(P51D, 4000, 160)
    fly(a, stick(0, 0, 1), 1)
    const nose = new Vector3(0, 0, -1).applyQuaternion(a.state.orientation)
    expect(nose.x).toBeGreaterThan(0.02)
  })
})

describe('World 把搖桿指令交給飛機', () => {
  it('`manual` 為 true 的座位照桿量飛；false 的照瞄準方向飛', () => {
    const w = new World()
    const right: Controller = {
      update(_self, _dt, out) {
        out.aimWorld.set(0, 0, -1)
        out.throttle = 0.8
        out.manual = true
        out.stickRoll = 1
        out.stickPitch = 0
        out.stickYaw = 0
      },
    }
    const straight: Controller = {
      update(self, _dt, out) {
        out.aimWorld.set(0, 0, -1).applyQuaternion(self.state.orientation)
        out.throttle = 0.8
        // 桿量留著也不算數：`manual` 是 false
        out.manual = false
        out.stickRoll = 1
      },
    }
    const a = w.add(new Aircraft(P51D, 4000, 160), right, 'blue', new Vector3(0, 4000, 0))
    const b = w.add(new Aircraft(P51D, 4000, 160), straight, 'blue', new Vector3(500, 4000, 0))
    for (let i = 0; i < 240; i++) w.step(DT)
    expect(bank(a.aircraft)).toBeGreaterThan(20)
    expect(Math.abs(bank(b.aircraft))).toBeLessThan(2)
  })
})

describe('FlightDirector.updateManual：不配置', () => {
  it('同一個桿量跑兩次，逐位元相同（決定性）', () => {
    const run = () => {
      const a = cruise(20)
      const q = new Quaternion()
      for (let i = 0; i < 240; i++) a.update(new Vector3(0, 0, -1), 0.7, DT, 0, false, false, false, stick(0.3, 0.6, -0.2))
      q.copy(a.state.orientation)
      return q.toArray()
    }
    expect(run()).toEqual(run())
  })
})
