import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { WEP_THROTTLE } from '../physics/propulsion'
import { DEG } from '../core/math'
import type { FireAim } from './fire'
import { NO_INTERCEPT, solveLead } from '../world/lead'
import { PROJECTILE_LIFETIME } from '../world/Projectiles'
import { sustainedTurnRate } from '../analysis/envelope'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import type { Ship } from '../world/ships'
import type { GroundTarget } from '../world/groundTargets'
import type { Team } from '../world/World'
import type { GroundUnitId } from '../render/geometry/ground'

/**
 * # AI 的對艦索敵與掃射
 *
 * **與空戰完全平行的一條路徑。只在空戰那一側回傳「沒有目標」時才問。**
 * 有敵機在、或這一場沒有船，程式碼路徑與沒有這個模組時相同。
 *
 * `selectTarget`／`targetScore`（`ai/target.ts`）不涉入：它評的每一項
 * （機會、威脅、切換成本、視野）對一艘不會轉向、以砲位而非機首還手的船
 * 都沒有意義，而把船塞進 `TargetCandidate` 要給它一具假的 `Aircraft`。
 *
 * ## 目標是砲位
 *
 * 掃射艦隊做的事就是打掉防空砲，而砲位是這一期唯一打得掉的東西（船體要等
 * 魚雷）。瞄船體中心會讓飛機對著一塊沒有東西的甲板打。砲位全打光的船才
 * 改瞄船體 —— 那是魚雷的目標，也是攻擊航路的起點。
 *
 * ## 索敵不看自己有沒有武器
 *
 * 「能不能鎖定」與「打不打得動」是兩層。一式陸攻沒有固定槍，但它低空掠過
 * 去時側方與機腹的 20 mm 銃手會打砲位（`world/turrets.ts` 的 `pickTarget`）
 * —— 用武器擋索敵會讓那一整段行為消失。
 *
 * ## 這一層不做的
 *
 * - 不迴避彈幕。威脅評估只認得飛機。
 * - 不投雷、不投彈。
 * - 不編隊攻擊。僚機仍然走站位那一格。
 */

/**
 * 多遠之內才會把船當目標，m。
 *
 * 【為什麼要有上限】不擋的話，開場在 20 km 外、身邊沒有敵機的 AI 會立刻
 * 脫離編隊一路飛向艦隊，而那一段路上它什麼都不做。**起始值。**
 */
export const SHIP_ATTACK_RANGE = 8000

/**
 * 進到這麼近就拉起來脫離，m。
 *
 * 【它守的是撞船】撞船現在是致命的（`World.hitsShip`），而俯衝掃射的 AI
 * 沒有任何東西會叫它拉桿 —— `applySafety` 看的是地形與海面，不是船。
 *
 * 【它同時是落彈瞄準的下限】`bombRun.ts` 在這個斜距交還瞄準點，掛彈的
 * 戰鬥機能壓到多近才放手由它決定。100 m 讓側翼進場的零戰投得出彈；盟 M3
 * 無頭跑 240 秒，撞船與落海都是 0 —— 安全層在那之前就把機首拉起來了。
 * **起始值，由試飛裁定。**
 */
export const SHIP_BREAK_RANGE = 100

/** 機首與預瞄方向的夾角小於這個才開火，rad。 */
export const SHIP_FIRE_CONE = 3 * DEG

/**
 * 在錐內就開火，順手把夾角寫進 `aim`。
 *
 * 【為什麼要回報夾角】掃射也吃點放的工作週期（`ai/fire.ts` 的 `burstDuty`）——
 * 瞄得準就咬住，瞄得爛只點兩下，與打飛機同一條規則。不回報的話呼叫端得再算
 * 一次 acos，而這是每個物理步都跑的路徑。
 */
function fireWithinCone(dot: number, aim: FireAim | undefined): boolean {
  if (aim !== undefined) aim.error = Math.acos(Math.min(1, Math.max(-1, dot)))
  return dot > Math.cos(SHIP_FIRE_CONE)
}

/** 對地掃射脫離時的固定爬升角。它只作用在已飛越目標的離場段，不是低空偏好。 */
export const GROUND_STRAFE_EGRESS_CLIMB = 6 * DEG

