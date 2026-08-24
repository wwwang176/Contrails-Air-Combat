/**
 * **橫越目標的追瞄對照** —— 只用兩個分支都有的 API，好讓同一支檔案原封不動
 * 放到 main 的 worktree 跑。不是測試（`.probe.ts`）。跑法：
 *   npx vite-node test/tools/crossing-compare.probe.ts
 *
 * 【它回答的問題】專案負責人：「我記得原版也是有延遲，但為什麼跟得上預瞄點？
 * 用一個從左到右橫飛的模擬看看。」場景：敵機在正前方 600 m、同高、以 180 m/s
 * 從左舷橫越到右舷（釘死直線、打不死）。我機 Bf 109、VETERAN（0.3 s 延遲）。
 *
 * 逐秒印「機首離預瞄點幾度」—— 咬住 = 幾度以內。
 */
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { VETERAN } from '../../src/ai/profile'
import { BF109G6 } from '../../src/specs/bf109g6'
import { P51D } from '../../src/specs/p51d'
import type { Command, Controller } from '../../src/control/Controller'
import type { AircraftSpec } from '../../src/specs/types'
import type { Battery } from '../../src/weapons/types'

const DT = 1 / 240
const RAD = Math.PI / 180
const FWD = new Vector3(0, 0, -1)
const ALT = 5000
const TAS = 180
const SECONDS = 30

function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}
const MINE: AircraftSpec = { ...BF109G6, battery: harmless(BF109G6.battery) }
const DRONE: AircraftSpec = { ...P51D, battery: harmless(P51D.battery) }

class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(FWD)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

const world = new World()
const mine = new Aircraft(MINE, ALT, TAS)
const drone = new Aircraft(DRONE, ALT, TAS)

const minePos = new Vector3(0, ALT, 0)
// 由左舷出發：放在正前方 600 m、往 +X（右舷方向）橫飛
const dronePos = new Vector3(0, ALT, -600)
const droneVel = new Vector3(TAS, 0, 0)

mine.state.position.copy(minePos)
mine.state.velocity.set(0, 0, -TAS)
mine.prevPosition.copy(minePos)
drone.state.position.copy(dronePos)
drone.state.velocity.copy(droneVel)
drone.state.orientation.setFromUnitVectors(FWD, new Vector3(1, 0, 0))
drone.prevPosition.copy(dronePos)
drone.prevOrientation.copy(drone.state.orientation)

const ai = new AiController()
const mc = world.add(mine, ai, 'blue', minePos, ALT, TAS)
const dc = world.add(drone, new Idle(), 'red', dronePos, ALT, TAS)
mc.respawnOnDestroy = false
dc.respawnOnDestroy = false
ai.board = createTargetBoard(world.combatants)
ai.selfIndex = mc.index
ai.profile = VETERAN

const droneStart = dronePos.clone()
const nose = new Vector3()
const prevVel = mine.state.velocity.clone()
const accel = new Vector3()
let gMax = 0

console.log('   t   預瞄差  夾角   G    高度  空速   意圖     模式')
for (let s = 0; s < SECONDS * 240; s++) {
  world.step(DT)
  drone.state.position.copy(droneStart).addScaledVector(droneVel, (s + 1) * DT)
  drone.state.velocity.copy(droneVel)
  drone.state.angularVelocity.set(0, 0, 0)
  drone.prevPosition.copy(drone.state.position)
  drone.prevOrientation.copy(drone.state.orientation)
  dc.hp = DRONE.hp
  dc.alive = true

  accel.copy(mine.state.velocity).sub(prevVel).divideScalar(DT)
  accel.y += 9.80665
  const g = accel.length() / 9.80665
  if (g > gMax) gMax = g
  prevVel.copy(mine.state.velocity)

  if (!mc.alive) { console.log('自機墜毀'); break }
  if (s % 240 !== 0) continue

  const lead = (ai as unknown as { basis: { leadPoint: Vector3 } }).basis.leadPoint
  const ll = lead.length()
  nose.copy(FWD).applyQuaternion(mine.state.orientation)
  const ld = ll > 1e-3
    ? Math.acos(Math.max(-1, Math.min(1, nose.dot(lead) / ll))) / RAD : 0
  const los = new Vector3().copy(drone.state.position).sub(mine.state.position)
  const asp = Math.acos(
    Math.max(-1, Math.min(1, nose.dot(los) / los.length())),
  ) / RAD

  console.log(
    `  ${(s * DT).toFixed(0).padStart(2)}  ${ld.toFixed(1).padStart(6)}°`
    + ` ${asp.toFixed(0).padStart(4)}° ${gMax.toFixed(1).padStart(4)}`
    + ` ${mine.state.position.y.toFixed(0).padStart(6)}`
    + ` ${mine.state.velocity.length().toFixed(0).padStart(5)}`
    + `  ${(ai as unknown as { intent: string }).intent.padEnd(8)}`
    + ` ${(ai as unknown as { mode: string }).mode}`,
  )
  gMax = 0
}
