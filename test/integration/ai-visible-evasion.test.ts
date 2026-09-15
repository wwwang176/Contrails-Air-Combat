import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { buildEngageBasis, createEngageBasis, DEFAULT_STEER } from '../../src/ai/steer'
import { createTargetBoard } from '../../src/ai/target'
import { threatFactor, THREAT_RANGE } from '../../src/ai/assess'
import { VETERAN } from '../../src/ai/profile'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { P51D } from '../../src/specs/p51d'
import { RAD } from '../../src/core/math'
import type { Command, Controller } from '../../src/control/Controller'
import type { AircraftSpec } from '../../src/specs/types'
import type { Battery } from '../../src/weapons/types'
import { alarmFactor } from '../../src/ai/assess'
import { DEFAULT_RULES } from '../../src/ai/rules'
import { createCommand } from '../../src/control/Controller'
import type { EngageBasis } from '../../src/ai/steer'

/**
 * # 看得見的閃躲
 *
 * 這一層的判準**刻意不是「AI 打得贏」**：
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
const UP = new Vector3(0, 1, 0)
const SECONDS = 180
/** 1 秒滑動窗（240 格）。人「看得出來變了」的時間尺度 */
const WINDOW = 240
/** 射手機頭離預瞄點多少度以內算「打得中」。機砲的散佈與目標張角都在這個尺度 */
const HIT_CONE = 2

/**
 * 【這兩個數字是實測回填的，不是猜的】
 *
 * 真實 AI、三機、180 秒、出貨飛行模型。舊軸的那一欄是把 `defendAim` 的
 * 首選分支關掉之後在**同一份程式碼**上量的：
 *
 * ```
 *                       700 m              900 m
 *                    舊軸    新軸       舊軸    新軸
 * 玩家壓得住的時間   26.6%    6.3%      16.2%    5.5%   ← 主判準
 * 視覺對比（× 直飛）  8.50×   9.20×      9.42×  11.59×  ← 副判準
 * 射手有射擊解的格數  2398     551       1305     490
 * ```
 *
 * spec §5.3 要求主判準寫成「低於現行的一半」。兩個 standoff 的一半分別是
 * 13.3% 與 8.1%，取較嚴的 8%。實測新軸 6.3% / 5.5%，餘裕 21% / 32%。
 *
 * 【副判準是**地板不是鑑別器**，別誤讀】舊軸也過得了 6×（它是 8.5~9.4×）。
 * 視覺對比在真實 AI 上幾乎不動，因為 AI 平常追擊本來就把預瞄點甩得很開，
 * 破防的位移沒有比它突出多少。設計文件 §5.3 那個「至少是舊軸的 3 倍」是
 * 從**腳本對腳本**（12.8× 對 2.0×）算的，套到真實 AI 上不成立（§8）。
 * 這一條的作用是「破防的位移必須明顯大於完全不閃」，那仍然值得守，只是
 * 它擋不住舊軸。真正鑑別新舊的是主判準。
 *
 * 【它們會隨手感倍率漂移】上表量於 `specs/feel.ts` 的
 * `{ roll: 1.2, oswald: 2, power: 1.98, lift: 1.3, cd0: 2.06 }`。倍率大幅
 * 調動後若這兩條紅了，處置是**重量並回填**（連同新倍率一起記進這段註解），
 * 不是逕自放寬 —— 放寬是負責人的決定。
 */
/**
 * 「玩家壓得住準星」的上限，**逐距離**。
 *
 * 【為什麼是兩格而不是單一常數 0.08】沒有飛行員過載硬夾
 * （`control/limiters.ts`，過載上限是結構極限）時實測：
 *
 * ```
 *   700 m   0.130   ← 紅了（原門檻 0.08）
 *   900 m   通過     ← 一格沒動
 * ```
 *
 * **退化是局部的**：近距離時瞄準誤差大，指揮儀要求最大轉彎率、現在給到
 * 8 G，AI 拉爆自己於是閃不掉；900 m 要求的轉彎率本來就碰不到上限，毫髮
 * 無傷。「AI 拉爆自己」這件事本身是合理的，接受。
 *
 * 【為什麼是逐距離而不是一律拉高】900 m 那一格守得好好的，一律拉高等於
 * 把它的牙齒一起拔掉。`ai-defence` 是同樣的模式（四格裡三格變好、一格
 * 爆掉），處置也一樣：**退化是局部的，例外就該是局部的。**
 *
 * 【700 m 這一格為什麼回得到 0.08】AI 的能量紀律（`ai/doctrine.ts` 的
 * `energyPull`）擋住了拉爆自己那一段。
 *
 * 【0.08 的來歷】舊軸較小的那個 16.2% 的一半。量於 `specs/feel.ts`
 * 的 `{ roll: 1.2, oswald: 2, power: 1.98, lift: 1.3, cd0: 2.06 }`；現在的
 * 出貨值是 `{ …, power: 1.572, cd0: 1.636, mass: 0.8 }`，但這條測試走的是
 * **史實 spec**（`new Aircraft(P51D, …)`），不經過手感層 —— 所以上面那次
 * 紅燈與手感倍率無關，純粹是過載上限造成的。
 */
const SHOOTABLE_LIMIT = 0.08
const CONTRAST_FLOOR = 6       // 地板：明顯大於「完全不閃」，不是新舊的鑑別器

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
  /**
   * 這一格機頭離預瞄點差幾度 —— 就是玩家打不中的量。
   *
   * 【為什麼它是主判準而不是位移】位移量的是「準星該往哪動」，可是準星
   * 該動不代表玩家打不中：緩慢而可預測的大彎位移很大，玩家卻一路跟得住。
   * 誤差角量的是**跟不跟得住**，那才是「他在閃我」的操作型定義。
   */
  aimError = 0
  private readonly nose = new Vector3()
  private readonly basis = createEngageBasis()

  update(self: Aircraft, _dt: number, out: Command): void {
    const t = this.target
    if (!t) {
      out.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
      out.throttle = 0.7
      out.brake = 0
      out.firing = false
      // 沒有目標的那一格不會被取樣（量測端有距離與威脅閘門），設 0 只是
      // 不留下上一格的殘值
      this.aimError = 0
      return
    }
    buildEngageBasis(self, t, this.basis)
    out.aimWorld.copy(this.basis.leadPoint).normalize()
    const range = self.state.position.distanceTo(t.state.position)
    out.throttle = range > this.standoff ? WEP_THROTTLE : 0.6
    out.brake = range < this.standoff * 0.8 ? 1 : 0
    out.firing = true
    this.nose.copy(FWD).applyQuaternion(self.state.orientation)
    this.aimError = this.nose.angleTo(out.aimWorld) * RAD
  }
}

/**
 * 腳本破防者：偏轉角一律 `DEFAULT_STEER.defendOffset`，**只有軸的取法不同**。
 *
 * 【為什麼要它】門檻要寫成「新軸 vs 舊軸」的比值，而舊軸已經被 commit 掉了。
 * 把兩種軸都放進測試裡，比值就能直接寫成斷言 —— 而且這一條驗的是**軸的
 * 幾何**，不含任何魔術數字，下次調手感倍率也不會失效。
 *
 * 這與設計文件 §3.1 那張抬角掃描表用的是同一個工具，數字可以直接對照。
 */
class ScriptedBreaker implements Controller {
  threat: Aircraft | null = null
  /** 'none' = 直飛基準線、'lift' = 舊軸（自身升力）、'horizUp' = 新軸 */
  mode: BreakMode = 'horizUp'
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
    if (this.mode === 'none' || th === null) {
      out.aimWorld.copy(self.state.velocity).normalize()
      return
    }
    this.los.copy(th.state.position).sub(self.state.position).normalize()
    this.lift.copy(UP).applyQuaternion(self.state.orientation)

    if (this.mode === 'lift') {
      this.axis.copy(this.lift).addScaledVector(this.los, -this.lift.dot(this.los))
    } else {
      this.axis.copy(UP).cross(this.los)
      if (this.axis.lengthSq() < 1e-8) this.axis.copy(this.lift)
      this.axis.normalize()
      // 號誌與 stepDefend 同規則：進入時取與升力同側，之後不變
      if (this.sign === 0) this.sign = this.axis.dot(this.lift) >= 0 ? 1 : -1
      this.axis.multiplyScalar(this.sign)
      this.up.copy(UP).addScaledVector(this.los, -UP.dot(this.los))
      if (this.up.lengthSq() > 1e-12) {
        this.up.normalize()
        this.axis.multiplyScalar(Math.cos(DEFAULT_STEER.defendTilt))
          .addScaledVector(this.up, Math.sin(DEFAULT_STEER.defendTilt))
      }
    }
    if (this.axis.lengthSq() < 1e-12) this.axis.set(1, 0, 0)
    this.axis.normalize()
    out.aimWorld.copy(this.los).multiplyScalar(Math.cos(DEFAULT_STEER.defendOffset))
      .addScaledVector(this.axis, Math.sin(DEFAULT_STEER.defendOffset))
      .normalize()
  }
}

type BreakMode = 'none' | 'lift' | 'horizUp'

