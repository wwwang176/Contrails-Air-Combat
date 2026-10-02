import { Vector3 } from 'three'
import { DEG } from '../core/math'
import { bankAttitude, createBankAttitude } from '../control/FlightDirector'
import { THROTTLE_FLOOR } from '../input/throttle'
import { RHO0 } from '../physics/atmosphere'
import { WEP_THROTTLE } from '../physics/propulsion'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import type { GroundUnitId } from '../render/geometry/ground'
import type { GroundTarget } from '../world/groundTargets'
import type { Team } from '../world/World'

/**
 * # AI 的俯衝投彈
 *
 * 只給 `spec.diveBomber` 的機種（Ju 87）。其他機種的投彈走水平轟炸（`ai/bombRun.ts`）或掛彈戰鬥機的
 * 掃射（`ai/shipAttack.ts`），這裡一個字都不碰。
 *
 * ```
 * 平飛 ──對準方位、到了水平距離──▶ 俯衝 ──離目標 DIVE_RELEASE_HEIGHT──▶ 拉起 ──▶ 爬離 ──▶ 回頭再平飛
 * ```
 *
 * 【只追視線，不修正落點】AI 是陪玩家玩的，姿態演出來就好：機翼放平、機鼻壓到約 75°、投彈、拉起。
 * 落點修正（`stepBombAim`）在高處的修正量很大，會把機鼻推向正下方並引來大滾轉；只追視線時滾轉恆為 0。
 *
 * 所有數值是起始值，由試飛裁定。
 */

/** 進場幾何用的俯衝角：從目標上空往回推的直線俯衝角 */
export const DIVE_ANGLE = 75 * DEG

/**
 * 瞄準俯仰的下限（往下為正的絕對值）。
 *
 * 【為什麼不能更陡】坡度角在機首接近垂直時沒有定義（`FlightDirector` 的 `BankAttitude.authority`
 * 趨近 0），機翼改平抓不到東西，滾轉來不及。
 */
export const DIVE_ANGLE_MAX = 85 * DEG

/**
 * 進場時離目標的視線角（機身看目標的俯角）超過這個就不壓機鼻。
 *
 * 【為什麼】已經飛到目標正上方附近，壓下去只會比 `DIVE_ANGLE_MAX` 更陡；改走脫離、拉開再回頭。
 */
export const DIVE_TOO_STEEP = 80 * DEG

/**
 * 機鼻從水平壓到俯衝角那段飛掉的水平距離，換成秒（乘上真速）。
 *
 * 【它決定俯衝的平台角】機鼻壓下去約 4.5 秒、掉 350 m、前進 400 m，之後直線飛向目標，所以平台角就是
 * 壓完那一刻的視線角。預留 1.5 s → 約 −83°、2 s → −80°、3.4 s → −75°。
 */
export const DIVE_LEAD_SECONDS = 3.4

/** 離目標至少這麼高才俯衝，m。低於它的話俯衝段太短，拉起之前看不出是俯衝 */
export const DIVE_MIN_HEIGHT = 1300

/** 機首與目標方位的夾角小於這個才壓機鼻，rad。對不準就壓下去會斜著衝 */
export const DIVE_ALIGN = 10 * DEG

/**
 * 壓機鼻時坡度的絕對值要小於這個，rad。
 *
 * 【為什麼要看坡度】`FlightDirector` 的 `upright` 只把坡度夾在 ±80° 以內，不會把機翼鎖平。目標在側面、
 * 平飛還在轉彎時，方位對準了但機翼還斜著，壓下去之後帶著六十幾度的坡度一路俯衝到投彈。
 */
export const DIVE_ENTRY_BANK = 15 * DEG

/**
 * 離目標的高度到這裡開始要求投彈，m。
 *
 * 【不能再低】俯衝 75°、IAS 116～130 m/s 時，從這個高度開始拉起最低離地約 185 m；再低或再快，安全層
 * （`applySafety`）會在拉起途中接管。
 */
export const DIVE_RELEASE_HEIGHT = 500

/**
 * 低於投彈高度這麼多還沒投出去，就放棄這一趟、拉起，m。
 *
 * 【為什麼不能在要求投彈的同一步就轉拉起】安全層接管時會清掉 `bombing`，一次投彈要求可能被吃掉。
 * 要等彈艙真的空了才算投完；沒投成又不放棄的話，會一直俯衝下去。
 */
export const DIVE_ABORT_MARGIN = 100

/**
 * 俯衝中減速板開始打開的 IAS ÷ vne，與全開的寬度。
 *
 * 【為什麼要擋】IAS 到 0.74 倍 vne 時，投彈高度剛好落在安全層「所需高度」附近，安全層會在拉起途中接管；
 * 擋在 0.65 倍時安全層不介入。
 */
