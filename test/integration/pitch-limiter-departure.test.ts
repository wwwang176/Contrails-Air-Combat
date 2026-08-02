import { describe, it, expect } from 'vitest'
import { createDiagnostics, createFlightState, stepDynamics } from '../../src/physics/dynamics'
import { pitchRateLimit, createPitchLimit, gLoadFromOrientation } from '../../src/control/limiters'
import { clamp } from '../../src/core/math'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import type { AircraftSpec } from '../../src/specs/types'
import type { Controls } from '../../src/physics/types'

const DT = 1 / 240

/**
 * 用真實的 stepDynamics（240Hz）模擬一次「拉桿到限制器允許的最大俯仰率」
 * 的操作：指令在 1 秒內從 0 斜升到 pitchRateLimit 當下算出的 qMax，
 * 一個純比例（P）舵面回路把機體實際俯仰率（state.angularVelocity.x）
 * 追到這個指令上。回傳整段模擬中出現過的峰值迎角，以及該時刻「有效」
 * 失速臨界角（若縫翼已展開，含 slatAlphaBonus）。
 *
 * 這正是協調者用來抓出「brief 公式漏了重力支持項」這個 Critical 缺陷的
 * 手法：qMax = n_limit·g/V（未修正版本）在 V0=70 m/s 時會讓 P-51D 的
 * 峰值迎角衝到 32.2°（kp=3）／45.9°（kp=8）——遠遠超過失速臨界角
 * 17°。修正後（qMax = (n_limit−gLoad)·g/V）在同樣的驅動方式下，
 * 這 12 組（2 機型 × 3 速度 × 2 增益）全部把峰值迎角壓在有效失速臨界角
 * 之下。完整數據見 task-17-report.md「臨界修正」章節。
 */
function peakAlphaUnderRampedPull(
  spec: AircraftSpec, v0: number, kp: number, seconds = 6,
): { peakAlpha: number; peakEffCrit: number } {
  const state = createFlightState(0, v0)
  const diag = createDiagnostics()
  const pl = createPitchLimit()
  const controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: 1 }
  const steps = Math.round(seconds / DT)
  let peakAlpha = -Infinity
  let peakEffCrit = 0
  for (let i = 0; i < steps; i++) {
    const t = i * DT
    const gLoad = gLoadFromOrientation(state.orientation)
    // dt=0：只讓 stepDynamics 依「當下」state 重新算出 diag.aero / slatsDeployed，
    // 不積分——藉此在下指令前拿到與 state 一致的空速/迎角快照。
    stepDynamics(spec, state, controls, 0, diag)
    pitchRateLimit(spec, diag.aero, diag.slatsDeployed, gLoad, pl)
    const qCmd = Math.min(t / 1, 1) * pl.qMax
    controls.elevator = clamp(kp * (qCmd - state.angularVelocity.x), -1, 1)

    stepDynamics(spec, state, controls, DT, diag)
    const effCrit = spec.lift.alphaCrit + (diag.slatsDeployed ? spec.lift.slatAlphaBonus : 0)
    if (diag.aero.alpha > peakAlpha) {
      peakAlpha = diag.aero.alpha
      peakEffCrit = effCrit
    }
  }
  return { peakAlpha, peakEffCrit }
}

describe('限制後的俯仰率指令在真實動力學下不放飛機失速（迴歸測試）', () => {
  const specs: AircraftSpec[] = [P51D, BF109G6]
  const speeds = [70, 110, 160]
  const gains = [3, 8]

  for (const spec of specs) {
    for (const v0 of speeds) {
      for (const kp of gains) {
        it(`${spec.id} V0=${v0}m/s kp=${kp}：峰值迎角低於（含縫翼加成的）失速臨界角`, () => {
          const { peakAlpha, peakEffCrit } = peakAlphaUnderRampedPull(spec, v0, kp)
          expect(peakAlpha).toBeLessThan(peakEffCrit)
        })
      }
    }
  }
})
