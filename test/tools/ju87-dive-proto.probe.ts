/**
 * 俯衝投彈的原型量測。**一次性量測，不進測試組。**
 *
 * 用現成的零件拼：平飛到目標上方的某個水平距離 → 壓機鼻俯衝（戰鬥機掛彈的掃射瞄準 ＋ 落點解算）→
 * 離地某高度投彈 → 拉起。四架 Ju 87 都換成這個控制器，每架各挑一門不同的反坦克砲。
 * 量：俯衝的速度與角度、安全層有沒有提前接管、拉起掉多低、投彈那一刻的預測落點離目標多遠。
 *
 * 環境變數：DIVE_DEG（俯衝角，預設 75）、ENTRY_S（壓機鼻要預留的秒數，預設 3）、RELEASE_AGL（投彈高度，
 * 相對目標，預設 500）、IAS_BRAKE（開減速板的 IAS ÷ vne，預設 0.6）。
 *
 * 跑法：`npx vite-node test/tools/ju87-dive-proto.probe.ts`
 */
import { Vector3 } from 'three'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { createTerrain } from '../../src/render/terrain'
import { flatSeaCrashPolicy } from '../../src/world/seaCrash'
import { settleGroundTargets, type GroundTarget } from '../../src/world/groundTargets'
import { clearImpacts } from '../../src/world/events'
import { clearKills } from '../../src/world/kills'
import { readyCard } from '../fixtures/mission'
import { createGroundStrafeState, groundAttackCommand, resetGroundStrafe } from '../../src/ai/shipAttack'
import { createBombAim, setBombBallistics, stepBombAim } from '../../src/ai/bombRun'
import { applySafety } from '../../src/ai/safety'
import { solveImpact, type BombState, type Impact } from '../../src/world/bomb'
import { BOMB_BLAST_RADIUS } from '../../src/weapons/bomb'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { THROTTLE_FLOOR } from '../../src/input/throttle'
import { RHO0 } from '../../src/physics/atmosphere'
import { AiController } from '../../src/ai/AiController'
import type { Controller, Command } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
const SECONDS = Number(process.env['SECONDS'] ?? 220)
const DEG = Math.PI / 180
const DIVE = Number(process.env['DIVE_DEG'] ?? 75) * DEG
const ENTRY_S = Number(process.env['ENTRY_S'] ?? 3)
const RELEASE_AGL = Number(process.env['RELEASE_AGL'] ?? 500)
const IAS_BRAKE = Number(process.env['IAS_BRAKE'] ?? 0.6)
const MIN_DIVE_HEIGHT = 1000
/** 離目標多高以下才用落點修正的瞄準；以上只追視線 */
const AIM_FROM = Number(process.env['AIM_FROM'] ?? 99999)

const terrain = createTerrain('kursk')
const b = createBattle(new AiController(), missionConfigFrom(readyCard('germany-m4')), 20260913)
const w = b.world
const policy = flatSeaCrashPolicy(terrain.collisionHeightAt)
let crashed = 0
w.crashPolicy = (c) => { const hit = policy(c); if (hit && c.team === 'blue') crashed++; return hit }
w.land = terrain.land
w.groundAt = terrain.collisionHeightAt
w.waterAt = terrain.waterAt
settleGroundTargets(w.groundTargets, w.groundAt)
setBombBallistics(w.bombDrag, DT)

const START: BombState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
const HIT: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }
const DECK = (): number => deckY
let deckY = 0

type Phase = 'level' | 'dive' | 'pullout' | 'egress'

interface DiveLog { seat: number; t: number; entryH: number; entryRange: number; samples: { h: number; ias: number; g: number; pitch: number; bank: number }[]
  releaseT: number; releaseH: number; releaseMiss: number; minAgl: number; safety: string; safetyH: number; maxN: number }
const logs: DiveLog[] = []

class DiveProbe implements Controller {
  phase: Phase = 'level'
  readonly strafe = createGroundStrafeState()
  readonly bombAim = createBombAim()
  target: GroundTarget | null = null
  tick = 0
  holdAlt = 0
  released = false
  cur: DiveLog | null = null
  constructor(readonly seat: number) {}

