/**
 * 四個開局幾何的逐秒診斷。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/beam-blind.probe.ts
 *
 * 【這支探針記著一個坑，不要再踩】它原本是為了追「敵人在正側面時 AI 為
 * 什麼閃了卻看不出來」而寫的 —— 那個現象**不存在**，是場景擺錯擺出來的。
 *
 * 專案負責人的原話是「敵人離我 800M **在前方**往左橫飛」。第一版實作成
 * 「觀測儀在敵機**正右方**、兩機**同向並排**」—— 那不是橫越，是編隊，而且
 * 相對速度為零、視線角度永遠不變，**幾何本身就是死局**。在那個死局裡量到
 * 預測誤差 0.70°（幾乎貼著地板），還順著它推出一套「破防軸與航向平行、
 * AI 破一次就穩住」的說法。場景改成真正的橫越之後，數字是 5.50°，
 * 與正後方的 5.85° 幾乎一樣 —— **那個缺陷從頭到尾不存在**。
 *
 * 同一輪還查出上下顛倒：`high`/`low` 原本是「觀測儀在敵機上方」，也就是
 * 「敵人在我下方」，與負責人的敘述相反。
 *
 * 教訓：**幾何是判準的一部分，擺錯場景的量測會給出自洽而完整的假結論。**
 * 三個獨立指標（預測誤差、有效窗長、正常模式佔比）當時全部互相印證，
 * 而它們印證的是同一個錯誤前提。
 *
 * 【現在它量什麼】每秒一列：航向變化、預測誤差、位置偏差拆成徑向（沿
 * 觀測者視線，看不見）與切向（垂直視線，看得見），加上意圖與轉向模式。
 * 判準只給一個中位數，這支給的是那個中位數底下的時間結構。
 */
import { Vector3, Quaternion } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { buildEngageBasis, createEngageBasis } from '../../src/ai/steer'
import { createTargetBoard } from '../../src/ai/target'
import { alarmFactor } from '../../src/ai/assess'
import { VETERAN } from '../../src/ai/profile'
import { P51D } from '../../src/specs/p51d'
import { RAD } from '../../src/core/math'
import type { Command, Controller } from '../../src/control/Controller'
import type { AircraftSpec } from '../../src/specs/types'
import type { Battery } from '../../src/weapons/types'

const DT = 1 / 240
const ALT = 4000
const TAS = 200
const FWD = new Vector3(0, 0, -1)
const STANDOFF = 800
const SECONDS = 12
const LOOKAHEAD_STEPS = 240

/** 無傷害彈藥 —— 量的是機動，不是誰打死誰 */
function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}
const BLUNT: AircraftSpec = { ...P51D, battery: harmless(P51D.battery) }

/** 觀測儀的控制器：不開火、不機動（狀態每步被外部覆寫） */
class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.throttle = 0.7
    out.brake = 0
    out.firing = false
    out.aimWorld.copy(FWD)
  }
}

/**
 * 開局幾何，**一律從玩家（觀測儀）的視角**描述 —— 與 ai-visible-evasion
 * 的 `aspectOf` 是同一組定義。`offset` 是敵機相對我的位置，`course` 是
 * 敵機的開局航向。觀測儀一律在原點、機首 `FWD`、等速直線。
 */
const PROBES = {
  ahead: { offset: new Vector3(0, 0, -STANDOFF), course: FWD, label: '正前方‧前飛' },
  crossing: { offset: new Vector3(0, 0, -STANDOFF), course: new Vector3(-1, 0, 0), label: '正前方‧橫飛' },
  above: { offset: new Vector3(0, STANDOFF, 0), course: FWD, label: '我的正上方' },
  below: { offset: new Vector3(0, -STANDOFF, 0), course: FWD, label: '我的正下方' },
} as const

