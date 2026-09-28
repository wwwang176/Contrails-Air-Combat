import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createCommand } from '../../src/control/Controller'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import { DEG, G0 } from '../../src/core/math'
import {
  bestSustainedTurnRateCached, bestSustainedTurnSpeedCached, maxRollRate,
} from '../../src/analysis/envelope'
import { BOMB_PROFILE, RUN_SETTLE, setBombBallistics } from '../../src/ai/bombRun'
import { EGRESS_TURNS, createStrikeState, stepStrike, type StrikeState } from '../../src/ai/strikeRun'
import { createGroundTarget } from '../../src/world/groundTargets'
import { bombDragK, BOMB_TERMINAL_SPEED } from '../../src/world/bomb'
import type { AircraftSpec } from '../../src/specs/types'

/**
 * # 攻擊航路的鎖定：要穩才鎖、來不及穩就重來
 *
 * 轟炸機滾轉慢，還在迴轉裡就鎖住航向的話，落點橫著掃過投彈窗，整趟一枚都
 * 放不出來。
 */

const DT = 1 / 240
const K = bombDragK(BOMB_TERMINAL_SPEED)
const ALT = 1500
const TAS = 95

function plane(spec: AircraftSpec = B17G, z = 0): Aircraft {
  const a = new Aircraft(spec, ALT, TAS)
  a.state.position.set(0, ALT, z)
  a.state.velocity.set(0, 0, -TAS)
  a.state.orientation.identity()
  a.state.angularVelocity.set(0, 0, 0)
  return a
}

const target = () => createGroundTarget(0, 'boilerHouse', 'red', 0, -8000, 0)

/** 先在遠處跑一步拿到這一趟的 `plan`。 */
function planned(spec: AircraftSpec = B17G): StrikeState {
  setBombBallistics(K, DT)
  const st = createStrikeState()
  stepStrike(st, plane(spec), target(), 0, BOMB_PROFILE, true, true, DT, createCommand())
  return st
}

/** 飛機擺在離目標 `range` 公尺處，機首正對目標。 */
function at(range: number, spec: AircraftSpec = B17G): Aircraft {
  return plane(spec, -8000 + range)
}

describe('鎖定航向要穩', () => {
  it('對照：水平、不轉、進到鎖定距離就轉直飛', () => {
    const st = planned()
    stepStrike(st, at(st.plan.lockRange - 50), target(), 0, BOMB_PROFILE, true, true, DT, createCommand())
    expect(st.phase).toBe('run')
  })

  it('帶著 30° 坡度不鎖', () => {
    const st = planned()
    const a = at(st.plan.lockRange - 50)
    a.state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), 30 * DEG)
    stepStrike(st, a, target(), 0, BOMB_PROFILE, true, true, DT, createCommand())
    expect(st.phase).toBe('approach')
  })

  it('機翼水平但還在轉（每秒 3°）不鎖', () => {
    const st = planned()
    const a = at(st.plan.lockRange - 50)
    a.state.angularVelocity.set(0, 3 * DEG, 0)
    stepStrike(st, a, target(), 0, BOMB_PROFILE, true, true, DT, createCommand())
    expect(st.phase).toBe('approach')
  })

  /**
   * 【過了放手點還沒鎖就重來】再追下去只會繞著目標打轉 —— 投彈窗已經在身後。
   */
  it('到了放手點還沒穩下來：放棄這一趟，轉脫離', () => {
    const st = planned()
    const a = at(st.plan.releaseRange! - 20)
    a.state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), 30 * DEG)
    const out = createCommand()
    stepStrike(st, a, target(), 0, BOMB_PROFILE, true, true, DT, out)
    expect(st.phase).toBe('egress')
    expect(out.bombing).toBe(false)
  })

  it('還沒到放手點：不穩就繼續進場，不放棄', () => {
    const st = planned()
    const a = at(st.plan.releaseRange! + 20)
    a.state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), 30 * DEG)
    stepStrike(st, a, target(), 0, BOMB_PROFILE, true, true, DT, createCommand())
    expect(st.phase).toBe('approach')
  })
})

describe('直飛中目標換了', () => {
  it('轉脫離，不帶著前一個目標的航向飛下去', () => {
    const st = planned()
    st.phase = 'run'
    st.target = 0
    st.heading.set(0, 0, -1)
    stepStrike(st, at(st.plan.lockRange - 50), target(), 1, BOMB_PROFILE, true, true, DT, createCommand())
    expect(st.phase).toBe('egress')
  })

  /**
   * 【回頭時才重選，不是投完就重選】越過目標、拉開的參考點是剛炸的那一個；
   * 投完就換的話，脫離途中瞄點跳到另一個目標，越過與拉開都量錯了對象。
   */
  it('投完轉脫離時不重選；脫離結束、回頭進場時才要求重選', () => {
    const st = planned()
    st.phase = 'run'
    st.target = 0
    stepStrike(st, at(st.plan.lockRange - 50), target(), 0, BOMB_PROFILE, false, true, DT, createCommand())
    expect(st.phase).toBe('egress')
    expect(st.repick).toBe(false)
    stepStrike(st, at(st.egressRange + 100), target(), 0, BOMB_PROFILE, true, true, DT, createCommand())
    expect(st.phase).toBe('approach')
    expect(st.repick).toBe(true)
  })
})