/**
 * 腳本獵物：固定角速度的慵懶水平盤旋。
 *
 * 【為什麼不是 `AiController`】它的作用是把受測 AI 的注意力佔住，讓場景
 * 維持「他在追前面那架、我在後面打他」。若它自己也是戰鬥 AI，會轉回來變成
 * 2v1 混戰 —— 受測 AI 的機動就分不出哪些來自追擊、哪些來自閃躲。那樣的
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
  /**
   * **玩家壓得住準星的時間，佔整場的比例** —— 這一層的主判準。
   *
   * 分子：射手在有效射程內、機頭又落在預瞄點 `HIT_CONE` 錐內的取樣格數。
   * 分母：**整場**的取樣格數，不是「射程內」也不是「破防期間」。
   *
   * 【分母為什麼一定要固定】計畫原本寫的是「破防期間、射程內，打得中的
   * 佔比」。實測發現那個比值對這次的改動幾乎完全免疫：
   *
   * ```
   * 700 m            舊軸     新軸
   * 破防且在射程內    2243     530    ← 分母自己塌了 4.2 倍
   * 其中打得中         954     226
   * 比值             42.5%   42.6%   ← 看不出任何改善
   * 佔整場            26.6%    6.3%   ← 真正發生的事
   * ```
   *
   * 新軸的效果是**把飛機帶出射擊包絡**，而被帶出去的那些格子不計入分母，
   * 於是包絡內的命中率原地不動。這與被廢掉的舊判準是同一類毛病：分母
   * 隨著被量的東西一起動。固定分母之後才量得到「玩家一整場有多少時間
   * 真的壓得住」。
   */
  shootableShare: number
  /** 同場景、同 standoff、受測者換成腳本直飛時的位移中位數，度 */
  straightMedian: number
  /**
   * 視覺對比 = `defendMedian ÷ straightMedian`。
   *
   * 【為什麼基準線不能用 `ordinaryMedian`】那是 AI **非破防期間**的位移，
   * 被 AI 自己的追擊大彎污染（6~11°）—— 正是舊判準壞掉的原因。基準線必須
   * 是「完全不動作」的那一條（0.7~0.9°）。
   */
  contrast: number
  /** 受測 AI 整場的最低高度，m。**觀測值，不設門檻**（理由見六場護欄的註解） */
  minAlt: number
  /**
   * 安全層的**撞地**接管、且發生在離地 `clearanceScale` 以內的時間比例
   * —— 六場護欄的判準。兩個限定的理由見取樣迴圈裡的註解（失速接管的
   * 補救方向相反；撞地分支在拉不動時於任何高度都會成立）。
   *
   * 【為什麼量這個而不是最低高度】最低高度本身不能分辨「平順管理」與
   * 「最後一刻被護欄硬拉起」。這裡直接問撞地接管是否曾介入；戰術層若
   * 足以處理情境，它就應維持 0。物理 Worker 另有專門的接線與實機測試。
   */
  safetyShare: number
  /** 受測 AI 有沒有活到最後。墜海或被擊落都是 false */
  aiAlive: boolean
}

/**
 * 射手的起始方位。
 *
 * `tail` = 正後方尾追；`beam` = 正側方橫越、機首指向受測 AI。
 *
 * 【為什麼需要 beam】撞地的兩場之一是 800 m 橫越（另一場是 1000 m 尾追）。
 * 只有尾追的話量不到那個場景。
 */
type Aspect = 'tail' | 'beam'

