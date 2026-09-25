import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createSituation, evaluateEnergy, evaluateGeometry } from '../../src/ai/assess'
import { P51D } from '../../src/specs/p51d'
import { DEG } from '../../src/core/math'
import type { Battery } from '../../src/weapons/types'
import type { AircraftSpec } from '../../src/specs/types'
import { installRecoveryWorkerPortForTest } from '../../src/ai/recoveryWorkerClient'
import { RecoveryEngineTestPort } from '../helpers/recoveryEngineTestPort'

/**
 * # AI 纏鬥的決定性
 *
 * 兩架 AI P-51 對飛 300 秒，每 0.25 s 取樣一次機動統計；同一組開局跑兩次，
 * 統計必須完全相同。本檔不注入任何亂數，不同就是哪裡混進了不確定的輸入。
 */
beforeAll(() => { installRecoveryWorkerPortForTest(new RecoveryEngineTestPort()) })
afterAll(() => { installRecoveryWorkerPortForTest(null) })

const DT = 1 / 240
const SECONDS = 300
const FWD = new Vector3(0, 0, -1)

/**
 * 同一副武器，單發傷害歸零。彈道、初速、射速、匯聚、預瞄用的 `sight`
 * 全部不動。
 *
 * AI 的決策輸入（預瞄解、`shotInstant`、`threatInstant`、開火紀律）一個字
 * 都不變，但仗打不完，300 秒的觀察窗不會被提早結束的戰鬥截斷。
 */
function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}
const P51_BLUNT: AircraftSpec = { ...P51D, battery: harmless(P51D.battery) }

interface Side {
  altitude: number
  /** 水平位移 [x, z]，m */
  offset: [number, number]
  headingDeg: number
}

interface Metrics {
  /** 速度低於 1G 失速速度的取樣比例 */
  belowStall: number
  /** 安全層介入的取樣比例 */
  safetyShare: number
  /** 單次 extend 的最長連續秒數 */
  longestExtend: number
  /** 航跡角超過 ±45° 的取樣比例 */
  steepShare: number
  /** 機首偏離目標超過 90° 的取樣比例 */
  offNose: number
}

const TAS = 200

function duel(blue: Side, red: Side): Metrics {
  const world = new World()
  const make = (s: Side): { a: Aircraft; pos: Vector3 } => {
    const a = new Aircraft(P51_BLUNT, s.altitude, TAS)
    const pos = new Vector3(s.offset[0], s.altitude, s.offset[1])
    const h = s.headingDeg * DEG
    const dir = new Vector3(-Math.sin(h), 0, -Math.cos(h))
    a.state.position.copy(pos)
    a.state.velocity.copy(dir).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    return { a, pos }
  }
  const b = make(blue)
  const r = make(red)
  const blueAi = new AiController()
  const redAi = new AiController()
  const bc = world.add(b.a, blueAi, 'blue', b.pos, blue.altitude, TAS)
  const rc = world.add(r.a, redAi, 'red', r.pos, red.altitude, TAS)
  blueAi.target = r.a
  redAi.target = b.a
  bc.respawnOnDestroy = false
  rc.respawnOnDestroy = false

  const sit = createSituation()
  const los = new Vector3()
  const nose = new Vector3()
  let samples = 0
  let belowStall = 0
  let safety = 0
  let steep = 0
  let offNose = 0
  let longestExtend = 0
  let currentExtend = 0

  const steps = Math.round(SECONDS / DT)
  for (let s = 0; s <= steps; s++) {
    // 【每 0.25 s 取樣一次】足以解析週期 20 s 的振盪，又不會讓統計成本
    // 主導測試時間
    if (s % 60 === 0) {
      evaluateGeometry(b.a, r.a, sit)
      evaluateEnergy(b.a, r.a, sit)
      samples++
      if (sit.speedMargin < 1) belowStall++
      if (blueAi.safetyActive) safety++
      const v = b.a.state.velocity
      const sp = v.length()
      const gamma = sp > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, v.y / sp))) : 0
      if (Math.abs(gamma) > 45 * DEG) steep++
      los.copy(r.a.state.position).sub(b.a.state.position)
      const range = los.length()
      if (range > 1e-3) {
        los.divideScalar(range)
        nose.copy(FWD).applyQuaternion(b.a.state.orientation)
        if (Math.acos(Math.max(-1, Math.min(1, nose.dot(los)))) > Math.PI / 2) offNose++
      }
      if (blueAi.intent === 'extend') {
        currentExtend += 0.25
        if (currentExtend > longestExtend) longestExtend = currentExtend
      } else {
        currentExtend = 0
      }
    }
    world.step(DT)
  }
  return {
    belowStall: belowStall / samples,
    safetyShare: safety / samples,
    longestExtend,
    steepShare: steep / samples,
    offNose: offNose / samples,
  }
}

/** 對頭開局，1000 m */
const BLUE: Side = { altitude: 1000, offset: [0, 1500], headingDeg: 180 }
const RED: Side = { altitude: 1000, offset: [0, 0], headingDeg: 0 }

describe('AI 纏鬥（1v1、300 秒、子彈無傷害）', () => {
  it('決定性：同一組開局跑兩次結果完全相同', () => {
    const a = duel(BLUE, RED)
    const b = duel(BLUE, RED)
    expect(a).toEqual(b)
  }, 60000)
})
