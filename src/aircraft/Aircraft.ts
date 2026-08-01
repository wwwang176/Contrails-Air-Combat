import { Quaternion, Vector3 } from 'three'
import { G0 } from '../core/math'
import {
  createDiagnostics, createFlightState, stepDynamics, type StepDiagnostics,
} from '../physics/dynamics'
import {
  FlightDirector, createDirectorDebug, type DirectorDebug,
} from '../control/FlightDirector'
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
  state: FlightState
  readonly diag: StepDiagnostics = createDiagnostics()
  readonly controls: Controls = { aileron: 0, elevator: 0, rudder: 0, throttle: 0 }
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
  }

  reset(altitude: number, tas: number): void {
    this.state = createFlightState(altitude, tas)
    this.prevPosition.copy(this.state.position)
    this.prevOrientation.copy(this.state.orientation)
    this.director.reset()
    this.diag.slatsDeployed = false
    this.controls.aileron = 0
    this.controls.elevator = 0
    this.controls.rudder = 0
    this.lastEnergy = this.specificEnergy
    this.psActual = 0
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
   * 本任務的前一版在此有一次 body → world 的轉換，是為了抵銷指揮儀內部的
   * 逆轉換（淨效果是恆等變換，也就是機體固定準星）；世界固定裁決之後
   * 該轉換整個移除，指揮儀拿到的才是真正的世界方向。
   */
  update(aimDirWorld: Vector3, throttle: number, dt: number): void {
    this.prevPosition.copy(this.state.position)
    this.prevOrientation.copy(this.state.orientation)

    this.controls.throttle = throttle
    stepDynamics(this.spec, this.state, this.controls, dt, this.diag)

    this.director.update(
      this.spec, this.state, this.diag.aero, this.diag.slatsDeployed,
      aimDirWorld, dt, this.controls, this.dbg,
    )

    const es = this.specificEnergy
    this.psActual = dt > 0 ? (es - this.lastEnergy) / dt : 0
    this.lastEnergy = es
  }
}