function run(probe: keyof typeof PROBES): void {
  const world = new World()
  const prey = new Aircraft(BLUNT, ALT, TAS)
  const lamp = new Aircraft(BLUNT, ALT, TAS)

  const asp = PROBES[probe]
  const lampPos = new Vector3(0, ALT, 0)
  const preyPos = asp.offset.clone().add(lampPos)
  for (const [a, p, c] of [[prey, preyPos, asp.course], [lamp, lampPos, FWD]] as const) {
    a.state.position.copy(p)
    a.state.velocity.copy(c).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(FWD, c)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }

  const ai = new AiController()
  const pc = world.add(prey, ai, 'blue', preyPos, ALT, TAS)
  const lc = world.add(lamp, new Idle(), 'red', lampPos, ALT, TAS)
  for (const c of [pc, lc]) c.respawnOnDestroy = false
  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = pc.index
  ai.profile = VETERAN

  const basis = createEngageBasis()
  const lampStart = lampPos.clone()
  const lampVel = new Vector3(0, 0, -TAS)
  const dir = new Vector3()

  // 環形緩衝：一秒前的位置與速度
  const histP: Vector3[] = []
  const histV: Vector3[] = []
  for (let i = 0; i <= LOOKAHEAD_STEPS; i++) {
    histP.push(new Vector3())
    histV.push(new Vector3())
  }
  let head = 0
  let filled = 0

  const los = new Vector3()
  const dev = new Vector3()
  const ghostPos = new Vector3()
  const heading = new Vector3()
  const prevHeading = new Vector3(0, 0, -1)
  const q = new Quaternion()

  console.log(`\n── 開局 ${probe}（${STANDOFF} m）─────────────────────────`)
  console.log('  秒   航向變化/s  預測誤差   偏差總量   徑向    切向   徑向佔比  意圖   模式')

  for (let s = 0; s < SECONDS * 240; s++) {
    world.step(DT)
    if (!pc.alive || !lc.alive) {
      console.log(`  ${(s * DT).toFixed(1)}s：有人死了，停`)
      return
    }

    // 觀測儀歸位：等速直線 + 機首指向彈道預瞄點
    lamp.state.position.copy(lampStart).addScaledVector(lampVel, (s + 1) * DT)
    lamp.state.velocity.copy(lampVel)
    lamp.state.angularVelocity.set(0, 0, 0)
    buildEngageBasis(lamp, prey, basis)
    dir.copy(basis.leadPoint).normalize()
    lamp.state.orientation.setFromUnitVectors(FWD, dir)
    lamp.prevPosition.copy(lamp.state.position)
    lamp.prevOrientation.copy(lamp.state.orientation)

    const n = histP.length
    histP[head]!.copy(prey.state.position)
    histV[head]!.copy(prey.state.velocity)
    const oldIdx = (head - LOOKAHEAD_STEPS + n) % n
    head = (head + 1) % n
    if (filled <= LOOKAHEAD_STEPS) filled++

    if (filled <= LOOKAHEAD_STEPS) continue
    if (s % 240 !== 0) continue

    // ── 每秒一列 ──────────────────────────────────────────
    const valid = alarmFactor(lamp, prey) > 0

    // 一秒前的航向 → 現在的航向，變了幾度
    heading.copy(prey.state.velocity).normalize()
    const turned = heading.angleTo(prevHeading) * RAD
    prevHeading.copy(heading)

    // 「照一秒前那樣飛下去」會在哪
    ghostPos.copy(histP[oldIdx]!).addScaledVector(histV[oldIdx]!, 1)
    // 實際位置與那個預測的偏差向量
    dev.subVectors(prey.state.position, ghostPos)
    // 拆成徑向（沿觀測儀→目標的視線）與切向
    los.subVectors(prey.state.position, lamp.state.position).normalize()
    const radial = dev.dot(los)
    const total = dev.length()
    const tangential = Math.sqrt(Math.max(total * total - radial * radial, 0))

    // 預瞄方向的預測誤差（與掃描同一個算法）
    const a = dir.clone()
    const ghost = new Aircraft(BLUNT, ALT, TAS)
    ghost.state.position.copy(ghostPos)
    ghost.state.velocity.copy(histV[oldIdx]!)
    const gv = histV[oldIdx]!.clone().normalize()
    ghost.state.orientation.copy(q.setFromUnitVectors(FWD, gv))
    buildEngageBasis(lamp, ghost, basis)
    const err = a.angleTo(basis.leadPoint.clone().normalize()) * RAD

    console.log(
      `  ${(s * DT).toFixed(0).padStart(3)}`
      + `  ${turned.toFixed(1).padStart(9)}°`
      + `  ${err.toFixed(2).padStart(8)}°`
      + `  ${total.toFixed(1).padStart(8)}m`
      + `  ${Math.abs(radial).toFixed(1).padStart(6)}m`
      + `  ${tangential.toFixed(1).padStart(6)}m`
      + `  ${(Math.abs(radial) / Math.max(total, 1e-6) * 100).toFixed(0).padStart(7)}%`
      + `  ${ai.intent.padEnd(8)}`
      + ` ${ai.mode}${valid ? '' : '  (彈道已失效)'}`,
    )
    if (!valid) return
  }
}

console.log('每秒一列。「航向變化/s」是實際飛行方向這一秒轉了幾度；')
console.log('「偏差總量」是實際位置與「照一秒前那樣直飛」的距離，拆成')
console.log('徑向（沿觀測者視線，看不見）與切向（垂直視線，看得見）。')
console.log('')
console.log('  甲「根本沒轉」  → 航向變化 ≈ 0')
console.log('  乙「轉去看不見的方向」→ 徑向佔比接近 100%')
console.log('  丙「轉一次就穩住」→ 航向變化前幾秒大、之後趨近 0')

for (const p of ['ahead', 'crossing', 'above', 'below'] as const) run(p)
