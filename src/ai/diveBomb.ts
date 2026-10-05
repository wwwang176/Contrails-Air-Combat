import { Vector3 } from 'three'
import { DEG } from '../core/math'
import { bankAttitude, createBankAttitude } from '../control/FlightDirector'
import { THROTTLE_FLOOR } from '../input/throttle'
import { RHO0 } from '../physics/atmosphere'
import { WEP_THROTTLE } from '../physics/propulsion'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import type { GroundUnitId } from '../specs/ground'
import type { GroundTarget } from '../world/groundTargets'
import type { Team } from '../world/team'

/**
 * # AI 的俯衝投彈
 *
 * 只給 `spec.diveBomber` 的機種（Ju 87）。其他機種的投彈走水平轟炸（`ai/bombRun.ts`）或掛彈戰鬥機的
 * 掃射（`ai/shipAttack.ts`），這裡一個字都不碰。
 *
 * ```
 * 平飛 ──飛過目標一小段──▶ 翻轉 ──機鼻對上目標、機翼是正的──▶ 俯衝 ──離目標 DIVE_RELEASE_HEIGHT──▶
 * 拉起 ──▶ 爬離 ──▶ 回頭再平飛
 * ```
 *
 * 【過頂翻轉】平飛飛過目標 `DIVE_FLIP_PAST` 公尺，翻到顛倒、用正過載把機鼻拉過垂直：機鼻指向後下方、
 * 回頭對著目標，機翼自然是正的（翻轉後拉的終點），俯衝不需要再滾。指揮儀自己在這個速度下會選推頭，推頭
 * 拉不過垂直，所以要用 `Command.pull` 強制翻轉後拉。實測飛過 0～150 m、高 1,000～1,300 m，翻完用
 * 約 4 秒、機鼻停在往後下方約 64～78°、無阻力落點離目標 19～65 m。
 *
 * 【只追視線，不修正落點】AI 是陪玩家玩的，姿態演出來就好。落點修正（`stepBombAim`）在高處的修正量很大，
 * 會把機鼻推向正下方並引來大滾轉；只追視線時滾轉恆為 0。
 *
 * 所有數值是起始值，由試飛裁定。
 */

/**
 * 飛過目標這麼遠才翻轉，m。翻轉那一圈機鼻拉過垂直、飛機仍在往前飛（約 250～400 m），所以俯衝線回頭
 * 落在目標附近；飛過得越多，俯衝角越淺、落點越靠後。
 */
export const DIVE_FLIP_PAST = 50

/**
 * 飛過目標時橫向偏離上限，m。翻轉與俯衝都在同一個鉛直面裡，橫向偏離會一路帶到投彈。
 */
export const DIVE_FLIP_LATERAL = 80

/** 飛過目標這麼遠還沒翻（條件一直不成立）就放棄這一趟、改走脫離，m */
export const DIVE_FLIP_MISS = 400

/**
 * 平飛時離目標這麼近就不再朝目標轉、保持航向，m。過頂那一刻目標方位會翻轉 180°，朝它轉的話
 * 一飛過目標就掉頭。
 */
export const DIVE_HOLD_RANGE = 250

/** 機鼻與視線的夾角小於這個、而且機翼是正的，就算翻完、轉俯衝，rad */
export const DIVE_FLIP_DONE = 15 * DEG

/**
 * 翻轉中離目標的高度低於「投彈高度 + 這個」就放棄這一趟、拉起，m。翻轉那一圈會掉 125～145 m，
 * 沒翻完就低到這裡，不能再賭。
 */
export const DIVE_FLIP_FLOOR = 150

/**
 * 瞄準俯仰的下限（往下為正的絕對值）。
 *
 * 【為什麼不能更陡】坡度角在機首接近垂直時沒有定義（`FlightDirector` 的 `BankAttitude.authority`
 * 趨近 0），機翼改平抓不到東西，滾轉來不及。
 */
