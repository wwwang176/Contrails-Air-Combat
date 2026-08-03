import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  createDiagnostics, createFlightState, stepDynamics,
} from '../../src/physics/dynamics'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import type { AircraftSpec } from '../../src/specs/types'
import type { Controls, FlightState } from '../../src/physics/types'
import { RAD } from '../../src/core/math'

const DT = 1 / 240
const UP = new Vector3(0, 1, 0)
const FWD = new Vector3(0, 0, -1)

/**
 * 懸掛入場速度，m/s（288 km/h）。
 *
 * 【為什麼不是計畫原訂的 200 m/s】實測：中立舵、200 m/s 垂直入場的飛機在
 * 掉速之前就先低頭了——全程最低只到 476 km/h，`controlAuthority` 從未低於
 * 1，懸掛根本沒發生。80 m/s 是真的會懸掛的躍升入場：TAS 一路掉到 106 km/h
 * （遠低於 1 G 失速的 173 km/h），操縱權掉到 0.25。實測表見 spec §8.2。
 */
const ENTRY_TAS = 80
const HANG_SECONDS = 20

interface Sample {
  t: number
  altitude: number
  tas: number
  /** 此刻若拉滿舵，0.6 秒內換得到的峰值俯仰率，°/s */
  pitchRate: number
  /** 機首仰角，° */
  noseElevation: number
  authority: number
}

function cloneState(s: FlightState): FlightState {
  return {
    position: s.position.clone(),
    velocity: s.velocity.clone(),
    orientation: s.orientation.clone(),
    angularVelocity: s.angularVelocity.clone(),
  }
}

/**
 * 從給定狀態出發，升降舵打滿 0.6 秒能換到的峰值俯仰率，°/s。
 *
 * 【為什麼要用複製狀態】滿舵**不能**當作「維持懸掛」的指令：實測 200 m/s
 * 垂直入場滿舵，0.3 秒就翻進俯衝、全程 `authority = 1`，低速區根本進不去。
 * 那不是設計失效，是「你還有操縱權，所以你翻得出去」的正確物理。
 *
 * 所以把兩件事分開：主軌跡以中立舵維持懸掛，操縱權則由這支不干擾主軌跡的
 * 探針去問。量的仍然是計畫要的那個量——舵面打滿換得到多少姿態控制。
 */
function probePitchRate(spec: AircraftSpec, from: FlightState): number {
  const state = cloneState(from)
  const diag = createDiagnostics()
  const controls: Controls = { aileron: 0, elevator: 1, rudder: 0, throttle: 1.1, brake: 0 }
  let peak = 0
  for (let i = 0; i < 240 * 0.6; i++) {
    stepDynamics(spec, state, controls, DT, diag)
    peak = Math.max(peak, Math.abs(state.angularVelocity.x) * RAD)
  }
  return peak
}

/**
 * 垂直向上、舵面中立、油門全開，全程取樣。
 *
 * 【為什麼不用 Aircraft】這一條驗的是物理不是指揮儀。中立舵加上獨立的滿舵
 * 探針，把「舵面打滿換得到多少俯仰率」單獨隔離出來。
 */
function verticalHang(spec: AircraftSpec, altitude: number, tas: number, seconds: number): Sample[] {
  const state = createFlightState(altitude, tas)
  state.velocity.copy(UP).multiplyScalar(tas)
  state.orientation.setFromUnitVectors(FWD, UP)
  const diag = createDiagnostics()
  const controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: 1.1, brake: 0 }

  const nose = new Vector3()
  const out: Sample[] = []
  const steps = Math.round(seconds / DT)
  for (let i = 0; i <= steps; i++) {
    if (i % 24 === 0) {
      nose.copy(FWD).applyQuaternion(state.orientation)
      out.push({
        t: i * DT,
        altitude: state.position.y,
        tas: state.velocity.length(),
        pitchRate: probePitchRate(spec, state),
        noseElevation: Math.asin(Math.max(-1, Math.min(1, nose.y))) * RAD,
        authority: diag.controlAuthority,
      })
    }
    stepDynamics(spec, state, controls, DT, diag)
  }
  return out
}

/**
 * 【門檻由 Task 4 的量測訂出】入場點（t = 0、288 km/h、authority = 1）的滿舵
 * 俯仰率取四分之一：P-51D 195.4 → 48.85，向下取整到 48。這不是配出來的數字
 * ——它是「舵面打滿卻只剩入場時四分之一的效果」這句話的量化。
 *
 * 【基準取入場點而不是全程最大值】全程最大值落在**改出段**（t = 20 s、
 * 397 km/h、278.9 °/s），那是俯衝加速後的數字，與懸掛前的手感無關。入場點
 * 才是玩家做這個決定時的參考點。
 *
 * 兩台的實測谷底分別是 26.4 與 26.9 °/s，距門檻有 1.8 倍餘裕；入場值 195.4
 * 與 221.4 °/s，距 `門檻 × 3` 有 1.36 倍餘裕。模擬完全確定性，沒有隨機來源，
 * 所以這個餘裕足夠。
 *
 * 實測表見 spec §8.2。
 */
const PITCH_RATE_FLOOR = 48
/** 首次跌破門檻的時間（P-51D 5.9 s、Bf 109 6.1 s）加 2 秒。 */
const COLLAPSE_TIME = 8.1

describe('L4-A 脫離必須發生', () => {
  for (const spec of [P51D, BF109G6]) {
    it(`${spec.name}：垂直懸掛時滿舵換不到姿態控制`, () => {
      const samples = verticalHang(spec, 1000, ENTRY_TAS, HANG_SECONDS)

      // 一：入場點的滿舵俯仰率遠高於門檻——否則這條測試量不到東西
      const entry = samples[0]!
      expect(entry.authority).toBe(1)
      expect(entry.pitchRate).toBeGreaterThan(PITCH_RATE_FLOOR * 3)

      // 二：低速段必須跌破門檻，且在時限內
      const collapsed = samples.find((s) => s.pitchRate < PITCH_RATE_FLOOR)
      expect(collapsed, '俯仰率從未跌破門檻').toBeDefined()
      expect(collapsed!.t).toBeLessThan(COLLAPSE_TIME)

      // 三：跌破的時候，操縱權確實已經在拐點以下——把因果釘死。
      // 若哪天俯仰率跌破了但 authority 仍是 1，代表這條測試量到的是別的東西。
      expect(collapsed!.authority).toBeLessThan(1)

      // 四：全程有限，沒有數值爆掉
      for (const s of samples) {
        expect(Number.isFinite(s.tas)).toBe(true)
        expect(Number.isFinite(s.pitchRate)).toBe(true)
      }
    })

    /**
     * 驗收條件 4：機頭最終被重力帶下來，不會維持指向。
     *
     * 【為什麼要單獨驗這一條】舵面失效只保證「你控制不了」，不保證
     * 「機頭會掉下來」。若氣動阻尼把飛機鎖在垂直姿態，結果會是一架
     * 卡在天上的飛機——那比原本的問題更糟。
     */
    it(`${spec.name}：機頭最終被重力帶下來`, () => {
      const samples = verticalHang(spec, 1000, ENTRY_TAS, HANG_SECONDS)
      const last = samples[samples.length - 1]!
      expect(last.noseElevation).toBeLessThan(0)
    })
  }
})
