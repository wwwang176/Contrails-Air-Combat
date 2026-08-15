/**
 * 「預瞄偏移還能更高嗎」的量測。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/aim-ceiling.probe.ts
 *
 * 【它要回答什麼】2026-08-16 落地的主判準門檻是 `AIM_ERROR_FLOOR = 2°`，
 * 現況是 5.42~7.42°。專案負責人問：2 度是最高了嗎，還有辦法更高嗎？
 *
 * 那是兩個問題，這支只答得出第二個的一半。
 *
 * ## 一、門檻能訂多高 —— **4°（= 2 × HIT_CONE）**，理由在下面
 *
 * 拿現況最小值 5.42° 當門檻是照著現況畫靶（2026-08-13 spec §7.5 的第三次
 * 教訓）。2026-08-16 補了兩張掃描，答案才有依據。
 *
 * 【穩健性掃描：距離 700/800/900 × yaw ±8° × pitch ±8°，共 108 組】
 * 這些擾動都不改變場景語意，落差就是判準的體質雜訊。
 *
 *   場景          釘死那點    最小     中位     最大
 *   正前方‧前飛     5.85°     5.18°    5.86°    6.45°
 *   正前方‧橫飛     5.50°     0.99°    5.50°    6.37°
 *   我的正上方      7.46°     0.97°    7.39°    8.41°
 *   我的正下方      7.17°     0.60°    6.71°    7.65°
 *
 * 【俯仰細掃：這個判準是雙峰的，中間幾乎沒有東西】
 * 曲線在多數區間平滑（前飛整段 5.83~5.86，紋風不動），但有**懸崖**：
 * 橫飛 pitch +2° 從 5.50 掉到 1.07、上方 −8° 掉到 2.22、下方 −6~−2° 掉到
 * 約 2。也就是 AI 要嘛落在 5.2~8.4°（破防成立），要嘛落在 0.6~3.2°
 * （某個分支翻掉），**3.2~5.2 之間是空的**。
 *
 * 所以門檻訂在那個空帶裡的任何值，鑑別力一樣；該挑的是兩邊餘裕最平均的
 * 那個。**4°** 落在空帶正中，且剛好 = 2 × `HIT_CONE`，錨的語意不變：
 * 「預瞄點一秒內移動超過**兩個**命中錐」。它不是從現況那張表推出來的。
 *
 * 【順帶：那些懸崖本身可能是缺陷】橫飛只要俯仰擺 +2° 就整個塌掉，離釘死
 * 那一點非常近。查不查是專案負責人的決定。
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

interface Row {
  err: number; samples: number; window: number; alive: boolean
  /** 實際位置與「照前瞻窗前那樣直飛」的距離中位數，m */
  dev: number
  /** 上面那個偏差沿觀測者視線的分量（**徑向 —— 看不見**），m */
  radial: number
  /** 垂直視線的分量（**切向 —— 看得見**），m */
  tangential: number
  /** 取樣格裡意圖是 `defend` 的比例 —— 場景成不成立 */
  defendShare: number
}

/**
 * 開局擾動，度。`yaw` 繞鉛直軸、`pitch` 繞「航向 × 鉛直」。
 *
 * 【為什麼要有這個】護欄釘死在 800 m、航向零誤差的那一點上。要判斷門檻能
 * 訂多高，得先知道這個數字**對語意上無關的小擾動有多敏感** —— 若擺歪 8°
 * 就掉一半，那把門檻頂到現況最小值附近，一次無害的重構就會踩到。
 */
interface Tilt { yaw: number; pitch: number }
const NO_TILT: Tilt = { yaw: 0, pitch: 0 }

function tilted(course: Vector3, t: Tilt): Vector3 {
  const c = course.clone()
  if (t.yaw !== 0) c.applyAxisAngle(UP, (t.yaw * Math.PI) / 180)
  if (t.pitch !== 0) {
    const axis = new Vector3().crossVectors(c, UP)
    if (axis.lengthSq() > 1e-12) c.applyAxisAngle(axis.normalize(), (t.pitch * Math.PI) / 180)
  }
  return c.normalize()
}