export const DIVE_ANGLE_MAX = 85 * DEG

/** 離目標至少這麼高才翻轉，m。低於它的話俯衝段太短，拉起之前看不出是俯衝 */
export const DIVE_MIN_HEIGHT = 800

/**
 * 高度的遲滯帶，m：脫離要爬到 `DIVE_MIN_HEIGHT + DIVE_LEVEL_SLACK` 才回平飛；平飛掉到
 * `DIVE_MIN_HEIGHT - DIVE_LEVEL_SLACK` 以下才退回脫離。
 *
 * 【為什麼要有帶】剛好在下限回平飛的話，平飛維持高度掉個幾公尺就小於下限，立刻被打回脫離，兩個相位
 * 來回切換，飛進回平飛的距離以內之後還要飛過目標白繞一圈。
 */
export const DIVE_LEVEL_SLACK = 100

/**
 * 翻轉時坡度的絕對值要小於這個，rad。
 *
 * 【為什麼要看坡度】還在轉彎時開始翻轉，坡度會一路帶進翻轉；翻轉是在鉛直面裡拉，帶著坡度拉出去的
 * 俯衝線會偏離目標。
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
 * 翻轉時真速要不低於這個，m/s。
 *
 * 【為什麼是 65】單機模擬（`test/tools/ju87-flip.probe.ts`，離目標高 900 m）在 65～90 m/s 都翻得完：
 * 65 m/s 用 5.2 秒、掉 113 m，90 m/s 用 4.5 秒、掉 112 m，機翼都翻正。再低沒量過，而安全層的失速門檻
 * 是 36 m/s，翻轉要耗速，餘裕不能再少。脫離的爬升把速度耗到 65 m/s 上下，回頭的助跑約 1,100 m，
 * 進場時真速約 77～85 m/s。
 */
export const DIVE_ENTRY_SPEED = 65

/**
 * 脫離的爬升角，rad；爬升角隨真速收斂：不低於 `DIVE_CLIMB_FULL_SPEED` 全爬，到 `DIVE_CLIMB_MIN_SPEED`
 * 放平，之間線性，m/s。
 *
 * 【為什麼要收斂】12° 一路爬把速度耗到接近失速，安全層（`applySafety`）用失速接管把機首壓下去，
 * 還要在轉彎時承受更大的失速速度。放平才加得回速度。
 *
 * 【速度取在最佳爬升速度附近】這台飛機（套過手感）WEP 下最佳爬升約 9.4 m/s @ 52 m/s，70 m/s 只剩
 * 7.9、75 m/s 6.9；失速門檻 36 m/s，55 m/s 以上有 1.5 倍餘裕，轉彎也不會碰到。速度越高爬得越慢，
 * 但回平飛要加速到 `DIVE_ENTRY_SPEED`（水平加速度在 60 m/s 約 1.5 m/s²、80 m/s 約 0.7）。
 */
export const DIVE_EGRESS_CLIMB = 12 * DEG
export const DIVE_CLIMB_FULL_SPEED = 70
export const DIVE_CLIMB_MIN_SPEED = 55

/**
 * 拉高衝：拉起時速度還有 129 m/s，動能折合約 620 m 的高度。真速不低於 `DIVE_ZOOM_FULL_SPEED` 用
 * `DIVE_ZOOM_CLIMB` 爬，掉到 `DIVE_ZOOM_END_SPEED` 以下回到持續爬升的 `DIVE_EGRESS_CLIMB`，之間線性。
 *
 * 【為什麼】用持續爬升的角度慢慢爬，同一份動能要花兩倍的時間，阻力吃掉更多；大角度很快把它換成高度。
 */
export const DIVE_ZOOM_CLIMB = 35 * DEG
export const DIVE_ZOOM_FULL_SPEED = 110
export const DIVE_ZOOM_END_SPEED = 80

