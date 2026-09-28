import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { liftReference } from '../../src/control/FlightDirector'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { DEG, G0 } from '../../src/core/math'
import { P51D } from '../../src/specs/p51d'

/**
 * # AI 跟瞄時的機翼改平：改到轉彎所需的坡度
 *
 * spec `docs/superpowers/specs/2026-09-28-ai-track-level-design.md`。
 *
 * 改平原本把坡度拉向 0。瞄準方向在轉的時候，坡度必須維持那個轉彎；拉向 0 的
 * 話機首落後、誤差長回來、瞄準又把坡度拉回去 —— 約 1 Hz 的極限環。
 * `trackTurn` 開著時，改平的參考換成轉彎所需的升力方向。
 */

const DT = 1 / 240
const ALT = 3000
const TAS = 150

describe('liftReference：轉彎所需的升力方向', () => {
  const v = new Vector3(0, 0, -TAS)
  const out = new Vector3()

  it('瞄準方向不轉：就是世界上方', () => {
    expect(liftReference(new Vector3(), v, 6, out)).toBe(true)
    expect(out.x).toBe(0)
    expect(out.y).toBe(1)
    expect(out.z).toBe(0)
  })

  it('水平右轉：往右傾 atan(v·ω/g)', () => {
    // 朝 −Z 飛、往右轉：角速度 (0, −Ω, 0)
    const omega = G0 / TAS
    expect(liftReference(new Vector3(0, -omega, 0), v, 6, out)).toBe(true)
    // v·ω/g = 1 → 45°，傾向 +X（右）
    expect(Math.atan2(out.x, out.y) / DEG).toBeCloseTo(45, 6)
    expect(out.z).toBeCloseTo(0, 9)
  })

  /**
   * 【夾的是總升力】氣動上限 2 g 的飛機要水平轉 2 g，需要的是 √5 g 的升力 ——
   * 做不到。參考停在水平轉彎做得到的最大坡度 acos(1/2) = 60°。
   */
  it('需求超過可用過載：停在 acos(1/nLimit)', () => {
    const omega = (2 * G0) / TAS
    expect(liftReference(new Vector3(0, -omega, 0), v, 2, out)).toBe(true)
    expect(Math.atan2(out.x, out.y) / DEG).toBeCloseTo(60, 6)
  })

  it('可用過載不到 1 g：只抵銷重力，參考是世界上方', () => {
    expect(liftReference(new Vector3(0, -G0 / TAS, 0), v, 0.8, out)).toBe(true)
    expect(Math.atan2(out.x, out.y)).toBeCloseTo(0, 12)
  })

  /** 【升力需求恰好為零】方向沒有定義，改平不出力，而不是算出 NaN */
  it('升力需求為零：回 false', () => {
    // ω × v = −g·UP：朝 −Z 飛、ω = (−g/V, 0, 0)
    expect(liftReference(new Vector3(-G0 / TAS, 0, 0), v, 6, out)).toBe(false)
  })
})

/** 朝 −Z 平飛的 P-51 */
function plane(): Aircraft {
  const a = new Aircraft(P51D, ALT, TAS)
  a.state.position.set(0, ALT, 0)
  a.state.velocity.set(0, 0, -TAS)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
  return a
}

function sameControls(a: Aircraft, b: Aircraft): boolean {
  return a.controls.aileron === b.controls.aileron
    && a.controls.elevator === b.controls.elevator
    && a.controls.rudder === b.controls.rudder
    && a.state.orientation.equals(b.state.orientation)
    && a.state.position.equals(b.state.position)
}

