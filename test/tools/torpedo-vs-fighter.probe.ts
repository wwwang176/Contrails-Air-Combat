import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'
import { G4M } from '../../src/specs/g4m'
import { F4F4 } from '../../src/specs/f4f4'
import { resetBombBay } from '../../src/weapons/bomb'
import { TORPEDO_PROFILE } from '../../src/ai/torpedoRun'
import type { Loadout } from '../../src/weapons/stores'

/**
 * # 一台掛雷的 G4M，前方有船，旁邊有一架野貓
 *
 * 為了回答「G4M 明明前方有船艦，卻 extend 轉彎去打 F4F」而建的。
 * `japan-m3` 有 11 對 8、防空火網、編隊與命令 —— 變因太多。
 * 這裡只留兩架飛機與一艘船。
 *
 * **量到的兩件事：**
 *
 * 1. **它從來沒有換目標。** 120 秒的抽樣裡 `shipAim.ship` 恆為 0、狀態恆為
 *    `approach`。看起來像「轉彎走掉」的是脫離段 —— 而當時脫離會爬升，把
 *    高度一輪一輪推到包絡上限之外，於是永遠不准鎖航向（已修：`egressClimb`
 *    改成 0）。
 * 2. **有戰鬥機在場時它 20 秒就被打下來**（hp 2800 → 0）。掛雷的轟炸機沒有
 *    任何迴避 —— 對艦分支排在自衛之前。**這一條還沒有解。**
 *
 * ```
 *   npx vite-node test/tools/torpedo-vs-fighter.probe.ts
 * ```
 */

const DT = 1 / 240
const SECONDS = 120
const TORPEDO: Loadout = {
  kind: 'torpedo', count: 1, damage: 15_000, reloadSeconds: 45,
}

function run(name: string, withFighter: boolean): void {
  const w = new World()
  const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 8)
  ship.guns = []
  ship.gunCooldowns = new Float32Array(0)
  ship.hp = 1e9
  w.ships.push(ship)

  const ai = new AiController()
  const g4m = w.add(new Aircraft(G4M), ai, 'blue', new Vector3(0, 1000, 5000), 1000, 110)
  g4m.aircraft.state.position.set(0, 1000, 5000)
  g4m.aircraft.prevPosition.copy(g4m.aircraft.state.position)
  g4m.loadout = TORPEDO
  resetBombBay(g4m.bombBay, TORPEDO)

  const members = [g4m]
  let fighterAi: AiController | null = null
  if (withFighter) {
    fighterAi = new AiController()
    const f = w.add(
      new Aircraft(F4F4), fighterAi, 'red', new Vector3(600, 1100, 4200), 1100, 110,
    )
    f.aircraft.state.position.set(600, 1100, 4200)
    f.aircraft.prevPosition.copy(f.aircraft.state.position)
    members.push(f)
  }

  const board = createTargetBoard(members)
  for (let i = 0; i < members.length; i++) {
    const ctl = members[i]!.controller
    if (!(ctl instanceof AiController)) continue
    ctl.board = board
    ctl.selfIndex = i
    ctl.ships = w.ships
    ctl.bombDrag = w.bombDrag
  }
  // 【只有 G4M 掛彈艙】野貓沒有，它走原本的空戰仲裁
  ai.bombBay = g4m.bombBay
  ai.strikeProfile = TORPEDO_PROFILE

  let drops = 0
  const phases = new Map<string, number>()
  let noShipTicks = 0
  let hadAirTarget = 0
  let samples = 0

  for (let i = 0; i < SECONDS * 240; i++) {
    const d0 = w.torpedoes.dropped
    w.step(DT)
    if (w.torpedoes.dropped > d0) drops++

    if (i % 120 === 0) {
      samples++
      const p = g4m.aircraft.state.position
      const r = Math.hypot(ship.position.x - p.x, ship.position.z - p.z)
      if (ai.shipAim.ship < 0) noShipTicks++
      if (ai.target !== null) hadAirTarget++
      const key = ai.shipAim.ship < 0 ? '沒選到船' : ai.strike.phase
      phases.set(key, (phases.get(key) ?? 0) + 1)
      if (i % 1200 === 0) {
        console.log(`    t=${String(i / 240).padStart(3)}s`
          + ` alt=${p.y.toFixed(0).padStart(4)}`
          + ` 離船=${r.toFixed(0).padStart(4)}`
          + ` 選到的船=${ai.shipAim.ship}`
          + ` 空中目標=${ai.target === null ? '無' : '有'}`
          + ` 段=${ai.shipAim.ship < 0 ? '－' : ai.strike.phase}`
          + ` 彈=${g4m.bombBay.load}`
          + ` hp=${g4m.hp.toFixed(0)}`)
      }
    }
  }
  const dist = [...phases.entries()].map(([k, v]) => `${k} ${v}`).join('　')
  console.log(`  ${name}: 投=${drops}`
    + `　沒選到船的抽樣=${noShipTicks}/${samples}`
    + `　有空中目標=${hadAirTarget}/${samples}`)
  console.log(`      狀態分佈：${dist}`)
}

console.log('一台掛雷的 G4M、一艘不還擊的弗萊徹、120 秒')
run('只有船', false)
console.log('')
run('船 + 一架野貓', true)