/**
 * 脫離時繞著目標盤旋爬高，盤旋半徑 `DIVE_EGRESS_RANGE`，m。半徑之外朝內偏、之內朝外偏，偏的量隨離
 * 半徑的距離線性增加，到 `DIVE_ORBIT_BAND` 公尺偏滿 `DIVE_ORBIT_BIAS`。
 *
 * 【為什麼是盤旋不是飛出去再飛回來】直飛出去掉頭飛回時，爬得夠高常常已經飛進回平飛的距離以內，
 * 要飛過目標、再飛出去才能回平飛，白繞一大圈；盤旋讓爬夠了高度就能回平飛。
 *
 * 離目標在 `DIVE_EGRESS_RANGE − DIVE_ORBIT_BAND`（500 m）以內而且正在飛離的，保持航向直線爬；
 * 再遠就開始轉彎。半徑大的話（3,000 m）要飛到離目標 2,500 m 才開始轉、轉回來再用一圈的時間，爬夠
 * 高度之後還要多飛幾十秒才能回頭。
 *
 * 回平飛至少要離目標 `DIVE_REARM_RANGE` 公尺，m：留得出轉彎與對正的空間。
 */
export const DIVE_EGRESS_RANGE = 1000
export const DIVE_ORBIT_BAND = 500
export const DIVE_ORBIT_BIAS = 35 * DEG
export const DIVE_REARM_RANGE = 500

/**
 * 回平飛時目標落在身後最多這麼遠（沿航向的「飛過」量），m。盤旋把範圍維持在一個半徑上，速度幾乎
 * 垂直於目標方向，「飛過」量在 0 附近由雜訊決定，門檻要有餘裕。必須小於 `DIVE_FLIP_MISS`：平飛看到
 * 飛過量超過那一條就轉脫離，兩個條件重疊的話相位每步來回切換。
 */
export const DIVE_REARM_ALONG = 200

/** 平飛維持高度的前瞻時間，s。`誤差 − 前瞻 × 升降率` 除以 400 就是瞄準方向的仰角 */
export const DIVE_LEVEL_DAMP = 6

/** 挑目標的名次輪替數：`selfIndex` 對它取餘數，各架挑不同的目標 */
export const DIVE_RANK_COUNT = 4

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

export type DivePhase = 'level' | 'flip' | 'dive' | 'pullout' | 'egress'

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
const BODY_UP = /* @__PURE__ */ new Vector3()
const HEAD = /* @__PURE__ */ new Vector3()
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
 * 沿現在的水平航向飛過目標多遠，m（飛過為正、目標在前方為負）。副作用：`HEAD` 留著水平航向，
 * 呼叫端接著算橫向偏離要用
 *
 * @param dx 飛機到目標的水平向量
 */
function alongTrack(self: Aircraft, dx: number, dz: number): number {
  headingHorizontal(self, HEAD)
  return -(dx * HEAD.x + dz * HEAD.z)
}

/**
 * 推進一步。寫滿 `out` 的瞄準、油門、減速板、`upright`、`pull` 與 `bombing`（`firing` 與 `trackTurn`
 * 恆為 false）。
 *
 * 平飛 → 翻轉 → 俯衝 → 拉起 → 爬離 → 回頭再平飛，見檔頭。**呼叫端仍然要在之後套 `applySafety`**。
 *
 * @param target 目標；平飛與脫離讀它的位置，翻轉、俯衝與拉起不讀（用鎖定的 `state.aim`）。沒有就沿用上一個位置
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
  out.pull = false
  out.trackTurn = false
  out.brake = 0
  out.throttle = WEP_THROTTLE
  if (target !== null && (state.phase === 'level' || state.phase === 'egress')) {
    state.aim.copy(target.position)
  }
  switch (state.phase) {
    case 'level': stepLevel(state, self, loaded, out); break
    case 'flip': stepFlip(state, self, loaded, out); break
    case 'dive': stepDive(state, self, loaded, out); break
    case 'pullout': stepPullout(state, self, out); break
    case 'egress': stepEgress(state, self, loaded, out); break
  }
}

/** 俯衝與翻轉共用的減速板：隨指示空速從 `DIVE_IAS_RATIO` 起漸開，`DIVE_IAS_BAND` 寬滿開 */
function diveBrake(self: Aircraft): number {
  const ias = Math.sqrt((2 * self.diag.aero.qbar) / RHO0)
  return Math.max(0, Math.min(1, (ias / self.spec.limits.vne - DIVE_IAS_RATIO) / DIVE_IAS_BAND))
}