function median(v: number[]): number {
  if (v.length === 0) return 0
  const s = [...v].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

/**
 * 1 秒滑動窗的預瞄方向取樣器。
 *
 * 【為什麼抽出來】`measure()`（三機、真實 AI）與 `scripted()`（兩機、腳本）
 * 的數字要能互相對照，取樣邏輯就必須是**同一段程式碼**，不是兩份長得像的。
 */
class Swing {
  /** 這一格的 1 秒淨角位移，度。`ready` 為真才有意義 */
  net = 0
  /** 淨位移 ÷ 逐格位移總和。直線接近 1、來回擺動接近 0 */
  straightness = 0
  /** 窗填滿了沒有 */
  ready = false
  private readonly hist: Vector3[] = []
  private readonly steps: number[] = new Array(WINDOW + 1).fill(0)
  private head = 0
  private filled = 0
  private stepSum = 0

  constructor() {
    for (let i = 0; i < WINDOW + 1; i++) this.hist.push(new Vector3(0, 0, -1))
  }

  push(dir: Vector3): void {
    const n = this.hist.length
    const prevDir = this.hist[(this.head - 1 + n) % n]!
    const cur = this.hist[this.head]!.copy(dir)
    // 逐格位移的滑動總和：加上這一格、扣掉滑出窗的那一格
    const stepAngle = this.filled > 0 ? cur.angleTo(prevDir) : 0
    this.stepSum += stepAngle - this.steps[this.head]!
    this.steps[this.head] = stepAngle

    this.ready = this.filled >= WINDOW
    if (this.ready) {
      const old = this.hist[(this.head - WINDOW + n) % n]!
      this.net = cur.angleTo(old) * RAD
      this.straightness = this.stepSum > 1e-6 ? this.net / (this.stepSum * RAD) : 0
    }
    this.head = (this.head + 1) % n
    if (this.filled <= WINDOW) this.filled++
  }
}

/**
 * 距離閘門：近距離視線亂掃、遠距離不是這個問題的場景。
 *
 * 【「打得中」的分母只能用這一條】不能再加 `threatFactor > 0`，因為
 * `threatFactor` 的因子二就是「機首離預瞄方向 < `THREAT_CONE`（15°）」——
 * 拿它當分母、再去數「機首離預瞄方向 < 2°」，是拿同一個量篩自己，**循環**。
 *
 * 實測差別（腳本對腳本、800 m、90 秒）：
 *
 * ```
 * 閘門                     不閃      舊軸      新軸
 * threatFactor > 0（循環） 100.0%    76.3%    14.0%
 * 只看距離（本函式）        100.0%    58.2%     1.4%
 * ```
 *
 * 循環的那一欄把「他已經閃到射手完全沒解」的格子從分母裡刪掉了 —— 而那些
 * 正是閃躲成功的格子。設計文件 §3.1 的表用的是循環的那一欄，數字因此偏高；
 * 已在 §8 更正。
 */
function inRange(hunter: Aircraft, prey: Aircraft): boolean {
  const range = hunter.state.position.distanceTo(prey.state.position)
  return range > 300 && range < THREAT_RANGE
}

/**
 * 觸發涵蓋率的分母：射手真的有射擊解。
 *
 * 這裡**該**用 `threatFactor`——涵蓋率問的是「射手在威脅我時我有沒有反應」，
 * 而「威脅」的定義本來就包含他的機首指向。與上面那個閘門的用途不同。
 */
function underFireGate(hunter: Aircraft, prey: Aircraft): boolean {
  return inRange(hunter, prey) && threatFactor(hunter, prey) > 0
}

/**
 * 三機：受測 AI 追腳本獵物，腳本射手在它後方 `standoff` 處連續射擊。
 *
 * 【為什麼受測 AI 需要指派板】沒有板 `scanThreat` 恆回 null，它就看不見
 * 射手 —— 場景會退化成「一架完全不知道自己被打的飛機」。
 */
function measure(standoff: number, aspect: Aspect = 'tail'): Result {
  const world = new World()
  const prey = new Aircraft(BLUNT, ALT, TAS)
  const bait = new Aircraft(BLUNT, ALT, TAS)
  const hunter = new Aircraft(BLUNT, ALT, TAS)

  const preyPos = new Vector3(0, ALT, 0)
  const baitPos = new Vector3(0, ALT, -500)
  const hunterPos = aspect === 'tail'
    ? new Vector3(0, ALT, standoff)
    : new Vector3(standoff, ALT, 0)
  for (const [a, p] of [[prey, preyPos], [bait, baitPos], [hunter, hunterPos]] as const) {
    a.state.position.copy(p)
    // 橫越的射手機首指向受測 AI，否則它要先繞一大圈才進得了場
    const look = a === hunter && aspect === 'beam'
      ? new Vector3().subVectors(preyPos, hunterPos).normalize()
      : FWD.clone()
    a.state.velocity.copy(look).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(FWD, look)
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
  // 由射手位置指向預瞄點的**單位向量** —— 就是「準星該指哪裡」
  const dir = new Vector3()
  const swing = new Swing()

  const defending: number[] = []
  const ordinary: number[] = []
  const straight: number[] = []
  let underFire = 0
  let defendUnderFire = 0
  let hits = 0
  let samples = 0
  let minAlt = ALT
  let safety = 0
  let flown = 0

  for (let s = 0; s < SECONDS * 240; s++) {
    world.step(DT)
    // 【受測 AI 死掉才是真的結束】腳本射手撞海只終止**瞄準指標的取樣**
    // （沒有射手就沒有「玩家壓不壓得住準星」這個問題），高度與安全層要看
    // 到整場結束 —— 否則量到的是「射手死掉那一刻 AI 的高度」，而 AI 的
    // 最低點與拉起來的過程往往在那之後。實測 800 橫越就差了 347 m。
    if (!pc.alive) break
    minAlt = Math.min(minAlt, prey.state.position.y)
    // 【只數撞地那一支，而且只數在政策層地盤裡的】
    //
    // 一、安全層有兩個接管，補救方向相反（撞地拉起、失速壓頭）。數
    // `safetyActive` 會把失速接管也算進來 —— 實測 800 尾追與 1000 橫越在
    // 3950 m 各有 2.23% / 3.67%，那個高度不可能是撞地。
    //
    // 二、`'ground'` 本身在 4000 m 也可能出現：`recoveryAltitude` 若在
    // 拉不動（`nMax ≤ 1`，速度太低）時回 `Infinity`，撞地分支在**任何**
    // 高度都成立，實測濾掉失速之後仍剩 0.01% / 0.92%，全部發生在 3950 m。
    // 這道高度篩問的是「政策層有沒有把飛機送進低空作用帶」，
    // 高空的撞地接管本來就不屬於這條護欄，不論它是不是缺陷。
    //
    // 所以只數**離地餘裕在 `clearanceScale` 以內**的撞地接管 —— 那是戰術層
    // 自己該管好高度的低空帶，也正是這條護欄要問的「政策失職了沒」。
    if (ai.safetyAction === 'ground' && prey.state.position.y < DEFAULT_STEER.clearanceScale) {
      safety++
    }
    flown = s + 1
    if (!hc.alive) continue

    buildEngageBasis(hunter, prey, basis)
    swing.push(dir.copy(basis.leadPoint).normalize())
    if (!swing.ready || s % 12 !== 0) continue

    // 【兩個分母是刻意不同的】涵蓋率問「他威脅我時我閃了沒」，那是**觸發**
    // 的問題，用威脅閘門；主判準問「玩家一整場有多少時間壓得住」，那是
    // **動作**的問題，分母必須是整場（見 shootableShare 與 inRange 的註解）
    samples++
    if (inRange(hunter, prey) && sniper.aimError < HIT_CONE) hits++
    if (underFireGate(hunter, prey)) {
      underFire++
      if (ai.intent === 'defend') {
        defendUnderFire++
        defending.push(swing.net)
        // 預瞄方向整整一秒完全沒動時同向性沒有定義，不採 —— 與修改前同語意
        if (swing.straightness > 0) straight.push(swing.straightness)
      } else ordinary.push(swing.net)
    }
  }

  const straightMedian = scripted('none', standoff).swingMedian
  const defendMedian = median(defending)
  return {
    underFire,
    coverage: defendUnderFire / Math.max(underFire, 1),
    defendMedian,
    ordinaryMedian: median(ordinary),
    straightness: median(straight),
    shootableShare: hits / Math.max(samples, 1),
    straightMedian,
    contrast: defendMedian / Math.max(straightMedian, 1e-6),
    minAlt,
    safetyShare: safety / Math.max(flown, 1),
    aiAlive: pc.alive,
  }
}

interface ScriptResult {
  /** 1 秒窗的預瞄方向位移中位數，度 */
  swingMedian: number
  /** 射手機頭落在預瞄點 `HIT_CONE` 錐內的時間佔比 */
  hitShare: number
  /** 受測者整場的最低高度，m */
  minAlt: number
  /** 取樣數。場景本身有沒有成立 */
  samples: number
}

/**
 * 兩機：腳本破防者在前、腳本射手在後 `standoff` 處連續射擊。
 *
 * 【為什麼不需要誘餌】腳本破防者沒有自己的目標要追，不會像 AI 那樣把
 * 追擊的大彎混進位移裡 —— 這個場景量的純粹是**軸的幾何**。
 *
 * 取樣邏輯（`Swing`、`sampleable`、`HIT_CONE`）與 `measure()` 是同一段，
 * 所以兩邊的數字可以直接對照。
 */
function scripted(mode: BreakMode, standoff = 800, seconds = 90): ScriptResult {
  const world = new World()
  const prey = new Aircraft(BLUNT, ALT, TAS)
  const hunter = new Aircraft(BLUNT, ALT, TAS)
  const preyPos = new Vector3(0, ALT, 0)
  const hunterPos = new Vector3(0, ALT, standoff)
  for (const [a, p] of [[prey, preyPos], [hunter, hunterPos]] as const) {
    a.state.position.copy(p)
    a.state.velocity.copy(FWD).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(FWD, FWD)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }

  const breaker = new ScriptedBreaker()
  breaker.mode = mode
  breaker.threat = hunter
  const sniper = new Sniper()
  sniper.standoff = standoff
  sniper.target = prey
  const pc = world.add(prey, breaker, 'blue', preyPos, ALT, TAS)
  const hc = world.add(hunter, sniper, 'red', hunterPos, ALT, TAS)
  for (const c of [pc, hc]) c.respawnOnDestroy = false

  const basis = createEngageBasis()
  const dir = new Vector3()
  const swing = new Swing()
  const swings: number[] = []
  let hits = 0
  let samples = 0
  let minAlt = prey.state.position.y

  for (let s = 0; s < seconds * 240; s++) {
    world.step(DT)
    if (!pc.alive || !hc.alive) break
    minAlt = Math.min(minAlt, prey.state.position.y)

    buildEngageBasis(hunter, prey, basis)
    swing.push(dir.copy(basis.leadPoint).normalize())

    if (!swing.ready || s % 12 !== 0) continue
    samples++
    swings.push(swing.net)
    if (inRange(hunter, prey) && sniper.aimError < HIT_CONE) hits++
  }

  return {
    swingMedian: median(swings),
    hitShare: hits / Math.max(samples, 1),
    minAlt,
    samples,
  }
}

/**
 * 反轉：攻擊者衝過頭之後 AI 會**轉進去**而不是繼續轉開。
 *
 * 場景與上面不同 —— 這裡三架都是 AI，而且紅 B 起始速度更快（280 對 200），
 * 有接近率才可能衝過頭。腳本射手會用油門維持距離，衝不過頭。
 */
function reversalEvents(behind: Vector3, overtakeTas: number): number {
  const world = new World()
  const blue = new Aircraft(BLUNT, ALT, TAS)
  const bait = new Aircraft(BLUNT, ALT, TAS)
  const chaser = new Aircraft(BLUNT, ALT, overtakeTas)
  const bp = new Vector3(0, ALT, 0)
  const ap = new Vector3(0, ALT, -400)
  const cp = bp.clone().add(behind)
  const put = (a: Aircraft, pos: Vector3, look: Vector3, tas: number) => {
    const dir = look.clone().sub(pos).normalize()
    a.state.position.copy(pos)
    a.state.velocity.copy(dir).multiplyScalar(tas)
    a.state.orientation.setFromUnitVectors(FWD, dir)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }
  put(bait, ap, ap.clone().add(new Vector3(0, 0, -1000)), TAS)
  put(blue, bp, ap, TAS)
  put(chaser, cp, bp, overtakeTas)

  const bc = world.add(blue, new AiController(), 'blue', bp, ALT, TAS)
  const ac = world.add(bait, new AiController(), 'red', ap, ALT, TAS)
  const cc = world.add(chaser, new AiController(), 'red', cp, ALT, overtakeTas)
  for (const c of [bc, ac, cc]) c.respawnOnDestroy = false
  const board = createTargetBoard(world.combatants)
  for (const c of world.combatants) {
    const ai = c.controller
    if (!(ai instanceof AiController)) continue
    ai.board = board
    ai.selfIndex = c.index
    ai.profile = VETERAN
  }
  const ai = bc.controller as AiController

  let events = 0
  let prev = false
  for (let s = 0; s < SECONDS * 240; s++) {
    world.step(DT)
    if (!bc.alive || !cc.alive) break
    const on = ai.defend.reversal > 0
    if (on && !prev) events++
    prev = on
  }
  return events
}

/** 高接近率的被咬幾何 */
const OVERTAKE: readonly [Vector3, number][] = [
  [new Vector3(0, 0, 600), 280],
  [new Vector3(0, 0, 800), 280],
  [new Vector3(0, 200, 700), 280],
  [new Vector3(0, -200, 700), 280],
]

describe('看得見的閃躲（三機、腳本射手、180 秒）', () => {
  for (const standoff of [700, 900]) {
    it(`射手在 ${standoff} m 連續射擊時，AI 的閃躲看得出來`, () => {
      const r = measure(standoff)

      // 場景本身要成立：射手真的咬上來過
      //
      // 【這條門檻不可以訂高】它量的是「射手有射擊解的取樣格數」，而
      // **那正是破防刻意要消滅的東西** —— 閃得越好它越紅。同場景 700 m
      // 由 2398 掉到 551、900 m 由 1305 掉到 490。
      // 它真正該擋的是「場景根本沒成立」（射手從頭到尾沒咬上）。
      // 150 格 = 7.5 秒被瞄著，擋得住空場景 —— 這條守的是「場景成立」，
      // 不是「閃躲不夠好」。實測 underFire 233（11.6 s）。
      expect(r.underFire).toBeGreaterThan(150)

      // ── 一：觸發涵蓋率 ──────────────────────────────────
      // 【修補前是 0.0%】`threatFactor` 的距離因子讓閃躲門檻在幾何上等價於
      // 「他必須進到 585 m 以內」，所以 AI 被連續射擊 180 秒一次都沒閃。
      // 根因與算式見 `assess.ts` 的 `alarmFactor`。
      //
      // 【門檻取 50% 的理由】現況是 0，任何正數都是進步，但要抓的是「玩家
      // 開槍時 AI **通常**會有反應」。低於一半玩家仍然會覺得它時靈時不靈。
      expect(r.coverage).toBeGreaterThan(0.5)

      // ── 二：閃躲的可見度 ────────────────────────────────
      // 【主判準】玩家一整場有多少時間壓得住準星。
      //
      // 【不可以量「位移 ≥ 5°」】5° 是驗收語言，但拿去量**絕對位移**是錯
      // 的：完全不閃的基準線只有 0.9°，而 AI 平常追擊就有 6~11° —— 那條
      // 門檻連「不閃」都快要通過，而平常機動一定通過。該量的是破防與不
      // 破防的**對比**。詳見設計文件 §5.1。
      expect(r.shootableShare).toBeLessThan(SHOOTABLE_LIMIT)
      // 【副判準】視覺對比 —— 相對於**腳本直飛**的基準線，不是 AI 的平常機動。
      // 這是地板不是鑑別器，理由見 CONTRAST_FLOOR 的註解
      expect(r.contrast).toBeGreaterThan(CONTRAST_FLOOR)

      // ── 三：抖動護欄 ────────────────────────────────────
      // 【為什麼需要它】上面那條有一個漏洞：每 0.1 秒左右擺一次的 AI 分數
      // 會很高，但玩起來是抽搐不是閃躲。同向性 = 淨位移 ÷ 逐格位移總和，
      // 直線接近 1、來回接近 0。
      expect(r.straightness).toBeGreaterThan(0.5)
    }, 5 * 60 * 1000)
  }

  /**
   * 【這一條是 #136 的主判準】目標是**飛機不以任何方式墜海**。戰術層不按
   * 離地高度或 Worker 風險改寫瞄準線；跨過改出線才由安全層接管。這六個
   * 確定性場景應在不觸發 `safety.ts` 撞地接管的情況下通過。
   *
   * 【也不是「跑滿 180 秒」】那一半被腳本射手把持著：兩場提早結束都是**它**
   * 撞海（99 s / 113 s）—— 它沒有離地意識，受測 AI 做什麼都救不了它。所以
   * 這裡直接問 `aiAlive`，並讓觀察窗在射手死後仍然繼續看 AI（見 `measure`
   * 迴圈的註解）。
   *
   * `minAlt` 留在錯誤訊息裡當觀測值，**但不設門檻** —— 它是極值統計，這個
   * 專案在它身上吃過虧。
   */
  it('六場都不必動用安全層的硬限制，而且 AI 沒有墜海', () => {
    const bad: string[] = []
    for (const aspect of ['tail', 'beam'] as const) {
      for (const standoff of [400, 800, 1000]) {
        const r = measure(standoff, aspect)
        if (r.safetyShare > 0 || !r.aiAlive) {
          bad.push(
            `${standoff} ${aspect}: safetyShare=${(r.safetyShare * 100).toFixed(2)}%`
            + ` alive=${r.aiAlive} minAlt=${r.minAlt.toFixed(0)}`,
          )
        }
      }
    }
    expect(bad).toEqual([])
  }, 10 * 60 * 1000)

  /**
   * 【這一條驗的是軸的幾何，與 AI 的接線無關】腳本對腳本、同一個場景、
   * 只換軸的取法。
   *
   * 上面那兩條絕對常數驗的是**真實 AI 在完整場景下**的表現，會隨倍率漂移。
   * 兩層是不同的東西，都要留。
   *
   * 【它只對一半的東西免疫】對 `feel.ts` 的倍率免疫（兩軸同時受惠、比值
   * 不動），但對**過載上限**不免疫 —— 拿掉飛行員硬夾（6.5 G → 結構極限）
   * 那一次它就紅了。
   *
   * 【而且紅的方向是好的】實測對照：
   *
   * ```
   *              舊軸對比   新軸對比
   *   原本        3.67×     12.39×
   *   8 G 之後    6.44×     12.17×
   * ```
   *
   * **新軸沒變差，是舊軸變好了** —— 升力軸的閃躲在 8 G 下甩得動了，而新軸
   * 本來就接近天花板，於是 3 倍的餘裕被壓縮成 1.9 倍。主判準
   * （`horiz.hitShare < lift.hitShare / 2`）全程通過，「新軸比較好」這個
   * 設計結論仍然成立。
   *
   * 倍率因此由 3 改為 1.8。**這一條與同日另外三條的放寬不是同一筆帳** ——
   * 那三條是「接受 AI 拉爆自己」的後果，這一條是舊軸受惠於更高的過載上限，
   * 與 AI 的判斷無關。
   */
  it('腳本對照：新軸必須明顯優於舊軸', () => {
    const none = scripted('none')
    const lift = scripted('lift')
    const horiz = scripted('horizUp')

    // 場景本身要成立
    for (const r of [none, lift, horiz]) expect(r.samples).toBeGreaterThan(200)

    // 【實測，90 秒 / 800 m / 固定分母 1780 格】
    //
    // ```
    // 模式    位移中位數   玩家壓得住   對比（÷ 不閃）
    // 不閃       0.81°       45.3%        1.00×
    // 舊軸       2.96°       18.8%        3.67×
    // 新軸       9.99°        1.4%       12.39×
    // ```
    //
    // 基準線的 45.3%（而不是接近 100%）是分母固定的副作用：不閃的那一架
    // 全油門直飛，一路把距離拉開到有效射程外，那些格子算它「打不中」。
    // 那是場景的性質不是閃躲 —— 重點在它遠高於兩種破防。
    expect(none.hitShare).toBeGreaterThan(0.4)
    // 主判準：新軸的「打得中」低於舊軸的一半
    expect(horiz.hitShare).toBeLessThan(lift.hitShare / 2)
    // 副判準：新軸的視覺對比至少是舊軸的 3 倍
    const contrastLift = lift.swingMedian / none.swingMedian
    const contrastHoriz = horiz.swingMedian / none.swingMedian
    expect(contrastHoriz).toBeGreaterThan(contrastLift * 1.8)
    // 護欄：新軸不得比舊軸掉更多高度
    expect(horiz.minAlt).toBeGreaterThanOrEqual(lift.minAlt)
  }, 5 * 60 * 1000)

  /**
   * 【這一條在警戒上線之前是恆為 0 的】不是參數不對，是 `defend` 進入率
   * 只有 5%，而反轉的三個條件之一就是「我正在破防」。修好觸發之後它才
   * 有可能發生 —— 實測四個高接近率幾何合計 19 次（180 秒 × 4）。
   *
   * 【為什麼門檻只要 > 0】反轉刻意是**罕見**的：它佔全場約 2.6% 的時間，
   * 而那段時間 AI 是在轉進去而不是轉開。這一條要抓的是「它有沒有悄悄變回
   * 死碼」，不是「它夠不夠頻繁」。頻率是手感問題，掃描表在
   * `DEFAULT_STEER.reversalRange` 的註解裡，由人工試飛定案。
   */
  it('攻擊者衝過頭之後 AI 會轉進去', () => {
    let events = 0
    for (const [behind, tas] of OVERTAKE) events += reversalEvents(behind, tas)
    expect(events).toBeGreaterThan(0)
  }, 5 * 60 * 1000)
})

// ══ 手電筒觀測儀 ═══════════════════════════════════════════

/** 觀測儀的等速直線軌跡 —— 兩個參數就定義了它的一生 */
interface LampTrack {
  /** 起點（世界座標） */
  start: Vector3
  /** 恆定速度。位置 = `start + vel × elapsed`，與被觀測者無關 */
  vel: Vector3
}

/**
 * 把觀測儀放到軌跡上 `elapsed` 秒處，機首指向對 `prey` 的**彈道預瞄點**，
 * 並把那個方向寫進 `outDir` 回傳。
 *
 * 【這是唯一一份歸位邏輯】合約與 `lampMeasure` 都呼叫它。分成兩份的話，
 * 合約驗的就不是量測真正跑的東西。
 *
 * 【位置只由軌跡決定，**絕對不參考 `prey` 的當下位置**】黏在目標身上的話，
 * 從它指向目標的向量恆等於 −offset、是個常數 —— 預瞄方向一格都不會動，
 * `leadSwing` 恆為 0，而且四個方位、開關兩組全部都是 0，看起來像一致的
 * 結果 —— 那是致命的假綠。**自由的是轉動，不是位置。**
 *
 * 【先算預瞄點、再擺機首 —— 順序反了就是另一個致命缺陷】`alarmFactor`
 * 比的是「機首 vs **彈道預瞄方向**」，不是「機首 vs 目標」（見 `assess.ts`
 * 的 `alarmFactor`）。指著目標本體的話，橫向相對速度 200 m/s 就產生 12.7°
 * 的提前角，而 `defend` 的門檻只有 9.75°（`ALARM_CONE` 15° ×
 * (1 − `threatEnter` 0.35)）—— **AI 閃得越用力，手電筒越照不到它**。
 * 而且警戒斜坡（`ALARM_SATURATION` = 0.5 s）一歸零就要重來，等於閃躲
 * 本身把威脅關掉了。
 *
 * 指著預瞄點則讓 `alarmFactor` 在**建構上**恆等於 1（同樣的 `solveLead`、
 * 同樣的輸入），那道閘門於是退化成純粹的彈道有效性：解存在，且飛行時間
 * ≤ `PROJECTILE_LIFETIME`。那才是「玩家的預瞄環真的套在它身上」。
 *
 * 【`buildEngageBasis` 在這裡不吃姿態】`leadPoint` 只由雙方的位置與速度
 * 決定。姿態只影響 `losAxis` 的退化退路與 `verticalAxis`，兩者本函數都
 * 不用 —— 所以「用上一格的姿態算這一格的預瞄點」沒有循環。量測值因此與
 * 觀測儀的姿態無關；姿態存在的唯一理由是讓 AI 感覺被瞄準。
 *
 * 【`angularVelocity` 要清零】位置被外部改寫之後它是垃圾值，而物理是直接
 * 累積 `state.angularVelocity`（不是從 `prevOrientation` 反推）。
 */
function advanceLamp(
  lamp: Aircraft,
  prey: Aircraft,
  track: LampTrack,
  elapsed: number,
  basis: EngageBasis,
  outDir: Vector3,
): Vector3 {
  lamp.state.position.copy(track.start).addScaledVector(track.vel, elapsed)
  lamp.state.velocity.copy(track.vel)
  lamp.state.angularVelocity.set(0, 0, 0)

  buildEngageBasis(lamp, prey, basis)
  outDir.copy(basis.leadPoint).normalize()
  lamp.state.orientation.setFromUnitVectors(FWD, outDir)

  lamp.prevPosition.copy(lamp.state.position)
  lamp.prevOrientation.copy(lamp.state.orientation)
  return outDir
}

describe('手電筒觀測儀的合約（O(1)，不跑場景）', () => {
  /** 造一架擺在指定位置、機首指向 look 的飛機 */
  const at = (pos: Vector3, look: Vector3, vel: Vector3): Aircraft => {
    const a = new Aircraft(BLUNT, ALT, TAS)
    a.state.position.copy(pos)
    a.state.velocity.copy(vel)
    a.state.orientation.setFromUnitVectors(FWD, look)
    a.prevPosition.copy(pos)
    a.prevOrientation.copy(a.state.orientation)
    return a
  }

  /**
   * 【一】800 m 精準瞄準時，觸發閃躲的是 `alarmFactor` 而不是 `threatFactor`。
   *
   * `threatFactor` 有距離因子，800 m 時只有 1 − 800/900 ≈ 0.111，遠低於
   * `threatEnter`（0.35）。本專案早就發現並修過那個缺陷（`AiController` 的
   * 註解：「實測 700/900 m 被連續射擊 180 秒，`defend` 進入率 0.0%」），
   * 修法就是另做 `alarmFactor` —— 它沒有距離因子。
   *
   * 少了這一條，整個掃描會在「AI 從頭到尾不閃」的情況下跑完，而讀表的人
   * 會以為那是 AI 的問題。
   */
  it('800 m 精準瞄準：alarmFactor 滿值，threatFactor 遠低於門檻', () => {
    const prey = at(new Vector3(0, ALT, 0), FWD, new Vector3(0, 0, -TAS))
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)
    advanceLamp(lamp, prey, track, 0, createEngageBasis(), new Vector3())
    expect(alarmFactor(lamp, prey)).toBeCloseTo(1, 6)
    expect(threatFactor(lamp, prey)).toBeLessThan(DEFAULT_RULES.threatEnter)
  })

  /**
   * 【二】彈丸壽命是 `alarmFactor` 唯一的距離閘門。800 m 過得了，
   * 1200 m 過不了 —— 這條把「為什麼 standoff 選 800」釘在測試裡。
   */
  it('彈丸壽命是唯一的距離閘門', () => {
    const prey = at(new Vector3(0, ALT, 0), FWD, new Vector3(0, 0, -TAS))
    const track: LampTrack = { start: new Vector3(0, ALT, 1200), vel: new Vector3(0, 0, -TAS) }
    const far = new Aircraft(BLUNT, ALT, TAS)
    advanceLamp(far, prey, track, 0, createEngageBasis(), new Vector3())
    expect(alarmFactor(far, prey)).toBe(0)
  })

  /**
   * 【二之二 —— 排除「偷偷加回固定截斷」】1000 m 仍然要有值。
   *
   * 只驗「800 過、1200 不過」的話，一個把 `THREAT_RANGE`（900）或任何
   * 900~1000 的固定截斷加回來的實作照樣全綠。1000 m 在
   * 彈丸壽命內（1.2 s × 887 m/s ≈ 1064 m）卻在 900 m 外，正好把兩者分開。
   */
  it('900 m 外、彈丸壽命內：仍然有警戒', () => {
    const prey = at(new Vector3(0, ALT, 0), FWD, new Vector3(0, 0, -TAS))
    const track: LampTrack = { start: new Vector3(0, ALT, 1000), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)
    advanceLamp(lamp, prey, track, 0, createEngageBasis(), new Vector3())
    expect(alarmFactor(lamp, prey)).toBeGreaterThan(0)
    expect(threatFactor(lamp, prey)).toBe(0)
  })

  /**
   * 【三 —— 「瞄準敵機」那個歧義的守門員】機首要指**預瞄點**，不是目標本體。
   *
   * `alarmFactor` 比的是「機首 vs 彈道預瞄方向」。橫向相對速度 200 m/s 對
   * 887 m/s 的機砲產生 atan(200 × 0.9 / 800) ≈ 12.7° 的提前角，而 `defend`
   * 的門檻只有 `ALARM_CONE` × (1 − `threatEnter`) = 15° × 0.65 = 9.75°。
   *
   * 也就是說：指著目標本體的手電筒，**在 AI 開始橫向閃躲的那一刻就失去了
   * 觸發 defend 的資格** —— 閃得越用力越量不到，是最壞的一種選樣偏差。
   *
   * 這一條同時證明「瞄預瞄點」不是風格選擇，而是這條路唯一能走的走法。
   */
  it('橫向閃躲時：瞄目標本體會掉出 defend 門檻，瞄預瞄點不會', () => {
    // 目標帶 200 m/s 的橫向速度 —— 這就是「正在往旁邊閃」
    const prey = at(new Vector3(0, ALT, 0), FWD, new Vector3(200, 0, -TAS))
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    // 正確：advanceLamp 指向預瞄點 —— 在建構上滿值
    advanceLamp(lamp, prey, track, 0, createEngageBasis(), new Vector3())
    expect(alarmFactor(lamp, prey)).toBeCloseTo(1, 6)

    // 舊做法：指向目標本體
    const los = new Vector3().subVectors(prey.state.position, lamp.state.position).normalize()
    lamp.state.orientation.setFromUnitVectors(FWD, los)
    const atBody = alarmFactor(lamp, prey)
    expect(atBody).toBeGreaterThan(0)                        // 還在 15° 錐內
    expect(atBody).toBeLessThan(DEFAULT_RULES.threatEnter)   // 但不足以觸發 defend
  })

  /**
   * 【四 —— 「黏在目標身上」的守門員】觀測儀必須有自己獨立的軌跡。
   *
   * 若位置永遠是「目標當下位置 + 固定位移」，從它指向目標的向量恆等於
   * −位移，是個常數 —— 預瞄方向一格都不會動，`leadSwing` 恆為 0，而且
   * 四個方位、開關兩組**全部**都是 0，看起來像一致的結果。
   *
   * 【這一條必須呼叫 `advanceLamp` 本人】手工擺兩個狀態的話，一個仍然
   * 黏著的實作照樣全綠。所以下面直接斷言 helper 產出
   * 的位置**等於軌跡公式**、且**不等於黏著公式**。
   */
  it('歸位函數不黏在目標身上：位置逐位元由軌跡決定', () => {
    const basis = createEngageBasis()
    const dir0 = new Vector3()
    const dir1 = new Vector3()
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    // t=0：同向並飛，觀測儀在正後方 800 m
    const prey0 = at(new Vector3(0, ALT, 0), FWD, new Vector3(0, 0, -TAS))
    advanceLamp(lamp, prey0, track, 0, basis, dir0)
    expect(lamp.state.position.distanceTo(track.start)).toBeLessThan(1e-6)

    // t=1 秒：目標**轉了 90°**往 −X 飛，而且離開了原本的航跡
    const prey1 = at(new Vector3(-150, ALT, -150), new Vector3(-1, 0, 0), new Vector3(-TAS, 0, 0))
    advanceLamp(lamp, prey1, track, 1, basis, dir1)

    // 位置 = start + vel × 1，與目標做了什麼無關
    const onTrack = track.start.clone().addScaledVector(track.vel, 1)
    expect(lamp.state.position.distanceTo(onTrack)).toBeLessThan(1e-6)
    // 而且**不是**「目標當下位置 + 固定位移」—— 黏著版本會落在這裡
    const glued = prey1.state.position.clone().add(new Vector3(0, 0, 800))
    expect(lamp.state.position.distanceTo(glued)).toBeGreaterThan(100)
    // 目標轉了向，看過去的方向就必須改變
    expect(dir0.angleTo(dir1) * RAD).toBeGreaterThan(5)
  })

  /**
   * 【五 —— 接線】前四條都只驗純函數。這一條驗**產線真的走這條路**：
   * `AiController.scanThreat` 用 `alarmFactor` 掃全場、挑出手電筒當
   * `threatSource`，最後意圖變成 `defend`。
   *
   * 少了它，前四條可以全綠而 `lampMeasure` 仍然量到一架從頭到尾不閃的 AI。
   *
   * 【不跑 `world.step`】幾何由手動維持，只餵決策 —— 480 次 `update`，
   * 仍然是毫秒級。警戒斜坡 `ALARM_SATURATION` = 0.5 s，2 秒綽綽有餘。
   *
   * 【遠處那一架紅隊的用途】沒有它的話 `threatSource === lamp` 是唯一解，
   * 證明不了「掃描真的在比較」。
   */
  it('接線：AI 靠 alarmFactor 進 defend，且認得是手電筒在瞄它', () => {
    const world = new World()
    const prey = new Aircraft(BLUNT, ALT, TAS)
    const lamp = new Aircraft(BLUNT, ALT, TAS)
    const far = new Aircraft(BLUNT, ALT, TAS)

    const preyPos = new Vector3(0, ALT, 0)
    const farPos = new Vector3(3000, ALT, 0)
    const vel = new Vector3(0, 0, -TAS)
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: vel.clone() }

    const pc = world.add(prey, new Lazy(), 'blue', preyPos, ALT, TAS)
    const lc = world.add(lamp, new Lazy(), 'red', track.start, ALT, TAS)
    const fc = world.add(far, new Lazy(), 'red', farPos, ALT, TAS)
    for (const c of [pc, lc, fc]) c.respawnOnDestroy = false

    const ai = new AiController()
    ai.board = createTargetBoard(world.combatants)
    ai.selfIndex = pc.index
    ai.profile = VETERAN

    const basis = createEngageBasis()
    const dir = new Vector3()
    const cmd = createCommand()
    for (let i = 0; i < 2 * 240; i++) {
      const t = i * DT
      // 手動維持幾何：受測方與遠處那架都等速直飛，間距因此恆定
      prey.state.position.copy(preyPos).addScaledVector(vel, t)
      prey.state.velocity.copy(vel)
      far.state.position.copy(farPos).addScaledVector(vel, t)
      far.state.velocity.copy(vel)
      advanceLamp(lamp, prey, track, t, basis, dir)
      ai.update(prey, DT, cmd)
    }

    expect(ai.threatSource).toBe(lamp)
    expect(ai.intent).toBe('defend')
  })
})

