import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { NO_INTERCEPT, solveLead } from '../world/lead'
import { WEP_THROTTLE } from '../physics/propulsion'
import { THROTTLE_FLOOR } from '../input/throttle'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import type { Situation } from './assess'
import type { Intent } from './rules'

const FWD = new Vector3(0, 0, -1)
const UP = new Vector3(0, 1, 0)
const S = makeScratch(6)

/**
 * 交戰基底：把「瞄準點該放在目標的哪一側」拆成兩個正交方向。
 *
 * 所有向量都是**世界座標**。`leadAxis` 與 `verticalAxis` 都已扣除沿
 * `losAxis` 的分量——沿視線移動瞄準點只會改變距離，不會改變指向。
 */
export interface EngageBasis {
  /** 由我指向目標的單位向量 */
  losAxis: Vector3
  /** 目標的運動方向在垂直於視線的平面上的投影 */
  leadAxis: Vector3
  /** 我的升力方向在垂直於視線的平面上的投影 */
  verticalAxis: Vector3
  /** 由我到彈道預瞄點的向量（相對座標，非單位向量） */
  leadPoint: Vector3
  /** 預瞄點離目標當前位置多遠，m */
  leadScale: number
  /** 攔截時間，s。`NO_INTERCEPT` 表示無解 */
  interceptTime: number
  /** 目標運動方向 ∥ 視線，前置／後置沒有意義 */
  leadDegenerate: boolean
  /** 升力方向 ∥ 視線，「上方」沒有唯一解 */
  verticalDegenerate: boolean
}

export function createEngageBasis(): EngageBasis {
  return {
    losAxis: new Vector3(0, 0, -1),
    leadAxis: new Vector3(1, 0, 0),
    verticalAxis: new Vector3(0, 1, 0),
    leadPoint: new Vector3(0, 0, -1),
    leadScale: 0,
    interceptTime: NO_INTERCEPT,
    leadDegenerate: true,
    verticalDegenerate: true,
  }
}

/** 投影出垂直於 axis 的分量並正規化。回傳原始模長，供退化判定。 */
function perpendicular(v: Vector3, axis: Vector3, out: Vector3): number {
  out.copy(v).addScaledVector(axis, -v.dot(axis))
  const len = out.length()
  if (len > 1e-6) out.divideScalar(len)
  return len
}

/** 退化判定的模長下限。低於此值方向由浮點雜訊主導。 */
const AXIS_EPSILON = 0.15

/**
 * 建立交戰基底。不修改 self 與 target。
 */
export function buildEngageBasis(self: Aircraft, target: Aircraft, out: EngageBasis): void {
  const p = S.v[0]!.copy(target.state.position).sub(self.state.position)
  const range = p.length()
  if (range > 1e-3) out.losAxis.copy(p).divideScalar(range)
  else out.losAxis.copy(FWD).applyQuaternion(self.state.orientation)

  // 彈道預瞄點：在射手座標系是 P + V·t
  const v = S.v[1]!.copy(target.state.velocity).sub(self.state.velocity)
  const dir = S.v[2]!
  const t = solveLead(p, v, self.spec.battery.sight.muzzleVelocity, dir)
  out.interceptTime = t
  if (t === NO_INTERCEPT) {
    out.leadPoint.copy(p)
    out.leadScale = 0
  } else {
    out.leadPoint.copy(p).addScaledVector(v, t)
    out.leadScale = v.length() * t
  }

  // 【leadAxis 取目標的運動方向，不是相對速度】前置／後置追擊的「前」與
  // 「後」是沿**目標的航跡**定義的。用相對速度的話，共速尾追時它會退化，
  // 但那時候「瞄他後方」仍然是有意義的動作。
  const targetDir = S.v[3]!.copy(target.state.velocity)
  const targetSpeed = targetDir.length()
  if (targetSpeed > 1e-6) targetDir.divideScalar(targetSpeed)
  else targetDir.copy(FWD).applyQuaternion(target.state.orientation)
  out.leadDegenerate = perpendicular(targetDir, out.losAxis, out.leadAxis) < AXIS_EPSILON

  // 【verticalAxis 取自身升力方向而非世界上方】yo-yo 的「拉高」在物理上
  // 就是「多拉一點桿」，那個方向永遠是自己的升力方向。指揮儀是
  // bank-to-turn，大坡度時命令「世界正上方」會要求飛機先滾平再拉——那是
  // 一個做不到的指令，而且滾平的過程中什麼都沒發生。
  const lift = S.v[4]!.copy(UP).applyQuaternion(self.state.orientation)
  out.verticalDegenerate = perpendicular(lift, out.losAxis, out.verticalAxis) < AXIS_EPSILON
}