/**
 * 平飛：朝目標水平飛、維持高度；離目標近了就保持航向（`DIVE_HOLD_RANGE`）。飛過目標 `DIVE_FLIP_PAST`
 * 而且橫向對正、高度與速度夠、坡度小、有彈，就轉翻轉。空手、離目標不夠高、飛過頭太多（`DIVE_FLIP_MISS`）
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
  if (range > DIVE_HOLD_RANGE) out.aimWorld.set(dx / range, 0, dz / range)
  else headingHorizontal(self, out.aimWorld)
  // 高度控制：前瞻的比例控制，與水平轟炸的定高同一個形式（`ai/strikeRun.ts` 的 `applyRunAltitude`）
  const err = state.holdAlt - p.y
  out.aimWorld.y = Math.max(-LEVEL_SLOPE, Math.min(LEVEL_SLOPE, (err - DIVE_LEVEL_DAMP * v.y) / 400))
  out.aimWorld.normalize()

  // 沿航向飛過目標多遠（飛過為正）與橫向偏離
  const along = alongTrack(self, dx, dz)
  const lateral = Math.abs(dx * HEAD.z - dz * HEAD.x)
  if (!loaded || h < DIVE_MIN_HEIGHT - DIVE_LEVEL_SLACK || along > DIVE_FLIP_MISS) {
    state.phase = 'egress'
    return
  }
  if (along < DIVE_FLIP_PAST || lateral > DIVE_FLIP_LATERAL) return
  if (h < DIVE_MIN_HEIGHT || v.length() < DIVE_ENTRY_SPEED) return
  if (Math.abs(bankAttitude(self.state.orientation, BANK).angle) <= DIVE_ENTRY_BANK) state.phase = 'flip'
}

/**
 * 翻轉：瞄準點是鎖定的那一點，只追視線；強制翻轉後拉（`Command.pull`），翻到顛倒、用正過載把機鼻拉過
 * 垂直，機鼻指向後下方、回頭對著目標，機翼自然轉正。油門怠速、減速板擋速度。機鼻對上視線（`DIVE_FLIP_DONE`）
 * 而且機翼是正的就轉俯衝；彈艙空了、或掉到投彈高度加 `DIVE_FLIP_FLOOR` 以下還沒翻完，就放棄、拉起。
 */