/**
 * 船體瞄點比水線高多少，m。
 *
 * 【為什麼不是 0】艦體盒的原點在**水線**上（與 `shipAA.ts` 同一套座標），
 * 瞄它等於瞄海面。**只在砲位全打光、而且艦級沒有瞄點（或還沒挑）時用到**
 * —— 平常瞄的是砲位本身，砲位打光後瞄 `ShipClass.aimPoints`。
 */
export const SHIP_AIM_HEIGHT = 12

/**
 * 鎖定的東西：哪一艘船的哪一個砲位。
 *
 * `gun` 為 −1 代表「這艘船的砲位都打光了，機槍改瞄船體」。`point` 是
 * `ShipClass.aimPoints` 的索引，**一律會挑**：砲位打光後機槍瞄它，掛彈的
 * 戰鬥機落彈也瞄它。−1 = 還沒挑（瞄船心）。
 */
export interface ShipAim {
  ship: number
  gun: number
  point: number
}

export type GroundStrafePhase = 'approach' | 'egress'

/**
 * 戰鬥機的一次對地掃射航次。
 *
 * `armed` 代表這一趟曾把目標帶進武器射程；只有它成立後目標跑到身後，才算
 * 真正飛越。這可避免 AI 一開始就在近距離背對目標時，誤把「尚未進場」當成
 * 「已經飛越」。`target` 用物件身分防止換目標時沿用上一趟的離場承諾。
 */
export interface GroundStrafeState {
  phase: GroundStrafePhase
  armed: boolean
  target: GroundTarget | Aircraft | null
  readonly egressHeading: Vector3
  /** 本決策拍算出的回頭門檻，m；Infinity = 當下還做不出可持續迴轉。 */
  reattackRange: number
  /** 當前對地預瞄解的飛行時間，s；離場或無解時為 NO_INTERCEPT。 */
  interceptTime: number
}

export function createGroundStrafeState(): GroundStrafeState {
  return {
    phase: 'approach',
    armed: false,
    target: null,
    egressHeading: new Vector3(0, 0, -1),
    reattackRange: 0,
    interceptTime: NO_INTERCEPT,
  }
}

export function resetGroundStrafe(state: GroundStrafeState): void {
  state.phase = 'approach'
  state.armed = false
  state.target = null
  state.egressHeading.set(0, 0, -1)
  state.reattackRange = 0
  state.interceptTime = NO_INTERCEPT
}

export function createShipAim(): ShipAim {
  return { ship: -1, gun: -1, point: -1 }
}

/**
 * 粗篩的餘裕，m。取最長的艦體半長（Essex 133 m）再放寬。
 *
 * 【它必須寬到不會假陰性】粗篩用船心、比距離用砲位，兩者最多差一個艦體
 * 半長。算小了的症狀是「艦艏的砲位永遠不會被選中」，而且沒有任何錯誤。
 */
const HULL_SLACK = 200

const P0 = /* @__PURE__ */ new Vector3()

/**
 * 挑一個對艦目標：敵隊、還浮著、在接戰半徑內。
 *
 * **先比艦艇價值，價值相同才比距離。** 選中之後在**那一艘**上取離自己最近
 * 的砲位；砲位全打光就改瞄船體（魚雷的目標，也是攻擊航路的起點）。
 *
 * 【為什麼價值優先，而不是一律取最近的】一支艦隊的護衛幕本來就擋在主力
 * 前面 —— 只比距離的話，攻擊機永遠先咬到最外圈的驅逐艦，而那不是任何一支
 * 雷擊隊會做的事。倫內爾島打的是重巡、沖繩打的是航母。
 *
 * 【價值就是艦級的血量】Essex 60,000 ／ Wichita 40,000 ／ Fletcher 20,000
 * —— 那本來就是「這艘船有多重要」的量。**不另開一個 `value` 欄位**：多一格
 * 就多一個會與血量不同步的地方。
 *
 * 【用艦級的血量，不是剩餘血量】半沉的航母仍然是第一順位。改用剩餘血量的話
 * 攻擊機會在打到一半時掉頭去找完好的驅逐艦。
 *
 * 【為什麼不像空戰那樣評分】船不會轉向、不會逃，彼此也沒有「誰比較威脅我」
 * 的差別。價值加距離兩層就夠，多一套評分只是多一組要調的旋鈕。
 *
 * 熱路徑（決策拍，10 Hz）：不配置。
 */