// 【為什麼要另一條量測路徑】上面那一套用的是**真飛機**射手，而真飛機要
// 滾轉、要拉桿才轉得過來 —— 那些動作全都灌進「預瞄點動了幾度」，量到的
// 不只是 AI 的閃躲（同一份檔案記錄的 `ordinaryMedian` 6~11° 就是證據）。
//
// 解法是把射手當成一隻**可以自由轉動的手電筒**，始終瞄準在敵機身上。
// 污染源直接移除，比把污染扣掉簡單。
//
// 【這是新增不是取代】完美的手電筒瞄準誤差恆為 0，所以上面那條路徑的主
// 判準 `shootableShare`（機首落在預瞄錐內的佔比）在它身上恆為 1、完全失
// 去意義。兩條路徑回答兩個不同的問題：真射手問「一個受物理限制的追擊者
// 跟不跟得住」，手電筒問「預瞄點本身動了多少」。見 spec §3.3。

/** 觀測儀相對受測 AI 的方位 */
type Probe = 'ahead' | 'crossing' | 'above' | 'below'

/**
 * 開局幾何。**一律從玩家（觀測儀）的視角描述**：敵人離我 800 m、在我
 * 正前方前飛／在前方往左橫飛／在我下方或上方飛。
 *
 * 【`crossing` 一定要是真的橫飛】「觀測儀在敵機正右方、兩機同向並排」
 * 不是橫越，是編隊 —— 相對速度為零、視線角度永遠不變，**幾何本身就是
 * 死局**，量到的「AI 破一次就穩住」是那個死局的產物，不是 AI 的行為。
 *
 * 【`above` / `low` 的方向以玩家為準】`above` 是「敵機在我上方」。
 *
 * `offset` 是敵機相對觀測儀的位置，`course` 是敵機的開局航向。
 * 觀測儀一律在原點、機首 `FWD`、等速直線。
 */
