import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'
import { G4M } from '../../src/specs/g4m'
import { deckHeightOf, releaseRadiusOf, shipAt } from '../../src/ai/bombRun'
import { solveImpact } from '../../src/world/bomb'
import { Vector3 } from 'three'
import type { BombState, Impact } from '../../src/world/bomb'

/**
 * 攻擊航路的逐段追蹤。**一台 G4M、一艘不開火的船。**
 *
 * 【它找到過什麼】用它抓到 `lockRange` 寫死 3,000 m 的缺陷 ——
 * 4,000 m 的前拋將近 4 km，進到 3 km 才鎖航向早就飛過投彈點，落點誤差
 * 一路單調增加（503 → 1101 → 1694 → 2283 m）。整場統計看不出這件事，
 * 逐段的距離／高度／落點誤差才看得出來。
 *
 * 跑法：`npx vite-node test/tools/bomb-run-trace.probe.ts`
 */

const DT = 1 / 240
const st: BombState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
const hit: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }
const at = new Vector3()

function run(shipSpeed: number): void {
  const w = new World()
  w.crashPolicy = () => false
  const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -4000, 0, shipSpeed)
  ship.guns = []
  ship.gunCooldowns = new Float32Array(0)
  w.ships.push(ship)
  const ai = new AiController()
  const c = w.add(new Aircraft(G4M), ai, 'blue', new Vector3(0, 1000, 1000), 1000, 110)
  // 【`w.add` 只存重生點，不會把飛機放過去】少了這兩行它會留在
  // `new Aircraft()` 的預設高度（4,000 m），而那是完全不同的彈道
  c.aircraft.state.position.set(0, 1000, 1000)
  c.aircraft.prevPosition.copy(c.aircraft.state.position)
  ai.board = createTargetBoard([c])
  ai.selfIndex = 0
  ai.ships = w.ships
  ai.bombBay = c.bombBay
  ai.bombDrag = w.bombDrag

  console.log(`── 船速 ${shipSpeed} m/s ──`)
  let last = ''
  for (let i = 0; i < 200 * 240; i++) {
    w.step(DT)
    if (i % (5 * 240) !== 0) continue
    const p = c.aircraft.state.position
    const v = c.aircraft.state.velocity
    st.x = p.x; st.y = p.y; st.z = p.z
    st.vx = v.x; st.vy = v.y; st.vz = v.z
    const deck = deckHeightOf(ship.cls)
    let err = NaN
    let tf = NaN
    if (solveImpact(st, w.bombDrag, () => deck, DT, hit)) {
      shipAt(ship, hit.seconds, at)
      err = Math.hypot(hit.x - at.x, hit.z - at.z)
      tf = hit.seconds
    }
    const range = Math.hypot(p.x - ship.position.x, p.z - ship.position.z)
    const line = `${String(i / 240).padStart(4)}s ${ai.strike.phase.padEnd(9)}`
      + ` 距=${range.toFixed(0).padStart(5)} 高=${p.y.toFixed(0).padStart(5)}`
      + ` 速=${Math.hypot(v.x, v.z).toFixed(0).padStart(3)}`
      + ` 落時=${tf.toFixed(1).padStart(5)} 落點誤差=${err.toFixed(0).padStart(6)}`
      + ` 艙=${c.bombBay.load}`
    if (line.slice(5) !== last) console.log('  ' + line)
    last = line.slice(5)
  }
  console.log(`  投彈 ${w.bombs.dropped}、釋放半徑 ${releaseRadiusOf(ship.cls).toFixed(2)} m`)
  console.log('')
}

run(0)
run(8)