export function pickShipTarget(
  selfPos: Vector3, selfTeam: Team, ships: readonly Ship[], out: ShipAim,
  selfVel: Vector3 | null = null,
): boolean {
  const heldShip = out.ship
  const heldPoint = out.point
  out.ship = -1
  out.gun = -1
  out.point = -1
  const rangeSq = SHIP_ATTACK_RANGE * SHIP_ATTACK_RANGE
  let bestValue = -1
  let bestSq = Infinity
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i]!
    if (!s.alive || s.team === selfTeam) continue
    const value = s.cls.hp
    // 已經鎖定一艘更值錢的就不必再算這一艘的砲位
    if (value < bestValue) continue
    // 粗篩：船心離得比「接戰半徑 ＋ 一個艦體半長」還遠就一定不在範圍內
    const coarse = SHIP_ATTACK_RANGE + HULL_SLACK
    if (selfPos.distanceToSquared(s.position) > coarse * coarse) continue

    // 這一艘離自己多遠：取它最近的砲位，砲位全沒了取船體
    let nearSq = Infinity
    let gun = -1
    for (let g = 0; g < s.guns.length; g++) {
      if (!s.guns[g]!.alive) continue
      const d = selfPos.distanceToSquared(gunWorld(s, g, P0))
      if (d < nearSq) { nearSq = d; gun = g }
    }
    // 【瞄點一律挑】機槍有砲位就打砲位，但掛彈戰鬥機的落彈瞄的是這一點
    const point = pickHullPoint(s, selfPos, selfVel, i === heldShip ? heldPoint : -1)
    if (gun < 0) nearSq = selfPos.distanceToSquared(shipAimAt(s, -1, P0, point))

    if (nearSq > rangeSq) continue
    // 同價值時才比距離
    if (value === bestValue && nearSq >= bestSq) continue
    bestValue = value
    bestSq = nearSq
    out.ship = i
    out.gun = gun
    out.point = point
  }
  return out.ship >= 0
}

const P1 = /* @__PURE__ */ new Vector3()

/**
 * 砲位打光的船上挑一個掃射瞄點（`ShipClass.aimPoints` 的索引）。
 *
 * 【一趟之內不換點】上一拍挑的點還在機首前方、而且在脫離半徑之外，就留著 ——
 * 點與點相隔 50 m 以內，每拍改取最近的話瞄點會在兩點之間來回跳。
 *
 * 【飛越之後換前方的下一點】前方（速度方向）脫離半徑之外最近的那一點；前方
 * 沒有點（正在離場）就取最近的，繞回來時再照前方重挑。沒給速度時不分前後。
 *
 * 熱路徑（決策拍，10 Hz）：不配置。
 */
function pickHullPoint(ship: Ship, pos: Vector3, vel: Vector3 | null, held: number): number {
  const n = ship.cls.aimPoints.length
  if (n === 0) return -1
  const breakSq = SHIP_BREAK_RANGE * SHIP_BREAK_RANGE
  if (held >= 0 && held < n) {
    const p = hullAimWorld(ship, held, P1)
    const ahead = vel === null
      || (p.x - pos.x) * vel.x + (p.y - pos.y) * vel.y + (p.z - pos.z) * vel.z > 0
    if (ahead && pos.distanceToSquared(p) > breakSq) return held
  }
  let front = -1
  let frontSq = Infinity
  let nearest = -1
  let nearestSq = Infinity
  for (let k = 0; k < n; k++) {
    const p = hullAimWorld(ship, k, P1)
    const d = pos.distanceToSquared(p)
    if (d < nearestSq) { nearestSq = d; nearest = k }
    const ahead = vel === null
      || (p.x - pos.x) * vel.x + (p.y - pos.y) * vel.y + (p.z - pos.z) * vel.z > 0
    if (ahead && d > breakSq && d < frontSq) { frontSq = d; front = k }
  }
  return front >= 0 ? front : nearest
}

/**
 * 轟炸機挑地面目標。**與 `pickShipTarget` 同一條規則**：價值優先、同價值
 * 比距離，跳過死的與同隊的。地面目標沒有砲位，距離量到它的位置。
 *
 * 【與船分開一支】船那一支要掃砲位、要給戰鬥機掃射用，地面目標沒有那些。
 * 硬併成一支會讓兩邊都多一個「這是船還是建築」的分支。
 *
 * @returns 目標在 `targets` 裡的索引，沒有就 −1
 *
 * 熱路徑（決策拍，10 Hz）：不配置。
 */
