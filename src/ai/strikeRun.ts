import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { WEP_THROTTLE } from '../physics/propulsion'
import { DEG } from '../core/math'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import type { Ship } from '../world/ships'

/**
 * # 對艦攻擊航路的狀態機
 *
 * **與武器無關。** 轟炸與雷擊的差別全部收在一份 `StrikeProfile` 裡，
 * 兩者共用同一套狀態機。
 *
 * ```
 * 進場 ──對正了──▶ 直飛 ──投完／飛過頭／逾時──▶ 脫離 ──補滿且夠遠──▶ 進場
 *  ▲                                                                    │
 *  └────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## 為什麼非要有「直飛」這一段
 *
 * 「每一步都重新瞄準船的預測位置」不行：實測十架只投得成一趟、八架
 * 陣亡（spec §5.1）。成因：每步重瞄 = 追尾曲線，而投出去的東西繼承的是
 * **速度向量**，也就是轉彎圓的切線。在弧線上，預測落點橫掃海面的速度遠
 * 快於飛機接近船的速度 —— 落點掃過釋放窗而不是坐進去。
 *
 * 第一趟之所以成功，只是因為開場那 5 km 剛好是一條又長又直的航線。
 *
 * 所以直飛段**鎖定航向**：停止逐步重瞄，讓機身穩定，落點才停得下來。
 *
 * ## 這一層不做的
 *
 * - 不迴避彈幕、不編隊攻擊。
 * - 不決定「放不放得中」—— 那是 `StrikeProfile.shouldRelease`。
 */

export type StrikePhase = 'approach' | 'run' | 'egress'

/**
 * 一種武器的攻擊剖面。**轟炸與雷擊各一份。**
 *
 * 【為什麼把「放得中嗎」也放進來】那是唯一真正與武器有關的判斷。轟炸要跑
 * 彈道解算、雷擊只看射程與航向錐 —— 兩者的成本差三個數量級，硬要共用一條
 * 公式只會兩邊都不對。
 */
export interface StrikeProfile {
  /**
   * 航路高度，m。**`null` = 維持現在的高度。**
   *
   * 轟炸是 `null`（從巡航高度投）；雷擊要降到投雷高度。
   */
  readonly runAltitude: number | null
  /**
   * 改變高度時最陡准到多少，**指令方向的 sin**。省略 = 1（45°）。
   *
   * 【為什麼需要它】`applyRunAltitude` 的 1/400 增益是為**小誤差**訂的，
   * 而雷擊要從巡航高度掉到 50 m —— 誤差 950 m 會直接把指令頂到滿舵。實測
   * 一台 G4M 以 45° 從 427 m 俯衝進場，安全層來不及改出，飛機黏在海面上
   * 以 5 m/s 抹平（`test/tools/torpedo-run.probe.ts`）。
   *
   * 轟炸不受影響 —— 它的 `runAltitude` 是 `null`，整段不執行。
   */
  readonly runSlope?: number
  /** 機首與理想航向的夾角小於這個才鎖，rad。 */
  readonly lockCone: number
  /**
   * 已經飛到這麼近就放棄這一趟，m。
   *
   * 【它不是脫離距離，是放棄距離】到了這裡還沒放出去就代表這一趟算不準了
   * （或艙是空的）。繼續飛只會鑽進近迫火網。
   */
  readonly abortRange: number
  /** 一趟直飛最多幾秒。逾時就放棄 —— 避免鎖了一個永遠到不了的航向。 */
  readonly runSeconds: number
  /** 脫離時的爬升角，rad。 */
  readonly egressClimb: number
  /**
   * 這一拍的瞄點與鎖定距離。**就地寫 `out`，一次算完兩件事。**
   *
   * 【為什麼合成一支】兩者都要跑同一份彈道解算（轟炸一次 170 µs）。拆成
   * 兩支就是解兩次，而它們問的是同一條軌跡。
   *
   * 【為什麼鎖定距離不是常數】它必須等於「前拋距離 ＋ 一段穩定用的長度」，
   * 而前拋隨高度變：1,000 m 約 1.26 km、4,000 m 約 4 km。寫死 3 km 的話
   * 高空的轟炸機進到 3 km 時**早就飛過投彈點了**，落點誤差一路單調增加
   * （實測 4,000 m：503 → 1101 → 1694 → 2283 m）。
   *
   * 轟炸瞄「船在落彈時刻的位置」、雷擊瞄「船在雷程時刻的位置」。
   */
  plan(self: Aircraft, ship: Ship, out: StrikePlan): void
  /** 現在放得中嗎。熱路徑（決策拍）。 */
  shouldRelease(self: Aircraft, ship: Ship): boolean
}

