/**
 * 「預瞄偏移還能更高嗎」的量測。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/aim-ceiling.probe.ts
 *
 * 【它要回答什麼】2026-08-16 落地的主判準門檻是 `AIM_ERROR_FLOOR = 2°`，
 * 現況是 5.42~7.42°。專案負責人問：2 度是最高了嗎，還有辦法更高嗎？
 *
 * 那是兩個問題，這支只答得出第二個的一半。
 *
 * ## 一、門檻能訂多高 —— 5.42°（現況最小值）
 *
 * 但拿現況定門檻就是照著現況畫靶，本專案第三次的教訓（2026-08-13
 * spec §7.5）。若要一個有牙齒的數字，它得錨在別的東西上，不是這張表。
 *
 * ## 二、AI 還能不能閃更兇 —— **這支答不出來，原因記在下面**
 *
 * 原本的想法是拿 `ScriptedBreaker` 的 `horizUp` 軸當「這具機體的物理
 * 天花板」。**那個想法是錯的**，實測與靜態都證實：
 *
 *   場景          腳本破防的命令方向        結果
 *   正前方‧前飛   離航向 105°（正常破開）   5.85°，與 AI 完全相同
 *   正前方‧橫飛   離航向 155.2°（幾乎掉頭） 0.99°
 *   我的正上方    破防軸退化（UP × 視線 = 0）0.45°
 *   我的正下方    同上                       0.73°
 *
 * 180° 附近的轉向命令沒有偏好的滾轉方向，指揮儀在那裡退化；視線鉛直時
 * `UP × 視線` 是零向量，軸整個退回升力方向。**那支腳本只在尾追幾何下
 * 有意義**，它是為 700/900 兩條尾追測試寫的，不是通用的極限參考。
 *
 * 順帶得到一個真的發現：出貨的 `AiController` 在那三個幾何下**遠優於**
 * 這條裸公式（5.42 vs 0.99、7.42 vs 0.45、6.82 vs 0.73）—— 它不是照著
 * `defendAim` 盲執行，中間還有別的東西在救。
 *
 * 要真的量機體極限，需要一個**神諭控制器**：每一格直接求「在觀測者視野
 * 裡角速度最大的那個方向」再以最大可用 G 拉過去。那是另一輪的事。
 *
 * ## 三、真正量到的槓桿：前瞻窗長
 *
 * 判準的數字不只取決於 AI。這支掃了距離與前瞻窗，結論很乾淨：
 *
 *   **前瞻 1 秒 → 2 秒，四個場景一致放大約 2.9 倍**
 *   （5.85→17.17、5.42→15.51、7.42→20.47、6.82→18.91）
 *
 *   距離則**不是**單純的放大器：800→400 m 時「前飛」上升（5.85→8.42）
 *   但「上方」反而下降（7.42→3.55）—— 距離改變的不只是角度尺度，還改變
 *   了接戰本身（400 m 的「上方」有效窗跑到 20 秒上限，代表它幾乎沒分開）。
 *
 * 所以「要更高」目前有一條乾淨的路：**調前瞻窗長**。那正是專案負責人
 * 判準原話裡的「N 秒」，是他的參數。
 */
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { buildEngageBasis, createEngageBasis, DEFAULT_STEER } from '../../src/ai/steer'
import { createTargetBoard } from '../../src/ai/target'
import { alarmFactor } from '../../src/ai/assess'
import { VETERAN } from '../../src/ai/profile'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
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
const LAMP_SECONDS = 20

function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}
const BLUNT: AircraftSpec = { ...P51D, battery: harmless(P51D.battery) }

class Idle implements Controller {
  update(_s: Aircraft, _d: number, out: Command): void {
    out.throttle = 0.7; out.brake = 0; out.firing = false; out.aimWorld.copy(FWD)
  }
}

/**
 * 腳本破防。`hard = false` 就是直飛（自我檢查用）。
 *
 * 【這是 ai-visible-evasion 那支 `ScriptedBreaker` 的 `horizUp` 分支】
 * 同樣的軸與同樣的抬角，抄過來是為了不動那個檔案。軸取世界水平面內、
 * 垂直於視線的方向，再套 `defendTilt` 的抬角，最後與視線混 `defendOffset`。
 */
class Breaker implements Controller {
  threat: Aircraft | null = null
  hard = true
  private sign = 0
  private readonly los = new Vector3()
  private readonly axis = new Vector3()
  private readonly lift = new Vector3()
  private readonly up = new Vector3()

