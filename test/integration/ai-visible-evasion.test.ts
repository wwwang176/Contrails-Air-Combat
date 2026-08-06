import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { buildEngageBasis, createEngageBasis } from '../../src/ai/steer'
import { createTargetBoard } from '../../src/ai/target'
import { threatFactor } from '../../src/ai/assess'
import { VETERAN } from '../../src/ai/profile'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { P51D } from '../../src/specs/p51d'
import { RAD } from '../../src/core/math'
import type { Command, Controller } from '../../src/control/Controller'
import type { AircraftSpec } from '../../src/specs/types'
import type { Battery } from '../../src/weapons/types'

/**
 * # 看得見的閃躲
 *
 * 這一層的判準是專案負責人給的，而且**刻意不是「AI 打得贏」**：
 *
 * > 後方敵人準星放在敵機預瞄位置時，看到前方的敵機預瞄位置有大幅度變化，
 * > 就算 OK。幅度 5 度左右就算及格。
 *
 * 量的因此不是 AI 做了什麼，而是**玩家的瞄準工作被打亂多少**。一架滾得很
 * 誇張但預瞄點沒動的飛機其實沒在閃；預瞄點跳 5° 的飛機，玩家非重新瞄不可。
 *
 * 其餘的結果指標（被鎖定佔比、掉血、比能量、最低高度）在這一層**不是判準**
 * ——它們是別處的護欄。詳見
 * `docs/superpowers/specs/2026-08-06-visible-evasion-design.md`。
 */

const DT = 1 / 240
const ALT = 4000
const TAS = 200
const FWD = new Vector3(0, 0, -1)
const SECONDS = 180
/** 1 秒滑動窗（240 格）。人「看得出來變了」的時間尺度 */
const WINDOW = 240

function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}
const BLUNT: AircraftSpec = { ...P51D, battery: harmless(P51D.battery) }

/**
 * 腳本射手：把準星壓在預瞄點上，連續開火，用油門維持距離。
 *
 * 【為什麼不是 `AiController`】要量的是「防禦者讓射手的瞄準工作亂了多少」。
 * 射手若自己也在做意圖切換與能量管理，量到的是兩架的互動，不是防禦者的
 * 可見度。這是**一個瞄準完美、不做任何機動決策的玩家**。
 */
class Sniper implements Controller {
  target: Aircraft | null = null
  standoff = 900
  private readonly basis = createEngageBasis()

  update(self: Aircraft, _dt: number, out: Command): void {
    const t = this.target
    if (!t) {
      out.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
      out.throttle = 0.7
      out.brake = 0
      out.firing = false
      return
    }
    buildEngageBasis(self, t, this.basis)
    out.aimWorld.copy(this.basis.leadPoint).normalize()
    const range = self.state.position.distanceTo(t.state.position)
    out.throttle = range > this.standoff ? WEP_THROTTLE : 0.6
    out.brake = range < this.standoff * 0.8 ? 1 : 0
    out.firing = true
  }
}

/**
 * 腳本獵物：固定角速度的慵懶水平盤旋。
 *
 * 【為什麼不是 `AiController`】它的作用是把受測 AI 的注意力佔住，讓場景
 * 維持「他在追前面那架、我在後面打他」。若它自己也是戰鬥 AI，會轉回來變成
 * 2v1 混戰 —— 受測 AI 的機動就分不出哪些來自追擊、哪些來自閃躲。第一版的
 * 量測就是這樣被污染的：1v1 下 `defend` 只佔 5%，其餘九成五的預瞄點位移
 * 是「它在轉過來打你」。
 */
class Lazy implements Controller {
  private t = 0
  update(_self: Aircraft, dt: number, out: Command): void {
    this.t += dt
    const h = 0.05 * this.t
    out.aimWorld.set(-Math.sin(h), 0, -Math.cos(h))
    out.throttle = 0.85
    out.brake = 0
    out.firing = false
  }
}

interface Result {
  /** 射手有射擊解、且距離在有效區間內的取樣數 */
  underFire: number
  /** 那些取樣裡受測 AI 進 `defend` 的比例 —— **觸發涵蓋率** */
  coverage: number
  /** `defend` 期間，1 秒窗的預瞄方向角位移中位數，度 */
  defendMedian: number
  /** 非 `defend` 期間的同一個量。對照用，不設門檻 */
  ordinaryMedian: number
  /**
   * `defend` 期間的**同向性**：1 秒窗的淨位移 ÷ 逐格位移總和的中位數。
   * 直線的閃躲接近 1，來回擺動接近 0。
   */
  straightness: number
}