export type SteerMode = 'normal' | 'overshoot' | 'stallGuard' | 'planeDegenerate'

export interface SteerConfig {
  /** 超前閘門的距離門檻，m */
  overshootRange: number
  /** 失速裕度（拉太猛）低於此值才可能觸發吊機首閘門 */
  stallGuardMargin: number
  /** 速度裕度（TAS ÷ 1G 失速速度）低於此值也觸發吊機首閘門 */
  stallGuardSpeed: number
  /** 目標仰角高於此值才算「要吊上去」，rad */
  stallGuardElevation: number
  /** 瞄準點相對目標的最大角位移，rad */
  maxOffsetAngle: number
  /** cornerRatio 超過此值就開始減速 */
  brakeCornerRatio: number
  /** extend 的爬升／俯衝角上限，rad */
  extendPitch: number
  /** defend 的偏轉角，rad */
  defendOffset: number
}

/**
 * **全部都是起始值，待 Task 14 由對戰矩陣量測後回填。**
 */
export const DEFAULT_STEER: SteerConfig = {
  overshootRange: 120,
  stallGuardMargin: 1.25,
  stallGuardSpeed: 1.4,
  stallGuardElevation: 45 * (Math.PI / 180),
  maxOffsetAngle: 20 * (Math.PI / 180),
  brakeCornerRatio: 1.6,
  extendPitch: 25 * (Math.PI / 180),
  defendOffset: 75 * (Math.PI / 180),
}

/**
 * 幾何有效性閘門（spec §7.1）。在算 yo-yo 平面之前先過。
 *
 * 【優先序：超前 > 吊機首 > 平面退化】撞上去比失速嚴重，失速比瞄不準嚴重。
 */
export function geometryGate(
  sit: Situation,
  basis: EngageBasis,
  cfg: SteerConfig = DEFAULT_STEER,
): SteerMode {
  // 極近距離時預瞄點會產生指揮儀兌現不了的角速度需求：100 m 外、橫向
  // 200 m/s 的目標，視線角速度是 2 rad/s = 115°/s，而 P-51 的最大滾轉率
  // 只有約 100°/s——瞄準點每格劇烈跳動而飛機跟不上。
  if (sit.range < cfg.overshootRange && sit.closureRate > 0) return 'overshoot'

  // 【吊機首與平面奇異是兩件事】平飛時目標在正上方，速度與視線互相垂直，
  // 平面定義得非常好——壞的是能量不是幾何。所以這一條用能量判，
  // 不用平面模長判。
  //
  // 【兩個判準是「或」，缺一不可】M4 出貨後抓到的缺陷：`stallMargin` 代數上
  // 恆等於 √(CLmax/CL)，它問的是「我拉得太猛了嗎」。垂直爬升時飛機不需要
  // 升力，過載趨近 0，而 Vs ∝ √n 也跟著縮小，比值被撐大——P-51D 實測在
  // 132 km/h 時它讀 4.63，遠高於 1.25 的門檻，要掉到約 20 km/h 才觸發。
  // `speedMargin` 無視過載，補的正是這個盲區：同一個時刻它讀 0.68。
  //
  // 【仰角判準也是「或」，理由同上】原本只看目標仰角，等於只問「目標是不是
  // 吊在我上面」。人工驗收抓到的第二個缺陷：`extend` 的俯仰偏置滾雪球，會
  // 讓 AI 把**自己**吊到 85°，而目標仍在同一空層 —— 目標仰角接近 0，閘門
  // 一次都不觸發。「我正在把自己吊上去」與「目標吊在上面」是兩件不同的事，
  // 而前者才是失速的直接前兆。
  const elevation = Math.asin(Math.max(-1, Math.min(1, basis.losAxis.y)))
  if (
    (elevation > cfg.stallGuardElevation || sit.climbAngle > cfg.stallGuardElevation)
    && (sit.stallMargin < cfg.stallGuardMargin || sit.speedMargin < cfg.stallGuardSpeed)
  ) {
    return 'stallGuard'
  }

  // 真正的幾何奇異：升力方向 ∥ 視線，「上方」沒有唯一解
  if (basis.verticalDegenerate) return 'planeDegenerate'

  return 'normal'
}