export function pickGroundTarget(
  selfPos: Vector3, selfTeam: Team, targets: readonly GroundTarget[], range: number,
  onlyUnit: GroundUnitId | null = null,
): number {
  let best = -1
  let bestValue = -1
  let bestSq = Infinity
  const rangeSq = range * range
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!
    if (!t.alive || t.team === selfTeam) continue
    if (onlyUnit !== null && t.unit.id !== onlyUnit) continue
    if (t.value < bestValue) continue
    const d = selfPos.distanceToSquared(t.position)
    if (d > rangeSq) continue
    if (t.value === bestValue && d >= bestSq) continue
    best = i
    bestValue = t.value
    bestSq = d
  }
  return best
}

/**
 * 一個砲位的世界座標。就地寫 `out`。
 *
 * **與 `stepShipGuns` 的槍口、渲染層的槍焰是同一個算法** —— 三處分開寫會
 * 漂開，症狀是「打的地方跟看到的地方差幾公尺」。
 */
export function gunWorld(ship: Ship, gunIndex: number, out: Vector3): Vector3 {
  const g = ship.guns[gunIndex]
  if (g === undefined) return shipAimPoint(ship, out)
  return out.copy(g.zone.position).applyQuaternion(ship.orientation).add(ship.position)
}

/** 船體的瞄點：位置抬到上層建築的高度帶。 */
export function shipAimPoint(ship: Ship, out: Vector3): Vector3 {
  return out.set(ship.position.x, ship.position.y + SHIP_AIM_HEIGHT, ship.position.z)
}

/** 艦級的第 `k` 個掃射瞄點，世界座標。索引無效時退回船心的瞄點。 */
export function hullAimWorld(ship: Ship, k: number, out: Vector3): Vector3 {
  const p = ship.cls.aimPoints[k]
  if (p === undefined) return shipAimPoint(ship, out)
  return out.copy(p).applyQuaternion(ship.orientation).add(ship.position)
}

/** 鎖到砲位就瞄砲位；砲位打光瞄 `point` 那個船體瞄點，還沒挑就瞄船心。 */
export function shipAimAt(ship: Ship, gunIndex: number, out: Vector3, point = -1): Vector3 {
  if (gunIndex >= 0) return gunWorld(ship, gunIndex, out)
  return point >= 0 ? hullAimWorld(ship, point, out) : shipAimPoint(ship, out)
}

const S = /* @__PURE__ */ makeScratch(5)
const FWD = /* @__PURE__ */ new Vector3(0, 0, -1)
/** 方向退化的下限，m。與 `rallyAim` 同一個手法。 */
const MIN_ERROR = 1e-6

/**
 * 掃射一個目標。寫滿整個 `Command`。
 *
 * 三段：**遠了就飛過去、對準了就開火、太近就拉起來**。
 *
 * 【脫離優先於開火】兩者同時成立時（貼著船還對得很準）選脫離 —— 多打的
 * 那零點幾秒換不到一架飛機。
 *
 * 【`firing` 對沒有固定槍的機種是空轉】`World.fire` 跑的是 `battery.mounts`，
 * 空陣列就是零次迭代。它飛這一趟是為了讓自己的銃手打得到砲位。
 *
 * **呼叫端仍然要在之後套 `applySafety`**（spec §5.2：命令不豁免安全層）。
 *
 * 熱路徑：不配置。不修改 `self`，也不修改 `ship`。
 */
export function shipAttackCommand(
  self: Aircraft, ship: Ship, gunIndex: number, out: Command, point = -1, fireAim?: FireAim,
): void {
  const aim = shipAimAt(ship, gunIndex, S.v[0]!, point)
  const tv = S.v[3]!.set(0, 0, -1).applyQuaternion(ship.orientation).multiplyScalar(ship.speed)
  strafeCommand(self, aim, tv.x, tv.y, tv.z, out, fireAim)
}

/**
 * 掃射一個地面目標。與 `shipAttackCommand` 同一支掃射核心，目標不動。
 *
 * 【瞄命中盒的半高】瞄地面高度的話彈道打在停放機腳下的土裡。
 *
 * **呼叫端仍然要在之後套 `applySafety`** —— 俯衝掃射追到地面的風險由安全層擋。
 */
