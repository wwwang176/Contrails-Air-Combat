import { Quaternion, Vector3 } from 'three'
import { G0 } from '../core/math'
import {
  createDiagnostics, createFlightState, stepDynamics, type StepDiagnostics,
} from '../physics/dynamics'
import {
  FlightDirector, createDirectorDebug, type DirectorDebug,
} from '../control/FlightDirector'
import { DEFAULT_ACTUATOR_RATES, slewSurfaces, type ActuatorRates } from '../control/actuator'
import type { AircraftSpec } from '../specs/types'
import type { Controls, FlightState } from '../physics/types'

/**
 * 一架飛機：機種資料、運動狀態、診斷、舵面指令與飛行指揮儀的組裝體。
 *
 * 【一步的順序：stepDynamics 先、director.update 後】
 * 指揮儀在一步的結尾依「積分後的新狀態」算出舵面，該舵面套用於下一步，
 * 形成一步（240 Hz 下 4.17 ms）的延遲。這麼做的理由有二：
 *   1. Task 18 的 L4 矩陣（120 案例）就是在這個順序下驗證通過的。
 *      測試怎麼跑，遊戲就怎麼跑——否則遊戲裡的動力學不是被測過的那一個。
 *   2. 指揮儀讀的是最新狀態，控制迴路的相位反而較好；4 ms 的舵面延遲
 *      遠小於飛機本身的滾轉/俯仰時間常數，實務上無法察覺。
 */