export interface Knobs {
  /** −1 = 後置追擊、0 = 純追擊、+1 = 前置追擊（彈道預瞄點） */
  leadLag: number
  /** −1 = 壓到交戰平面下方、0 = 同平面、+1 = 拉到上方 */
  vertical: number
}

/** 接近率的舒適區間，m/s。超過上界要殺、低於下界要補。 */
const CLOSURE_HIGH = 150
const CLOSURE_LOW = 0

function clamp1(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x
}

/**
 * 由態勢算出兩個旋鈕。**具名機動是這個平面上的點，不是寫死的分支。**
 *
 * 【為什麼連續而不是三個具名分支】具名機動之間需要遲滯，否則在邊界上
 * 會反覆切換；連續量不需要——它會自己從一邊滑到另一邊。而且「高 yo-yo」
 * 與「低 yo-yo」本來就是同一個動作的兩個方向，拆成兩個名字反而要處理
 * 它們之間的過渡。
 */
export function engageKnobs(sit: Situation, out: Knobs, _cfg: SteerConfig = DEFAULT_STEER): void {
  /**
   * 「接近率太高」只有在**尾追**時才代表超前。
   *
   * 1 = 純尾追（我在他機尾後方）、0 = 純對頭。`angleOffTail` 是視線與他機首
   * 的夾角，0 為我咬在他正後方、π 為他正朝我來。
   *
   * 【為什麼需要這個門】人工驗收抓到的缺陷：對頭時接近率是**雙方速度相加**。
   * 兩台各 150 m/s 就是 282 m/s，`excess` 算出 0.88，兩個旋鈕直接推到底
   * ——全後置追擊 + 滿舵高 yo-yo。實測機首因此離預瞄點 24–40°，而威脅錐是
   * 15°、開火錐是 3°，於是：兩邊都不開火、兩邊的 `threatInstant` 都恆為 0，
   * 連 `defend` 在對頭時都結構上不可能觸發。看起來就是「AI 撇頭拒絕交戰」。
   *
   * 而那個反應本來就沒有意義：對頭的接近率是幾何給定的，任何機動都減不掉，
   * 高 yo-yo 只是把機首甩開。真正該做的是乾淨的預瞄追擊，拿一次正面快照
   * ——那正是 `merge` 意圖在做的事，只是它的時間窗（2.5 s）只涵蓋最後 750 m。
   */
  const pursuit = 0.5 * (1 + Math.cos(sit.angleOffTail))

  // 接近率相對舒適區間的偏離，正 = 太快、負 = 追不上
  const excess = pursuit * (sit.closureRate - CLOSURE_HIGH) / CLOSURE_HIGH
  // 【追不上不用門】「他跑掉了要切內線」與幾何無關，任何方位都成立。
  const deficit = (CLOSURE_LOW - sit.closureRate) / CLOSURE_HIGH

  // 太快 → 後置；正常 → 前置（進入射擊解）
  out.leadLag = clamp1(1 - 2 * Math.max(0, excess))

  // 【太快就拉高、追不上就壓低】高 yo-yo 用高度吃掉多餘速度並增加航跡
  // 長度；低 yo-yo 用高度換速度切內線。兩者是同一個旋鈕的兩端。
  //
  // 卸載**不在這裡**：卸載＝最小誘導阻力＝保住速度，會讓超前更嚴重。
  // 它屬於 extend（§7.3），那裡要的正是加速脫離。
  out.vertical = clamp1(Math.max(0, excess) - Math.max(0, deficit))
}