/** `StrikeProfile.plan` 的輸出。就地寫入 —— 熱路徑不得配置。 */
export interface StrikePlan {
  /** 該瞄的世界座標。 */
  readonly aim: Vector3
  /** 進到這麼近且對正了就鎖航向轉入直飛，m。 */
  lockRange: number
  /**
   * 脫離要拉開到多遠才准再進場，m。
   *
   * 【為什麼也是推導的】它的下限是「掉頭之後還有空間重新鎖住航向」，也就是
   * `lockRange + 2 × 迴旋半徑`。三個量都隨機種與高度變 —— 寫死一定會錯一邊：
   * 5,000 m 是 4,000 m 高度的值，拿到 1,000 m 就多飛了一倍多的路
   * （實測循環 111 s vs 66 s）。
   */
  egressRange: number
}

/**
 * 一架飛機的攻擊狀態。**由 `AiController` 持有**，與 `ShipAim` 同一個性質。
 */
export interface StrikeState {
  phase: StrikePhase
  /** 直飛段鎖定的航向，**水平單位向量**。 */
  readonly heading: Vector3
  /** 直飛段鎖定的那一艘（`ships` 索引）。**中途不換。** */
  ship: number
  /** 這一趟直飛已經幾秒。 */
  seconds: number
  /** 這一步要不要放。呼叫端寫進 `Command.bombing`。 */
  release: boolean
  /**
   * 這一拍的瞄點與鎖定距離。**只在決策拍重算。**
   *
   * 【為什麼要快取】`plan` 要跑彈道解算（170 µs）。每個物理步跑的話
   * 240 Hz × 170 µs = 每架 40 ms/s，直接撞穿設計預算。
   */
  readonly plan: StrikePlan
}

export function createStrikeState(): StrikeState {
  return {
    phase: 'approach',
    heading: new Vector3(0, 0, -1),
    ship: -1,
    seconds: 0,
    release: false,
    plan: { aim: new Vector3(), lockRange: 0, egressRange: 0 },
  }
}

export function resetStrike(s: StrikeState): void {
  s.phase = 'approach'
  s.heading.set(0, 0, -1)
  s.ship = -1
  s.seconds = 0
  s.release = false
  s.plan.aim.set(0, 0, 0)
  s.plan.lockRange = 0
  s.plan.egressRange = 0
}

/**
 * 直飛段每個決策拍把航向朝理想值收斂多少，0 = 完全凍結。
 *
 * 【為什麼不是 0】完全凍結最穩，但鎖定當下對船速與自身速度的估計一有偏差，
 * 整趟就報銷而且沒有機會修正。0.12 在 10 Hz 下的時間常數約 0.8 s ——
 * 量級小到落點不會橫掃，又足以吃掉系統性偏差。**起始值，由試飛裁定。**
 */
export const RUN_TRIM = 0.12

/** 方向退化的下限。與 `shipAttack.ts` 同一個手法。 */
const MIN_ERROR = 1e-6

const FWD = /* @__PURE__ */ new Vector3(0, 0, -1)
const S = /* @__PURE__ */ makeScratch(4)

/** 水平化並正規化。退化時回 `null`。 */
function flatten(v: Vector3): Vector3 | null {
  v.y = 0
  if (v.lengthSq() < MIN_ERROR) return null
  return v.normalize()
}

/**
 * 推進一步。寫滿整個 `Command`，並在 `state.release` 留下這一步要不要放。
 *
 * @param decide 這一步是不是決策拍。**`shouldRelease` 只在決策拍跑** ——
 *   轟炸的彈道解算一次 170 µs，每個物理步跑會直接撞穿設計預算。
 * @param loaded 艙裡還有東西嗎。空了就轉脫離 —— 沒有這一格的話它會一直
 *   飛航路而不知道自己手上是空的（實測累計 115 秒）。
 *
 * **呼叫端仍然要在之後套 `applySafety`**（spec §5.2：命令不豁免安全層）。
 *
 * 熱路徑：不配置。不修改 `self`，也不修改 `ship`。
 */
