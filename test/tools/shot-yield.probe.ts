/**
 * `sweetYieldTime` 的掃描。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/shot-yield.probe.ts
 *
 * 【要回答什麼】出貨值取了 `PROJECTILE_LIFETIME`（1.2 s），理由是「與
 * `shouldFire` 的第一條共用同一個數字」。那個理由只保證它**錨得住**，不保證
 * 它是**最好的**。spec §7.1 記了一個已知的取捨：線性斜坡在 `t ≈ 0.36 s`
 * （約 250 m）才降到開火錐 3°，所以 250~850 m 的平衡偏移仍高於錐。
 *
 * 斜坡調陡（`sweetYieldTime` 取 1.5× 或 2×）能把那一段壓下去，代價是中距離
 * 幾乎廢掉這一層。這支把兩邊都量出來，交專案負責人定值。
 *
 * 【三張表】
 *   一、人工回報的場景：機首離預瞄、開火佔時 —— 主判準本身
 *   二、距離對讓位係數與有效偏置 —— 「中距離被廢掉多少」
 *   三、1v1 對戰：雙方各當一次 109，看命中產出有沒有真的變好
 */
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { buildEngageBasis, createEngageBasis, sweetYield, DEFAULT_STEER } from '../../src/ai/steer'
import { createTargetBoard } from '../../src/ai/target'
import { DEFAULT_FIRE } from '../../src/ai/fire'
import { DEFAULT_DOCTRINE, sweetSpotPitch } from '../../src/ai/doctrine'
import { VETERAN } from '../../src/ai/profile'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { PROJECTILE_LIFETIME } from '../../src/world/Projectiles'
import { BF109G6 } from '../../src/specs/bf109g6'
import { P51D } from '../../src/specs/p51d'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import { RAD } from '../../src/core/math'
import type { Command, Controller } from '../../src/control/Controller'
import type { AircraftSpec } from '../../src/specs/types'
import type { Battery } from '../../src/weapons/types'

const DT = 1 / 240
const ALT = 4000
const FWD = new Vector3(0, 0, -1)
const L = PROJECTILE_LIFETIME

function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}
const ME = applyFeel(BF109G6, GAME_FEEL)
const FOE = applyFeel(P51D, GAME_FEEL)
const ME_BLUNT: AircraftSpec = { ...ME, battery: harmless(ME.battery) }
const FOE_BLUNT: AircraftSpec = { ...FOE, battery: harmless(FOE.battery) }

class Climber implements Controller {
  constructor(private readonly pitch: number) {}
  private readonly aim = new Vector3()
  update(self: Aircraft, _dt: number, out: Command): void {
    out.throttle = WEP_THROTTLE
    out.brake = 0
    out.firing = false
    const v = self.state.velocity
    const horiz = Math.hypot(v.x, v.z)
    if (horiz < 1e-6) { out.aimWorld.copy(FWD); return }
    const c = Math.cos(this.pitch) / horiz
    this.aim.set(v.x * c, Math.sin(this.pitch), v.z * c)
    out.aimWorld.copy(this.aim)
  }
}