export const DIVE_IAS_RATIO = 0.65
export const DIVE_IAS_BAND = 0.2

/** 拉起時機首抬到的仰角；航跡角回到 `DIVE_PULLOUT_DONE` 以上才算拉起完成，rad */
export const DIVE_PULLOUT_PITCH = 20 * DEG
export const DIVE_PULLOUT_DONE = 5 * DEG

/**
 * 壓機鼻時真速要不低於這個，m/s。
 *
 * 【為什麼要看速度】低速時推頭沒力：70 m/s 上下壓機鼻，滾轉會飄到 40～68°、機鼻衝過 −85°；
 * 90 m/s 以上滾轉恆為 0。脫離的爬升會把速度耗到 70 m/s 上下，回平飛要有加速的距離。
 */
export const DIVE_ENTRY_SPEED = 85

/**
 * 脫離的爬升角，rad；爬升角隨真速收斂：不低於 `DIVE_CLIMB_FULL_SPEED` 全爬，到 `DIVE_CLIMB_MIN_SPEED`
 * 放平，之間線性，m/s。
 *
 * 【為什麼要收斂】12° 一路爬把速度耗到接近失速，安全層（`applySafety`）用失速接管把機首壓下去，
 * 還要在轉彎時承受更大的失速速度。放平才加得回速度。
 */
export const DIVE_EGRESS_CLIMB = 12 * DEG
export const DIVE_CLIMB_FULL_SPEED = 80
export const DIVE_CLIMB_MIN_SPEED = 65

/**
 * 脫離時飛到離目標 `DIVE_EGRESS_RANGE` 公尺就掉頭朝目標，m：繞著目標盤旋爬高，不會一路飛出戰場。
 * 回平飛至少要離目標 `DIVE_REARM_RANGE` 公尺，m：留得出轉彎、對正與加速到 `DIVE_ENTRY_SPEED` 的空間。
 */
export const DIVE_EGRESS_RANGE = 3500
export const DIVE_REARM_RANGE = 2500

/** 平飛維持高度的前瞻時間，s。`誤差 − 前瞻 × 升降率` 除以 400 就是瞄準方向的仰角 */
export const DIVE_LEVEL_DAMP = 6

/** 挑目標的名次輪替數：`selfIndex` 對它取餘數，各架挑不同的目標 */
export const DIVE_RANK_COUNT = 4

/**
 * 在離目標 `h` 公尺高、真速 `tas` 時，水平距離進到這裡就壓機鼻。
 *
 * 前一項是從 `h` 直線俯衝 `DIVE_ANGLE` 到目標需要的水平距離，後一項是機鼻壓下去那段飛掉的距離。
 * 高度為零或負時只剩後一項。
 */
export function diveEntryRange(h: number, tas: number): number {
  return Math.max(0, h) / Math.tan(DIVE_ANGLE) + tas * DIVE_LEAD_SECONDS
}

/**
 * 挑俯衝的目標：敵隊、活著、在 `range` 以內，依（價值高優先、同價值近優先、再同則索引小優先）排序，
 * 取第 `rank` 名（0 起算）；候選不夠就取最後一名。沒有候選回 −1。
 *
 * 排序與 `pickGroundTarget` 相同。各架用不同的 `rank`，免得同時衝向同一點。
 *
 * 【距離從 `refPos` 量，呼叫端要給各架共用的基準點】各架各用自己的位置的話，排序會不同，不同名次不保證
 * 挑到不同的目標。範圍也從基準點量。
 *
 * @param onlyUnit 只收這一種單位（任務指定的優先地面單位）；null = 全部
 *
 * 熱路徑（決策拍）：不配置。每一名掃一遍（`rank` ≤ 3、候選一百多），不排序、不建陣列。
 */
export function pickDiveTarget(
  refPos: Vector3, team: Team, targets: readonly GroundTarget[], range: number, rank: number,
  onlyUnit: GroundUnitId | null = null,
): number {
  const rangeSq = range * range
  let last = -1
  let lastValue = Infinity
  let lastSq = -Infinity
  for (let r = 0; r <= rank; r++) {
    let best = -1
    let bestValue = -1
    let bestSq = Infinity
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!
      if (!t.alive || t.team === team) continue
      if (onlyUnit !== null && t.unit.id !== onlyUnit) continue
      const d = refPos.distanceToSquared(t.position)
      if (d > rangeSq) continue
      // 必須排在上一名之後
      if (last >= 0 && !(t.value < lastValue
        || (t.value === lastValue && (d > lastSq || (d === lastSq && i > last))))) continue
      if (best >= 0 && !(t.value > bestValue || (t.value === bestValue && d < bestSq))) continue
      best = i
      bestValue = t.value
      bestSq = d
    }
    if (best < 0) break
    last = best
    lastValue = bestValue
    lastSq = bestSq
  }
  return last
}