describe('指揮儀的 trackTurn', () => {
  /** 靜止的瞄準方向：右偏 8°、上仰 2° —— 飛機要真的動，改平才有事做 */
  const staticAim = new Vector3(Math.sin(8 * DEG), Math.sin(2 * DEG), -1).normalize()

  /**
   * 【關著的時候與沒有這個機制時逐位元相同】指紋是在加入
   * `trackTurn` 之前的程式碼上算出來的：6 秒的舵面指令與姿態，逐步以 FNV-1a
   * 雜湊 float64 的位元組。原本的算術動了任何一個字，這裡就變。
   */
  function digest(rotating: boolean): string {
    const a = plane()
    const aim = staticAim.clone()
    const buf = new Float64Array(7)
    const bytes = new Uint8Array(buf.buffer)
    let h = 0x811c9dc5
    for (let i = 0; i < 6 * 240; i++) {
      if (rotating) aim.set(Math.sin(14 * DEG * i * DT), 0, -Math.cos(14 * DEG * i * DT))
      a.update(aim, WEP_THROTTLE, DT)
      buf[0] = a.controls.aileron
      buf[1] = a.controls.elevator
      buf[2] = a.controls.rudder
      const q = a.state.orientation
      buf[3] = q.x
      buf[4] = q.y
      buf[5] = q.z
      buf[6] = q.w
      for (let k = 0; k < bytes.length; k++) h = Math.imul(h ^ bytes[k]!, 0x01000193) >>> 0
    }
    return h.toString(16)
  }

  it('關著時與沒有這個機制時逐位元相同：靜止與轉動的瞄準方向', () => {
    expect(digest(false)).toBe('148f0b07')
    expect(digest(true)).toBe('192c7fc9')
  })

  it('不傳與傳 false 相同', () => {
    const a = plane()
    const b = plane()
    for (let i = 0; i < 3 * 240; i++) {
      a.update(staticAim, WEP_THROTTLE, DT)
      b.update(staticAim, WEP_THROTTLE, DT, 0, false, false)
      expect(sameControls(a, b)).toBe(true)
    }
  })

  it('瞄準方向從啟用起一直靜止：與 false 逐位元相同', () => {
    const a = plane()
    const b = plane()
    for (let i = 0; i < 3 * 240; i++) {
      a.update(staticAim, WEP_THROTTLE, DT, 0, false, false)
      b.update(staticAim, WEP_THROTTLE, DT, 0, false, true)
      expect(sameControls(a, b)).toBe(true)
    }
  })

  /**
   * 【從關到開的第一步不微分】拿關閉期間的舊方向算角速度，第一步會暴衝。
   * 那一步必須與 false 相同；之後才開始不同。
   */
  it('從 false 切到 true 的第一步與 false 相同', () => {
    const a = plane()
    const b = plane()
    const aim = new Vector3()
    const rate = 14 * DEG
    for (let i = 0; i < 2 * 240; i++) {
      aim.set(Math.sin(rate * i * DT), 0, -Math.cos(rate * i * DT))
      a.update(aim, WEP_THROTTLE, DT, 0, false, false)
      b.update(aim, WEP_THROTTLE, DT, 0, false, false)
    }
    const i = 2 * 240
    aim.set(Math.sin(rate * i * DT), 0, -Math.cos(rate * i * DT))
    a.update(aim, WEP_THROTTLE, DT, 0, false, false)
    b.update(aim, WEP_THROTTLE, DT, 0, false, true)
    expect(sameControls(a, b)).toBe(true)
  })

  /**
   * 【一步跳一大段是不連續，不是角速度】重生與接手時瞄準方向一步重設到機首、
   * AI 換目標時一步跳走。拿那一步微分會得到上百 rad/s，參考歪掉約 0.5 s ——
   * 而那時機首剛好對準、改平是滿權限。跳完靜止的話必須與 false 完全相同。
   */
  it('瞄準方向一步跳 30° 之後靜止：與 false 逐位元相同', () => {
    const a = plane()
    const b = plane()
    const jumped = new Vector3(Math.sin(30 * DEG), 0, -Math.cos(30 * DEG))
    for (let i = 0; i < 4 * 240; i++) {
      const aim = i < 240 ? staticAim : jumped
      a.update(aim, WEP_THROTTLE, DT, 0, false, false)
      b.update(aim, WEP_THROTTLE, DT, 0, false, true)
      expect(sameControls(a, b)).toBe(true)
    }
  })

  /**
   * 【交接時把跟瞄歷史清掉】交還操縱、接手新機時瞄準方向被一步重設到機首。
   * 重設不到 5° 的話 `TRACK_JUMP` 攔不到 —— 4° 的重設微分出來是 0.34 rad/s，
   * 參考歪 79°，而那時誤差是零、改平滿權限。
   */
  it('resetTrack 之後一步 4° 的重設不微分：與 false 逐位元相同', () => {
    const a = plane()
    const b = plane()
    const reset = new Vector3(Math.sin(12 * DEG), Math.sin(2 * DEG), -1).normalize()
    for (let i = 0; i < 3 * 240; i++) {
      if (i === 240) a.director.resetTrack()
      const aim = i < 240 ? staticAim : reset
      a.update(aim, WEP_THROTTLE, DT, 0, false, true)
      b.update(aim, WEP_THROTTLE, DT, 0, false, false)
      expect(sameControls(a, b)).toBe(true)
    }
  })

  /**
   * 【病本身】瞄準方向以每秒 14° 水平轉（4 G 急轉靶機的量級），飛機跟著它。
   * 現行改平每次誤差進 2.5° 就把坡度拉向 0，形成極限環；開著 trackTurn 時
   * 改平的參考就是那個轉彎要的坡度，機首停得住。
   */
  /** @param frame 瞄準方向每幾個物理步才更新一次（滑鼠跟著算繪幀走） */
  function follow(trackTurn: boolean, frame = 1): { inCone: number, rollRms: number } {
    const a = plane()
    const aim = new Vector3()
    const rate = 14 * DEG
    let inCone = 0
    let n = 0
    let pSq = 0
    for (let i = 0; i < 12 * 240; i++) {
      const t = i * DT
      const tAim = Math.floor(i / frame) * frame * DT
      aim.set(Math.sin(rate * tAim), 0, -Math.cos(rate * tAim))
      a.update(aim, WEP_THROTTLE, DT, 0, false, trackTurn)
      if (t < 6) continue
      n++
      if (a.dbg.errorAngle <= 3 * DEG) inCone++
      pSq += a.dbg.actualP * a.dbg.actualP
    }
    return { inCone: inCone / n, rollRms: Math.sqrt(pSq / n) / DEG }
  }

  it('跟著持續轉動的瞄準方向：機首停在 3° 內，滾轉不再來回擺', () => {
    const on = follow(true)
    const off = follow(false)
    expect(on.inCone).toBeGreaterThan(0.95)
    expect(on.rollRms).toBeLessThan(off.rollRms / 2)
  })

  /** 【滑鼠是階梯】60 Hz 的算繪幀：每 4 個物理步才動一次，中間三步不動 */
  it('滑鼠式的階梯輸入也一樣停得住', () => {
    const on = follow(true, 4)
    const off = follow(false, 4)
    expect(on.inCone).toBeGreaterThan(0.95)
    expect(on.rollRms).toBeLessThan(off.rollRms / 2)
  })
})