function median(v: number[]): number {
  if (v.length === 0) return Number.NaN
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** 同一支測試的場景，抄過來是為了不 import 測試檔。 */
function scenario(): { noseOff: number; fireShare: number; alive: boolean } {
  const tas = 500 / 3.6
  const world = new World()
  const me = new Aircraft(ME_BLUNT, ALT, tas)
  const foe = new Aircraft(FOE_BLUNT, ALT, tas)
  const drop = 15 * (Math.PI / 180)
  const climb = 10 * (Math.PI / 180)
  const mePos = new Vector3(0, ALT, 0)
  const foePos = new Vector3(0, ALT - 150 * Math.sin(drop), -150 * Math.cos(drop))
  const course = new Vector3(0, Math.sin(climb), -Math.cos(climb))
  for (const [a, p, c] of [[me, mePos, FWD], [foe, foePos, course]] as const) {
    a.state.position.copy(p)
    a.state.velocity.copy(c).multiplyScalar(tas)
    a.state.orientation.setFromUnitVectors(FWD, c)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }
  const ai = new AiController()
  const mc = world.add(me, ai, 'blue', mePos, ALT, tas)
  const fc = world.add(foe, new Climber(climb), 'red', foePos, ALT, tas)
  for (const c of [mc, fc]) c.respawnOnDestroy = false
  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = mc.index
  ai.profile = VETERAN

  const basis = createEngageBasis()
  const lead = new Vector3()
  const nose = new Vector3()
  const offs: number[] = []
  let fire = 0
  let alive = true
  const total = 6 * 240
  const from = total - 240
  for (let s = 0; s < total; s++) {
    world.step(DT)
    if (!mc.alive || !fc.alive) { alive = false; break }
    if (s < from) continue
    buildEngageBasis(me, foe, basis)
    const len = lead.copy(basis.leadPoint).length()
    if (len < 1e-6) continue
    lead.divideScalar(len)
    nose.copy(FWD).applyQuaternion(me.state.orientation)
    offs.push(nose.angleTo(lead))
    if (mc.command.firing) fire++
  }
  const n = Math.max(offs.length, 1)
  return { noseOff: median(offs) * RAD, fireShare: fire / n, alive }
}

/** 同速尾追時，這個距離的攔截時間。 */
function interceptAt(range: number): number {
  const tas = 500 / 3.6
  const me = new Aircraft(ME_BLUNT, ALT, tas)
  const foe = new Aircraft(FOE_BLUNT, ALT, tas)
  for (const a of [me, foe]) {
    a.state.velocity.copy(FWD).multiplyScalar(tas)
    a.state.orientation.setFromUnitVectors(FWD, FWD)
  }
  me.state.position.set(0, ALT, 0)
  foe.state.position.set(0, ALT, -range)
  const b = createEngageBasis()
  buildEngageBasis(me, foe, b)
  return b.interceptTime
}

function withYieldTime<T>(seconds: number, fn: () => T): T {
  const saved = DEFAULT_STEER.sweetYieldTime
  DEFAULT_STEER.sweetYieldTime = seconds
  try {
    return fn()
  } finally {
    DEFAULT_STEER.sweetYieldTime = saved
  }
}

const CANDIDATES: Array<[string, number]> = [
  ['0（關閉）', 0],
  ['1.0× L', L],
  ['1.5× L', 1.5 * L],
  ['2.0× L', 2 * L],
]

console.log(`彈丸壽命 L = ${L} s；開火錐 = ${(DEFAULT_FIRE.trackingCone * RAD).toFixed(1)}°`)
console.log(`109 對 P-51 在 ${ALT} m／500 km/h 的原始偏置 = `
  + `${(sweetSpotPitch(ME, FOE, ALT, 500 / 3.6, DEFAULT_DOCTRINE) * RAD).toFixed(1)}°`)

console.log(`
╔══ 一、人工回報的場景（150 m、預瞄點在下方 15°、敵機爬升 10°）══`)
console.log('  sweetYieldTime   機首離預瞄   開火佔時   兩架存活')
for (const [label, t] of CANDIDATES) {
  const r = withYieldTime(t, scenario)
  console.log(
    `  ${label.padEnd(16)}`
    + `${r.noseOff.toFixed(2).padStart(8)}°`
    + `${(r.fireShare * 100).toFixed(1).padStart(10)}%`
    + `${String(r.alive).padStart(11)}`,
  )
}

console.log(`
╔══ 二、距離 → 讓位係數 → 有效偏置（原始 10°）══`)
console.log('  距離   攔截時間      1.0×L        1.5×L        2.0×L')
for (const range of [100, 150, 200, 300, 400, 600, 800, 1000]) {
  const t = interceptAt(range)
  const cell = (span: number) => {
    const y = sweetYield(t, { ...DEFAULT_STEER, sweetYieldTime: span })
    const deg = 10 * y
    // 標記平衡偏移是否已經低於開火錐
    return `${deg.toFixed(1)}°${deg < DEFAULT_FIRE.trackingCone * RAD ? '✓' : ' '}`
  }
  console.log(
    `${String(range).padStart(6)}m`
    + `${t.toFixed(3).padStart(10)}s`
    + `${cell(L).padStart(13)}`
    + `${cell(1.5 * L).padStart(13)}`
    + `${cell(2 * L).padStart(13)}`,
  )
}
console.log('  ✓ = 有效偏置已低於開火錐，那個距離上這一層不再擋住扳機')