export type DivePhase = 'level' | 'dive' | 'pullout' | 'egress'

/** 一架飛機的俯衝投彈狀態。**由 `AiController` 持有**，換場時重設 */
export interface DiveBombState {
  phase: DivePhase
  /**
   * 瞄準點，世界座標。平飛與脫離時是最近一次看到的目標位置；**進入俯衝那一刻鎖定**，俯衝與拉起
   * 不再讀目標：目標中途被別人炸掉或換成別的，這一趟照樣飛完。
   */
  readonly aim: Vector3
  /** 平飛維持的高度，m。0 = 還沒取（平飛的第一步取當下的高度） */
  holdAlt: number
}

export function createDiveBombState(): DiveBombState {
  return { phase: 'level', aim: new Vector3(), holdAlt: 0 }
}

export function resetDiveBomb(s: DiveBombState): void {
  s.phase = 'level'
  s.aim.set(0, 0, 0)
  s.holdAlt = 0
}

/** 方向退化的下限 */
const MIN_ERROR = 1e-6

/** 模組私有的暫存。熱路徑：不配置 */
const NOSE = /* @__PURE__ */ new Vector3()
const BANK = /* @__PURE__ */ createBankAttitude()

/** 平飛維持高度時，瞄準仰角的上限（sin） */
const LEVEL_SLOPE = 0.3

/** 機首的水平投影方向（單位向量）寫進 `out`；機首垂直時退回 −Z */
function noseHorizontal(self: Aircraft, out: Vector3): void {
  out.set(0, 0, -1).applyQuaternion(self.state.orientation)
  const len = Math.hypot(out.x, out.z)
  if (len > MIN_ERROR) out.set(out.x / len, 0, out.z / len)
  else out.set(0, 0, -1)
}

/** 現在的水平航向（速度的水平投影，單位向量）寫進 `out`；幾乎不動時用機首 */
function headingHorizontal(self: Aircraft, out: Vector3): void {
  const v = self.state.velocity
  const len = Math.hypot(v.x, v.z)
  if (len > MIN_ERROR) out.set(v.x / len, 0, v.z / len)
  else noseHorizontal(self, out)
}

/**
 * 推進一步。寫滿 `out` 的瞄準、油門、減速板、`upright` 與 `bombing`（`firing` 與 `trackTurn` 恆為 false）。
 *
 * 平飛 → 俯衝 → 拉起 → 爬離 → 回頭再平飛，見檔頭。**呼叫端仍然要在之後套 `applySafety`**。
 *
 * @param target 目標；平飛與脫離讀它的位置，俯衝與拉起不讀（用鎖定的 `state.aim`）。沒有就沿用上一個位置
 * @param loaded 彈艙裡還有東西（含正在連投的佇列）。炸彈出去了它就變 false
 *
 * 熱路徑（每個物理步）：不配置。
 */
export function stepDiveBomb(
  state: DiveBombState, self: Aircraft, target: GroundTarget | null, loaded: boolean, out: Command,
): void {
  out.firing = false
  out.bombing = false
  out.upright = false
  out.trackTurn = false
  out.brake = 0
  out.throttle = WEP_THROTTLE
  if (target !== null && (state.phase === 'level' || state.phase === 'egress')) {
    state.aim.copy(target.position)
  }
  switch (state.phase) {
    case 'level': stepLevel(state, self, loaded, out); break
    case 'dive': stepDive(state, self, loaded, out); break
    case 'pullout': stepPullout(state, self, out); break
    case 'egress': stepEgress(state, self, loaded, out); break
  }
}

/**
 * 平飛：朝目標水平飛、維持高度。條件都成立就轉俯衝；沒有條件俯衝（空手、不夠高、飛到目標上方附近）
 * 就走脫離。
 */
function stepLevel(state: DiveBombState, self: Aircraft, loaded: boolean, out: Command): void {
  const p = self.state.position
  const v = self.state.velocity
  const dx = state.aim.x - p.x
  const dz = state.aim.z - p.z
  const range = Math.hypot(dx, dz)
  const h = p.y - state.aim.y

  if (state.holdAlt === 0) state.holdAlt = p.y
  if (range > MIN_ERROR) out.aimWorld.set(dx / range, 0, dz / range)
  else headingHorizontal(self, out.aimWorld)
  // 高度控制：前瞻的比例控制，與水平轟炸的定高同一個形式（`ai/strikeRun.ts` 的 `applyRunAltitude`）
  const err = state.holdAlt - p.y
  out.aimWorld.y = Math.max(-LEVEL_SLOPE, Math.min(LEVEL_SLOPE, (err - DIVE_LEVEL_DAMP * v.y) / 400))
  out.aimWorld.normalize()

  if (!loaded || h < DIVE_MIN_HEIGHT || range < h / Math.tan(DIVE_TOO_STEEP)) {
    state.phase = 'egress'
    return
  }
  const tas = v.length()
  if (tas < DIVE_ENTRY_SPEED || range > diveEntryRange(h, tas)) return
  noseHorizontal(self, NOSE)
  const aligned = range > MIN_ERROR
    && (NOSE.x * dx + NOSE.z * dz) / range >= Math.cos(DIVE_ALIGN)
  if (aligned && Math.abs(bankAttitude(self.state.orientation, BANK).angle) <= DIVE_ENTRY_BANK) {
    state.phase = 'dive'
  }
}