  pick(self: Aircraft): void {
    let best: GroundTarget | null = null
    let bestD = Infinity
    for (const t of w.groundTargets) {
      if (!t.alive || t.team === 'blue' || t.unit.id !== 'atGun') continue
      const d = Math.hypot(t.position.x - self.state.position.x, t.position.z - self.state.position.z)
      // 各架挑不同的一門：座位號當作往後數第幾近
      const key = d + this.seat * 400
      if (key < bestD) { bestD = key; best = t }
    }
    this.target = best
  }

  update(self: Aircraft, _dt: number, out: Command): void {
    const decide = this.tick++ % 24 === 0
    if (this.target === null || !this.target.alive || decide && this.phase === 'level') this.pick(self)
    const t = this.target
    out.firing = false
    out.bombing = false
    out.upright = false
    out.trackTurn = false
    out.brake = 0
    out.throttle = WEP_THROTTLE
    const p = self.state.position
    const v = self.state.velocity
    const tas = v.length()
    const ias = Math.sqrt((2 * self.diag.aero.qbar) / RHO0)
    if (t === null) {
      out.aimWorld.set(0, 0, -1).applyQuaternion(self.state.orientation)
      out.aimWorld.y = 0
      out.aimWorld.normalize()
      return
    }
    const dx = t.position.x - p.x
    const dz = t.position.z - p.z
    const range = Math.hypot(dx, dz)
    const h = p.y - t.position.y
    const gamma = tas > 1 ? Math.asin(v.y / tas) : 0

    if (this.phase === 'level') {
      out.aimWorld.set(dx / range, 0, dz / range)
      if (this.holdAlt === 0) this.holdAlt = p.y
      const err = this.holdAlt - p.y
      out.aimWorld.y = Math.max(-0.3, Math.min(0.3, (err - 6 * v.y) / 400))
      out.aimWorld.normalize()
      const entry = h / Math.tan(DIVE) + tas * ENTRY_S
      const nose = new Vector3(0, 0, -1).applyQuaternion(self.state.orientation)
      const aligned = (nose.x * dx + nose.z * dz) / (Math.hypot(nose.x, nose.z) * range + 1e-9) > Math.cos(10 * DEG)
      if (h >= MIN_DIVE_HEIGHT && range <= entry && aligned) {
        this.phase = 'dive'
        resetGroundStrafe(this.strafe)
        this.released = false
        this.cur = { seat: this.seat, t: w.time, entryH: h, entryRange: range, samples: [], releaseT: -1, releaseH: -1, releaseMiss: NaN,
          minAgl: Infinity, safety: 'none', safetyH: -1, maxN: 0 }
        logs.push(this.cur)
      }
    } else if (this.phase === 'dive') {
      groundAttackCommand(this.strafe, self, t, decide, out, undefined, terrain.land)
      out.firing = false
      out.upright = true
      out.throttle = THROTTLE_FLOOR
      out.brake = Math.max(0, Math.min(1, (ias / self.spec.limits.vne - IAS_BRAKE) / 0.2))
      const bay = w.combatants[this.seat]!.bombBay
      const loaded = bay.load > 0 || bay.queue > 0
      stepBombAim(this.bombAim, self, t, loaded, decide, null, 3000, BOMB_BLAST_RADIUS * 2)
      if (this.bombAim.active && h <= AIM_FROM) out.aimWorld.copy(this.bombAim.aim)
      else if (h > AIM_FROM) {
        // 高處只追視線（不加落點修正）：落點修正量在高處很大，會把機首推向正下方
        out.aimWorld.set(dx, t.position.y - p.y, dz).normalize()
      }
      if (loaded && h <= RELEASE_AGL) {
        out.bombing = true
        if (this.cur !== null && this.cur.releaseT < 0) {
          this.cur.releaseT = w.time
          this.cur.releaseH = h
          START.x = p.x; START.y = p.y; START.z = p.z; START.vx = v.x; START.vy = v.y; START.vz = v.z
          deckY = t.impactY
          this.cur.releaseMiss = solveImpact(START, w.bombDrag, DECK, DT, HIT) ? Math.hypot(HIT.x - t.position.x, HIT.z - t.position.z) : NaN
        }
      }
      if ((!loaded || h <= RELEASE_AGL) && this.cur !== null && this.cur.releaseT >= 0) this.phase = 'pullout'
      if (h <= RELEASE_AGL - 50) this.phase = 'pullout'
    } else if (this.phase === 'pullout') {
      const hx = v.x
      const hz = v.z
      const hl = Math.hypot(hx, hz) || 1
      out.aimWorld.set((hx / hl) * Math.cos(20 * DEG), Math.sin(20 * DEG), (hz / hl) * Math.cos(20 * DEG))
      if (gamma > 5 * DEG) this.phase = 'egress'
    } else {
      const hx = v.x
      const hz = v.z
      const hl = Math.hypot(hx, hz) || 1
      out.aimWorld.set((hx / hl) * Math.cos(12 * DEG), Math.sin(12 * DEG), (hz / hl) * Math.cos(12 * DEG))
      // 爬到夠高、而且離目標夠遠就回頭
      if (h >= 1500 && range > 3000) { this.phase = 'level'; this.holdAlt = 0 }
    }

    // 安全層：真的套用，記下第一次介入
    const ground = terrain.collisionHeightAt(p.x, p.z)
    const action = applySafety(self, ground, out)
    const cur = this.cur
    if (cur !== null && (this.phase === 'dive' || this.phase === 'pullout')) {
      if (action !== 'none' && cur.safety === 'none') { cur.safety = `${action}@${this.phase}`; cur.safetyH = h }
      const agl = p.y - ground
      if (agl < cur.minAgl) cur.minAgl = agl
      if (self.diag.loadFactor > cur.maxN) cur.maxN = self.diag.loadFactor
      if (this.tick % 12 === 0 && this.phase === 'dive') {
        const nose = new Vector3(0, 0, -1).applyQuaternion(self.state.orientation)
        const up = new Vector3(0, 1, 0).applyQuaternion(self.state.orientation)
        const right = new Vector3(1, 0, 0).applyQuaternion(self.state.orientation)
        cur.samples.push({
          h, ias, g: gamma / DEG, pitch: Math.asin(nose.y) / DEG,
          bank: Math.atan2(right.y, up.y) / DEG,
        })
      }
    }
  }
}