export function groundAttackCommand(
  state: GroundStrafeState, self: Aircraft, target: GroundTarget, replan: boolean, out: Command,
  fireAim?: FireAim,
): void {
  const p = target.position
  const aim = S.v[0]!.set(p.x, (p.y + target.impactY) / 2, p.z)
  groundStrafeCommand(state, target, self, aim, 0, 0, 0, replan, out, fireAim)
}

/**
 * 掃射仍由起飛腳本控制的飛機。它在 `TargetBoard` 裡是 Aircraft，但飛行方式仍是
 * 地面滑行／滾行，所以要走有近距脫離的掃射核心，不能用會一路追尾的空戰控制。
 */
export function groundedAircraftAttackCommand(
  state: GroundStrafeState, self: Aircraft, target: Aircraft, replan: boolean, out: Command,
): void {
  const p = target.state.position
  const v = target.state.velocity
  groundStrafeCommand(state, target, self, p, v.x, v.y, v.z, replan, out)
}

/**
 * 這架機在目前高度與速度下，完成下一次對地進場至少要拉開的水平距離。
 *
 * 槍的準備距離取「槍口初速＋飛機前進速度」在彈丸壽命內能覆蓋的距離；其後
 * 再加一個 180° 持續迴轉的直徑。回傳 Infinity 不是錯誤，而是此速度下連
 * 1 g 都無法維持或沒有可持續轉彎解，必須先沿離場方向消耗速度。
 */
export function groundStrafeReattackRange(self: Aircraft): number {
  const tas = self.state.velocity.length()
  const omega = sustainedTurnRate(self.spec, self.state.position.y, tas)
  if (!(omega > 0)) return Infinity
  const weaponPreparation = (
    self.spec.battery.sight.muzzleVelocity + tas
  ) * PROJECTILE_LIFETIME
  return weaponPreparation + 2 * tas / omega
}

function enterGroundEgress(state: GroundStrafeState, self: Aircraft): void {
  state.phase = 'egress'
  state.armed = false
  state.interceptTime = NO_INTERCEPT
  const heading = state.egressHeading.copy(self.state.velocity)
  heading.y = 0
  if (heading.lengthSq() < MIN_ERROR) {
    heading.copy(FWD).applyQuaternion(self.state.orientation)
    heading.y = 0
  }
  if (heading.lengthSq() < MIN_ERROR) heading.set(0, 0, -1)
  else heading.normalize()
  state.reattackRange = groundStrafeReattackRange(self)
}

function commandGroundEgress(state: GroundStrafeState, out: Command): void {
  const h = state.egressHeading
  const c = Math.cos(GROUND_STRAFE_EGRESS_CLIMB)
  out.aimWorld.set(h.x * c, Math.sin(GROUND_STRAFE_EGRESS_CLIMB), h.z * c)
  out.throttle = WEP_THROTTLE
  out.brake = 0
  out.firing = false
}

/**
 * 地面物件專用的掃射航次。船仍走原本的近距離拉起，避免把對艦既有行為與
 * 掛彈瞄準一起改掉。
 */
