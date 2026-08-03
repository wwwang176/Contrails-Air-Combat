import { Vector3 } from 'three'
import { World } from '../src/world/World'
import { Aircraft } from '../src/aircraft/Aircraft'
import { AiController } from '../src/ai/AiController'
import { P51D } from '../src/specs/p51d'
import { BF109G6 } from '../src/specs/bf109g6'

export const LOAD_DT = 1 / 240
export const LOAD_ALTITUDE = 4000
export const LOAD_TAS = 200

export interface AiLoadState {
  world: World
}

/**
 * 兩架互相纏鬥的 AI。
 *
 * 【與 M1 的 physics-load、M2 的 projectile-load 同一個「單一替換點」設計】
 * 門檻測試與 benchmark 呼叫同一份負載定義，改一處、兩邊量到同一份工作量。
 */
export function createAiLoad(): AiLoadState {
  const world = new World()
  const blue = new Aircraft(P51D, LOAD_ALTITUDE, LOAD_TAS)
  const red = new Aircraft(BF109G6, LOAD_ALTITUDE, LOAD_TAS)
  red.state.position.set(0, LOAD_ALTITUDE, -500)
  red.prevPosition.copy(red.state.position)

  const blueAi = new AiController()
  const redAi = new AiController()
  const b = world.add(
    blue, blueAi, 'blue', new Vector3(0, LOAD_ALTITUDE, 0), LOAD_ALTITUDE, LOAD_TAS,
  )
  const r = world.add(
    red, redAi, 'red', new Vector3(0, LOAD_ALTITUDE, -500), LOAD_ALTITUDE, LOAD_TAS,
  )
  blueAi.target = red
  redAi.target = blue
  // 【兩邊都重生】不然一分鐘內就會有人被打爆，之後量到的是「只剩一架在
  // 空轉」而不是纏鬥的成本。
  b.respawnOnDestroy = true
  r.respawnOnDestroy = true

  return { world }
}

export function stepAiLoad(state: AiLoadState): void {
  state.world.step(LOAD_DT)
}

export function resetAiLoad(state: AiLoadState): void {
  state.world.projectiles.clear()
  for (const c of state.world.combatants) state.world.respawn(c)
}
