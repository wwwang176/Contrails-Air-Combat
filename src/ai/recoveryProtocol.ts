import type { AircraftSpec } from '../specs/types'

/** `FlightState`、舵面、診斷旗標與 FlightDirector 動態狀態的欄位數。 */
export const RECOVERY_SNAPSHOT_SIZE = 40

export interface RecoveryRequest {
  id: number
  sequence: number
  /** 模擬時鐘，供主線計算非同步結果的年齡。 */
  sentAt: number
  terrainTurn: number
  /** 實際 spec 內容的穩定雜湊；同一份手感參數跨場共用。 */
  specKey: string
  /** 同一控制器首次送出或換機種時才附上。 */
  spec: AircraftSpec | undefined
  snapshot: Float64Array
  /** > 0 時先照候選命令飛這麼久，再執行完整改出；供解除接管前的影子預演。 */
  trialSeconds?: number
  trialAimX?: number
  trialAimY?: number
  trialAimZ?: number
  trialThrottle?: number
  trialBrake?: number
  trialUpright?: boolean
}

export interface RecoveryResponse {
  readonly id: number
  readonly sequence: number
  readonly drop: number
  readonly seconds: number
  readonly recovered: boolean
  readonly computeMs: number
  readonly error?: string
}