interface LampAspect {
  /** 敵機在我的哪個方向、多遠 */
  offset: Vector3
  /** 敵機的開局航向（單位向量） */
  course: Vector3
  /** 表頭用的中文 */
  label: string
}

function aspectOf(probe: Probe, standoff: number): LampAspect {
  if (probe === 'ahead') {
    // 正前方，與我同向遠離 —— 典型的尾追
    return { offset: new Vector3(0, 0, -standoff), course: FWD.clone(), label: '正前方‧前飛' }
  }
  if (probe === 'crossing') {
    // 正前方，往我的左方橫越 —— 視線與它的航跡垂直
    return { offset: new Vector3(0, 0, -standoff), course: new Vector3(-1, 0, 0), label: '正前方‧橫飛' }
  }
  // 正上方 / 正下方，水平飛
  const sign = probe === 'above' ? 1 : -1
  return {
    offset: new Vector3(0, sign * standoff, 0),
    course: FWD.clone(),
    label: probe === 'above' ? '我的正上方' : '我的正下方',
  }
}

/**
 * 把一組位置與速度直線外推 `seconds` 秒，寫進 `ghost` 並回傳它。
 *
 * 【為什麼吃裸的位置速度而不是一架 `Aircraft`】量測路徑的來源是環形
 * 緩衝裡的兩個向量，不是一架飛機。若這裡收 `Aircraft`，量測就只能自己
 * 再手寫一次外推 —— 而**合約驗的就會是另一份實作**。
 *
 * 【幽靈機只是資料載體】它不進世界、不受物理、不被任何人看見。存在的
 * 唯一理由是 `buildEngageBasis` 吃的是 `Aircraft`，而我們必須用**產線
 * 那一份**彈道解，不能自己重寫一個 `solveLead`。
 */
