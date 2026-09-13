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