function run(
  probe: Probe, pilot: Pilot, standoff: number, lookahead: number, tilt: Tilt = NO_TILT,
): Row {
  const steps = Math.round(lookahead * 240)
  const world = new World()
  const prey = new Aircraft(BLUNT, ALT, TAS)
  const lamp = new Aircraft(BLUNT, ALT, TAS)
  const ghost = new Aircraft(BLUNT, ALT, TAS)

  const asp = ASPECTS[probe]
  const lampPos = new Vector3(0, ALT, 0)
  const preyPos = asp.off(standoff).add(lampPos)
  const course = tilted(asp.course, tilt)
  for (const [a, p, c] of [[prey, preyPos, course], [lamp, lampPos, FWD]] as const) {
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
  // 【與落地護欄對齊】整段前瞻都必須在 defend、而且反應延遲已排空。
  // 少了這道閘門，擾動掃描會把「AI 還沒開始閃」的格子也算成「閃得很小」
  const settle = Math.ceil(VETERAN.reactionDelay * 240)
  let defendRun = 0
  let defendN = 0
  const errs: number[] = []
  const devs: number[] = []
  const rads: number[] = []
  const tans: number[] = []
  const dev = new Vector3()
  const losv = new Vector3()
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

    defendRun = pilot !== 'ai' || ai.intent === 'defend' ? defendRun + 1 : 0

    const n = histP.length
    histP[head]!.copy(prey.state.position)
    histV[head]!.copy(prey.state.velocity)
    const old = (head - steps + n) % n
    head = (head + 1) % n
    if (filled <= steps) filled++

    if (filled <= steps || s - from < steps || s % 12 !== 0) continue
    if (defendRun < steps + settle) continue
    if (pilot === 'ai' && ai.intent === 'defend') defendN++

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

    // 位移分解：偏差有多少落在觀測者看得見的方向上
    dev.subVectors(prey.state.position, ghost.state.position)
    losv.subVectors(prey.state.position, lamp.state.position).normalize()
    const r = dev.dot(losv)
    const tot = dev.length()
    devs.push(tot)
    rads.push(Math.abs(r))
    tans.push(Math.sqrt(Math.max(tot * tot - r * r, 0)))
  }
  return {
    err: median(errs), samples: errs.length, window: (to - from) * DT, alive,
    dev: median(devs), radial: median(rads), tangential: median(tans),
    defendShare: defendN / Math.max(errs.length, 1),
  }
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

/**
 * **倍率的分子分母解剖。**
 *
 * 【為什麼要這一張】訊噪比（AI ÷ 直飛）在四個場景是 9~48 倍，差 5 倍。
 * 但分子只差 1.37 倍（5.42~7.42°），分母差 4 倍（0.15~0.60°）——
 * **那個落差主要來自分母**。
 *
 * 【假說】直飛的地板不是 0，是因為飛機有長週期俯仰起伏。那個擺動是
 * **鉛直**的：從正下方看是徑向（不改變視線方位、看不見），從正前方看是
 * 切向（全看得見）。若成立，四個場景的**位移總量應該一樣**，只有切向
 * 分量不同 —— 因為 above/below/ahead 三場的受測機航跡**逐位元相同**
 * （都是 FWD 直飛，只有手電筒擺的位置不同），crossing 也只是旋轉 90°。
 *
 * 【這一張若成立，代表什麼】**訊噪比不能拿來跨場景比較** —— 它的分母被
 * 「殘餘擺動剛好指向哪裡」污染了。跨場景該比的是分子本身。
 */
function anatomy(standoff: number, lookahead: number): void {
  console.log(`

╔══ 倍率的分子分母解剖（${standoff} m ／ 前瞻 ${lookahead} 秒）════════════`)
  for (const pilot of ['none', 'ai'] as const) {
    console.log(`
  受測方 = ${pilot === 'none' ? '腳本直飛（分母／地板）' : '出貨 AI（分子）'}`)
    console.log('    場景          預瞄誤差   位移總量    徑向     切向    切向佔比')
    for (const p of PROBES) {
      const r = run(p, pilot, standoff, lookahead)
      console.log(
        `    ${ASPECTS[p].label.padEnd(12)}`
        + `${r.err.toFixed(2).padStart(7)}°`
        + `${r.dev.toFixed(1).padStart(10)}m`
        + `${r.radial.toFixed(1).padStart(9)}m`
        + `${r.tangential.toFixed(1).padStart(9)}m`
        + `${(r.tangential / Math.max(r.dev, 1e-9) * 100).toFixed(0).padStart(10)}%`,
      )
    }
  }
}

/**
 * **穩健性掃描 —— 門檻能訂多高，答案在這一張，不在現況那張。**
 *
 * 【問題】專案負責人問：不改程式碼的話，`AIM_ERROR_FLOOR` 從 2° 可以改成
 * 幾度？現況四場是 5.42~7.42°，直覺會想頂到 5° 附近。
 *
 * 【為什麼不能那樣訂】護欄釘死在「800 m、航向零誤差」那**一個點**上。
 * 那一點的數字高，不代表附近都高。若擺歪一點就掉一半，門檻頂到現況最小值
 * 附近時，一次語意上無害的重構就會踩線 —— 護欄變成雜訊產生器。
 *
 * 【所以掃什麼】距離 700/800/900、開局航向 yaw 與 pitch 各 0/±8°。
 * 這些擾動**都不改變場景的語意**（還是「800 m 左右、大致某個方位」），
 * 所以它們之間的落差就是這個判準的**體質雜訊**。
 *
 * 門檻該訂在這張表的**最小值以下**，不是現況那一點以下。
 */
function robust(lookahead: number): void {
  console.log(`
`)
  console.log(`╔══ 穩健性掃描（前瞻 ${lookahead} 秒）═══════════════════════════`)
  console.log('  距離 700/800/900 × yaw 0/±8° × pitch 0/±8°，每場 27 組')
  console.log('  場景          釘死那點    最小     中位     最大    低於 4° 的組數')
  let worst = Infinity
  let worstAt = ''
  for (const p of PROBES) {
    const pin = run(p, 'ai', 800, lookahead).err
    const errs: number[] = []
    for (const d of [700, 800, 900]) {
      for (const yaw of [-8, 0, 8]) {
        for (const pitch of [-8, 0, 8]) {
          const r = run(p, 'ai', d, lookahead, { yaw, pitch })
          // 樣本不足或墜毀的組合不納入 —— 那是量測失效，不是 AI 不閃
          if (!r.alive || r.samples < 20) continue
          errs.push(r.err)
          if (r.err < worst) {
            worst = r.err
            worstAt = `${ASPECTS[p].label} ${d}m yaw${yaw} pitch${pitch}`
          }
        }
      }
    }
    const lo = Math.min(...errs)
    const hi = Math.max(...errs)
    const under4 = errs.filter((e) => e < 4).length
    console.log(
      `  ${ASPECTS[p].label.padEnd(12)}`
      + `${pin.toFixed(2).padStart(7)}°`
      + `${lo.toFixed(2).padStart(9)}°`
      + `${median(errs).toFixed(2).padStart(9)}°`
      + `${hi.toFixed(2).padStart(9)}°`
      + `${(under4 + '/' + errs.length).padStart(12)}`,
    )
  }
  console.log(`
  全域最小值 ${worst.toFixed(2)}° @ ${worstAt}`)
}

/**
 * 低點的解剖 —— **「AI 沒動」還是「動了但你看不見」？**
 *
 * 兩者對門檻的意義完全不同：前者是 AI 真的有洞，門檻頂高就會抓到它；
 * 後者是這個判準在那個幾何下失去解析度，門檻頂高只會製造假警報。
 *
 * 分辨方法就是 `anatomy` 那一張的欄位：位移總量大但切向小 = 動了看不見；
 * 位移總量本身就小（接近直飛地板的 2~3 m）= 真的沒動。
 */
function lowDetail(lookahead: number, cut: number): void {
  console.log(`

╔══ 低於 ${cut}° 的組合，逐一解剖 ═══════════════════════════`)
  console.log('  場景          距離  yaw pitch   誤差   位移總量   徑向    切向   取樣')
  for (const p of PROBES) {
    for (const d of [700, 800, 900]) {
      for (const yaw of [-8, 0, 8]) {
        for (const pitch of [-8, 0, 8]) {
          const r = run(p, 'ai', d, lookahead, { yaw, pitch })
          if (!r.alive || r.samples < 20 || r.err >= cut) continue
          console.log(
            `  ${ASPECTS[p].label.padEnd(12)}`
            + `${String(d).padStart(5)}`
            + `${String(yaw).padStart(5)}`
            + `${String(pitch).padStart(6)}`
            + `${r.err.toFixed(2).padStart(8)}°`
            + `${r.dev.toFixed(1).padStart(10)}m`
            + `${r.radial.toFixed(1).padStart(8)}m`
            + `${r.tangential.toFixed(1).padStart(8)}m`
            + `${String(r.samples).padStart(7)}`,
          )
        }
      }
    }
  }
}


/**
 * 細掃 —— **釘死那一點是穩定盆地，還是運氣好的尖峰？**
 *
 * 粗掃（±8°）看到低到 1° 的組合，但那不足以定門檻：如果曲線是平滑的、
 * 只在 ±8° 的邊緣才掉下去，釘死那點就在一個安全盆地裡，門檻可以訂高一些；
 * 如果 ±2° 就開始劇烈跳動，那它只是運氣好，門檻必須留大餘裕。
 */
function fine(lookahead: number): void {
  console.log(`

╔══ 開局俯仰細掃（800 m，pitch −8~+8 每 2°）═══════════════`)
  const cols = [-8, -6, -4, -2, 0, 2, 4, 6, 8]
  console.log('  場景        ' + cols.map((c) => (c + '°').padStart(7)).join(''))
  for (const p of PROBES) {
    const row = cols.map((pitch) => {
      const r = run(p, 'ai', 800, lookahead, { yaw: 0, pitch })
      return (!r.alive || r.samples < 20 ? '—' : r.err.toFixed(2)).padStart(7)
    })
    console.log('  ' + ASPECTS[p].label.padEnd(12) + row.join(''))
  }
}

table(800, 1)
sweepLookahead(800)
anatomy(800, 1)
robust(1)
fine(1)
lowDetail(1, 4)