  update(self: Aircraft, _dt: number, out: Command): void {
    out.throttle = WEP_THROTTLE
    out.brake = 0
    out.firing = false
    const th = this.threat
    if (!this.hard || th === null) {
      out.aimWorld.copy(self.state.velocity).normalize()
      return
    }
    this.los.copy(th.state.position).sub(self.state.position).normalize()
    this.lift.copy(UP).applyQuaternion(self.state.orientation)
    this.axis.copy(UP).cross(this.los)
    if (this.axis.lengthSq() < 1e-8) this.axis.copy(this.lift)
    this.axis.normalize()
    if (this.sign === 0) this.sign = this.axis.dot(this.lift) >= 0 ? 1 : -1
    this.axis.multiplyScalar(this.sign)
    this.up.copy(UP).addScaledVector(this.los, -UP.dot(this.los))
    if (this.up.lengthSq() > 1e-12) {
      this.up.normalize()
      this.axis.multiplyScalar(Math.cos(DEFAULT_STEER.defendTilt))
        .addScaledVector(this.up, Math.sin(DEFAULT_STEER.defendTilt))
    }
    if (this.axis.lengthSq() < 1e-12) this.axis.set(1, 0, 0)
    this.axis.normalize()
    out.aimWorld.copy(this.los).multiplyScalar(Math.cos(DEFAULT_STEER.defendOffset))
      .addScaledVector(this.axis, Math.sin(DEFAULT_STEER.defendOffset))
      .normalize()
  }
}

type Probe = 'ahead' | 'crossing' | 'above' | 'below'
type Pilot = 'ai' | 'break' | 'none'

const ASPECTS: Record<Probe, { off: (d: number) => Vector3; course: Vector3; label: string }> = {
  ahead: { off: (d) => new Vector3(0, 0, -d), course: FWD, label: '正前方‧前飛' },
  crossing: { off: (d) => new Vector3(0, 0, -d), course: new Vector3(-1, 0, 0), label: '正前方‧橫飛' },
  above: { off: (d) => new Vector3(0, d, 0), course: FWD, label: '我的正上方' },
  below: { off: (d) => new Vector3(0, -d, 0), course: FWD, label: '我的正下方' },
}