const A = makeScratch(2)

/**
 * 由旋鈕算出世界座標的瞄準方向（單位向量）。
 *
 * 【位移的長度尺度用角度而非公尺】`range × tan(maxOffsetAngle)` 讓瞄準點
 * 的偏移是一個**角度**，那才是指揮儀真正在追的量。用固定公尺數的話，
 * 遠距離時 yo-yo 小到沒有效果，近距離時大到把瞄準點甩出視野。
 */
export function aimFromKnobs(
  basis: EngageBasis,
  sit: Situation,
  k: Knobs,
  out: Vector3,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  const scale = Math.max(sit.range, 1) * Math.tan(cfg.maxOffsetAngle)

  const aim = A.v[0]!.copy(basis.leadPoint)

  // 後置量：由 +1（全前置，不後退）到 −1（全後置，退一個 scale）
  if (!basis.leadDegenerate) {
    const lag = (1 - clamp1(k.leadLag)) / 2
    aim.addScaledVector(basis.leadAxis, -lag * scale)
  }
  if (!basis.verticalDegenerate) {
    aim.addScaledVector(basis.verticalAxis, clamp1(k.vertical) * scale)
  }

  const len = aim.length()
  if (len > 1e-6) out.copy(aim).divideScalar(len)
  else out.copy(basis.losAxis)
}

const C = makeScratch(2)

/** 超前修正的固定旋鈕：全後置 + 全高 yo-yo。 */
const OVERSHOOT_KNOBS: Knobs = { leadLag: -1, vertical: 1 }

/**
 * 由意圖與幾何模式產生完整的轉向指令：`aimWorld`、`throttle`、`brake`。
 *
 * **不動 `firing`** —— 開火紀律是獨立的一層（`fire.ts`），因為「瞄得對」
 * 與「該不該扣扳機」是兩個不同的判斷：進場途中瞄準點是對的，但距離還
 * 遠到不該浪費彈幕。
 */
export function steerCommand(
  intent: Intent,
  mode: SteerMode,
  sit: Situation,
  basis: EngageBasis,
  self: Aircraft,
  k: Knobs,
  out: Command,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  // ── 瞄準點 ──────────────────────────────────────────────
  // 幾何模式壓過意圖：閘門存在的意義就是「這個幾何下一般解法會出錯」
  if (mode === 'planeDegenerate') {
    out.aimWorld.copy(basis.losAxis)
  } else if (mode === 'stallGuard') {
    // 不追上去。回到速度向量附近讓能量恢復——追一個吊在上面的目標會
    // 把自己也掛在那裡。
    unloadAim(self, 0, out.aimWorld)
  } else if (mode === 'overshoot') {
    // 後置 + 高 yo-yo。engageKnobs 在這個態勢下本來就會給負的 leadLag 與
    // 正的 vertical，這裡強制到底，因為超前是要立刻解決的。
    aimFromKnobs(basis, sit, OVERSHOOT_KNOBS, out.aimWorld, cfg)
  } else {
    switch (intent) {
      case 'engage':
        aimFromKnobs(basis, sit, k, out.aimWorld, cfg)
        break
      case 'extend':
        // 【卸載】把瞄準點放到自身速度向量上，指揮儀就沒有轉向需求，
        // 過載趨近 1 G、誘導阻力最小——這是能量重整的核心手段
        // （spec §4.4：這是 aimWorld 介面唯一能表達的卸載近似）。
        // 能量劣勢時帶爬升分量把速度存成高度，優勢時反之。
        unloadAim(self, -Math.sign(sit.energyAdvantage) * cfg.extendPitch, out.aimWorld)
        break
      case 'defend':
        defendAim(basis, out.aimWorld, cfg)
        break
      case 'merge':
      case 'approach':
        normalizeInto(basis.leadPoint, basis.losAxis, out.aimWorld)
        break
    }
  }

  // ── 油門與減速（spec §7.4）────────────────────────────
  if (mode === 'overshoot') {
    // 沒有減速板的年代這是做不到的，但本專案刻意加了（spec §2.1）。
    // 配合後置與高 yo-yo，三者都在增加能量消耗。
    out.throttle = THROTTLE_FLOOR
    out.brake = 1
  } else if (sit.cornerRatio > cfg.brakeCornerRatio) {
    // 【判準是角落速度不是 VNE】limits.vne 在整個 src/ 裡沒有任何程式碼
    // 消費它——超速在本模型沒有後果，拿它當判準是死碼。速度遠高於角落
    // 速度則是模型真的模擬的代價：轉彎半徑 ∝ V²，而且高速舵面變重。
    out.throttle = WEP_THROTTLE
    out.brake = Math.min(1, sit.cornerRatio - cfg.brakeCornerRatio)
  } else {
    out.throttle = WEP_THROTTLE
    out.brake = 0
  }
}

