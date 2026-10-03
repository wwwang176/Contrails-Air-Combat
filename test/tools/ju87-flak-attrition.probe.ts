/**
 * 德 M4 的 AI Ju 87 被防空打掉多少血。**一次性量測，不進測試組。**
 *
 * 六架全放 AI（玩家座位也是），接線照 `main.ts` 的 `wireTerrain`。每 30 秒與任務結束時記每架的血量
 * （`c.hp ÷ spec.hp`），算：存活者的平均、六架全部的平均（陣亡算 0）、最低、陣亡數。
 *
 * 環境變數：SECONDS（預設 480）、SEEDS（逗號分隔，預設 20260913）、FLAK（保留幾座輕高砲，預設全部；
 * 多出來的砲位拿掉砲、標成死的，拿來當對照組）。
 *
 * 跑法：`npx vite-node test/tools/ju87-flak-attrition.probe.ts`
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { createTerrain } from '../../src/render/terrain'
import { flatSeaCrashPolicy } from '../../src/world/seaCrash'
import { settleGroundTargets } from '../../src/world/groundTargets'
import { clearImpacts } from '../../src/world/events'
import { clearKills } from '../../src/world/kills'
import { readyCard } from '../fixtures/mission'

const DT = 1 / 240
const SECONDS = Number(process.env['SECONDS'] ?? 480)
const SEEDS = (process.env['SEEDS'] ?? '20260913').split(',').map(Number)
const FLAK = process.env['FLAK'] === undefined ? Infinity : Number(process.env['FLAK'])
const SAMPLE = 30

const terrain = createTerrain('rzhev')

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`
}

for (const seed of SEEDS) {
  const b = createBattle(new AiController(), missionConfigFrom(readyCard('germany-m4')), seed)
  const w = b.world
  const policy = flatSeaCrashPolicy(terrain.collisionHeightAt)
  w.crashPolicy = (c) => policy(c)
  w.land = terrain.land
  w.groundAt = terrain.collisionHeightAt
  w.waterAt = terrain.waterAt
  settleGroundTargets(w.groundTargets, w.groundAt)

  let kept = 0
  let flakTotal = 0
  for (const t of w.groundTargets) {
    if (t.unit.id !== 'flakLight') continue
    flakTotal++
    if (kept++ < FLAK) continue
    t.guns = []
    t.alive = false
  }

  const wired = new Set<AiController>()
  const wire = (): void => {
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
  }

  const blue = w.combatants.filter((c) => c.team === 'blue')
  const frac = (c: (typeof blue)[number]): number => Math.max(0, c.hp / c.aircraft.spec.hp)
  const report = (t: number): void => {
    const alive = blue.filter((c) => c.alive && c.hp > 0)
    const all = blue.reduce((s, c) => s + frac(c), 0) / blue.length
    const survivors = alive.length > 0 ? alive.reduce((s, c) => s + frac(c), 0) / alive.length : 0
    const min = Math.min(...blue.map(frac))
    console.log(
      `  t=${String(Math.round(t)).padStart(3)} 存活 ${alive.length}/${blue.length}｜平均血量 存活者 ${pct(survivors)}、六架（陣亡算 0）${pct(all)}｜最低 ${pct(min)}`,
    )
  }

  console.log(`種子 ${seed}，輕高砲 ${Math.min(FLAK, flakTotal)}/${flakTotal} 座`)
  let nextSample = SAMPLE
  let ended = false
  for (let i = 0, total = Math.round(SECONDS / DT); i < total; i++) {
    wire()
    stepBattle(b, DT)
    clearImpacts(w.groundKillEvents)
    clearKills(w.killEvents)
    clearImpacts(w.hitEvents)
    clearImpacts(w.splashEvents)
    clearImpacts(w.bombEvents)
    if (w.time >= nextSample) {
      report(w.time)
      nextSample += SAMPLE
    }
    if (b.outcome !== 'fighting') {
      console.log(`  任務 ${b.outcome}，t=${w.time.toFixed(0)}`)
      ended = true
      break
    }
  }
  if (!ended) console.log(`  跑滿 ${SECONDS} 秒、任務還沒結束`)
  report(w.time)
  console.log(`  每架最後的血量：${blue.map((c) => `#${c.index} ${pct(frac(c))}${c.alive ? '' : '（陣亡）'}`).join('、')}`)
}
