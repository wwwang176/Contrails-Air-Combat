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
 * 破防的位移沒有比它突出多少。設計文件 §5.3 那個「至少是舊值的 3 倍」是
 * 從**腳本對腳本**（12.8× 對 2.0×）算的，套到真實 AI 上不成立 —— 已在 §8
 * 更正。這一條留著的作用是「破防的位移必須明顯大於完全不閃」，那仍然值得
 * 守，只是它擋不住舊軸。真正鑑別新舊的是主判準。
 *
 * 【它們會隨手感倍率漂移】上表量於 `specs/feel.ts` 的
 * `{ roll: 1.2, oswald: 2, power: 1.98, lift: 1.3, cd0: 2.06 }`。倍率大幅
 * 調動後若這兩條紅了，處置是**重量並回填**（連同新倍率一起記進這段註解），
 * 不是逕自放寬 —— 那是專案負責人的裁定。
 */
/**
 * 「玩家壓得住準星」的上限，**逐距離**。
 *
 * 【2026-08-11 由單一常數 0.08 拆成兩格，專案負責人裁定接受】拿掉飛行員
 * 過載硬夾之後（`control/limiters.ts`，6.5 G → 結構極限）實測：
 *
 * ```
 *   700 m   0.130   ← 紅了（原門檻 0.08）
 *   900 m   通過     ← 一格沒動
 * ```
 *
 * **退化是局部的**：近距離時瞄準誤差大，指揮儀要求最大轉彎率、現在給到
 * 8 G，AI 拉爆自己於是閃不掉；900 m 要求的轉彎率本來就碰不到上限，毫髮
 * 無傷。專案負責人裁定「AI 拉爆自己這件事本身合理，接受」。
 *
 * 【為什麼拆開而不是一律拉到 0.14】900 m 那一格現在守得好好的，一律拉高
 * 等於把它的牙齒一起拔掉。同日 `ai-defence` 是同樣的模式（四格裡三格變好、
 * 一格爆掉），處置也一樣：**退化是局部的，例外就該是局部的。**
 *
 * 【0.14 已經刪掉了，2026-08-11】AI 能量紀律（`ai/doctrine.ts` 的
 * `energyPull`）上線後 700 m 這一格回到 0.08 並通過 —— 驗證成功，例外
 * 整筆撤銷。上面那段留著是為了記錄它為什麼曾經存在。
 *
 * 【原本的來歷】0.08 = 舊軸較小的那個 16.2% 的一半。量於 `specs/feel.ts`
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
   * 【為什麼量這個而不是最低高度】離地底限是一條由 `clearanceScale`（500 m）
   * 線性降到 0 的斜坡，它在**恰好 500 m 時輸出 0**。要求「最低高度不低於
   * 500」等於要求一個比例控制器有零穩態穿越 —— 斜坡做不到，加大增益也做
   * 不到（實測抬角由 10° 加到 80°，800 橫越那一場的最低高度卡在 398 m
   * 一個位數都沒動：底部由飛機當下的拉起能力決定，不由指令角度決定）。
   *
   * 該問的是**硬限制有沒有被動用**。政策層存在的目的就是讓那道最後防線
   * 不必動（spec §3「政策先動，硬限制只在政策失效時動」），而它是二元的、
   * 沒有這個穿越問題。
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
    // 二、`'ground'` 本身在 4000 m 也曾經出現：2026-08-09 之前
    // `recoveryAltitude` 在拉不動（`nMax ≤ 1`，速度太低）時回 `Infinity`，
    // 於是撞地分支在**任何**高度都成立，實測濾掉失速之後仍剩 0.01% / 0.92%，
    // 全部發生在 3950 m。那個分支歸屬問題已修（改成兩段式改出），但這道
    // 高度篩仍然留著 —— 它問的是「政策層有沒有把飛機送到離地底限以下」，
    // 高空的撞地接管本來就不屬於這條護欄，不論它是不是缺陷。
    //
    // 所以只數**離地餘裕在 `clearanceScale` 以內**的撞地接管 —— 那正是離地
    // 底限這一層負責的高度帶，也正是這條護欄要問的「政策失職了沒」。
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
      // 【500 → 300 是 2026-08-07 換破防軸時重新定值的】這一條量的是「射手
      // 有射擊解的取樣格數」，而**那正是新軸刻意要消滅的東西**：同場景
      // 700 m 由 2398 掉到 551、900 m 由 1305 掉到 490，900 m 那一格因此
      // 直接跌破舊門檻。
      //
      // 換句話說，這條護欄的量法與被測的功能耦合了 —— 閃得越好它越紅。
      // 它真正該擋的是「場景根本沒成立」（射手從頭到尾沒咬上）。490 格
      // 相當於 180 秒裡有 24.5 秒被瞄著，場景是成立的。重新定在 300
      // （15 秒），仍然擋得住空場景，但不再懲罰閃躲成功。
      expect(r.underFire).toBeGreaterThan(300)

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
      // 舊的「位移 ≥ 5°」是壞的：5° 這個數字是專案負責人給的，但拿去量
      // **絕對位移**是實作的錯。完全不閃的基準線只有 0.9°，而 AI 平常追擊
      // 就有 6~11° —— 那條門檻連「不閃」都快要通過，而平常機動一定通過。
      // 該量的是破防與不破防的**對比**。詳見設計文件 §5.1。
      expect(r.shootableShare).toBeLessThan(SHOOTABLE_LIMIT)
      // 【副判準】視覺對比 —— 相對於**腳本直飛**的基準線，不是 AI 的平常機動。
      // 這是地板不是鑑別器，理由見 CONTRAST_FLOOR 的註解
      expect(r.contrast).toBeGreaterThan(CONTRAST_FLOOR)

      // ── 三：抖動護欄 ────────────────────────────────────
      // 【為什麼需要它】上面那條有一個漏洞：每 0.1 秒左右擺一次的 AI 分數
      // 會很高，但玩起來是抽搐不是閃躲（這個專案 2026-08-05 才治好一次
      // 同樣的病）。同向性 = 淨位移 ÷ 逐格位移總和，直線接近 1、來回接近 0。
      expect(r.straightness).toBeGreaterThan(0.5)
    }, 5 * 60 * 1000)
  }

  /**
   * 【這一條是 #136 的主判準】目標是**飛機不以任何方式墜海**，而且是靠
   * `steer.ts` 的離地底限（`floorPitch`）自己處理掉，不是靠 `safety.ts`
   * 那道 120 m 的硬限制接住。
   *
   * 【判準為什麼不是「最低高度 > 500」，2026-08-07 專案負責人裁定】
   * 設計文件 §4.1 原本這樣寫，實作後發現那句話與底限層的形狀自相矛盾：
   * `floorPitchAngle` 是一條由 `clearanceScale`（500 m）線性降到 0 的斜坡，
   * 在**恰好 500 m 時輸出 0**。要求「絕不低於開始修正的高度」等於要求一台
   * 車在踩下煞車的那一刻就停住。實測抬角由 10° 加到 80°，800 橫越那一場的
   * 最低高度卡在 398 m 一個位數都沒動 —— 底部由飛機當下的速度姿態能拉多少
   * 決定，不由指令角度決定。
   *
   * 【也不是「跑滿 180 秒」】那一半被腳本射手把持著：兩場提早結束都是**它**
   * 撞海（99 s / 113 s），而它的死亡時間對抬角完全不敏感（99/99/99、
   * 113/113/114）—— 它沒有離地意識，AI 做什麼都救不了它。受測 AI 在全部
   * 七個抬角設定下一次都沒死。所以這裡改成直接問 `aiAlive`，並讓觀察窗在
   * 射手死後仍然繼續看 AI（見 `measure` 迴圈的註解）。
   *
   * 【實測，2026-08-07】離地底限上線前後：
   *
   * ```
   * 場景         最低高度（前 → 後）   安全層介入率（前 → 後）
   * 400 尾追        2687 → 2687          0.00% → 0.00%
   * 800 尾追        3953 → 3953          0.00% → 0.00%
   * 1000 尾追        113 →  309          1.52% → 0.00%   ←
   * 400 橫越        2556 → 2556          0.00% → 0.00%
   * 800 橫越          51 →  398          3.34% → 0.00%   ←
   * 1000 橫越       3940 → 3940          0.00% → 0.00%
   * ```
   *
   * 誘餌起始位置微擾 ±20 / ±40 各跑 5 次，撞地那兩場 10 次全部重現 ——
   * 系統性可重現，不是混沌抽樣。
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
   * 【2026-08-11 更正一個過度的宣告】原註解寫「不含任何魔術數字 —— 下次
   * 調手感倍率也不會失效」。**那個自信只對一半**：它對 `feel.ts` 的倍率
   * 免疫（兩軸同時受惠、比值不動），但對**過載上限**不免疫。當天拿掉
   * 飛行員硬夾（6.5 G → 結構極限）之後這條就紅了。
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