export function stepStrike(
  state: StrikeState, self: Aircraft, ship: Ship, shipIndex: number,
  profile: StrikeProfile, loaded: boolean, decide: boolean, dt: number, out: Command,
): void {
  const p = self.state.position
  const dx = ship.position.x - p.x
  const dz = ship.position.z - p.z
  const range = Math.hypot(dx, dz)

  out.throttle = WEP_THROTTLE
  out.brake = 0
  out.firing = false
  state.release = false

  // 【三個幾何量只在決策拍重算】見 `StrikeState.plan`。**排在相位分支之前**
  // —— 脫離段也要用得到 `egressRange`，而那一段直接 return
  if (decide) profile.plan(self, ship, state.plan)

  // ── 脫離 ──────────────────────────────────────────────
  //
  // 【背離＋爬高】投完之後繼續往船飛是十架死八架的直接原因（spec §5.1）。
  if (state.phase === 'egress') {
    steerEgress(self, profile, dx, dz, out)
    // 補滿且拉開夠遠才准再進場 —— 兩個條件缺一個就會空手再衝一次
    if (loaded && range > state.plan.egressRange) {
      state.phase = 'approach'
      state.ship = -1
    }
    out.bombing = false
    return
  }

  const aim = state.plan.aim
  const ideal = flatten(S.v[2]!.set(aim.x - p.x, 0, aim.z - p.z))

  // ── 進場 ──────────────────────────────────────────────
  if (state.phase === 'approach') {
    if (ideal !== null) out.aimWorld.copy(ideal)
    else out.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
    applyRunAltitude(self, profile, out)
    out.bombing = false

    // 【對正且進到鎖定距離才轉直飛】兩個都要 —— 只看距離的話會在還沒對正
    // 時就鎖住一個歪的航向，只看角度的話會在 8 km 外就鎖住
    if (!loaded || ideal === null || range > state.plan.lockRange) return
    const nose = flatten(S.v[3]!.copy(FWD).applyQuaternion(self.state.orientation))
    if (nose === null || nose.dot(ideal) < Math.cos(profile.lockCone)) return

    state.phase = 'run'
    state.ship = shipIndex
    state.seconds = 0
    state.heading.copy(ideal)
    return
  }

  // ── 直飛 ──────────────────────────────────────────────
  //
  // 【航向鎖住，只做重阻尼的修正】見 `RUN_TRIM`。這一段是整件事的核心：
  // 停止逐步重瞄，落點才停得下來。
  state.seconds += dt
  if (ideal !== null && decide) {
    state.heading.lerp(ideal, RUN_TRIM)
    if (flatten(state.heading) === null) state.heading.copy(ideal)
  }
  out.aimWorld.copy(state.heading)
  applyRunAltitude(self, profile, out)

  // 【放棄條件】飛過頭、逾時、或艙空了。留在直飛只會鑽進近迫火網。
  if (!loaded || range < profile.abortRange || state.seconds > profile.runSeconds) {
    state.phase = 'egress'
    state.seconds = 0
    // 【轉進脫離的那一步就要轉向】不在這裡改的話，這一步還飛著直飛的航向，
    // 而那一步正是「已經在船的正上方」的那一步 —— 差一步就是差 0.4 秒的
    // 近迫火網
    steerEgress(self, profile, dx, dz, out)
    out.bombing = false
    return
  }

  if (decide) state.release = profile.shouldRelease(self, ship)
  out.bombing = state.release
}

/** 背離目標並爬升。**兩個入口共用** —— 轉進脫離的那一步也要立刻轉向。 */
function steerEgress(
  self: Aircraft, profile: StrikeProfile, dx: number, dz: number, out: Command,
): void {
  const away = flatten(S.v[0]!.set(-dx, 0, -dz))
  if (away === null) {
    out.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
    return
  }
  const c = Math.cos(profile.egressClimb)
  out.aimWorld.set(away.x * c, Math.sin(profile.egressClimb), away.z * c).normalize()
}

/**
 * 航路高度。`runAltitude === null` 就維持現在的高度（水平飛）。
 *
 * 【為什麼是改 `aimWorld` 的 y 而不是另一個欄位】`Command` 只有一個方向，
 * 高度控制只能透過它。比例增益 1/400 讓 400 m 的高度差對應 45° ——
 * 再陡的話低空進場會踩到安全層。
 */
/**
 * 高度控制的前瞻時間，s。**`err − damp · vy`。**
 *
 * 【為什麼是 6】長週期振盪的週期約 10 秒，前瞻取四分之一週期上下是標準的
 * 起手；6 秒實測把 86～156 m 的擺幅收到個位數。**由試飛裁定。**
 */
const RUN_ALT_DAMP = 6

function applyRunAltitude(self: Aircraft, profile: StrikeProfile, out: Command): void {
  if (profile.runAltitude === null) {
    out.aimWorld.y = 0
    if (out.aimWorld.lengthSq() < MIN_ERROR) out.aimWorld.set(0, 0, -1)
    else out.aimWorld.normalize()
    return
  }
  const err = profile.runAltitude - self.state.position.y
  out.aimWorld.y = 0
  if (out.aimWorld.lengthSq() < MIN_ERROR) out.aimWorld.set(0, 0, -1)
  else out.aimWorld.normalize()
  const slope = profile.runSlope ?? 1
  // 【要有阻尼項，不然是長週期振盪】純比例控制配上俯仰的遲滯，實測一台
  // G4M 被命令飛 50 m 時在 86～156 m 之間以 10 秒的週期上下飄，高度與速度
  // 反相 —— 典型的能量交換。誤差全程是負的（一直在命令下降）而高度照樣
  // 往上，所以問題不在增益大小，是**沒有微分項**。
  //
  // 【`RUN_ALT_DAMP` 的單位是秒】`err − damp · vy` 等於「照現在的升降率，
  // damp 秒之後還差多少」—— 前瞻，不是憑空的係數。
  const vy = self.state.velocity.y
  out.aimWorld.y = Math.max(-slope, Math.min(slope, (err - RUN_ALT_DAMP * vy) / 400))
  out.aimWorld.normalize()
}

/** 常用的角度單位，給 profile 寫值用。 */
export const STRIKE_DEG = DEG