describe('脫離的方向', () => {
  /** 目標在 z = −8000，飛機朝 −Z 飛 */
  function egressFrom(a: Aircraft, st = planned()): { st: StrikeState, aim: Vector3 } {
    st.phase = 'run'
    st.target = 0
    const out = createCommand()
    stepStrike(st, a, target(), 0, BOMB_PROFILE, false, true, DT, out)
    expect(st.phase).toBe('egress')
    return { st, aim: out.aimWorld.clone() }
  }

  it('轟炸：目標還在前方，照原航向越過它', () => {
    const { aim } = egressFrom(at(1500))
    expect(aim.z).toBeLessThan(0)
  })

  it('轟炸：越過目標之後背離它拉開', () => {
    const { st } = egressFrom(at(1500))
    // 飛到目標後方 1 km、橫向偏 300 m
    const past = plane(B17G, -9000)
    past.state.position.x = 300
    const out = createCommand()
    stepStrike(st, past, target(), 0, BOMB_PROFILE, false, true, DT, out)
    const h = new Vector3(out.aimWorld.x, 0, out.aimWorld.z).normalize()
    const away = new Vector3(300, 0, -1000).normalize()
    expect(h.dot(away)).toBeGreaterThan(0.999)
  })
})

describe('穩定段與脫離距離照機種推導', () => {
  /** 尺是最佳持續迴旋：它只隨機種與高度變，不隨當下的速度跳 */
  function expected(spec: AircraftSpec): { rollOut: number, radius: number } {
    const omega = bestSustainedTurnRateCached(spec, ALT)
    const v = bestSustainedTurnSpeedCached(spec, ALT)
    const p = maxRollRate(spec, ALT, TAS)
    return { rollOut: (TAS * Math.atan((v * omega) / G0)) / p, radius: v / omega }
  }

  /**
   * 【為什麼不用當下速度的持續迴旋】接近極速時多餘功率趨近 0，半徑暴增：
   * He 111 在 1,500 m，80／95／105／110 m/s 是 559／924／2,007／0 m。拿它當尺，
   * 同一架飛機這一趟拉 1.9 km、下一趟拉 7 km。
   */
  it('尺不隨當下的速度跳：快 15 m/s，脫離距離多出的量只來自前拋', () => {
    setBombBallistics(K, DT)
    const slow = createStrikeState()
    const fast = createStrikeState()
    const a = plane()
    const b = plane()
    b.state.velocity.set(0, 0, -(TAS + 15))
    stepStrike(slow, a, target(), 0, BOMB_PROFILE, true, true, DT, createCommand())
    stepStrike(fast, b, target(), 0, BOMB_PROFILE, true, true, DT, createCommand())
    const gap = (s: StrikeState) => s.plan.egressRange - s.plan.lockRange
    expect(gap(fast)).toBeCloseTo(gap(slow), 6)
  })

  /** 地面目標不動，`lead` 是 0：鎖定距離 − 放手距離 ＝ 窗的餘裕 ＋ 滾回水平的那一段。 */
  it('鎖定距離多出「從最佳持續迴旋的坡度滾回水平」要飛的距離', () => {
    const st = planned()
    const { rollOut } = expected(B17G)
    expect(rollOut).toBeGreaterThan(50)
    expect(st.plan.lockRange - st.plan.releaseRange!).toBeCloseTo(RUN_SETTLE + rollOut, 0)
  })

  it('滾得快的留得短：P-51 的穩定段比 B-17 短', () => {
    const b17 = planned(B17G)
    const p51 = planned(P51D)
    expect(p51.plan.lockRange - p51.plan.releaseRange!)
      .toBeLessThan(b17.plan.lockRange - b17.plan.releaseRange!)
  })

  /**
   * 【轉進脫離那一步就定下來】脫離段 12° 爬升，B-17 從 108 掉到 69 m/s，迴旋
   * 半徑跟著縮；每拍重算的話目標距離從 9.3 km 一路縮到 3.4 km，拉不遠。
   */
  it('脫離距離在轉進脫離時定下來，脫離中掉速不會把它縮短', () => {
    const st = planned()
    st.phase = 'run'
    st.target = 0
    stepStrike(st, at(st.plan.lockRange - 50), target(), 0, BOMB_PROFILE, false, true, DT, createCommand())
    expect(st.phase).toBe('egress')
    const fixed = st.plan.egressRange

    const slow = at(fixed - 200)
    slow.state.velocity.set(0, 0, 60)
    stepStrike(st, slow, target(), 0, BOMB_PROFILE, true, true, DT, createCommand())
    expect(st.plan.egressRange).toBeLessThan(fixed - 200)
    expect(st.phase).toBe('egress')
  })

  it('脫離距離 ＝ 鎖定距離 ＋ EGRESS_TURNS 個最佳持續迴旋直徑', () => {
    const st = planned()
    const { radius } = expected(B17G)
    expect(st.plan.egressRange - st.plan.lockRange).toBeCloseTo(EGRESS_TURNS * 2 * radius, 0)
    expect(EGRESS_TURNS).toBeGreaterThan(1)
  })
})
