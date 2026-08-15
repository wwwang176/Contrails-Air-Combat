/**
 * 「威脅在正側面時，AI 為什麼閃了卻看不出來」的量測。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/beam-blind.probe.ts
 *
 * 【它要回答什麼】2026-08-16 的預瞄預測誤差掃描給出：
 *
 *   開局方位  預測誤差  直飛自檢
 *   tail      5.85°     0.42°
 *   beam      0.70°     0.48°   ← 幾乎貼著地板
 *   high      6.82°     0.32°
 *   low       7.53°     0.19°
 *
 * 靜態讀 `defendAim` 只回答了一半：正側面威脅下命令的飛行方向離現在航向
 * **24.8°**（正後方是 105°）。24.8° 不是 0，所以「算出來等於沒轉」是錯的。
 * 那為什麼預瞄點不動？
 *
 * 【三個互斥的假說，這支探針要分辨它們】
 *
 *   甲 **它根本沒轉** —— 命令 24.8° 但飛機沒跟上（舵面飽和、指揮儀壓制、
 *      拉桿紀律把它收掉）。證據：實際航向變化 ≈ 0。
 *
 *   乙 **它轉了，但轉去觀測者看不見的方向** —— 觀測者在正側面時，「朝他／
 *      背他」是**徑向**的，徑向位移不改變視線方位。證據：位移相對直飛預測
 *      的偏差幾乎全在徑向，切向幾乎是 0。
 *
 *   丙 **它轉了一次就穩住** —— 轉到新航向之後直線飛。預測誤差量的是「偏離
 *      直線多少」，一條**新的**直線的誤差是 0。證據：航向在前一兩秒變化很
 *      大，之後每秒變化趨近 0。
 *
 * 三者要的修法完全不同：甲 要查指揮儀，乙 要改破防軸的選法（正側面時該用
 * 鉛直面而不是水平面），丙 則根本不是缺陷而是判準的盲點（一條新直線對玩家
 * 而言確實不需要修正準星）。
 *
 * 【為什麼要一支探針而不是直接改】前四版的判準每一版都被推翻，其中兩次是
 * 因為「看起來合理的推論」沒有被量。這一支只產生證據，不動任何出貨程式。
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
const UP = new Vector3(0, 1, 0)
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

/** 四個開局方位的位移 */
const PROBES = {
  tail: new Vector3(0, 0, STANDOFF),
  beam: new Vector3(STANDOFF, 0, 0),
  high: new Vector3(0, STANDOFF, 0),
  low: new Vector3(0, -STANDOFF, 0),
} as const

function run(probe: keyof typeof PROBES): void {
  const world = new World()
  const prey = new Aircraft(BLUNT, ALT, TAS)
  const lamp = new Aircraft(BLUNT, ALT, TAS)

  const preyPos = new Vector3(0, ALT, 0)
  const lampPos = PROBES[probe].clone().add(preyPos)
  for (const [a, p] of [[prey, preyPos], [lamp, lampPos]] as const) {
    a.state.position.copy(p)
    a.state.velocity.copy(FWD).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(FWD, FWD)
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

for (const p of ['tail', 'beam', 'high', 'low'] as const) run(p)