/**
 * 俯衝：瞄準點是鎖定的那一點，只追視線、不修正落點。機翼放平、油門怠速、減速板擋速度。到了投彈高度
 * 每一步都要求投彈，等彈艙空了才轉拉起；沒投成就放棄。
 */
function stepDive(state: DiveBombState, self: Aircraft, loaded: boolean, out: Command): void {
  const p = self.state.position
  const lx = state.aim.x - p.x
  const ly = state.aim.y - p.y
  const lz = state.aim.z - p.z
  const hl = Math.hypot(lx, lz)
  if (hl > MIN_ERROR) out.aimWorld.set(lx / hl, 0, lz / hl)
  else noseHorizontal(self, out.aimWorld)
  // 俯仰夾在 −DIVE_ANGLE_MAX 以內，方位不變
  const pitch = Math.max(-DIVE_ANGLE_MAX, Math.atan2(ly, hl))
  const c = Math.cos(pitch)
  out.aimWorld.set(out.aimWorld.x * c, Math.sin(pitch), out.aimWorld.z * c)

  out.upright = true
  out.throttle = THROTTLE_FLOOR
  const ias = Math.sqrt((2 * self.diag.aero.qbar) / RHO0)
  out.brake = Math.max(0, Math.min(1, (ias / self.spec.limits.vne - DIVE_IAS_RATIO) / DIVE_IAS_BAND))

  // 炸彈出去了（或本來就沒有）
  if (!loaded) {
    state.phase = 'pullout'
    return
  }
  const h = p.y - state.aim.y
  if (h > DIVE_RELEASE_HEIGHT) return
  // 沒投成：低得太多、或已經在上升（安全層先拉起來了）
  if (h <= DIVE_RELEASE_HEIGHT - DIVE_ABORT_MARGIN || self.state.velocity.y >= 0) {
    state.phase = 'pullout'
    return
  }
  out.bombing = true
}

/** 拉起：機首抬到 `DIVE_PULLOUT_PITCH`，保持水平航向，油門全開、減速板收。航跡角回正就轉脫離 */
function stepPullout(state: DiveBombState, self: Aircraft, out: Command): void {
  headingHorizontal(self, out.aimWorld)
  const c = Math.cos(DIVE_PULLOUT_PITCH)
  out.aimWorld.set(out.aimWorld.x * c, Math.sin(DIVE_PULLOUT_PITCH), out.aimWorld.z * c)
  const v = self.state.velocity
  const tas = v.length()
  if (tas > MIN_ERROR && Math.asin(v.y / tas) >= DIVE_PULLOUT_DONE) state.phase = 'egress'
}

/**
 * 脫離：以 `DIVE_EGRESS_CLIMB` 爬升。離目標不到 `DIVE_EGRESS_RANGE` 就保持航向（飛離目標），到了就
 * 水平掉頭朝目標。高度、距離、彈艙都夠了就回平飛。
 */
function stepEgress(state: DiveBombState, self: Aircraft, loaded: boolean, out: Command): void {
  const p = self.state.position
  const dx = state.aim.x - p.x
  const dz = state.aim.z - p.z
  const range = Math.hypot(dx, dz)
  if (range >= DIVE_EGRESS_RANGE) out.aimWorld.set(dx / range, 0, dz / range)
  else headingHorizontal(self, out.aimWorld)
  const k = (self.state.velocity.length() - DIVE_CLIMB_MIN_SPEED) / (DIVE_CLIMB_FULL_SPEED - DIVE_CLIMB_MIN_SPEED)
  const climb = DIVE_EGRESS_CLIMB * Math.max(0, Math.min(1, k))
  const c = Math.cos(climb)
  out.aimWorld.set(out.aimWorld.x * c, Math.sin(climb), out.aimWorld.z * c)
  if (loaded && p.y - state.aim.y >= DIVE_MIN_HEIGHT && range >= DIVE_REARM_RANGE) {
    state.phase = 'level'
    state.holdAlt = 0
  }
}
