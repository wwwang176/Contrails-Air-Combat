import { Aircraft } from '../aircraft/Aircraft'
import { createCommand, type Command } from '../control/Controller'
import type { AircraftSpec } from '../specs/types'
import { createSense, type TerrainSense } from './terrainSense'
import { readRecoverySnapshot } from './recoverySnapshot'
import { runRecoveryRollout, type RecoveryRolloutResult } from './recoveryRollout'
import type { RecoveryRequest, RecoveryResponse } from './recoveryProtocol'

/** Worker 內的可重用預演狀態；單一序列只需要一架 Aircraft。 */
export class RecoveryWorkerEngine {
  private readonly specs = new Map<string, AircraftSpec>()
  private aircraft: Aircraft | null = null
  private readonly command: Command = createCommand()
  private readonly sense: TerrainSense = createSense()
  private readonly result: RecoveryRolloutResult = { drop: 0, seconds: 0, recovered: false }

  run(request: RecoveryRequest): RecoveryResponse {
    const started = performance.now()
    try {
      if (request.spec !== undefined) this.specs.set(request.specKey, request.spec)
      const spec = this.specs.get(request.specKey)
      if (spec === undefined) throw new Error(`Worker 尚未註冊機種 ${request.specKey}`)
      if (this.aircraft === null) this.aircraft = new Aircraft(spec)
      else if (this.aircraft.spec !== spec) this.aircraft.setSpec(spec)

      readRecoverySnapshot(this.aircraft, request.snapshot)
      this.sense.turn = request.terrainTurn
      runRecoveryRollout(this.aircraft, this.command, this.sense, this.result)
      return {
        id: request.id,
        sequence: request.sequence,
        drop: this.result.drop,
        seconds: this.result.seconds,
        recovered: this.result.recovered,
        computeMs: performance.now() - started,
      }
    } catch (error) {
      return {
        id: request.id,
        sequence: request.sequence,
        drop: 0,
        seconds: 0,
        recovered: false,
        computeMs: performance.now() - started,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