function median(v: number[]): number {
  if (v.length === 0) return 0
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

interface Row { err: number; samples: number; window: number; alive: boolean }

function run(probe: Probe, pilot: Pilot, standoff: number, lookahead: number): Row {
  const steps = Math.round(lookahead * 240)
  const world = new World()
  const prey = new Aircraft(BLUNT, ALT, TAS)
  const lamp = new Aircraft(BLUNT, ALT, TAS)
  const ghost = new Aircraft(BLUNT, ALT, TAS)

  const asp = ASPECTS[probe]
  const lampPos = new Vector3(0, ALT, 0)
  const preyPos = asp.off(standoff).add(lampPos)
  for (const [a, p, c] of [[prey, preyPos, asp.course], [lamp, lampPos, FWD]] as const) {
    a.state.position.copy(p)
    a.state.velocity.copy(c).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(FWD, c)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }

  const ai = new AiController()
  const breaker = new Breaker()
  breaker.hard = pilot === 'break'
  breaker.threat = lamp
  const pc = world.add(prey, pilot === 'ai' ? ai : breaker, 'blue', preyPos, ALT, TAS)
  const lc = world.add(lamp, new Idle(), 'red', lampPos, ALT, TAS)
  for (const c of [pc, lc]) c.respawnOnDestroy = false
  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = pc.index
  ai.profile = VETERAN

  const basis = createEngageBasis()
  const dir = new Vector3()
  const look = new Vector3()
  const a = new Vector3()
  const b = new Vector3()
  const start = lampPos.clone()
  const lvel = new Vector3(0, 0, -TAS)

  const histP: Vector3[] = []
  const histV: Vector3[] = []
  for (let i = 0; i <= steps; i++) { histP.push(new Vector3()); histV.push(new Vector3()) }
  let head = 0, filled = 0
  const errs: number[] = []
  let inside = false, from = 0, to = 0, alive = true

  for (let s = 0; s < LAMP_SECONDS * 240; s++) {
    world.step(DT)
    if (!pc.alive || !lc.alive) { alive = false; break }

    lamp.state.position.copy(start).addScaledVector(lvel, (s + 1) * DT)
    lamp.state.velocity.copy(lvel)
    lamp.state.angularVelocity.set(0, 0, 0)
    buildEngageBasis(lamp, prey, basis)
    dir.copy(basis.leadPoint).normalize()
    lamp.state.orientation.setFromUnitVectors(FWD, dir)
    lamp.prevPosition.copy(lamp.state.position)
    lamp.prevOrientation.copy(lamp.state.orientation)

    const valid = alarmFactor(lamp, prey) > 0
    if (!inside) { if (!valid) continue; inside = true; from = s } else if (!valid) break
    to = s

    const n = histP.length
    histP[head]!.copy(prey.state.position)
    histV[head]!.copy(prey.state.velocity)
    const old = (head - steps + n) % n
    head = (head + 1) % n
    if (filled <= steps) filled++

    if (filled <= steps || s - from < steps || s % 12 !== 0) continue

    const pv = histV[old]!
    ghost.state.position.copy(histP[old]!).addScaledVector(pv, lookahead)
    ghost.state.velocity.copy(pv)
    const sp = pv.length()
    if (sp > 1e-6) ghost.state.orientation.setFromUnitVectors(FWD, look.copy(pv).divideScalar(sp))
    ghost.prevPosition.copy(ghost.state.position)
    ghost.prevOrientation.copy(ghost.state.orientation)

    buildEngageBasis(lamp, prey, basis)
    a.copy(basis.leadPoint).normalize()
    buildEngageBasis(lamp, ghost, basis)
    b.copy(basis.leadPoint).normalize()
    errs.push(a.angleTo(b) * RAD)
  }
  return { err: median(errs), samples: errs.length, window: (to - from) * DT, alive }
}

const PROBES: Probe[] = ['ahead', 'crossing', 'above', 'below']

function table(standoff: number, lookahead: number): void {
  console.log(`
══ ${standoff} m ／ 前瞻 ${lookahead} 秒 ═══════════════════════════`)
  console.log('  場景            AI      裸破防公式   直飛自檢    AI/公式   有效窗(AI)')
  for (const p of PROBES) {
    const ai = run(p, 'ai', standoff, lookahead)
    const hd = run(p, 'break', standoff, lookahead)
    const no = run(p, 'none', standoff, lookahead)
    const ratio = hd.err > 1e-6 ? (ai.err / hd.err * 100).toFixed(0) + '%' : '—'
    const warn = [ai, hd, no].some((r) => !r.alive || r.samples < 10) ? '  ⚠ 樣本不足或墜毀' : ''
    console.log(
      `  ${ASPECTS[p].label.padEnd(12)}`
      + `${ai.err.toFixed(2).padStart(6)}°`
      + `${hd.err.toFixed(2).padStart(12)}°`
      + `${no.err.toFixed(2).padStart(11)}°`
      + `${ratio.padStart(10)}`
      + `${ai.window.toFixed(1).padStart(11)}s`
      + warn,
    )
  }
}

/**
 * 前瞻窗長的掃描 —— **這是「要更高」唯一乾淨的槓桿**。
 *
 * 【為什麼要並排看訊噪比】前瞻拉長時，直飛的自檢地板也跟著長（物理積分的
 * 殘差、推力與阻力讓速度不是嚴格常數）。單看 AI 的度數會誤判「越長越好」；
 * 真正該看的是 **AI ÷ 直飛** —— 判準把「在閃」與「沒在閃」分得多開。
 *
 * 【也要看取樣數】取樣要等前瞻窗填滿才開始（`s - from >= steps`），所以
 * 前瞻越長、能用的樣本越少。落地的掃描斷言 `samples >= 40`，這一欄直接
 * 顯示哪些組合會撞到那條線。
 */
function sweepLookahead(standoff: number): void {
  console.log(`

╔══ 前瞻窗長掃描（${standoff} m）═══════════════════════════════════`)
  for (const p of PROBES) {
    console.log(`
  ${ASPECTS[p].label}`)
    console.log('    前瞻      AI     直飛自檢   訊噪比   取樣數   有效窗')
    for (const la of [0.5, 1, 1.5, 2]) {
      const ai = run(p, 'ai', standoff, la)
      const no = run(p, 'none', standoff, la)
      const snr = no.err > 1e-6 ? (ai.err / no.err).toFixed(1) + '×' : '—'
      const thin = ai.samples < 40 ? '  ⚠ 取樣數低於落地斷言的 40' : ''
      console.log(
        `    ${(la + 's').padEnd(8)}`
        + `${ai.err.toFixed(2).padStart(6)}°`
        + `${no.err.toFixed(2).padStart(11)}°`
        + `${snr.padStart(9)}`
        + `${String(ai.samples).padStart(9)}`
        + `${ai.window.toFixed(1).padStart(9)}s`
        + thin,
      )
    }
  }
}

console.log('「裸破防公式」= ScriptedBreaker 的 horizUp 軸。**它不是機體極限** ——')
console.log('橫飛時命令幾乎是掉頭（155°）、上下方時破防軸整個退化，見檔頭。')
console.log('它只在尾追幾何下有意義；AI 在另外三個幾何遠優於它。')

table(800, 1)
table(400, 1)
sweepLookahead(800)