function groundStrafeCommand(
  state: GroundStrafeState,
  target: GroundTarget | Aircraft,
  self: Aircraft,
  aim: Vector3,
  tvx: number,
  tvy: number,
  tvz: number,
  replan: boolean,
  out: Command,
  fireAim?: FireAim,
): void {
  if (state.target !== target) {
    resetGroundStrafe(state)
    state.target = target
  }

  const los = S.v[1]!.copy(aim).sub(self.state.position)
  const horizontalRange = Math.hypot(los.x, los.z)

  if (state.phase === 'egress') {
    if (replan || !(state.reattackRange > 0)) {
      state.reattackRange = groundStrafeReattackRange(self)
    }
    if (horizontalRange < state.reattackRange) {
      commandGroundEgress(state, out)
      return
    }
    state.phase = 'approach'
    state.armed = false
    state.reattackRange = 0
  }

  const range = los.length()
  if (range < SHIP_BREAK_RANGE || range < MIN_ERROR) {
    enterGroundEgress(state, self)
    commandGroundEgress(state, out)
    return
  }

  // 目標在速度向量前方才有資格把本航次上膛；一開始背對近距離目標仍應回頭
  // 進場，而不是誤判為剛飛越。目標移動量一併算進閉合速度。
  const relVelocity = S.v[3]!.set(tvx, tvy, tvz).sub(self.state.velocity)
  const closing = -relVelocity.dot(los) / range
  const wasArmed = state.armed

  const lead = S.v[4]!
  const t = solveLead(los, relVelocity, self.spec.battery.sight.muzzleVelocity, lead)
  state.interceptTime = t
  const weaponReach = t !== NO_INTERCEPT && t <= PROJECTILE_LIFETIME
  if (weaponReach && closing > 0) state.armed = true

  // 曾進入射程後閉合速度翻成負值，就是實際飛過最近點。即使 Worker 為了
  // 地形提早把航線抬開、沒有鑽進 100 m，也要在此鎖住離場，不能下一格回瞄。
  if (wasArmed && closing <= 0) {
    enterGroundEgress(state, self)
    commandGroundEgress(state, out)
    return
  }

  los.divideScalar(range)
  out.aimWorld.copy(los)
  out.throttle = WEP_THROTTLE
  out.brake = 0
  if (!weaponReach) {
    out.firing = false
    return
  }
  const nose = S.v[2]!.copy(FWD).applyQuaternion(self.state.orientation)
  out.firing = fireWithinCone(nose.dot(lead), fireAim)
}

/**
 * 掃射的核心：遠了就飛過去、對準了就開火、太近就拉起來。
 *
 * @param aim 瞄點，世界座標。**不可以是 `S.v[1]`…`S.v[4]`** —— 那幾格在這裡改寫
 * @param tvx 目標速度，m/s
 */
function strafeCommand(
  self: Aircraft, aim: Vector3, tvx: number, tvy: number, tvz: number, out: Command,
  fireAim?: FireAim,
): void {
  const los = S.v[1]!.copy(aim).sub(self.state.position)
  const range = los.length()

  out.throttle = WEP_THROTTLE
  out.brake = 0

  // ── 脫離 ──────────────────────────────────────────────
  //
  // 【往上，而且保留現在的水平方向】單純「機首朝上」會讓飛機在船正上方
  // 拉成一個垂直圓、然後再掉回來。保留水平分量才是掠過去。
  if (range < SHIP_BREAK_RANGE || range < MIN_ERROR) {
    const fwd = S.v[2]!.copy(FWD).applyQuaternion(self.state.orientation)
    fwd.y = 0
    if (fwd.lengthSq() < MIN_ERROR) fwd.set(0, 0, -1)
    else fwd.normalize()
    // 30° 爬升 —— 夠拉開，又不會把速度全部換成高度
    out.aimWorld.set(fwd.x * 0.866, 0.5, fwd.z * 0.866).normalize()
    out.firing = false
    return
  }

  los.divideScalar(range)
  out.aimWorld.copy(los)

  // ── 開火 ──────────────────────────────────────────────
  //
  // 【射程判準是彈丸飛不飛得到】與空戰的 `shouldFire` 同一條規則：解得出
  // 攔截點，而且彈丸活得夠久飛到那裡。寫死一個距離的話，槍口初速不同的
  // 機種共用同一個射程，而那個數字只對訂它的那一台成立。
  //
  // 【目標的速度要進去】船 8 m/s 在一秒的彈道上是 8 m，比船寬小，但攔截解
  // 本來就吃得下它 —— 少給一個已經有的量沒有好處。地面目標給 0
  const sv = S.v[3]!.set(tvx, tvy, tvz).sub(self.state.velocity)
  // 【借用 los 那一格】它已經寫進 `out.aimWorld`，之後不再用到
  const rel = S.v[1]!.copy(aim).sub(self.state.position)
  const lead = S.v[4]!
  const t = solveLead(rel, sv, self.spec.battery.sight.muzzleVelocity, lead)
  if (t === NO_INTERCEPT || t > PROJECTILE_LIFETIME) {
    out.firing = false
    return
  }

  // 【用機首而不是瞄準線】`aimWorld` 是**想要**的方向，機首是**現在**的
  // 方向。用前者的話飛機在掉頭途中就會開火，子彈往天空飛。
  const nose = S.v[2]!.copy(FWD).applyQuaternion(self.state.orientation)
  out.firing = fireWithinCone(nose.dot(lead), fireAim)
}
