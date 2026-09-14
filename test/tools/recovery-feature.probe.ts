/** 單格改出特徵檢查器；參數由環境變數覆寫，不進測試組。 */
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import {
  RECOVERY_V2_COEFFS, createRecoveryFeatures, predictFromFeatures,
  recoveryFeatures, setupAircraft,
} from '../../src/tools/recoveryModel'

declare const process: { env: Record<string, string | undefined> }

const spec = process.env['SPEC'] === 'b17g' ? B17G : P51D
const number = (name: string, fallback: number): number => Number(process.env[name] ?? fallback)
const aircraft = setupAircraft({
  spec,
  ground: number('GROUND', 1000),
  agl: number('AGL', 20),
  tas: number('TAS', 60),
  gammaDeg: number('GAMMA', -20),
  bankDeg: number('BANK', 0),
  rollRateDeg: number('ROLL', 0),
  load: number('LOAD', 1),
  intent: 'strafe',
})
const features = createRecoveryFeatures()
recoveryFeatures(aircraft, features, process.env['DIRECTION'] === 'lift' ? 'lift-horizontal' : 'velocity')
console.log(JSON.stringify({ features, predicted: predictFromFeatures(features, RECOVERY_V2_COEFFS) }, null, 2))