function predictAhead(
  pos: Vector3, vel: Vector3, seconds: number, ghost: Aircraft, look: Vector3,
): Aircraft {
  ghost.state.position.copy(pos).addScaledVector(vel, seconds)
  ghost.state.velocity.copy(vel)
  ghost.state.angularVelocity.set(0, 0, 0)
  // 【姿態取速度方向，不複製當下的 prey 姿態】前者與「它照這樣飛下去」
  // 自洽；後者會把**實際狀態**漏進預測裡，那正是這個量要排除的東西
  const speed = vel.length()
  if (speed > 1e-6) {
    ghost.state.orientation.setFromUnitVectors(FWD, look.copy(vel).divideScalar(speed))
  }
  ghost.prevPosition.copy(ghost.state.position)
  ghost.prevOrientation.copy(ghost.state.orientation)
  return ghost
}

/**
 * **主判準的算法。** 從 `lamp` 的當下位置看出去，「實際的預瞄方向」與
 * 「預測的預瞄方向」差幾度。
 *
 * 【兩條都用同一個 `lamp`】差距因此純粹來自目標狀態的不同，不含觀測者
 * 自己的位移。
 *
 * 【為什麼不是比位置而是比方向】玩家修正的是**準星的角度**，不是目標的
 * 公尺數。同樣 50 m 的偏移，在 300 m 與 900 m 對玩家的意義差三倍。
 */
function aimErrorDeg(
  lamp: Aircraft, actual: Aircraft, predicted: Aircraft,
  basis: EngageBasis, a: Vector3, b: Vector3,
): number {
  buildEngageBasis(lamp, actual, basis)
  a.copy(basis.leadPoint).normalize()
  buildEngageBasis(lamp, predicted, basis)
  b.copy(basis.leadPoint).normalize()
  return a.angleTo(b) * RAD
}

