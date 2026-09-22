/**
 * 德 M3 我方 AI 的對地探針。**一次性量測，不進測試組。**
 *
 * 量三件事，對照「AI 會不會去打地上的 P-51」改動前後：
 *
 * ```
 *   一  我方 AI 打掉幾架停放的 P-51、幾架滑行／滾行中的 P-51
 *   二  我方 AI 的最低離地高度（每一架、每一步取最低）
 *   三  我方撞地次數
 * ```
 *
 * 接線照 `main.ts` 的 `wireTerrain`：地形、地面目標、船、彈艙都接給 AI，
 * 撞地判定走 `flatSeaCrashPolicy(terrain.collisionHeightAt)`。玩家座位也放 AI。
 *
 * 跑法：`npx vite-node test/tools/asch-strafe.probe.ts`
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { createTerrain } from '../../src/render/terrain'
import { flatSeaCrashPolicy } from '../../src/world/seaCrash'
import { settleGroundTargets } from '../../src/world/groundTargets'
import { clearImpacts, IMPACT_STRIDE } from '../../src/world/events'
import { clearKills } from '../../src/world/kills'
import { readyCard } from '../fixtures/mission'

const DT = 1 / 240
/** 每一場跑幾秒。第一個小隊約 90 秒排好隊，三批都滑出去要到 150 秒前後 */
const SECONDS = 150
const SEEDS = [20260913, 1, 2]

for (const seed of SEEDS) {
  const terrain = createTerrain('asch')
  const b = createBattle(new AiController(), missionConfigFrom(readyCard('germany-m3')), seed)
  const w = b.world
  const policy = flatSeaCrashPolicy(terrain.collisionHeightAt)
  let crashes = 0
  w.crashPolicy = (c) => {
    const hit = policy(c)
    if (hit && c.team === 'blue') crashes++
    return hit
  }
  w.land = terrain.land
  w.groundAt = terrain.collisionHeightAt
  w.waterAt = terrain.waterAt
  settleGroundTargets(w.groundTargets, w.groundAt)

  const wired = new Set<AiController>()
  const wire = (): void => {
    for (const c of w.combatants) {
      const ctl = c.controller
      if (!(ctl instanceof AiController) || wired.has(ctl)) continue
      ctl.ships = w.ships
      ctl.groundTargets = w.groundTargets
      ctl.bombBay = c.index === b.playerSeat ? null : c.bombBay
      ctl.bombDrag = w.bombDrag
      ctl.terrain = terrain
      ctl.clearTerrainState()
      wired.add(ctl)
    }
  }

  let minAgl = Infinity
  /** 停放的 P-51 累計掉的血（不分誰打的） */
  let parkedDamage = 0
  /** 我方 AI 的「活著的架次 × 步數」、其中沒有空中目標的、目標是滑行／滾行中紅機的、沒有空中目標而且在開火的 */
  let blueSteps = 0
  let noTargetSteps = 0
  let movingTargetSteps = 0
  let strafeFireSteps = 0
  /** 我方第一次有飛機進到停機線 1,500 m 內的時刻 */
  let firstNearField = -1
  const hp = w.groundTargets.map((t) => t.hp)
  let parkedByBlueAi = 0
  let parkedByPlayerSeat = 0
  let parkedOther = 0
  let movingKilled = 0
  let redKilled = 0
  const wasAlive = w.combatants.map((c) => c.alive)
  const steps = Math.round(SECONDS / DT)
  for (let i = 0; i < steps; i++) {
    wire()
    // 滑行／滾行中的那幾架在這一步之前的狀態
    const moving = w.combatants.map((c) => c.alive && c.takeoff !== null)
    stepBattle(b, DT)
    const ge = w.groundKillEvents
    for (let e = 0; e < ge.count; e++) {
      const o = e * IMPACT_STRIDE
      const t = w.groundTargets[ge.data[o + 3]!]!
      if (t.unit.id !== 'parkedP51') continue
      const killer = ge.data[o + 4]!
      if (killer < 0) parkedOther++
      else if (killer === b.playerSeat) parkedByPlayerSeat++
      else if (w.combatants[killer]!.team === 'blue') parkedByBlueAi++
      else parkedOther++
    }
    clearImpacts(ge)
    clearKills(w.killEvents)
    clearImpacts(w.hitEvents)
    clearImpacts(w.splashEvents)
    clearImpacts(w.bombEvents)
    for (let k = 0; k < w.combatants.length; k++) {
      const c = w.combatants[k]!
      if (wasAlive[k] === true && !c.alive && c.team === 'red') {
        redKilled++
        if (moving[k] === true) movingKilled++
      }
      wasAlive[k] = c.alive
      if (!c.alive || c.team !== 'blue') continue
      const p = c.aircraft.state.position
      const agl = p.y - terrain.collisionHeightAt(p.x, p.z)
      if (agl < minAgl) minAgl = agl
      const ctl = c.controller
      if (ctl instanceof AiController) {
        blueSteps++
        const tgt = ctl.target
        if (tgt === null) {
          noTargetSteps++
          if (c.command.firing) strafeFireSteps++
        } else {
          const owner = w.combatants.find((o) => o.aircraft === tgt)
          if (owner !== undefined && owner.takeoff !== null) movingTargetSteps++
        }
      }
      if (firstNearField < 0) {
        for (const t of w.groundTargets) {
          if (t.unit.id !== 'parkedP51') continue
          if (Math.hypot(p.x - t.position.x, p.z - t.position.z) < 1500) { firstNearField = w.time; break }
        }
      }
    }
    for (let g = 0; g < w.groundTargets.length; g++) {
      const t = w.groundTargets[g]!
      if (t.unit.id === 'parkedP51' && !t.departed && t.hp < hp[g]!) parkedDamage += hp[g]! - Math.max(t.hp, 0)
      hp[g] = t.hp
    }
    if (b.outcome !== 'fighting') break
  }
  const parkedLeft = w.groundTargets.filter((t) => t.unit.id === 'parkedP51' && t.alive).length
  const departed = w.groundTargets.filter((t) => t.departed).length
  console.log(
    `seed ${String(seed).padStart(8)}  ${w.time.toFixed(0).padStart(4)} s  ${b.outcome.padEnd(8)}`
    + `  停放機：我方 AI 打掉 ${parkedByBlueAi}、玩家座位 ${parkedByPlayerSeat}、其他 ${parkedOther}`
    + `、還在 ${parkedLeft}、起飛離場 ${departed}`
    + `  | 紅機被擊落 ${redKilled}（其中滑行／滾行中 ${movingKilled}）`
    + `  | 我方最低離地 ${minAgl.toFixed(1)} m、撞地 ${crashes}`,
  )
  const pct = (n: number): string => `${((100 * n) / Math.max(blueSteps, 1)).toFixed(1)}%`
  console.log(
    `                停放機累計掉血 ${parkedDamage.toFixed(0)}（一架 250）`
    + `  | 我方 AI 沒有空中目標 ${pct(noTargetSteps)}、目標是滑行／滾行中紅機 ${pct(movingTargetSteps)}`
    + `、沒有空中目標而且在開火 ${pct(strafeFireSteps)}`
    + `  | 第一次進到停機線 1,500 m 內 ${firstNearField.toFixed(1)} s`,
  )
  terrain.dispose()
}
