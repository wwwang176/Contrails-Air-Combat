/**
 * 【一次性量測】複製 ai-defence.test.ts 的「後下方 400 m」場景，印紅 B 的
 * 意圖／extend 事由／高度差時間線 —— 追「reactionSeconds 8.5 s」的根因。
 *
 *   npx vite-node test/tools/defence-below.probe.ts
 */
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { extendReason } from '../../src/ai/rules'
import { createTargetBoard } from '../../src/ai/target'
import { threatFactor } from '../../src/ai/assess'
import { P51D } from '../../src/specs/p51d'

const DT = 1 / 240
const ALT = 4000
const TAS = 200
const FWD = new Vector3(0, 0, -1)

function place(a: Aircraft, pos: Vector3, look: Vector3): void {
  const dir = look.clone().sub(pos).normalize()
  a.state.position.copy(pos)
  a.state.velocity.copy(dir).multiplyScalar(TAS)
  a.state.orientation.setFromUnitVectors(FWD, dir)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
}

const world = new World()
const blue = new Aircraft(P51D, ALT, TAS)
const redA = new Aircraft(P51D, ALT, TAS)
const redB = new Aircraft(P51D, ALT, TAS)

const bluePos = new Vector3(0, ALT, 0)
const aPos = new Vector3(0, ALT, -400)
const bPos = bluePos.clone().add(new Vector3(0, -150, 380))

place(redA, aPos, aPos.clone().add(new Vector3(0, 0, -1000)))
place(blue, bluePos, aPos)
place(redB, bPos, bluePos)

const bc = world.add(blue, new AiController(), 'blue', bluePos, ALT, TAS)
world.add(redA, new AiController(), 'red', aPos, ALT, TAS)
const rbc = world.add(redB, new AiController(), 'red', bPos, ALT, TAS)

const board = createTargetBoard(world.combatants)
for (const c of world.combatants) {
  const ai = c.controller
  if (ai instanceof AiController) { ai.board = board; ai.selfIndex = c.index }
}
const blueAi = bc.controller as AiController
const redBAi = rbc.controller as AiController

console.log('   t   紅B意圖    事由     紅B高度差  floorGap  紅B射解  藍意圖')
for (let s = 0; s < 30 * 240; s++) {
  world.step(DT)
  if (s % 120 !== 0) continue
  const t = (s * DT).toFixed(1).padStart(5)
  const dy = (redB.state.position.y - blue.state.position.y).toFixed(0).padStart(7)
  const fg = Number.isFinite(redBAi.sit.floorGap)
    ? redBAi.sit.floorGap.toFixed(0).padStart(7) : '     ∞'
  const tf = threatFactor(redB, blue) > 0 ? '有' : '—'
  console.log(
    `${t}  ${redBAi.intent.padEnd(8)} ${extendReason(redBAi.rules).padEnd(6)}`
    + ` ${dy}  ${fg}     ${tf}    ${blueAi.intent}`,
  )
}