describe('預測誤差的合約（O(1)，不跑場景）', () => {
  /**
   * 【六 —— 第五版的地基】理想等速直線的目標，預測誤差恆為 0。
   *
   * 這是整個第五版的核心主張：地板不是實測出來的，是**代數上的**。
   * 第四版的地板是 4.10 / 3.15 / 3.19 / 0.44 度、**方位相依**，害得跨
   * 方位不能比絕對度數；第五版四個方位對齊在 0。
   *
   * 【限定：理想】真實飛機受推力與阻力，速度大小不是嚴格常數，所以
   * **物理**直飛的自我檢查只能要求接近 0，不能宣稱恆等於 0（審查 M1）。
   * 這一條驗的是代數，不是物理。
   *
   * 這一條紅掉 = 那個主張是假的 = 整個計畫要重想。
   */
  it('理想等速直線的目標：預測誤差是 0', () => {
    const basis = createEngageBasis()
    const ghost = new Aircraft(BLUNT, ALT, TAS)
    const a = new Vector3()
    const b = new Vector3()
    const look = new Vector3()
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    // 目標帶一個任意的斜向等速 —— 直線就好，不必與觀測儀同向
    const vel = new Vector3(60, -10, -TAS)
    const prey = new Aircraft(BLUNT, ALT, TAS)
    prey.state.position.set(0, ALT, 0)
    prey.state.velocity.copy(vel)
    prey.state.orientation.setFromUnitVectors(FWD, vel.clone().normalize())

    // 一秒前的位置拿來外推，與「一秒後的實際狀態」比
    const pastPos = prey.state.position.clone().addScaledVector(vel, -1)

    advanceLamp(lamp, prey, track, 0, basis, new Vector3())
    expect(aimErrorDeg(lamp, prey, predictAhead(pastPos, vel, 1, ghost, look), basis, a, b))
      .toBeCloseTo(0, 6)
  })

  /**
   * 【七 —— 「角度變小也算閃」的守門員】
   *
   * 目標在一秒前是往 −X 橫飛的；一秒之內它**把橫向速度收掉**（拉回同向）。
   * 從觀測者看過去，預瞄點跑的**距離變短了** —— 第四版會判「動得比較少
   * = 沒在閃」。預測誤差不會：它比的是落點，而落點差很多。
   */
  it('角度變小也是閃躲：預測誤差抓得到', () => {
    const basis = createEngageBasis()
    const ghost = new Aircraft(BLUNT, ALT, TAS)
    const a = new Vector3()
    const b = new Vector3()
    const look = new Vector3()
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    // 一秒前：往 −X 橫飛
    const pastPos = new Vector3(0, ALT, 0)
    const pastVel = new Vector3(-150, 0, -TAS)
    // 一秒後的實際：橫向收掉了，所以位置落在「繼續橫飛」的右邊
    const prey = new Aircraft(BLUNT, ALT, TAS)
    prey.state.position.set(-40, ALT, -TAS)
    prey.state.velocity.set(0, 0, -TAS)

    // 【17.3° 是動工前算出來的，不是跑出來回填的】獨立解一次彈道：
    //   實際   p=(-40,0,-800) v=(0,0,0)      → t=0.903，lead 方向偏 2.9°
    //   預測   p=(-150,0,-800) v=(-150,0,0)  → t=0.961，lead 方向偏 20.2°
    // 差 17.33°。用區間而不是 toBeCloseTo：容得下浮點與求根分支的差異，
    // 但擋得住「少乘一個提前量」或「正負號寫反」那一類的錯
    advanceLamp(lamp, prey, track, 1, basis, new Vector3())
    const err = aimErrorDeg(lamp, prey, predictAhead(pastPos, pastVel, 1, ghost, look), basis, a, b)
    expect(err).toBeGreaterThan(14)
    expect(err).toBeLessThan(21)
  })

  /**
   * 【八 —— 「往上下偏開也算閃」的守門員】同樣的位移量，改成鉛直方向。
   *
   * 預瞄點往上或往下也是成功閃躲。
   * 這一條確認判準不是只對水平面敏感。
   */
  it('往上偏開也是閃躲：預測誤差抓得到', () => {
    const basis = createEngageBasis()
    const ghost = new Aircraft(BLUNT, ALT, TAS)
    const a = new Vector3()
    const b = new Vector3()
    const look = new Vector3()
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    const pastPos = new Vector3(0, ALT, 0)
    const pastVel = new Vector3(0, 0, -TAS)
    // 一秒後：它拉起來了，比「繼續直飛」高 40 m
    const prey = new Aircraft(BLUNT, ALT, TAS)
    prey.state.position.set(0, ALT + 40, -TAS)
    prey.state.velocity.set(0, 60, -TAS)

    // 獨立解一次彈道：預測是純尾追（相對速度 0，lead 就是 (0,0,-1)），
    // 實際 p=(0,40,-800) v=(0,60,0) → t=0.908，lead=(0,94.5,-800)，偏 6.74°
    advanceLamp(lamp, prey, track, 1, basis, new Vector3())
    const err = aimErrorDeg(lamp, prey, predictAhead(pastPos, pastVel, 1, ghost, look), basis, a, b)
    expect(err).toBeGreaterThan(5)
    expect(err).toBeLessThan(9)
  })
})

/**
 * 預測窗長，秒。判準問的是「我以為它**一秒後**會在哪」。
 *
 * 【它與 `WINDOW` 是同一個數字但不是同一件事】`WINDOW`（240 步）是
 * `Swing` 的滑動窗；這裡是外推的前瞻時間。第五版不用 `Swing`，兩者
 * 因此不再耦合 —— 要調「N 秒」只改這一個。
 */
const LOOKAHEAD = 1
const LOOKAHEAD_STEPS = LOOKAHEAD * 240

/** 觀察窗上界，秒。實際窗長是第一段連續彈道有效期，見 `validSeconds` */
const LAMP_SECONDS = 20

/**
 * 【取樣前要先讓場景進入穩態】
 *
 * 第一筆樣本在 `t ≈ 1s`，它比的是 `t=0` 到 `t=1s` —— 而那一秒的歷史
 * **完整包含開場**：`alarmRamp` 約 0.2 秒才跨過門檻，`VETERAN.reactionDelay`
 * 是 0.3 秒（意圖已是 `defend`，舵令還要再等）。也就是說第一批樣本量到的
 * 是「AI 還沒開始閃」。
 *
 * 修法不是猜一個延遲常數，而是**直接要求整段前瞻窗都在閃**：維護一個
 * 連續 `defend` 的計數器，只有連續時間 ≥ `LOOKAHEAD` + 反應延遲才取樣。
 */
const SETTLE_STEPS = Math.ceil(VETERAN.reactionDelay * 240)

/**
 * **主判準的下限**：玩家一秒前把準星放在預瞄點上，一秒後必須修正的角度，
 * 度。中位數。低於它 = 玩家看不出 AI 在閃。
 *
 * 【錨在哪】就是同檔的 `HIT_CONE` —— 「射手機頭離預瞄點多少度以內算打得
 * 中」，它的註解寫著「機砲的散佈與目標張角都在這個尺度」。所以這條門檻的
 * 意思很短：**預瞄點在一秒內移動超過這個角度，玩家原本會命中的那一槍就
 * 打不中了**。那正是「他必須重新瞄」的操作型定義。
 *
 * 【為什麼不從掃描的現況推導】那是照著現況畫靶 —— 現況必然通過，護欄沒有
 * 牙齒。這專案已經三次栽在「自訂量測看起來過關、實際沒解決問題」
 * （spec §7.5）。`HIT_CONE` 是為了別的用途而存在的常數，與 AI 的表現無關。
 *
 * 【兩個交叉檢查】800 m 的機體翼展張角是 0.81°（翼端 5.65 m）；量測本身的
 * 雜訊地板是 0.16~0.59°（腳本直飛的自我檢查）。2° 在兩者之上都有餘裕。
 *
 * 【它現在擋不住任何東西】四個場景是 5.50~7.46°，全部通過。這條門檻目前
 * 的作用是**防迴歸**，不是**推動改善**；要不要收緊看試玩。
 */
const AIM_ERROR_FLOOR = HIT_CONE

interface AimResult {
  /** **主判準**：預測誤差的中位數，度 */
  aimError: number
  /** 有效取樣裡受測方進 `defend` 的比例 */
  defendShare: number
  /**
   * 取樣點上 `defend.reversal > 0` 的比例 —— **歸因的破口**。
   *
   * `defend` 的意圖不保證轉向命令是閃躲：`reversalAim` 是明確的**追擊解**，
   * 而 `geometryGate` 的 `overshoot` / `speedRecover` / `planeDegenerate`
   * 也會在意圖仍是 `defend` 時覆蓋防禦分支。這一欄與
   * `normalModeShare` 把那些情況印出來，不用嘴巴保證。
   */
  reversalShare: number
  /** 取樣點上 `ai.mode === 'normal'` 的比例 —— 沒有被幾何閘門改寫 */
  normalModeShare: number
  /** 有效取樣裡 AI 認定「在瞄我的是手電筒」的比例 —— 歸因護欄 */
  lampShare: number
  /** 有效取樣數 */
  samples: number
  /** 第一段**連續**有效窗的長度，秒 */
  validSeconds: number
  /** 兩架飛機全程都活著 */
  allAlive: boolean
}