function median(v: number[]): number {
  if (v.length === 0) return 0
  const s = [...v].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

/**
 * 三機：受測 AI 追腳本獵物，腳本射手在它後方 `standoff` 處連續射擊。
 *
 * 【為什麼受測 AI 需要指派板】沒有板 `scanThreat` 恆回 null，它就看不見
 * 射手 —— 場景會退化成「一架完全不知道自己被打的飛機」。
 */
function measure(standoff: number): Result {
  const world = new World()
  const prey = new Aircraft(BLUNT, ALT, TAS)
  const bait = new Aircraft(BLUNT, ALT, TAS)
  const hunter = new Aircraft(BLUNT, ALT, TAS)

  const preyPos = new Vector3(0, ALT, 0)
  const baitPos = new Vector3(0, ALT, -500)
  const hunterPos = new Vector3(0, ALT, standoff)
  for (const [a, p] of [[prey, preyPos], [bait, baitPos], [hunter, hunterPos]] as const) {
    a.state.position.copy(p)
    a.state.velocity.copy(FWD).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(FWD, FWD)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }

  const ai = new AiController()
  const sniper = new Sniper()
  sniper.standoff = standoff
  const pc = world.add(prey, ai, 'blue', preyPos, ALT, TAS)
  const bc = world.add(bait, new Lazy(), 'red', baitPos, ALT, TAS)
  const hc = world.add(hunter, sniper, 'red', hunterPos, ALT, TAS)
  for (const c of [pc, bc, hc]) c.respawnOnDestroy = false
  sniper.target = prey

  const board = createTargetBoard(world.combatants)
  ai.board = board
  ai.selfIndex = pc.index
  ai.target = bait
  // 【用出貨的難度】這一層守的是玩家實際會遇到的敵人
  ai.profile = VETERAN

  const basis = createEngageBasis()
  // 由射手位置指向預瞄點的**單位向量**的歷史 —— 就是「準星該指哪裡」
  const hist: Vector3[] = []
  for (let i = 0; i < WINDOW + 1; i++) hist.push(new Vector3(0, 0, -1))
  let head = 0
  let filled = 0
  /** 逐格角位移的滑動總和，供同向性用 */
  const steps: number[] = new Array(WINDOW + 1).fill(0)
  let stepSum = 0

  const defending: number[] = []
  const ordinary: number[] = []
  const straight: number[] = []
  let underFire = 0
  let defendUnderFire = 0

  for (let s = 0; s < SECONDS * 240; s++) {
    world.step(DT)
    if (!pc.alive || !hc.alive) break

    buildEngageBasis(hunter, prey, basis)
    const prevDir = hist[(head - 1 + hist.length) % hist.length]!
    const cur = hist[head]!
    cur.copy(basis.leadPoint).normalize()

    // 逐格位移的滑動總和：加上這一格、扣掉滑出窗的那一格
    const stepAngle = filled > 0 ? cur.angleTo(prevDir) : 0
    stepSum += stepAngle - steps[head]!
    steps[head] = stepAngle

    if (filled >= WINDOW && s % 12 === 0) {
      const old = hist[(head - WINDOW + hist.length) % hist.length]!
      const net = cur.angleTo(old) * RAD
      const range = hunter.state.position.distanceTo(prey.state.position)
      // 【只採有意義的幾何】近距離視線亂掃、遠距離不是這個問題的場景
      if (threatFactor(hunter, prey) > 0 && range > 300 && range < 2000) {
        underFire++
        if (ai.intent === 'defend') {
          defendUnderFire++
          defending.push(net)
          if (stepSum > 1e-6) straight.push(net / (stepSum * RAD))
        } else ordinary.push(net)
      }
    }
    head = (head + 1) % hist.length
    if (filled <= WINDOW) filled++
  }

  return {
    underFire,
    coverage: defendUnderFire / Math.max(underFire, 1),
    defendMedian: median(defending),
    ordinaryMedian: median(ordinary),
    straightness: median(straight),
  }
}

describe('看得見的閃躲（三機、腳本射手、180 秒）', () => {
  for (const standoff of [700, 900]) {
    it(`射手在 ${standoff} m 連續射擊時，AI 的閃躲看得出來`, () => {
      const r = measure(standoff)

      // 場景本身要成立：射手真的一直咬著
      expect(r.underFire).toBeGreaterThan(500)

      // ── 一：觸發涵蓋率 ──────────────────────────────────
      // 【修補前是 0.0%】`threatFactor` 的距離因子讓閃躲門檻在幾何上等價於
      // 「他必須進到 585 m 以內」，所以 AI 被連續射擊 180 秒一次都沒閃。
      // 根因與算式見 `assess.ts` 的 `alarmFactor`。
      //
      // 【門檻取 50% 的理由】現況是 0，任何正數都是進步，但要抓的是「玩家
      // 開槍時 AI **通常**會有反應」。低於一半玩家仍然會覺得它時靈時不靈。
      expect(r.coverage).toBeGreaterThan(0.5)

      // ── 二：閃躲的可見度 ────────────────────────────────
      // 【5° 是專案負責人給的及格線】它的操作型意義是「準星非移動不可」。
      // 修補前的實測：平常 2.9°（低於及格線 —— 那就是「看起來很笨」），
      // 而它罕見地真的閃時是 12.2°（及格線的 2.4 倍）。**動作本身從來就
      // 不是問題，問題是它幾乎不觸發。**
      expect(r.defendMedian).toBeGreaterThanOrEqual(5)

      // ── 三：抖動護欄 ────────────────────────────────────
      // 【為什麼需要它】上面那條有一個漏洞：每 0.1 秒左右擺一次的 AI 分數
      // 會很高，但玩起來是抽搐不是閃躲（這個專案 2026-08-05 才治好一次
      // 同樣的病）。同向性 = 淨位移 ÷ 逐格位移總和，直線接近 1、來回接近 0。
      expect(r.straightness).toBeGreaterThan(0.5)
    }, 5 * 60 * 1000)
  }
})