/**
 * 瞄準自身速度向量，可加上一個俯仰偏置。`pitch > 0` 為爬升。
 *
 * `pitch` 是**相對地平線的航跡角**，不是相對當前速度向量的增量：維持航向，
 * 把航跡角設成 `pitch`。
 *
 * 【為什麼不能寫成 `v.y += tan(pitch)`】那個寫法把偏置加在**當前**速度向量
 * 上，而飛機會追上去 —— 下一格再從轉過的新方向加一次，指令角度於是每格
 * 滾雪球。人工驗收實測：`extend` 一啟動，瞄準仰角 4 秒內由 −27° 跑到 −56°
 * （垂直俯衝）；能量差翻負後改成爬升偏置，7 秒內由 +16° 跑到 +85°，TAS 由
 * 688 掉到 498 km/h —— 那正是「AI 自己吊到失速」的來源。
 *
 * 航跡角必須相對地平線定義，才會是一個**穩定的**目標而不是會跑掉的增量。
 */
function unloadAim(self: Aircraft, pitch: number, out: Vector3): void {
  const v = C.v[0]!.copy(self.state.velocity)
  const speed = v.length()
  if (speed > 1e-3) v.divideScalar(speed)
  else v.copy(FWD).applyQuaternion(self.state.orientation)

  if (pitch === 0) {
    out.copy(v)
    return
  }

  // 維持航向、把航跡角設成 pitch。水平分量退化（已經垂直）時航向沒有定義，
  // 改用機首的水平投影；兩者都退化就直接沿用速度向量。
  let hx = v.x
  let hz = v.z
  let h = Math.hypot(hx, hz)
  if (h < 1e-6) {
    const nose = C.v[1]!.copy(FWD).applyQuaternion(self.state.orientation)
    hx = nose.x
    hz = nose.z
    h = Math.hypot(hx, hz)
    if (h < 1e-6) {
      out.copy(v)
      return
    }
  }
  const c = Math.cos(pitch) / h
  out.set(hx * c, Math.sin(pitch), hz * c)
}

/**
 * 破防：瞄準點垂直於他的射線，優先選能增加 `angleOffTail` 的一側。
 *
 * 目的是**破壞他的預瞄解**，不是逃跑——逃跑會把尾巴一直送給他。
 */
function defendAim(basis: EngageBasis, out: Vector3, cfg: SteerConfig): void {
  // 由視線繞 verticalAxis 轉開一個大角度。verticalAxis 退化時改用 leadAxis，
  // 兩者都退化時直接回傳視線（此時幾何本來就沒有可選的一側）。
  const axis = !basis.verticalDegenerate ? basis.verticalAxis
    : !basis.leadDegenerate ? basis.leadAxis
      : null
  if (!axis) {
    out.copy(basis.losAxis)
    return
  }
  out.copy(basis.losAxis).multiplyScalar(Math.cos(cfg.defendOffset))
    .addScaledVector(axis, Math.sin(cfg.defendOffset))
    .normalize()
}

/** 正規化 v 寫入 out；退化時用 fallback。 */
function normalizeInto(v: Vector3, fallback: Vector3, out: Vector3): void {
  const len = v.length()
  if (len > 1e-6) out.copy(v).divideScalar(len)
  else out.copy(fallback)
}