/**
 * 手電筒量測（第五版）：場上只有受測方與觀測儀。
 *
 * @param evade `false` 時把受測方換成腳本直飛（`ScriptedBreaker` + `mode='none'`）
 *              —— 那是**量測工具的自我檢查**，預測誤差應該接近 0。它不是
 *              對照組：第五版的數學地板是 0，不需要跑第二場來取得。
 *
 * 【為什麼沒有誘餌】要量的是「敵機直飛，被手電筒瞄準時閃躲」，不是追逐。
 * 誘餌會讓受測 AI 為了追它而轉彎，那個彎一樣會讓預瞄點移動而且無法歸因。
 *
 * 【目標是手電筒，會不會變成追逐手電筒】場上只有兩架，受測 AI 必然選
 * 觀測儀當目標（`selectTarget` 只在自己死了或無活敵人時回 null）。緩解
 * 在於它全程處在 `defend`，而破防的瞄準是 `LOS·cos(75°) + axis·sin(75°)`
 * —— **偏離視線 75°，是破開不是追擊**。
 *
 * 但這**不是**一個程式上的不變量：`cos 75° ≈ 0.259`，仍含
 * 26% 朝攻擊者的分量；`reversalAim` 更是明確的追擊解；`geometryGate` 也
 * 會覆蓋防禦分支。所以本函數回報 `defendShare`、`reversalShare` 與
 * `normalModeShare` 三個數字，讓讀表的人自己判斷，不靠敘述保證。
 *
 * 【歷史環形緩衝】要拿「一秒前的位置與速度」，所以存 `LOOKAHEAD_STEPS + 1`
 * 格，先寫後讀。只存位置與速度 —— 外推只需要這兩個。
 */
function aimMeasure(standoff: number, probe: Probe, evade: boolean): AimResult {
  const world = new World()
  const prey = new Aircraft(BLUNT, ALT, TAS)
  const lamp = new Aircraft(BLUNT, ALT, TAS)
  const ghost = new Aircraft(BLUNT, ALT, TAS)

  // 【觀測儀在原點，敵機依開局幾何擺位】見 `aspectOf` —— 一律從玩家視角
  const aspect = aspectOf(probe, standoff)
  const lampPos = new Vector3(0, ALT, 0)
  const preyPos = aspect.offset.clone().add(lampPos)
  for (const [a, p, c] of [
    [prey, preyPos, aspect.course], [lamp, lampPos, FWD],
  ] as const) {
    a.state.position.copy(p)
    a.state.velocity.copy(c).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(FWD, c)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }

  const ai = new AiController()
  const breaker = new ScriptedBreaker()
  breaker.mode = 'none'
  breaker.threat = lamp
  const pc = world.add(prey, evade ? ai : breaker, 'blue', preyPos, ALT, TAS)
  // 【觀測儀不開火】它是量測儀器，不是戰鬥單位（spec §6）。`Lazy.update`
  // 明確 `firing = false`，而且兩架都用 `BLUNT`（無傷害彈藥）
  const lc = world.add(lamp, new Lazy(), 'red', lampPos, ALT, TAS)
  for (const c of [pc, lc]) c.respawnOnDestroy = false

  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = pc.index
  ai.profile = VETERAN

  const basis = createEngageBasis()
  const dir = new Vector3()
  const look = new Vector3()
  const va = new Vector3()
  const vb = new Vector3()
  const track: LampTrack = { start: lampPos.clone(), vel: new Vector3(0, 0, -TAS) }

  // 歷史環形緩衝：一秒前的位置與速度
  const histP: Vector3[] = []
  const histV: Vector3[] = []
  for (let i = 0; i <= LOOKAHEAD_STEPS; i++) {
    histP.push(new Vector3())
    histV.push(new Vector3())
  }
  let head = 0
  let filled = 0

  const errors: number[] = []
  let defendN = 0
  let reversalN = 0
  let normalN = 0
  let lampN = 0
  let samples = 0
  let inside = false
  let validFrom = 0
  let validTo = 0
  let allAlive = true
  /** 連續處在 `defend` 的格數 —— 見 `SETTLE_STEPS` 的註解 */
  let defendRun = 0

  for (let s = 0; s < LAMP_SECONDS * 240; s++) {
    world.step(DT)
    if (!pc.alive || !lc.alive) {
      allAlive = false
      break
    }

    advanceLamp(lamp, prey, track, (s + 1) * DT, basis, dir)

    // ── 有效窗：第一段連續的「彈道解成立」，失效即停 ──────
    const valid = alarmFactor(lamp, prey) > 0
    if (!inside) {
      if (!valid) continue
      inside = true
      validFrom = s
    } else if (!valid) {
      break
    }
    validTo = s

    defendRun = !evade || ai.intent === 'defend' ? defendRun + 1 : 0

    // 記這一格的狀態，然後回頭拿 LOOKAHEAD 秒前的那一格
    const n = histP.length
    histP[head]!.copy(prey.state.position)
    histV[head]!.copy(prey.state.velocity)
    const oldIdx = (head - LOOKAHEAD_STEPS + n) % n
    head = (head + 1) % n
    if (filled <= LOOKAHEAD_STEPS) filled++

    // 【整段前瞻必須落在有效期內，而且整段都在閃】
    // `filled` 保證環形緩衝有一秒歷史；`s - validFrom` 保證那一秒都在
    // 彈道有效期內；`defendRun` 保證那一秒 AI 都在 defend 而且反應延遲
    // 已經排空
    if (filled <= LOOKAHEAD_STEPS) continue
    if (s - validFrom < LOOKAHEAD_STEPS) continue
    if (defendRun < LOOKAHEAD_STEPS + SETTLE_STEPS) continue
    if (s % 12 !== 0) continue

    samples++
    errors.push(aimErrorDeg(
      lamp, prey, predictAhead(histP[oldIdx]!, histV[oldIdx]!, LOOKAHEAD, ghost, look),
      basis, va, vb,
    ))
    if (evade) {
      if (ai.intent === 'defend') defendN++
      if (ai.defend.reversal > 0) reversalN++
      if (ai.mode === 'normal') normalN++
      if (ai.threatSource === lamp) lampN++
    }
  }

  const d = Math.max(samples, 1)
  return {
    aimError: median(errors),
    defendShare: defendN / d,
    reversalShare: reversalN / d,
    normalModeShare: normalN / d,
    lampShare: lampN / d,
    samples,
    validSeconds: (validTo - validFrom) * DT,
    allAlive,
  }
}

describe('預瞄預測誤差（手電筒觀測儀、兩架、開局 800 m）', () => {
  for (const probe of ['ahead', 'crossing', 'above', 'below'] as const) {
    it(`${aspectOf(probe, 800).label}：我以為它一秒後在哪 vs 它實際在哪`, () => {
      const on = aimMeasure(800, probe, true)
      const off = aimMeasure(800, probe, false)
      console.log(
        `[預測誤差] ${aspectOf(probe, 800).label} 800m`
        + ` 閃躲=${on.aimError.toFixed(2)}°`
        + ` 直飛自檢=${off.aimError.toFixed(2)}°`
        + ` defend佔時=${(on.defendShare * 100).toFixed(1)}%`
        + ` 反轉=${(on.reversalShare * 100).toFixed(1)}%`
        + ` 正常模式=${(on.normalModeShare * 100).toFixed(1)}%`
        + ` 瞄我的是手電筒=${(on.lampShare * 100).toFixed(1)}%`
        + ` 有效窗=${on.validSeconds.toFixed(1)}s／自檢 ${off.validSeconds.toFixed(1)}s`
        + ` 取樣=${on.samples}／自檢 ${off.samples}`
        + ` 存活=${on.allAlive}／${off.allAlive}`,
      )
      // 【這裡的斷言只驗「量測有效」，不驗「AI 夠好」】主判準的門檻由
      // 負責人定值，這裡連寫都不寫。
      for (const [name, r] of [['閃躲', on], ['自檢', off]] as const) {
        expect(r.allAlive, `${name}：兩架飛機要全程活著`).toBe(true)
        // 【直接斷言取樣數，不用秒數間接推】validSeconds 只比 2
        // 大一點時大約只有 21 筆、涵蓋約一秒實際資料，容易被一次短暫機動
        // 主導中位數
        expect(r.samples, `${name}：取樣數`).toBeGreaterThanOrEqual(40)
        expect(r.validSeconds, `${name}：連續有效窗`).toBeGreaterThan(3)
        expect(Number.isFinite(r.aimError)).toBe(true)
      }
      // 【量測工具的自我檢查】腳本直飛的預測誤差必須接近 0。
      // 它若不接近 0，代表外推或彈道解寫錯了，整張表都不能看。
      // 【為什麼不是恰好 0】真實飛機受推力與阻力，速度大小不是嚴格常數
      expect(off.aimError, '直飛的預測誤差要接近 0').toBeLessThan(1)
      // 場景成立：AI 真的在閃、而且知道是誰在瞄它
      expect(on.defendShare).toBeGreaterThan(0.9)
      expect(on.lampShare).toBeGreaterThan(0.9)
      // 【主判準】玩家看得出 AI 在閃 —— 見 `AIM_ERROR_FLOOR`
      expect(on.aimError, '預瞄偏移要大於一個命中錐').toBeGreaterThan(AIM_ERROR_FLOOR)
    }, 10 * 60 * 1000)
  }
})