export class Aircraft {
  spec: AircraftSpec
  /**
   * 運動狀態。**物件本身恆不更換** —— `reset` 就地寫回四個欄位。
   *
   * 【`readonly` 是護欄不是裝飾】`this.state = createFlightState(...)` 會把
   * `state.position` 換成新的 `Vector3`，於是指揮層在 `createBattle` 抓的
   * 那個參考變成孤兒，「再打一場」之後整場讀凍結座標（40/40 架失聯、最大
   * 落差 5300 m）。這個修飾字讓那件事在型別層就不可能發生。見 `reset` 的
   * 註解。
   */
  readonly state: FlightState
  readonly diag: StepDiagnostics = createDiagnostics()
  /** 指揮儀輸出的舵面**指令**。舵面實際位置見 `surfaces`。 */
  readonly controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: 0, brake: 0 }
  /**
   * 舵面**實際位置**——物理層讀的是這一份。
   *
   * 指揮儀每步可以下任意大的指令跳變，但舵面要花時間走過去
   * （見 control/actuator.ts）。分成兩份而不是就地限速，是為了讓歸因面板
   * 能同時看到「要求」與「做到」：兩者長時間分離就代表舵面在追不上，
   * 那是內環增益過高的直接證據。
   */
  readonly surfaces: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: 0, brake: 0 }
  actuatorRates: ActuatorRates = DEFAULT_ACTUATOR_RATES
  readonly director = new FlightDirector()
  readonly dbg: DirectorDebug = createDirectorDebug()

  /** 供渲染插值使用的前一步狀態。 */
  readonly prevPosition = new Vector3()
  readonly prevOrientation = new Quaternion()

  private lastEnergy = 0
  private psActual = 0

  constructor(spec: AircraftSpec, altitude = 4000, tas = 150) {
    this.spec = spec
    this.state = createFlightState(altitude, tas)
    this.prevPosition.copy(this.state.position)
    this.prevOrientation.copy(this.state.orientation)
    this.lastEnergy = this.specificEnergy
  }

  /** 比能量 Es = h + V²/(2g)，公尺。能量戰的統一貨幣。 */
  get specificEnergy(): number {
    const v = this.state.velocity.length()
    return this.state.position.y + (v * v) / (2 * G0)
  }

  /** 實測比超量功率，m/s。正值代表能量累積。 */
  get specificExcessPowerActual(): number {
    return this.psActual
  }

  /**
   * 換裝機種。運動狀態原樣保留（換的是飛機不是處境），但所有
   * 「屬於前一架飛機」的控制器內部狀態必須清乾淨：
   *   - director 的三組 PID 積分項與微分項歷史（增益是機種無關的，
   *     但積分量已經是為前一架飛機的舵效累積出來的）
   *   - 縫翼遲滯旗標（Bf 109 有縫翼、P-51D 沒有；旗標是輸入兼輸出，
   *     跨機種沿用等於把別人的遲滯狀態帶進來）
   */
  setSpec(spec: AircraftSpec): void {
    this.spec = spec
    this.director.reset()
    this.diag.slatsDeployed = false
    // 舵面實際位置同樣屬於「前一架飛機」——它是那架飛機的作動器走到的地方，
    // 與 PID 積分項是同一類殘留。不清會讓換裝瞬間繼承別人的舵面偏轉
    // （實測洩漏量 0.042 rad/s 的角速度差，恰為此測試抓到的量）。
    this.surfaces.aileron = 0
    this.surfaces.elevator = 0
    this.surfaces.rudder = 0
  }

  /**
   * 回到「朝 −Z 平飛」的初始狀態。
   *
   * 【就地寫回，不換 `state` 物件】`this.state = createFlightState(...)`
   * 會把 `state.position` 換成一個**新的** `Vector3`，於是任何在此之前抓過
   * 那個向量的人，從此永遠讀到一個停在重置那一刻的孤兒。
   *
   * 實際中招的是指揮層：`setup.ts` 的 `createBattle` 把快照的位置抓成參考
   * （`position: c.aircraft.state.position`，而且是 `readonly`，抓一次就再也
   * 接不回去）。`resetBattle`（再打一場）對每一架都呼叫 `World.respawn` →
   * `reset()`，所以**重開一場之後整個指揮層讀到的是一整場凍結的座標**。
   * 實測 40/40 架失聯、最大落差 5300 m，集合令因此解除不掉，最長握了 344 秒
   * （人工回報 196 秒）—— 症狀是 AI 繞著一個五公里外的鬼位置無限盤旋。
   * 見 `test/tools/rally-reset.probe.ts`。
   *
   * 壞掉的不只集合令：側翼落點、集火解除、撤退令錨的敵群質心，指揮層每一個
   * 吃位置的判斷都一起讀鬼影。
   *
   * 【為什麼修這裡而不是只修指揮層】換物件是一顆對**所有**持有者的地雷，
   * 指揮層只是第一個踩到的。`FlightState` 只有四個欄位，就地寫回是完整的，
   * 而且與 `createFlightState` 的初值逐位元相同（`new Quaternion()` 是單位
   * 四元數、`new Vector3()` 是零向量）。
   *
   * 【`state` 已標成 `readonly`】那一行才是真正的護欄 —— 它讓「換掉 state」
   * 這件事在型別層就不可能再發生。
   */
  reset(altitude: number, tas: number): void {
    this.state.position.set(0, altitude, 0)
    this.state.velocity.set(0, 0, -tas)
    this.state.orientation.set(0, 0, 0, 1)
    this.state.angularVelocity.set(0, 0, 0)
    this.prevPosition.copy(this.state.position)
    this.prevOrientation.copy(this.state.orientation)
    this.director.reset()
    this.diag.slatsDeployed = false
    this.controls.aileron = 0
    this.controls.elevator = 0
    this.controls.rudder = 0
    this.surfaces.aileron = 0
    this.surfaces.elevator = 0
    this.surfaces.rudder = 0
    this.lastEnergy = this.specificEnergy
    this.psActual = 0
  }

  /**
   * 重生：重置飛機，**並且**把世界瞄準點放回新的機首方向。
   *
   * 【為什麼要有這個函式，而不是在兩處各呼叫一次 reset + 歸位】
   * 世界固定瞄準點會活過 reset：瞄準點是世界方向，重置飛機不會動到它。
   * 玩家俯衝撞海時瞄準點正指著海面，自動重置若只呼叫 reset，飛機一重生
   * 就被指令朝著（相對新機首 92° 的）舊方向飛，被圓錐夾制拖到機首下方
   * 11.375°，於是**放著不動也會一路推頭飛回海裡**（實測 60 秒由 4000 m
   * 掉到 2006 m，負過載 −0.79）。
   *
   * 手動重置（R）與撞海重置是同一件事，必須走同一條程式碼路徑——
   * 這與把撞海判定抽成 `isCrashed` 是同一個理由：兩份長得很像的副本，
   * 就是只有一份會被修好的那種危險。
   */
  respawn(aimWorld: Vector3, altitude: number, tas: number): void {
    this.reset(altitude, tas)
    aimWorld.set(0, 0, -1).applyQuaternion(this.state.orientation)
  }

  /**
   * 推進一個物理步。熱路徑，禁止任何配置行為。
   *
   * @param aimDirWorld **世界座標**的瞄準方向（`InputState.aimWorld`）
   * @param throttle    玩家油門，0 ~ 1.1
   *
   * 【不要在這裡轉成機體座標】`FlightDirector.update` 的第五參數就叫
   * `aimDirWorld`，它自己在每一步用當下姿態的逆四元數轉成機體座標
   * （`FlightDirector.ts:191-192`）——這正是「每步做一次 world → body」
   * 這項要求的實作位置。若呼叫端先轉一次再傳進去，等於連轉兩次，
   * 瞄準方向會被姿態旋轉平方，飛機會追一個不存在的方向。
   * **這裡不做 body → world 的轉換** —— 那會抵銷指揮儀內部的逆轉換，
   * 淨效果是機體固定準星，而準星是世界固定的。
   */
  update(aimDirWorld: Vector3, throttle: number, dt: number, brake = 0): void {
    this.prevPosition.copy(this.state.position)
    this.prevOrientation.copy(this.state.orientation)

    this.controls.throttle = throttle
    this.controls.brake = brake
    // 舵面先走一步（受作動速率限制），物理層讀的是走完之後的實際位置。
    slewSurfaces(this.surfaces, this.controls, this.actuatorRates, dt)
    stepDynamics(this.spec, this.state, this.surfaces, dt, this.diag)

    this.director.update(
      this.spec, this.state, this.diag.aero, this.diag.slatsDeployed,
      aimDirWorld, dt, this.controls, this.dbg,
    )

    const es = this.specificEnergy
    this.psActual = dt > 0 ? (es - this.lastEnergy) / dt : 0
    this.lastEnergy = es
  }
}
