import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  createDiagnostics, createFlightState, stepDynamics,
} from '../../src/physics/dynamics'
import { LOW_SPEED_KNEE, stallDynamicPressure } from '../../src/physics/aero'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { AiController } from '../../src/ai/AiController'
import { PILOT_G_POSITIVE } from '../../src/control/limiters'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
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
  for (const spec of [P51D, BF109K4]) {
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

interface Recovery {
  /**
   * 全程是否真的進入過失能（`controlAuthority < 1`）。
   *
   * 【為什麼需要這個欄位】沒有它的話有一半的案例是假通過：3,000 m、80 m/s
   * 的動壓是 2,909 Pa，已經在拐點（1,858 Pa）之上，「恢復」條件在第 0 步就
   * 成立了，等於什麼都沒驗。這個旗標讓「從未陷入麻煩」變成紅燈而不是綠燈。
   */
  distressed: boolean
  /** 是否恢復到可控飛行 */
  recovered: boolean
  /** 進入失能後恢復所花的秒數；未恢復為 Infinity */
  seconds: number
  /** 全程最低高度，m */
  minAltitude: number
  /** 恢復後三秒內的過載峰值 */
  peakG: number
  finite: boolean
}

/**
 * 把飛機放成垂直懸掛的姿態，交給 AI，看它救不救得回來。
 *
 * 【目標放在很遠的地方】這一條驗的是**救機**，不是纏鬥。目標擺遠讓 AI 的
 * 意圖落在 approach，轉向不會干擾判定；但目標仍然存在，所以走的是完整的
 * 程式路徑而不是「沒有目標」那條捷徑。
 *
 * 【恢復的定義】**先進入失能**（`controlAuthority < 1`），然後速度回到拐點
 * 以上（舵面重新有效）**而且**航跡角高於 −60°（不是還在直直往下掉）。
 *
 * 三個條件都要。少了「先進入失能」，80 m/s 那幾組會在第 0 步就算恢復；
 * 少了航跡角，單看速度的話一路俯衝到底也會「恢復」。
 */
function aiRecovery(spec: AircraftSpec, altitude: number, tas: number): Recovery {
  const self = new Aircraft(spec, altitude, tas)
  self.state.position.set(0, altitude, 0)
  self.state.velocity.copy(UP).multiplyScalar(tas)
  self.state.orientation.setFromUnitVectors(FWD, UP)
  self.prevPosition.copy(self.state.position)
  self.prevOrientation.copy(self.state.orientation)

  const target = new Aircraft(spec, 5000, 180)
  target.state.position.set(0, 5000, -6000)
  target.prevPosition.copy(target.state.position)

  const ai = new AiController()
  ai.target = target
  const cmd = createCommand()

  const qKnee = LOW_SPEED_KNEE * stallDynamicPressure(spec)
  let distressedAt = Infinity
  let recoveredAt = Infinity
  let minAltitude = altitude
  let peakG = 0

  for (let i = 0; i < 40 * 240; i++) {
    const t = i * DT
    ai.update(self, DT, cmd)
    self.update(cmd.aimWorld, cmd.throttle, DT, cmd.brake)
    target.update(FWD, 0.7, DT)

    minAltitude = Math.min(minAltitude, self.state.position.y)
    if (!Number.isFinite(self.state.position.y)) {
      return {
        distressed: distressedAt !== Infinity,
        recovered: false, seconds: t, minAltitude: -Infinity, peakG, finite: false,
      }
    }

    if (distressedAt === Infinity && self.diag.controlAuthority < 1) distressedAt = t

    const v = self.state.velocity
    const speed = v.length()
    const gamma = speed > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, v.y / speed))) : 0
    if (distressedAt !== Infinity
      && recoveredAt === Infinity
      && self.diag.aero.qbar >= qKnee
      && gamma > -60 * (Math.PI / 180)) {
      recoveredAt = t
    }
    // 恢復後三秒內的過載峰值——積分飽和會在這裡表現成一個尖峰
    if (recoveredAt !== Infinity && t <= recoveredAt + 3) {
      peakG = Math.max(peakG, Math.abs(self.diag.loadFactor))
    }
  }

  return {
    distressed: distressedAt !== Infinity,
    recovered: recoveredAt !== Infinity,
    seconds: recoveredAt === Infinity ? Infinity : recoveredAt - distressedAt,
    minAltitude,
    peakG,
    finite: true,
  }
}

describe('L4-B AI 必須救得回來', () => {
  const CASES: readonly [number, number][] = [
    [3000, 40],   // 幾乎停住
    [3000, 80],   // 還有一點速度
    [1500, 40],   // 低空且幾乎停住
    [1500, 80],
  ]

  for (const spec of [P51D, BF109K4]) {
    for (const [altitude, tas] of CASES) {
      it(`${spec.name} / ${altitude} m / ${(tas * 3.6).toFixed(0)} km/h 垂直懸掛 → 救得回來`, () => {
        const r = aiRecovery(spec, altitude, tas)
        expect(r.finite).toBe(true)
        // 【先確認這一組真的量得到東西】沒進入失能就沒有救機可言，該紅
        expect(r.distressed, '全程未進入失能，這一組什麼都沒驗到').toBe(true)
        expect(r.recovered, '四十秒內未恢復可控飛行').toBe(true)
        // 【不觸海是硬要求】spec §8.3 條件 5
        expect(r.minAltitude).toBeGreaterThan(0)
        /**
         * 【過載尖峰是積分飽和的指紋】指揮儀的 PID 在舵面失效期間看不到
         * 飽和（`controls.elevator` 讀起來仍是滿舵，是空氣不理它），積分項
         * 會爬到上限；速度回來的瞬間那個積分變成一個猛拉。若這裡紅了，
         * 先確認是不是 spec §5.2 說的那件事，再考慮調衰減陡度。
         */
        expect(r.peakG).toBeLessThan(PILOT_G_POSITIVE + 0.5)
      })
    }
  }
})