function stepFlip(state: DiveBombState, self: Aircraft, loaded: boolean, out: Command): void {
  const p = self.state.position
  const lx = state.aim.x - p.x
  const ly = state.aim.y - p.y
  const lz = state.aim.z - p.z
  const len = Math.hypot(lx, ly, lz)
  if (len > MIN_ERROR) out.aimWorld.set(lx / len, ly / len, lz / len)
  else out.aimWorld.set(0, -1, 0)
  out.pull = true
  out.throttle = THROTTLE_FLOOR
  out.brake = diveBrake(self)

  if (!loaded || p.y - state.aim.y <= DIVE_RELEASE_HEIGHT + DIVE_FLIP_FLOOR) {
    state.phase = 'pullout'
    out.pull = false
    return
  }
  NOSE.set(0, 0, -1).applyQuaternion(self.state.orientation)
  BODY_UP.set(0, 1, 0).applyQuaternion(self.state.orientation)
  if (NOSE.dot(out.aimWorld) >= Math.cos(DIVE_FLIP_DONE) && BODY_UP.y > 0) state.phase = 'dive'
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
  out.brake = diveBrake(self)

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
 * 脫離的水平瞄準方向（單位向量）寫進 `out`：繞著目標沿切線飛，半徑之外朝內偏、之內朝外偏。切線有
 * 兩個方向，取與現在水平航向同向的那一個（機頭偏哪邊就繞哪邊，不來回切換）。
 *
 * @param dx 飛機到目標的水平向量（≠ 0）
 */
function orbitHeading(self: Aircraft, dx: number, dz: number, range: number, out: Vector3): void {
  const ix = dx / range
  const iz = dz / range
  headingHorizontal(self, HEAD)
  let tx = -iz
  let tz = ix
  if (tx * HEAD.x + tz * HEAD.z < 0) {
    tx = -tx
    tz = -tz
  }
  const k = Math.max(-1, Math.min(1, (range - DIVE_EGRESS_RANGE) / DIVE_ORBIT_BAND))
  const beta = k * DIVE_ORBIT_BIAS
  const c = Math.cos(beta)
  const s = Math.sin(beta)
  out.set(tx * c + ix * s, 0, tz * c + iz * s)
}

/**
 * 脫離：爬升（角度隨速度收斂，見 `DIVE_EGRESS_CLIMB`）。離目標還近而且正在飛離就保持航向直線爬；
 * 飛到盤旋半徑附近、或正朝目標飛來，就繞著目標盤旋（`orbitHeading`）。高度、距離、彈艙都夠了就回平飛。
 */
function stepEgress(state: DiveBombState, self: Aircraft, loaded: boolean, out: Command): void {
  const p = self.state.position
  const dx = state.aim.x - p.x
  const dz = state.aim.z - p.z
  const range = Math.hypot(dx, dz)
  // 【離得近而且正在飛離就直線爬】轉彎（含側滑）會耗掉持續爬升約 1.5 m/s，直線最快；到了盤旋半徑附近
  // 才開始轉。正朝目標飛來的要轉開，不然會飛過目標上空
  const v = self.state.velocity
  const away = v.x * dx + v.z * dz < 0
  if (range > MIN_ERROR && (range >= DIVE_EGRESS_RANGE - DIVE_ORBIT_BAND || !away)) {
    orbitHeading(self, dx, dz, range, out.aimWorld)
  } else {
    headingHorizontal(self, out.aimWorld)
  }
  const tas = self.state.velocity.length()
  const zoom = Math.max(0, Math.min(1, (tas - DIVE_ZOOM_END_SPEED) / (DIVE_ZOOM_FULL_SPEED - DIVE_ZOOM_END_SPEED)))
  const k = Math.max(0, Math.min(1, (tas - DIVE_CLIMB_MIN_SPEED) / (DIVE_CLIMB_FULL_SPEED - DIVE_CLIMB_MIN_SPEED)))
  const climb = (DIVE_EGRESS_CLIMB + (DIVE_ZOOM_CLIMB - DIVE_EGRESS_CLIMB) * zoom) * k
  const c = Math.cos(climb)
  out.aimWorld.set(out.aimWorld.x * c, Math.sin(climb), out.aimWorld.z * c)
  // 回平飛要目標沒有落在身後太遠（`DIVE_REARM_ALONG`）：平飛把「飛過 `DIVE_FLIP_MISS` 以上」當成錯過、
  // 轉脫離，這裡若不看航向，目標在遠處身後時兩邊的條件同時成立，相位每步來回切，瞄準點與維持高度也
  // 每步重設
  if (
    loaded && p.y - state.aim.y >= DIVE_MIN_HEIGHT + DIVE_LEVEL_SLACK && range >= DIVE_REARM_RANGE
    && alongTrack(self, dx, dz) <= DIVE_REARM_ALONG
  ) {
    state.phase = 'level'
    state.holdAlt = 0
  }
}
