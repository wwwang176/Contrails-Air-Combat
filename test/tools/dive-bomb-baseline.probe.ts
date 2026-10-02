/**
 * 其他機種的對地行為有沒有被俯衝投彈動到。**一次性量測，不進測試組。**
 *
 * 把德 M4（有一百四十個地面目標）的藍隊換成不是 Ju 87 的機種，全部放 AI，各跑一段，輸出每架每秒的
 * 位置、速度、彈艙存量與開火／投彈指令的雜湊。**改 `AiController` 之前量一次留底，改完逐位元比對。**
 * `strike-replay-baseline` 的兩個場景（日 M3、盟 M3）都沒有地面目標，覆蓋不到對地路徑。
 *
 * 跑法：`npx vite-node test/tools/dive-bomb-baseline.probe.ts`
 */
import { createHash } from 'node:crypto'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { createTerrain } from '../../src/render/terrain'
import { flatSeaCrashPolicy } from '../../src/world/seaCrash'
import { settleGroundTargets } from '../../src/world/groundTargets'
import { clearImpacts } from '../../src/world/events'
import { clearKills } from '../../src/world/kills'
import { readyCard } from '../fixtures/mission'
import { HE111 } from '../../src/specs/he111'
import { G4M } from '../../src/specs/g4m'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { KI84 } from '../../src/specs/ki84'

const DT = 1 / 240
const SECONDS = Number(process.env['SECONDS'] ?? 60)
const SEED = 20260913

for (const spec of [HE111, G4M, B17G, P51D, BF109K4, KI84]) {
  const terrain = createTerrain('kursk')
  // 隊伍是 `missionConfigFrom` 由卡片的 `blueSpec` 生出來的，換機種要換卡片裡的那一格
  const card = readyCard('germany-m4')
  const cfg = missionConfigFrom({ ...card, battle: { ...card.battle, blueSpec: spec } })
  const b = createBattle(new AiController(), cfg, SEED)
  const w = b.world
  const policy = flatSeaCrashPolicy(terrain.collisionHeightAt)
  w.crashPolicy = (c) => policy(c)
  w.land = terrain.land
  w.groundAt = terrain.collisionHeightAt
  w.waterAt = terrain.waterAt
  settleGroundTargets(w.groundTargets, w.groundAt)
  const wired = new Set<AiController>()
  const hash = createHash('sha256')
  let drops = 0
  const load = new Map<number, number>()
  const total = Math.round(SECONDS / DT)
  for (let i = 0; i < total; i++) {
    for (const c of w.combatants) {
      const ctl = c.controller
      if (!(ctl instanceof AiController) || wired.has(ctl)) continue
      ctl.ships = w.ships
      ctl.groundTargets = w.groundTargets
      ctl.bombBay = c.bombBay
      ctl.bombDrag = w.bombDrag
      ctl.terrain = terrain
      ctl.clearTerrainState()
      wired.add(ctl)
    }
    stepBattle(b, DT)
    clearImpacts(w.groundKillEvents)
    clearKills(w.killEvents)
    clearImpacts(w.hitEvents)
    clearImpacts(w.splashEvents)
    clearImpacts(w.bombEvents)
    for (const c of w.combatants) {
      if (c.team !== 'blue') continue
      const l = c.bombBay.load + c.bombBay.queue
      const prev = load.get(c.index)
      if (prev !== undefined && l < prev) drops++
      load.set(c.index, l)
    }
    if (i % 240 === 0) {
      for (const c of w.combatants) {
        if (c.team !== 'blue') continue
        const p = c.aircraft.state.position
        const v = c.aircraft.state.velocity
        hash.update([
          c.index, c.alive ? 1 : 0, p.x.toFixed(4), p.y.toFixed(4), p.z.toFixed(4),
          v.x.toFixed(4), v.y.toFixed(4), v.z.toFixed(4),
          c.bombBay.load, c.bombBay.queue, c.command.bombing ? 1 : 0, c.command.firing ? 1 : 0,
          c.command.aimWorld.x.toFixed(5), c.command.aimWorld.y.toFixed(5), c.command.aimWorld.z.toFixed(5),
          c.command.throttle.toFixed(3), c.command.brake.toFixed(3),
        ].join(',') + ';')
      }
    }
    if (b.outcome !== 'fighting') break
  }
  const blue = w.combatants.filter((c) => c.team === 'blue')
  console.log(`${spec.id.padEnd(8)} sha256=${hash.digest('hex').slice(0, 24)} 藍隊 ${blue.filter((c) => c.alive).length}/${blue.length} 投彈 ${drops} 地面損失 ${w.groundTargets.filter((t) => !t.alive).length}`)
}