const probes: DiveProbe[] = []
for (const c of w.combatants) {
  if (c.team !== 'blue') continue
  const pr = new DiveProbe(c.index)
  probes.push(pr)
  c.controller = pr
}
console.log(`俯衝 ${(DIVE / DEG).toFixed(0)}°、投彈高度 ${RELEASE_AGL} m、壓機鼻預留 ${ENTRY_S} s、開減速板 IAS/vne>${IAS_BRAKE}`)

for (let i = 0; i < Math.round(SECONDS / DT); i++) {
  stepBattle(b, DT)
  clearImpacts(w.groundKillEvents)
  clearKills(w.killEvents)
  clearImpacts(w.hitEvents)
  clearImpacts(w.splashEvents)
  clearImpacts(w.bombEvents)
  if (b.outcome !== 'fighting') break
}
console.log(`墜毀（藍隊）${crashed}；活著 ${w.combatants.filter((c) => c.team === 'blue' && c.alive).length}/4；地面目標損失 ${w.groundTargets.filter((t) => !t.alive).length}`)
for (const l of logs) {
  console.log(`\n#${l.seat} t=${l.t.toFixed(0)} 壓機鼻：高 ${l.entryH.toFixed(0)} m、水平 ${l.entryRange.toFixed(0)} m；` +
    `投彈 t=${l.releaseT.toFixed(1)} 高 ${l.releaseH.toFixed(0)} m、預測落點離目標 ${l.releaseMiss.toFixed(0)} m；最低離地 ${l.minAgl.toFixed(0)} m；最大過載 ${l.maxN.toFixed(1)}；` +
    `安全層 ${l.safety}${l.safetyH >= 0 ? ` @高${l.safetyH.toFixed(0)}` : ''}`)
  if (l.seat !== 0) continue
  const pick = l.samples.filter((_, k) => k % 6 === 0)
  console.log('   ' + pick.map((s) => `${s.h.toFixed(0)}m:IAS${s.ias.toFixed(0)} γ${s.g.toFixed(0)} 俯${s.pitch.toFixed(0)} 滾${s.bank.toFixed(0)}`).join(' | '))
}
