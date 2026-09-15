import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { G0, smoothstep } from '../core/math'
import { NO_INTERCEPT, solveLead } from '../world/lead'
import { PROJECTILE_LIFETIME } from '../world/Projectiles'
import { WEP_THROTTLE } from '../physics/propulsion'
import { rallyAim } from './rally'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import type { Situation } from './assess'
import type { Intent } from './rules'

const FWD = new Vector3(0, 0, -1)
const UP = new Vector3(0, 1, 0)
/** extend 的爬升／俯衝角上限，rad。兩個增益都以它為基準 */
const EXTEND_PITCH = 25 * (Math.PI / 180)
/** 見 `SteerConfig.altitudeGapScale`。掃描結果見該欄位。 */
const ALTITUDE_GAP_SCALE = 600
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

/**
 * 破防這一層自己的跨格狀態。
 *
 * 【為什麼需要狀態】`steer.ts` 的其他東西全是純函數，而反轉不是一個「此刻
 * 的幾何」而是一個**展開中的動作** —— 它必須跨格記得「我正在做這件事」。
 * 由呼叫端持有、以參數傳入，模組本身仍然沒有可變的全域狀態（spec §4.3）。
 */
export interface DefendState {
  /** 反轉倒數的剩餘秒數。> 0 = 正在反轉 */
  reversal: number
  /**
   * 觸發那一刻的攻擊者。換人時取消 —— 對著別人做到一半的反轉沒有意義，
   * 而且瞄準點會指向一架已經不相干的飛機。
   */
  attacker: Aircraft | null
  /**
   * 破防軸的左右號誌，+1 / −1。**0 = 尚未決定**。
   *
   * 【為什麼要跨格記住】`UP × threatLos` 有 ±兩側，兩側同樣「橫向破防」。
   * 每一格重算必然存在一個切換面，跨過去就是瞄準點瞬間跳 2×75°，飛機每格
   * 抖一下。進入破防時決定一次、整段不變。攻擊者換人或離開破防時歸零，
   * 下次重新決定。
   */
  axisSign: number
  /**
   * `extend` 的轉向側，+1 / −1。**0 = 尚未決定**。
   *
   * 【與 `axisSign` 是同一個病、同一個治法】脫離時錨點（當前目標）**幾乎
   * 總是在正後方** —— 而 `atan2` 的誤差角在正後方由 +179° 跳到 −179°，
   * 每格重算的側別會跟著翻，瞄準點瞬間跳 2 × `extendTurnCap`。進入脫離時
   * 決定一次、整段不變；離開或換目標時歸零。
   *
   * 【為什麼放在 `DefendState` 裡】這個型別實際上是**操縱層的跨拍記憶**，
   * 破防只是第一個用戶。拆成兩個型別要動 `steerCommand` 的簽名，而它有
   * 57 個呼叫點、`createDefendState()` 有 68 個 —— 那個風險換不到等值的
   * 清晰度。名字保留，語意以這段註解為準。
   */
  extendSide: number
}

export function createDefendState(): DefendState {
  return { reversal: 0, attacker: null, axisSign: 0, extendSide: 0 }
}

/**
 * 「追不上預瞄點」的跨格狀態。由 `stepTrack` 每步維護。
 *
 * 【為什麼與 `DefendState` 分開】那一個是破防的狀態（反轉倒數、破防軸、
 * 脫離側別），這一個是追擊幾何的狀態。兩者的生命週期無關。
 */
export interface TrackState {
  /** 閂上 = 正在佈局下一次機會，而不是追瞄 */
  latched: boolean
  /** 已經連續低於 `trackExit` 幾秒。只在閂上時有意義 */
  quiet: number
}

export function createTrackState(): TrackState {
  return { latched: false, quiet: 0 }
}

/**
 * 維護「追不上」的閂鎖。就地修改 `state`。
 *
 * 生命週期（spec §5.2）：
 * ```
 *   未閂 → 閂上：  trackRatio > trackEnter
 *   閂上 → 釋放：  trackRatio < trackExit 連續維持 trackHold 秒
 * ```
 *
 * @param ratio   `Situation.trackRatio`
 * @param losRate `Situation.losRate`，rad/s。低於 `trackLosFloor` 不閂（扳機優先）
 * @param active  有沒有攻擊目標。沒有目標時立刻釋放
 */
export function stepTrack(
  state: TrackState,
  ratio: number,
  losRate: number,
  active: boolean,
  dt: number,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  // 【消融開關】見 `SteerConfig.trackEnter`
  if (!active || !(cfg.trackEnter > 0) || !Number.isFinite(ratio)) {
    state.latched = false
    state.quiet = 0
    return
  }
  if (!state.latched) {
    // 【扳機優先】見 `SteerConfig.trackLosFloor`
    if (ratio > cfg.trackEnter && losRate > cfg.trackLosFloor) {
      state.latched = true
      state.quiet = 0
    }
    return
  }
  // 【遲滯帶裡不算安靜】要掉到 `trackExit` 以下才開始計時
  if (ratio < cfg.trackExit) {
    state.quiet += dt
    if (state.quiet >= cfg.trackHold) {
      state.latched = false
      state.quiet = 0
    }
  } else {
    state.quiet = 0
  }
}

/**
 * 每個物理步更新破防狀態。目前只有反轉用得到。
 *
 * **判定（三個條件同時成立）**
 *
 *   1. 到攻擊者的距離 < `reversalRange`
 *   2. 我的**速度向量**與「指向他的視線」的夾角 < `reversalAspect`
 *      —— 他已經跑到我的前半球
 *   3. `defending` 為真 —— 只有正在破防的人才談得上反轉
 *
 * 條件 2 是「衝過頭」的真正定義：我硬破防而他跟得住時，視線一直留在後半球；
 * 他過頭了，視線才會掃到前面來。
 *
 * 【已知窗口很小】AI 對 AI 的實測：「衝過頭」只佔 1.6% 的取樣，其中 27%
 * 藍方已經有射擊解，真正「錯過機會」的約佔全場 0.7%。這一項仍然留著 ——
 * 真人玩家衝過頭的頻率遠高於 AI，而它的價值在「難得發生時很精彩」，
 * 不在佔比。不要拿佔比去砍它。
 *
 * @param defending 這一格的意圖是不是 `defend`
 *
 * 熱路徑（240 Hz），不配置。
 */
export function stepDefend(
  state: DefendState,
  self: Aircraft,
  attacker: Aircraft | null,
  defending: boolean,
  dt: number,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  if (state.reversal > 0) {
    // 換人就取消；否則倒數
    if (attacker !== state.attacker) {
      state.reversal = 0
      state.attacker = attacker
      // 號誌是對**舊**攻擊者的幾何算的，跟著一起丟掉
      state.axisSign = 0
      return
    }
    state.reversal = Math.max(0, state.reversal - dt)
    if (state.reversal === 0) state.attacker = null
    return
  }

  // ── 破防軸的左右號誌（進入時決定一次）──────────────
  // 【為什麼寫在這裡而不是 defendAim 裡】defendAim 是純函數、每格被呼叫，
  // 它沒有「這是不是第一格」的資訊。號誌是跨格狀態，必須由持有狀態的這一層
  // 決定（與 reversal 同一個理由）。
  if (!defending || attacker === null) {
    state.attacker = attacker
    state.axisSign = 0
    return
  }
  if (attacker !== state.attacker) state.axisSign = 0
  state.attacker = attacker
  if (state.axisSign === 0) {
    // 取與當下升力同側 —— 進入破防時轉場最小
    const dir = D.v[0]!.copy(attacker.state.position).sub(self.state.position)
    const dist = dir.length()
    if (dist > 1e-3) {
      dir.divideScalar(dist)
      const h = D.v[2]!.copy(UP).cross(dir)
      if (h.lengthSq() > 1e-12) {
        h.normalize()
        const lift = D.v[1]!.copy(UP).applyQuaternion(self.state.orientation)
        state.axisSign = h.dot(lift) >= 0 ? 1 : -1
      } else state.axisSign = 1
    } else state.axisSign = 1
  }

  // 【暫存向量的重複使用】號誌那段用了 D.v[0]/[1]/[2]，算完就不再需要，
  // 下面的反轉偵測會重新 copy。不要把號誌那段挪到反轉偵測中間。
  const los = D.v[0]!.copy(attacker.state.position).sub(self.state.position)
  const range = los.length()
  if (range >= cfg.reversalRange || range < 1e-3) return
  los.divideScalar(range)

  const vel = D.v[1]!.copy(self.state.velocity)
  const speed = vel.length()
  if (speed < 1e-3) return
  vel.divideScalar(speed)
  if (vel.dot(los) < Math.cos(cfg.reversalAspect)) return

  state.reversal = cfg.reversalHold
}

export type SteerMode = 'normal' | 'overshoot' | 'speedRecover' | 'unload' | 'planeDegenerate'

export interface SteerConfig {
  /** 超前閘門的距離門檻，m */
  overshootRange: number
  /**
   * **拉太猛**的判準：失速裕度（TAS ÷ 當前過載下的失速速度）低於此值就卸載。
   *
   * 【它量的是攻角不是速度】代數上恆等於 √(CLmax / CL)，所以它回答的是
   * 「我拉得太猛了嗎」。補救是停止拉桿，不是壓機頭。
   *
   * 【為什麼不能放到 1.25】戰鬥機在最大轉彎率下按定義就貼著 CLmax，追瞄的
   * 硬拉本來就會壓到 1.25 以下 —— 閘門於是把每一次要害的拉桿都中止掉。
   * 實測高能量開局會由「29 秒擊落」退化成「90 秒逾時」，而且能量超支
   * （花 3428 > 開局優勢 3213）。詳見 `speedRecoverMargin` 的掃描表。
   *
   * 【它同時是卸載強度的分母】`unloadPull` 用
   * `(stallMargin − 1) / (unloadMargin − 1)` 當拉桿係數，所以這個值不只決定
   * 「何時介入」，也決定「介入得多深」——它是限制器的整條斜坡。
   *
   * 【這個旋鈕是混沌的】七格、兩種開局、200 秒：
   *
   * ```
   *        高能量開局                      共速共高
   * 1.02   逾時 紅 239 : 藍   0  花 6691   紅  94 : 藍 137
   * 1.05   逾時 紅 280 : 藍   0  花 7881   紅  65 : 藍  34
   * 1.10   逾時 紅  92 : 藍   0  花 5033   紅  73 : 藍   0
   * 1.15   逾時 紅 561 : 藍 428  花 6627   紅 305 : 藍   0   ← 現值
   * 1.20   逾時 紅 180 : 藍   0  花 6051   紅 407 : 藍   0
   * 1.30   藍勝 182s 紅1000 : 藍 0 花 6060 紅 151 : 藍  62
   * 1.40   逾時 紅 278 : 藍   0  花 4408   紅 124 : 藍   0
   * ```
   *
   * 行為品質七格**全部在門檻內**且沒有方向性（`safetyShare` 0.58~2.25%、
   * `longestExtend` 36.00~48.75 s、`steepShare` 4.08~7.24%）。傷害卻在
   * 相鄰格之間差 3~5 倍、勝負翻號。
   *
   * 【1.30 那格擊落不是理由】它的左右鄰居（1.20 與 1.40）都比 1.15 差。
   * **這個旋鈕沒有可辨識的最佳點，不要拿單格的好看數字去調它。**
   */
  unloadMargin: number
  /**
   * **快沒空速**的判準：速度裕度（TAS ÷ 1G 失速速度）低於此值就壓機頭。
   *
   * 【不准再加上仰角前提】「仰角 > 45° **且** 速度低」的 `且` 會讓它在
   * 74° 仰角、速度裕度 1.49 時仍然不動，等到 1.34 才觸發 —— 已經 78 m/s
   * 了。速度不足在任何姿態都是問題；俯衝時速度自然高，不會誤觸發（實測
   * 俯衝時觸發 0 次，spec §3.4）。
   *
   * 【兩個門檻的定值】高能量開局（boom-and-zoom）與
   * 1v1 機動測試 @4000 的三場一起掃：
   *
   * ```
   * speedRecover / unload   高能量開局      belowStall 最差（@4000 三場）
   *   1.4  / 1.25            timeout 90 s        1.08%
   *   1.25 / 1.15            blue 31.6 s         0.83%   ← 選定
   *   1.15 / 1.1             blue 30.2 s         2.33%
   *   1.4  / 0（關 unload）  blue 31.3 s         1.92%
   *   0    / 1.25（關 sr）   timeout 90 s        0.08%
   * ```
   *
   * 【責任在 unload 不在這一項】第一列與第五列是關鍵：關掉 `speedRecover`
   * 仗仍然打不完，關掉 `unload` 就好了 —— 打斷攻擊的是「拉太猛」那一個。
   * 主要的修正在 `unloadMargin`。
   *
   * 【現行包絡下它連順帶效果都沒有】掃 1.10 / 1.25 /
   * 1.40 / 1.55，兩種開局、200 秒，**戰鬥效能四格逐位元完全相同**：
   * 高能量開局一律「逾時、紅 561 : 藍 428、花 6627 m」，共速共高一律
   * 「紅 305 : 藍 0」。行為品質也幾乎相同，唯一的差別是 1.55 的
   * `safetyShare` 由 0.75% 升到 1.75%（往壞的方向）。
   *
   * **這個旋鈕在現行包絡下沒有影響力。**
   *
   * 【為什麼不刪掉它與它的分支】沒有影響力不等於錯。它是失速的第一道
   * **政策層**，而現在之所以量不到，是因為 `unloadMargin` 在它之前就把
   * 「拉太猛」擋掉了 —— 兩者管的是不同的病（拉太猛 vs 飛太慢）。包絡再
   * 變（換機種、再調手感）時它會重新生效，刪掉只會讓下一個人重寫一遍。
   */
  speedRecoverMargin: number
  /** `speedRecover` 的壓頭角度，rad。正值，實際命令的是它的負值 */
  speedRecoverPitch: number
  /** 瞄準點相對目標的最大角位移，rad */
  maxOffsetAngle: number
  /**
   * `cornerRatio` 超過此值就開始減速。
   *
   * 【物理】轉彎半徑正比於 V²，超過角落速度再快也不會轉得更好，只會繞更
   * 大圈。所以「太快」在纏鬥裡是真的有代價的。
   *
   * 【定值的掃描】高能量開局（P-51 對 Bf 109、藍方佔 3213 m 比能量優勢、
   * 200 秒）：
   *
   * ```
   * 值      結果          傷害交換        藍方花掉的比能量
   * 1.20   逾時 200s    紅 319 : 藍   0        7848 m
   * 1.40   逾時 200s    紅 212 : 藍   0        7846 m
   * 1.60   逾時 200s    紅 561 : 藍 428        6627 m
   * 1.65   逾時 200s    紅 254 : 藍 333        6272 m
   * 1.70   藍勝 156s    紅1000 : 藍   0        6025 m   ← 平台起點
   * 1.75 / 1.78 / 1.80 / 1.85 / 2.00 / 2.50 ── 與 1.70 逐位元相同 ──
   * ```
   *
   * 【為什麼這張表算數】1.70~2.50 **六個連續取值逐位元完全相同** —— 那不
   * 可能是抽樣，它就是「規則不再觸發」這件事本身。**平台是結構，單點是
   * 抽樣**；混沌的旋鈕給的是互相矛盾的鄰格（見 `unloadMargin`）。
   *
   * 【為什麼是 1.8 不是平台起點 1.70】留 0.1 的餘裕。貼著實測邊界放，別處
   * 動一下就又踩回懸崖 —— 而 1.60 / 1.65 那兩格（藍方挨 428 / 333）就是
   * 懸崖的樣子。
   *
   * 【為什麼是 1.8 不是 2.5】數值上等價，但把死區拉大沒有好處。未來加進
   * 真的轉不贏的機種、或再調手感時，1.8 比 2.5 更快重新活過來。
   *
   * 【它只作用在能量戰】`ai-manoeuvre` 六場（P-51 對 P-51、TAS 200 起始）
   * 在 1.6 與 1.8 之間**逐位元相同** —— 那六場衝不到那個速度，規則一次都
   * 沒觸發。變的只有高能量開局，而那正是這條規則唯一會觸發的地方。
   *
   * 【往下調是死路】1.20 的 `longestExtend` 56.50 s **破 55 s 門檻**，
   * 而 1.05–1.6 整段掃過都沒有幫助。
   */
  brakeCornerRatio: number
  /** extend 的爬升／俯衝角上限，rad */
  extendPitch: number
  /**
   * `extend` 期間瞄準點**偏離當前航向**的上限，rad。0 = 這一層關閉（消融用）。
   *
   * 【它為什麼取代得了「坡度上限」】指揮儀把瞄準誤差拆成兩件事：**方位
   * 決定往哪邊滾**（`rollCommand = atan2(aimBody.x, aimBody.y)`），**大小
   * 決定拉多少 G**（見 `shrinkTowardNose` 的註解）。而「轉彎會掉速度」的
   * 物理量是**誘導阻力**，誘導阻力由**過載**決定 —— 不是由坡度決定。
   * 90° 坡度拉 1.05 G 幾乎不掉能量，30° 坡度拉 4 G 掉得很快。
   *
   * 所以限制誤差角的**大小**直接限制了過載，也就直接限制了能量損失。
   * 【不要改成限坡度】坡度盯的是錯的量，而且傾斜角在 `aimWorld` 這個介面
   * 下**根本下不了指令**（spec §2.6）。
   *
   * 【為什麼不分脫離理由】spec §9.4 擔心「見底時最該做的是低頭換速度，
   * 不是轉彎」。那已經被兩層既有機制承擔：`extendPitchAngle` 在速度赤字
   * 0.25 時給滿俯衝，而 `sit.pullCeiling`（`energyPull`）在同一個區間把
   * 整個誤差角縮到 0.65。連續的縮放勝過再開一個分支 —— 而 `steerCommand`
   * 也讀不到 `RuleState`，分理由就得再改一次簽名。
   *
   * 【這個機制修的是「合理性」，不是效率】它存在的理由是「一直直直飛很不
   * 合理」。**攻擊效率有沒有提高沒差**，那只是附加價值 —— 不要拿
   * `fireShare`／`redDamage` 之類來否決它。行為的絕對量測（卡住幾秒、
   * 跑多遠）才是判準。
   *
   * 【掃描表，`extendTurnFade: 1500`】兩個指標**方向相反**，
   * 而且對 `maxRadius` **非單調**：
   *
   * ```
   *   cap    longestExtend（≤55）   maxRadius（≤~4740）
   *     0°   綠                     10744
   *     5°   綠                     15107   ← 比不做更遠
   *     8°   綠                     12899   ← 比不做更遠
   *    10°   55.5 / 57.5 / 65       8450
   *    15°   75.5 / 70              6212
   * ```
   *
   * 【為什麼小角度反而更遠】轉彎半徑 `R = V² / (g·tanθ)`。小偏置＝小過載＝
   * **超大的弧**，那個弧的最遠點比直線跑還遠。要嘛不轉，要嘛轉得夠快。
   *
   * 【為什麼大角度讓脫離變長】見底型脫離的出場條件**就是能量恢復**，而轉彎
   * 正在消耗能量（spec §9.4：「見底時最該做的是低頭換速度」）。
   * `sit.pullCeiling` 那一層**實測承擔不住**這件事。
   *
   * **15° 待人工試飛定案。** 已知代價：`ai-manoeuvre` 側舷 @1000/@4000 的
   * `longestExtend` 破線（75.5 / 70）。換到的是 `maxRadius` 由 10.7 km 降到
   * 6.2 km —— 那條在這一層關著時同樣是紅的。
   */
  extendTurnCap: number
  /**
   * 轉向偏置開始開啟的 `cornerRatio`。低於它完全不偏（翼平直飛撿速度）。
   *
   * 【為什麼是 0.9 而不是 1】cornerRatio = 1 是**角落速度** —— 最會轉彎
   * 的速度，不是懸崖；把底放在 1 等於「正好最會轉的時候不准轉」。實測
   * belowOrbit：4,300 m 平飛可持續只有 1.02，任何 > 1 的斜坡都讓均衡點
   * 貼死在 cr ≈ 1、偏置 ≈ 0 —— 斜坡頂掃 1.02／1.05／1.08 跑出**同一條
   * 軌跡**（物理上限鎖死旋鈕）。與 `zoomEnter`/`zoomFull` 同一種一對式。
   *
   * 【底的掃描（belowOrbit，重新對上時間）】0.80 → 深失血回潮（最低
   * −1124）且不回席；0.85 → **65 s 回席**；0.90 → 不回席（均衡偏置
   * 太小，1.5°/s 的轉率追不完 5 km 的距離）。取 0.85 —— 高高度的平飛
   * 幾乎沒有多餘功率，回場的彎注定要在角落速度下方一點點的地方飛。
   */
  extendVigorEnter: number
  /** 轉向偏置全開的 `cornerRatio`。Enter..Full 之間 smoothstep。 */
  extendVigorFull: number
  /**
   * 規則 3 俯衝目標的自身上限，IAS / vne。**不得高於安全層的 `overspeedRatio`**
   * —— 高於它的話脫離的一方會自己撞進守線，兩層打架。
   */
  diveSelfRatio: number
  /**
   * 規則 3 俯衝目標：對手紅線的這個倍數。過一點就夠 —— 對手在自己的 0.9
   * 就放手了，多俯衝的高度是白丟的。
   */
  diveTargetRatio: number
  /**
   * 規則 3 俯衝的航跡角，rad。**比 `extendPitch` 陡得多，而且必須如此。**
   *
   * 【為什麼 25° 不夠】F4F 又重又拖（cd0 0.0248），−15～−25° 的重力分量推不
   * 動它：實測 19 秒只從 0.41 爬到 0.56 vne、掉 685 m，連對手放手的速度都
   * 沒摸到，等於白丟高度。−45° 的重力分量是 −15° 的 2.7 倍，粗算 10 秒內
   * 到得了。
   */
  divePitch: number
  /**
   * 回場偏置**淡到滿**的距離，m。由 0 漸進到這個值，之後全程滿偏。
   *
   * 【淡入區本身有害，要讓 AI 快速通過】它存在只是為了不抖 —— 距離在門檻
   * 附近晃一下，偏置若在 0 與 `extendTurnCap` 之間跳，機首就跟著抖。但區
   * 間裡的偏置是「一點點」，而一點點偏置＝小過載＝**超大的弧**（見
   * `extendTurnCap` 的掃描表：偏 5° 跑 15.1 km，比完全不轉的 10.7 km 還
   * 遠）。所以這個值決定的是「不上不下的地帶有多寬、多早開始」。
   *
   * 【為什麼一定要有這一層】沒有它時 AI 會**繞著目標盤旋**：`extend` 的兩個
   * 出口是「拉開到 `extendRange`」與「閂鎖釋放」，而全程朝目標偏轉會把兩個
   * 一起堵死 —— 距離永遠到不了 1,500 m，轉彎又補不回能量。實測
   * `ai-manoeuvre` 側舷 @1000 m 的 `longestExtend` 由 55 s 的上限暴增到
   * **284.5 s** —— 300 秒的場次有 284 秒在脫離，那不是空戰，是繞圈。
   * （`ai-duel-matrix` 的 `redDamage` 同時掉到 0，但那只是旁證：**這個
   * 機制修的是「直直飛不合理」，不是攻擊效率**。）
   *
   * 【750 的取捨】淡入區蓋住 0..750 m，能量型脫離（`extendRange` 1,500 m
   * 出場）整批落在裡面 —— 它們會被帶著走大弧。換到的是 750 m 之後**全程
   * 滿偏**，回場比把淡入區推遠積極得多。哪一邊划算由人工試飛判定，這是
   * 「玩起來合不合理」的問題，不是數字問題。
   *
   * 【0 = 全程滿偏】不是關閉。要關閉這一層請用 `extendTurnCap: 0`。
   *
   * **待人工試飛定案。** 已量過的兩組（`extendTurnCap` 20°）：
   *
   * ```
   *   淡入區          longestExtend@1000   maxRadius
   *   1500..3000 m    75.5（cap 15°）      6212（cap 15°）
   *    750..1500 m    79                   10494
   * ```
   */
  extendTurnFade: number
  /**
   * 速度赤字 → 俯仰的增益。
   *
   * 【`4 × extendPitch` 的意思】速度赤字 0.25（`cornerRatio` = 0.75）時就
   * 給滿俯衝角。
   *
   * 【它與意圖層的分工】俯仰是**連續**的：`cornerRatio` 一低於 1 就開始
   * 加深俯衝，到 0.75 給滿。而意圖層的 `DEFAULT_RULES.cornerEnter` 也是
   * 0.75 —— 兩者刻意對齊成「先用姿態換速度，換到給滿了都還沒補回來，才
   * 輪到意圖切成 `extend` 真的撤下來」。前者不必離開戰場，後者要。
   *
   * 實測六場開局的 `belowStall` 全部落在 0.08%，這個增益不需要再調。
   *
   * 【現值離懸崖有兩格】
   *
   * ```
   *        高能量開局              共速共高        longestExtend  steepShare
   * 2×EP  逾時 紅 206 : 藍   0   紅 121 : 藍   0     39.00 s       8.24%
   * 3×EP  逾時 紅  43 : 藍   0   紅 986 : 藍 461     48.50 s       4.41%
   * 4×EP  逾時 紅 561 : 藍 428   紅 305 : 藍   0     48.25 s       4.08%  ← 現值
   * 5×EP  逾時 紅 224 : 藍   0   紅 712 : 藍   0     48.00 s       5.91%
   * 6×EP  逾時 紅   0 : 藍 151   紅 115 : 藍   0     96.25 s ✗     6.91%
   * ```
   *
   * **6×EP 是明確的懸崖**：`longestExtend` 由 48 秒暴衝到 96.25 秒（破
   * 55 秒門檻），而且高能量開局的傷害交換**翻號** —— 藍方單方面挨打。
   * 壓頭壓太深，脫離就變成一去不回。現值離懸崖有兩格。
   *
   * 中間幾格同樣是混沌（3×EP 在共速共高讓藍方挨 461、5×EP 讓紅方挨 712，
   * 而兩者的高能量開局都比現值「好看」）。與 `unloadMargin` 同一個道理：
   * 不要拿單格的好看數字去調它。
   *
   * 【爬升那半邊調不動，不要試】這個增益是雙向的：`speedDeficit` 在速度
   * 過剩時變負，乘上增益就命令爬升，把速度存成高度（`ai-steer.test.ts`
   * 有三條測試在守）。但 `extend` 的淨爬升**不是被命令出來的**：
   *
   * ```
   *   命令的爬升    p90 只有 +6.1°，而且只佔 30% 的取樣
   *   做不到的俯衝  進入 extend 當下的航跡角中位 +9.7°，離開時才 +2.3°
   * ```
   *
   * 它進來時機頭就朝上，而且一直朝上。把過剩那半邊獨立出來掃 0~4 倍，
   * 結束高度平均全部落在 5051 ± 300 m 的雜訊裡（兩個開局在基準下就差
   * 393 m），`extend` 佔時、`engage` 佔時、`cornerRatio` 一欄都沒動 ——
   * **連完全不准爬升都一樣。**
   */
  pitchSpeedGain: number
  /**
   * 高度赤字 → 俯仰的增益。
   *
   * 【`2 × extendPitch` 怎麼來的】高度赤字 0.5（離地約 250 m）時就抵銷
   * 滿值的速度項，確保「低空缺速度 → 平飛」而不是俯衝。
   *
   * **目前的場景一個都量不到它。** 掃過兩組：
   *
   * 一、`ai-duel-matrix` 兩種開局：1~4 倍逐位元相同。
   *
   * 二、task #136 的六場撞地場景（真實 AI、三機、腳本射手、180 秒）——
   * 那是專門為了低空而造的場景，掃 0 / 1 / 2 / 3 / 4 / 6 倍：
   *
   * ```
   * 六個取值 × 六個場景，全部逐位元相同：
   *   400 尾追  撞地接管 0.00%  最低 2687     400 橫越  0.00%  2556
   *   800 尾追  撞地接管 0.00%  最低 3953     800 橫越  0.00%   398
   *   1000尾追  撞地接管 0.00%  最低  309     1000橫越  0.00%  3940
   * ```
   *
   * **連 0 倍（完全關掉）都一樣。**
   *
   * 【為什麼量不到】`extendPitchAngle` 只在 `extend` 意圖下執行。而那兩場
   * 低空的意圖分布是 `approach` 60% / `engage` 30% / `merge` / `defend`
   * —— **`extend` 一次都沒出現**。不是進不去那個高度，是進去的時候不在
   * `extend`。
   *
   * 【它不是低空的主要防線】真正的撞地判斷由同步護欄與物理 Worker 承擔；
   * 這一項只是 `extend` 專用的戰術補償。
   *
   * 【要量它需要什麼】一個「AI 在低空、而且處於 `extend`」的場景 ——
   * 例如讓受測 AI 在低空被逼到速度見底而觸發 `extendFloorLatch`。那個場景
   * 目前不存在，造一個是另一份的事。
   */
  pitchAltitudeGain: number
  /**
   * 低空的特徵離地高度，m。`extend` 的離地補償在這個高度以下開始作用；
   * 撤退與側翼的集合點也不低於它。撞地接管不讀這個值。
   */
  clearanceScale: number
  /**
   * 比敵人低多少公尺算「滿偏爬升」。`extendPitchAngle` 的高度項尺標。
   *
   * 【0 = 關掉高度項】那時 `extend` 只剩「速度不足就低頭」與離地保護，
   * 也就是**完全不管敵人在上面還是下面**。
   */
  altitudeGapScale: number
  /** defend 的偏轉角，rad */
  defendOffset: number
  /**
   * 破防軸往上抬的角度，rad。
   *
   * 【為什麼需要它】破防軸取世界水平面之後，75° 坡度的水平大彎會自然掉
   * 高度 —— 那個坡度要 3.9 G 才維持水平，低速時做不到。抬角把它抵消。
   *
   * 【20° 是掃出來的，不是估的】出貨飛行模型、800 m 尾追、90 秒：
   *
   * ```
   * 抬角     位移    瞄準誤差   打得中    最低高度   收尾TAS
   * 不閃     0.9°     0.0°    100.0%     4000      146
   * 現行     1.8°     0.6°     77.1%     4000       84
   *   0°    20.0°    47.5°      2.0%     2287      162   ← 掉 1713 m
   *  10°    16.4°    63.1°      6.8%     3969      133
   *  20°    11.5°    55.4°      2.4%     4000      123   ← 選定
   *  30°     9.6°    56.7°      3.2%     4000      122
   *  40°     9.1°    55.3°      8.3%     4000      127
   *  50°     9.5°    54.6°      7.0%     4000      145
   * ```
   *
   * 20° 是「打得中」的最低點，也是高度損失歸零的第一個值。橫越與對頭同向。
   *
   * 【低空不需要額外規則】3000 / 1500 / 800 m 三個開局高度，抬 20° 的最低
   * 高度都**等於開局高度** —— 「離地餘裕小就再抬高一點」沒有實測依據。
   *
   * 【什麼時候要重掃】這一項依賴當前的升力係數與過載能力，不是幾何恆等式。
   * `specs/feel.ts` 的 `lift` 或 `oswald` 大幅調動之後要重掃。
   */
  defendTilt: number
  /**
   * 反轉的距離上限，m。超過這個距離「他衝過頭」沒有意義 —— 他只是跑遠了。
   *
   * **起始值，待實測回填。** 掃描範圍 300 / 500 / 800。
   */
  reversalRange: number
  /**
   * 反轉的方位判準，rad。我的**速度向量**與「指向他的視線」的夾角小於它，
   * 就代表他已經跑到我的前半球。
   *
   * 【為什麼用速度向量而不是機首】破防時攻角很大，機首與航跡差得多。
   * 「他在我前面」問的是航跡的前面 —— 我正在往哪裡飛。
   *
   * **起始值，待實測回填。** 掃描範圍 60° / 90° / 120°。
   */
  reversalAspect: number
  /**
   * 反轉一旦觸發就做滿幾秒。
   *
   * 【為什麼要閂住而不是逐格重判】反轉是一個**動作**，不是一個狀態查詢。
   * 拉進去的那一秒裡幾何一定會離開觸發條件（他被我轉到後面去了），逐格
   * 重判等於做到一半就放手 —— 那既不是反轉也不是破防，是抖動。
   *
   * **起始值，待實測回填。** 掃描範圍 1 / 2 / 4。
   */
  reversalHold: number
  /**
   * 甜蜜區俯仰偏置的**讓位時間尺度**，秒。**0 = 這一層關閉**（消融用）。
   *
   * 斜坡整段落在開火範圍**之外**：
   *
   * ```
   *   interceptTime ≤ span        →  0    完全讓位（打得到，扳機優先）
   *   span .. 2 × span            →  線性淡出
   *   interceptTime ≥ 2 × span    →  1    照原樣偏（還打不到，把仗帶到甜蜜區）
   * ```
   *
   * 【為什麼分界要正好落在 `span`】三個地方共用這一個數字，而且它們說的
   * 是同一件事：`shouldFire` 的第一條是 `interceptTime > span → 不開火`，
   * HUD 的 `leadValid` 是 `t !== NO_INTERCEPT && t <= span`（`main.ts`）。
   * 於是有一個玩家在畫面上就能驗證的定義 —— **預瞄環出現＝打得到＝甜蜜區
   * 讓位**。分界若落在斜坡的另一端，預瞄環出現的那一刻偏置仍是滿的，
   * 開火錐 3° 對上 10° 的平衡偏移，結構上開不了火。
   *
   * 【為什麼不是階梯】`interceptTime` 在分界附近抖動時，階梯會讓偏置在
   * 0° 與 10° 之間跳，機首跟著抖。淡出段買到平滑，而它整段都在預瞄環出現
   * 之前 —— 在玩家看得到的區間裡，兩者逐位元相同。
   *
   * 【為什麼需要讓位】`sit.sweetPitch` 只看機種對、高度、空速 —— 不看距離、
   * 不看瞄準誤差、不看有沒有射擊解。命令的航跡角是
   * `−(下瞄角 × pullCeiling) + sweetPitch`，所以偏置本身就是一個**平衡偏移**：
   * 109 在 4000 m／500 km/h 的偏置是 +10°、`pullCeiling` 是 1.00，機首於是
   * 穩定停在目標線上方 10°。而 `DEFAULT_FIRE.trackingCone` 只有 3° ——
   * **那個態勢下 AI 結構上開不了火。**
   *
   * 【為什麼閘門不掛在瞄準誤差上】會鎖死。平衡點是 10°，閘門若設在 5°，系統
   * 永遠停在 10°、進不了 5°、閘門永遠不開。閘門必須掛在**偏置控制不到**的量
   * 上，`interceptTime` 由雙方位置與速度決定，當格不讀 `aimWorld` 也不讀機首。
   *
   * 【為什麼是 `PROJECTILE_LIFETIME`】不新增第二套時間尺度，直接沿用武器
   * 是否仍可命中的既有判準。
   *
   * 【尺度感】800 m 同速尾追的 `interceptTime ≈ 0.90 s`（`ai-steer.test.ts`
   * 的場景註解），低於 `span` —— 整個尾追射程內偏置都是 0。要拿回滿偏得等
   * `interceptTime ≥ 2 × span`，那是預瞄環還沒出現的距離。
   *
   * spec `2026-08-16-sweet-spot-shot-yield-design.md`。
   */
  sweetYieldTime: number
  /**
   * 「追不上」的閂上門檻（`Situation.trackRatio`）。嚴格大於才閂。
   *
   * 【1.4 是四個場景一起決定的】非護送場景的最高點是纏鬥的 **1.28**，
   * 護送關的峰值是 **2.36~2.73** —— 中間有 1.8 倍的空隙。1.4 落在纏鬥
   * 上界之上 9%、護送峰值之下 41%。
   *
   * 【為什麼不是 1.0】門檻 1.0 會讓共速共高的純纏鬥有 **47.4%** 的時間在
   * 收手。近距離繞圈時比值本來就在 1 附近徘徊，而那時候繼續轉才是對的。
   * 取 1.0 等於照著護送關過擬合。
   *
   * **`<= 0` 是整個機制的消融開關** —— 閂鎖永遠不成立，兩個意圖分支逐位元
   * 退回沒有這一層的行為。（0 在語意上是「任何值都觸發」，那是永遠不會要的設定。）
   */
  trackEnter: number
  /**
   * 釋放的門檻。低於它才開始累積安靜時間。
   *
   * 【遲滯帶】`trackExit` 到 `trackEnter` 之間既不閂上也不開始釋放，
   * 防止在門檻上抖動。與 `RuleState` 那幾個閂鎖同一個手法。
   */
  trackExit: number
  /**
   * 低於 `trackExit` 之後還要連續維持幾秒才釋放，s。
   *
   * 【為什麼要計時而不只是遲滯】遲滯處理的是門檻附近的抖動；這裡的問題是
   * **訊號本身只有 1.7 秒**（實測最長一段）。佈局是一個要花好幾秒走完的
   * 動作，不能訊號一掉就中止。
   */
  trackHold: number
  /**
   * 閂上還要求的最低視線角速度，rad/s。低於它就不閂 —— **扳機優先**。
   *
   * 【為什麼不能只靠比值】比值大只表示「相對於我的能力追不上」。一台轉彎率
   * 很低的飛機在很慢的視線角速度下也會超過門檻，而那個角速度低到
   * `DEFAULT_FIRE.maxLosRate` 根本沒擋 —— 那一格是打得到的，該讓給扳機。
   *
   * 【為什麼與 `DEFAULT_FIRE.maxLosRate` 同值卻不共用常數】兩者是同一件事的
   * 兩面（「準星穩不穩得住」），但分屬操縱層與開火紀律。跨模組耦合換不到
   * 等值的好處 —— 與 `extendTurnFade` 對 `DEFAULT_RULES.extendRange` 同一個
   * 判斷。**調其中一個時要想到另一個。**
   */
  trackLosFloor: number
  /**
   * 開始往上佈局的 `cornerRatio`。低於它只做水平轉向。
   *
   * 【為什麼用 `cornerRatio` 而不是比能量】它問的是「**現在**拉得動嗎」，
   * 而比能量問的是「帳面上有多少本錢」。帳面有本錢不等於這一格拉得動。
   */
  zoomEnter: number
  /** 往上佈局到滿的 `cornerRatio`。中間連續，不會跳。 */
  zoomFull: number

  /**
   * 空層鎖的俯仰上界，rad。**`0` 關掉整層。**
   *
   * 【它與 `sweetSpotMaxPitch`／`turnPlaneMaxPitch` 的差別】那兩個是**偏置**
   * —— 在追擊給的航跡角上再加幾度，所以追擊要往下拽它們攔不住。這一層是
   * **約束**：鎖定時直接把航跡角拉向一個高度保持解，方位仍然完全交給追擊。
   *
   * 【它模仿的動作】5000 m 面對面交會、敵人穿越之後，保持在 5000 m 左右
   * 平飛迴轉找敵人。改用俯衝迴轉的話高度掉了很難爬回來，而且會被別人
   * 俯衝攻擊。
   */
  bandMaxPitch: number
  /** 高度誤差多少公尺就給滿 `bandMaxPitch`。中間線性。 */
  /**
   * 開始鎖空層的機首夾角，rad。`aspectAngle` 超過它就不再是「對著他」。
   *
   * 【為什麼是 45°】超過 45° 就該考慮平飛迴轉、俯衝迴轉、拉高迴轉；敵人
   * 在 45° 之內時鎖空層不需要作用，那一半由 `bandHold` 的讓位閘實現 ——
   * 見該函式。
   */
  bandAspectEnter: number
  /** 鎖到滿的機首夾角，rad。`Enter`..`Full` 之間 smoothstep，沒有翻轉點。 */
  bandAspectFull: number
  /**
   * 帶半寬，m。鎖 5000 m 搭 100 就是 4900~5100，**帶內本層完全不介入**。
   *
   * 【它不是死區，是自由區】差別在於出帶之後介入力道是從 0 長上來的，所以
   * 帶緣上沒有跳變。見 `bandError`。
   */
  bandTolerance: number
  /** 出帶後再差多少公尺就給滿 `bandMaxPitch`。中間線性。 */
  bandPitchScale: number
  /**
   * 鎖住時，瞄準方向最多能離開當前航向幾度（水平面內），rad。
   *
   * 【只鎖俯仰擋不住俯衝 —— 這是實測出來的】面對面交會後目標在機尾 163°，
   * 瞄準點於是要求一個近乎 180° 的反轉。指揮儀是 bank-to-turn，最短的做法
   * 就是**滾成倒飛再拉過去**：實測坡度 95° → 153°，而俯仰指令一直老實地是
   * 0°~+5°。倒過來的飛機拉桿是往地面拉，60 秒掉 1003 m。
   *
   * 把「一次要求轉多少」壓下來之後，同一個指揮儀就會選擇**滾到 70 度左右、
   * 拉、讓機首慢慢繞過來** —— 那正是水平迴旋。目標繞到界線內時誤差自然縮小，
   * 這一層自己就退場，不需要任何額外的狀態。
   *
   * 【它不改方向只改幅度】轉左還是轉右仍然完全由追擊決定。
   */
  bandTurnCap: number
  /**
   * 拉高迴轉爬完之後，速度**至少**要剩下幾倍角落速度。
   *
   * 【它不是「現在要多快」】判準是 `zoomAffordable`：把 `bandZoomGain` 的高度
   * 從動能裡扣掉之後還剩不剩得下這個比值。裸比值的版本實測會讓 109 爬完剛好
   * 掉到角落速度上，之後追不上任何人 —— 見該函式的註解。
   */
  bandZoomRatio: number
  /** 拉高迴轉往上抓幾公尺。到頂就停 —— 鎖的是**帶**不是爬升率。 */
  bandZoomGain: number
  /**
   * 俯衝迴轉的門檻：我要比敵人高幾公尺才准往下轉。
   *
   * 【為什麼門檻這麼高】俯衝迴轉**只有在高度非常高的時候才用**。高度掉了
   * 很難爬回來，而且會被別人俯衝攻擊 —— 那是這一整層存在的理由，不能被
   * 自己的一個分支破壞。
   */
  bandDiveGap: number
  /** 俯衝迴轉往下放幾公尺。不會低於敵人所在的高度。 */
  bandDiveDrop: number
}

/**
 * 由實測回填的：`unloadMargin`、`speedRecoverMargin`、`speedRecoverPitch`、
 * `brakeCornerRatio` 與 `extend` 的三個俯仰參數（掃描表在各欄位的註解裡）。
 * 仍是起始值的：`overshootRange`、`maxOffsetAngle`、`defendOffset`。
 *
 * 【這一層不受手感倍率影響】判準全部寫成**比值**，分母是飛機自己的氣動
 * 性能（`stallMargin` = TAS ÷ 失速速度、`cornerRatio` = TAS ÷ 角落速度）。
 * 手感倍率一動分母同步跟著走 —— 持續迴旋率動過 +87%，`ai-manoeuvre` 五條
 * 指標沒有任何一條接近門檻，三條還變好。
 *
 * 【怎麼分辨「真的該調」與「只是這一格剛好好看」】現行預設在高能量開局是
 * 紅 561 : 藍 428，而**三個旋鈕的單軸擾動都能改善它**
 * （`unloadMargin` 1.10、`brakeCornerRatio` 1.40、`pitchSpeedGain` 2×EP
 * 都讓藍方 0 傷）。只看「改善了沒」會誤以為三個都該調。分野在**證據的
 * 形狀**：混沌的旋鈕給出**互相矛盾的鄰格**，有訊號的旋鈕給出**連續取值
 * 逐位元相同的平台**。只採信平台。
 *
 * 完整的掃描資料與推論見
 * `docs/superpowers/specs/2026-08-07-ai-energy-recalibration-design.md`。
 */
export const DEFAULT_STEER: SteerConfig = {
  overshootRange: 120,
  unloadMargin: 1.15,
  speedRecoverMargin: 1.25,
  // 【與安全層的 recoveryPitch 對稱】掃過 0°／5°／10°／20°／30°：對高能量
  // 開局的勝負沒有訊號（0° 與 20° 都是逾時，30° 反而擊落但那是混沌敏感，
  // 不是趨勢）。取 20° 的理由是與安全層對稱，兩層的動作幅度一致
  speedRecoverPitch: 20 * (Math.PI / 180),
  maxOffsetAngle: 20 * (Math.PI / 180),
  brakeCornerRatio: 1.8,
  extendPitch: EXTEND_PITCH,
  // 【為什麼要 20° 而不是 10°】10° 的偏置換算約 1°/s 的轉率，從右後方回場
  // 要 33 秒 —— 肉眼看就是直飛，交會後觸發 extend 的敵人在右後方時完全看
  // 不出 AI 有朝他轉。20° 約 10°/s，回場 15 秒。
  //
  // 【「轉彎消耗能量」在這裡擋不住大角度】能量帳高度佔九成
  // （`kineticWeight`）、高度鎖的出場只看高度 —— 轉彎掉的速度幾乎不動這
  // 兩本帳。rearHigh 開局：
  //
  // ```
  //   cap    重新對上    護送主判準（谷底對轟炸機）
  //   10°      33 s        −131
  //   20°      15 s        −137   ← 取這個
  //   30°      11 s        —      （最低點 −543，弧內掉太多）
  // ```
  //
  // 順帶把 frontAbove（敵人在上方）從「60 秒內對不上」修成 12 秒。
  // 已知代價：倒飛開局的最低點 −308 → −685（回正 + 轉向疊在一起時弧內
  // 下沉變深），人工試飛若在意再回頭。
  extendTurnCap: 20 * (Math.PI / 180),
  extendVigorEnter: 0.85,
  extendVigorFull: 1.05,
  diveSelfRatio: 0.90,
  diveTargetRatio: 1.05,
  divePitch: 45 * (Math.PI / 180),
  extendTurnFade: 750,
  pitchSpeedGain: 4 * EXTEND_PITCH,
  pitchAltitudeGain: 2 * EXTEND_PITCH,
  clearanceScale: 500,
  altitudeGapScale: ALTITUDE_GAP_SCALE,
  defendOffset: 75 * (Math.PI / 180),
  // ## defendTilt 的定值
  //
  // 【它為什麼要這麼大】P-51D 在 4,427 kg 的試飛重量下氣動可用過載只有
  // 10.43 G，破防的角速度因此偏小，四條行為護欄會一起紅。抬角加大同時對
  // 得上那四條：既讓預瞄點的垂直位移變大（「看得出在閃」），又減少破防時
  // 往海面掉（安全層介入）。
  //
  // ```
  //   tilt  正下方閃躲  後上方400m  400m掉血  安全層  其他        總紅燈
  //   20°     1.73°       93.2%     1000死   3.04%   —              4
  //   30°     1.97°       31.0%      214     0.64%   —              2
  //   31°     2.15°       30.7%      304     0       —              0  ← 出貨
  //   32°     2.31°       30.8%      326     0       戰術效果 ×2     2
  //   33°     2.37°       30.5%      317     0       shootableShare  1
  //   34°     2.47°       30.7%      326     0       撞海 + 戰術     2
  //   36°     2.67°       30.7%      614     —       —              2
  //   40°     2.85°       30.5%      815     —       —              2
  // ```
  //
  // 【窗口很窄，這件事本身要記住】31° 是**唯一**全綠的值。三個方向各自把
  // 它夾住：
  //
  //   下界  「正下方」的閃躲角必須大於一個命中錐（2°）。30° 只有 1.97°。
  //   上界一  36° 以上抬角把 AI 帶進更垂直的機動，出彎能量更低反而更容易
  //           被咬 —— 後上方那一格的掉血由 304 跳到 614。
  //   上界二  **34° 開始低空纏鬥會飛進海裡**（零反應延遲下 9,543 步觸海，
  //           門檻是 0）。32° 還乾淨，33/34 之間有一個陡坎。
  //
  // 中間的 32° 與 33° 各自打破一條 20v20 的混沌聚合量（戰術開關對照、
  // shootableShare）。**所以不要把這個值當成可以隨手微調的旋鈕**：任一方向
  // 動 1–2 度就會有東西紅，而且紅的不是同一條。
  //
  // 【不要改用 `defendOffset` 代替】偏轉角改的是「往哪邊閃」，而這幾格缺的
  // 是「別掉高度」。把它放到 85°（tilt 留 20°）閃躲角是修好了（2.62°），
  // 但後上方 400 m 反而更糟（96.2%、還是被打死），而且一樣打破戰術對照。
  //
  // 【對別的機種】這是共用參數，109 也照吃。動它會改變 20v20 的重播校驗和。
  defendTilt: 31 * (Math.PI / 180),
  // ## 反轉的三個參數
  //
  // 六個高接近率場景（紅 B 起始 TAS 280 對藍方 200）× 180 秒，警戒已上線：
  //
  //   range aspect hold   反轉次數  佔時    反轉中有射擊解
  //    500    90°   2s      19     2.64%      9.6%   ← 選定
  //    300    90°   2s       8     1.13%      3.2%
  //    800    90°   2s      38     6.09%     10.2%
  //    500    60°   2s       7     1.13%      9.6%
  //    500   120°   2s      30     4.96%      5.7%
  //    500    90°   1s      30     2.52%      7.5%
  //    500    90°   4s      19     4.78%      5.9%
  //
  // 【沒有最佳點，所以取起始值】品質（反轉期間拿到射擊解的比例）在
  // 5.7~10.2% 之間平坦；次數則單純隨判定放寬而增加。真正的決定因素是
  // 「要花多少比例的時間**不閃躲**」—— 反轉期間 AI 是在轉進去而不是轉開，
  // 而它同時仍然在挨打。800/90/2 的次數多一倍、品質只多 0.6 個百分點，
  // 代價是 6.09% 對 2.64% 的不閃躲時間。
  //
  // 【這一組最該由人工試飛定案】這一項的定位是「難得發生時很精彩」。
  // 500/90/2 是每分鐘約一次；覺得太少就放寬 range，覺得 AI 在該閃的時候
  // 發呆就收緊。
  //
  // 【它靠警戒訊號吃飯】`defend` 進入率低到 5% 時三個條件的第三條幾乎不
  // 成立，反轉恆為 0 —— 那時要查的是警戒層，不是這三個值。
  reversalRange: 500,
  reversalAspect: 90 * (Math.PI / 180),
  reversalHold: 2,
  sweetYieldTime: PROJECTILE_LIFETIME,
  // 【出貨值 0 = 這一層關著】開著時護送關的谷底由 −368 m 惡化到 −921 m、
  // 峰值到谷底由 792 m 惡化到 1353 m。它只用角速度、把角度丟掉了 ——
  // 敵人在機體仰角 +86 度而它說「追得上」。同一件事由打法層的
  // `turnPlanePitch` 承擔（見 `doctrine.ts`）。
  trackEnter: 0,
  trackExit: 1.0,
  trackHold: 3.0,
  trackLosFloor: 0.35,
  zoomEnter: 1.00,
  zoomFull: 1.30,
  // ## 空層鎖
  //
  // 起始值。兩個角度門檻是指定的 45° 及其平滑到頂的位置；其餘六個待
  // `band-drill.probe.ts` 掃描回填。
  bandMaxPitch: 20 * (Math.PI / 180),
  bandAspectEnter: 45 * (Math.PI / 180),
  bandAspectFull: 60 * (Math.PI / 180),
  bandTolerance: 100,
  bandPitchScale: 200,
  bandTurnCap: 75 * (Math.PI / 180),
  bandZoomRatio: 1.15,
  bandZoomGain: 400,
  bandDiveGap: 1200,
  bandDiveDrop: 400,
}

/**
 * 幾何有效性閘門（spec §7.1）。在算 yo-yo 平面之前先過。
 *
 * 【優先序：超前 > 沒空速 > 拉太猛 > 平面退化】撞上去比失速嚴重；沒空速
 * 比拉太猛嚴重（前者要壓機頭換速度，後者只要停止拉桿）；失速比瞄不準嚴重。
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

  // 【兩個判準各管一種失效模式，補救動作相反】
  //   speedMargin 低 = 快沒空速  → 壓機頭換速度
  //   stallMargin  低 = 拉太猛   → 卸載，機頭跟著速度向量
  // **兩者不可以合併成同一個 mode**：共用 `unloadAim(self, 0)` 對「拉太猛」
  // 正確、對「快沒空速」是無操作（spec §5.1 的缺陷 3）。
  //
  // 【不准加仰角前提】「目標仰角 > 45° 或自己航跡角 > 45°」那種前提會讓
  // 同一空層平飛追擊時速度掉到一半也不動。速度不足在任何姿態都是問題；
  // 俯衝時速度自然高，不會誤觸發。
  if (sit.speedMargin < cfg.speedRecoverMargin) return 'speedRecover'
  if (sit.stallMargin < cfg.unloadMargin) return 'unload'

  // 真正的幾何奇異：升力方向 ∥ 視線，「上方」沒有唯一解
  if (basis.verticalDegenerate) return 'planeDegenerate'

  return 'normal'
}

export interface Knobs {
  /** −1 = 後置追擊、0 = 純追擊、+1 = 前置追擊（彈道預瞄點） */
  leadLag: number
  /** −1 = 壓到交戰平面下方、0 = 同平面、+1 = 拉到上方 */
  vertical: number
  /**
   * 規則 3 的俯衝目標 IAS，m/s。**0 = 關閉。**
   *
   * 由 `AiController` 每步寫入 —— `steerCommand` 讀不到 `RuleState`，「這一段
   * 是不是規則 3 的脫離」只有它知道。見 `redlineDiveIas`。
   */
  diveIas: number
}

/**
 * 規則 3 的俯衝目標 IAS，m/s。**0 = 沒有實質餘裕，不俯衝。**
 *
 * 【餘裕條件】對手紅線 × `diveTargetRatio` 要低於自己的 × `diveSelfRatio`
 * 才算：P-51 對 Bf109（787 對 729 km/h）不成立，行為一個字不變；F4F 對 A6M
 * （549 對 630）成立。俯衝到對手放手的速度就夠，不是俯衝到自己的極限。
 */
export function redlineDiveIas(
  vneSelf: number, vneTarget: number, cfg: SteerConfig = DEFAULT_STEER,
): number {
  const target = cfg.diveTargetRatio * vneTarget
  const ceiling = cfg.diveSelfRatio * vneSelf
  return target < ceiling ? target : 0
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
  // 【為什麼是 `max(0, cos)` 而不是 `(1+cos)/2`】後者在正側面（90°）還留
  // 一半權重，於是敵機在前方 600 m 由左舷橫越到右舷時，瞄準點停在「飛機與
  // 預瞄點中間」—— 那是後置量。橫越的接近率與對頭一樣是幾何給定的，後置
  // 減不掉它，只會讓 3° 開火錐永遠對不上偏射的預瞄點。現在的門讓尾追
  // （< 90°）才漸進觸發，側面與前半球完全不後置。
  const pursuit = Math.max(0, Math.cos(sit.angleOffTail))

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

/**
 * 佈局下一次射擊機會的旋鈕：**後置追擊 + 依能量往上**。就地寫入 `out`。
 *
 * 【它不是脫離】轉向的目的是**創造下一次瞄準敵人的機會**。後置追擊把需要
 * 的角速度降下來、保住能量，高 yo-yo 用高度換取下一次進場的位置 —— 兩者
 * 都是為了繼續打，不是為了離開。
 *
 * 【與 `engageKnobs` 的分工】那一個由**接近率**決定（太快就後置、追不上就
 * 切內線），問的是速度；這一個在**機頭追不上預瞄點**時取代它，問的是角速度。
 * 兩者不會同時生效 —— 呼叫端二選一。
 */
export function repositionKnobs(
  sit: Situation,
  out: Knobs,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  out.leadLag = -1
  // 【非有限值退化成不往上】水平轉向在任何狀態下都是安全的
  out.vertical = Number.isFinite(sit.cornerRatio)
    ? smoothstep(cfg.zoomEnter, cfg.zoomFull, sit.cornerRatio)
    : 0
}

/**
 * 空層鎖選中的走法。`off` = 沒鎖，完全交給追擊。
 */
export type BandKind = 'off' | 'level' | 'zoom' | 'dive'

/**
 * 空層鎖自己的跨格狀態。與 `DefendState` 同一個位階 —— 由呼叫端持有、
 * 以參數傳入，`steer.ts` 本身仍然沒有可變的全域狀態（spec §4.3）。
 *
 * 【為什麼需要跨格】鎖的是**進入那一刻的高度**。每格重算的話它永遠等於
 * 「現在的高度」，誤差恒為 0，一層什麼都不做的恆等式。同理，三種走法也只
 * 在進入時挑一次 —— 轉到一半改主意是兩邊都不到位。
 */
export interface BandState {
  kind: BandKind
  /**
   * 這一刻生效的空層，m。`kind === 'off'` 時無意義。
   * 每步由 `min(anchor, sit.chaseAlt)` 重算 —— 見 `stepBand` 的夾制註解。
   */
  altitude: number
  /**
   * 進場時選定的走法目標高度，m —— `altitude` 的上界。
   *
   * 【為什麼要跟 `altitude` 分開存】基準要能動態貼著下方的敵人走（他降
   * 我跟著降、他爬回來我最多回到這裡），所以「進場時挑的那個數字」必須
   * 另外留著，`altitude` 才有東西可以夾。
   */
  anchor: number
  /** 鎖的力道，0..1。0 = 完全不介入、1 = 航跡角完全由高度帶決定 */
  hold: number
  /**
   * 轉向側，+1 = 左（與 `headingErrorTo` 同號）。
   *
   * 【沒有它會在正後方直飛 —— 實測 18 秒】面對面完美對穿之後目標停在正後方
   * 180°，`headingErrorTo` 的符號由浮點雜訊決定、逐格翻面，被上限夾出來的
   * 瞄準點於是左右輪流跳，指揮儀平均下來就是**直飛**（機首夾角 176°~180°、
   * 坡度 0°、距離 581 → 6,958 m）。與 `stepExtendSide` 管的是同一個死區，
   * 分開存是因為兩者的生命週期不同（那個跟著 extend 的進出走）。
   */
  side: number
}

export function createBandState(): BandState {
  return { kind: 'off', altitude: 0, anchor: 0, hold: 0, side: 1 }
}

/**
 * 鎖空層的力道，0..1。`max(夾角項, 射程項) × 讓位閘`。
 *
 * ```
 *   夾角項   smoothstep(45°..60°)      對不上他 —— 這是一個彎，不是一次修正
 *   射程項   sweetYield（攔截時間）    還不到拚的時候，先把高度守住
 *   讓位閘   射程項 < 0.3 時整層淡出   真的打得到就全力咬預瞄點
 * ```
 *
 * 前兩項是這一層的兩個觸發（「超過 45 度就考慮平飛迴轉」「在射程範圍外
 * 也是鎖空層」）；讓位閘是「進入射程則解除」—— 用的尺與開火紀律、玩家
 * 預瞄環同一把（`PROJECTILE_LIFETIME`）。
 *
 * 【為什麼讓位是乘上去的閘，不是把夾角項刪掉 —— 兩個方向各被咬過一次】
 *
 *   只留 max：射程內的轉圈戰裡目標隨時甩出 45° 外，夾角項把俯仰鎖回平飛、
 *   轉向夾在 75°，預瞄點在垂直方向上不准追 —— 人工回報「追不到預瞄點，
 *   轉彎的 AoA 沒辦法到極限」。而實測鎖住的迴轉段 G 5.5~6.9、失速餘裕
 *   1.05~1.13，拉桿從來不是問題，是鎖錯了時機。
 *
 *   只留射程項：對穿瞬間 `solveLead` 對後方目標常常仍有解，射程項從斜坡
 *   中段（0.37）慢慢爬，力道不足再加上閃爍重鎖，迴轉段漏掉 250 m ——
 *   護送關主判準從 +723 退到 −87。夾角項在那一刻是 1，正好補上。
 *
 * 【讓位閘的 0.3】射程項本身是攔截時間 1.2→2.4 s 的線性斜坡，0.3 對應
 * 「再 0.4 秒的彈道時間就進射程」。閘在 0..0.3 之間線性，沒有翻轉點。
 */
export function bandHold(
  sit: Situation,
  basis: EngageBasis,
  cfg: SteerConfig = DEFAULT_STEER,
): number {
  if (!(cfg.bandMaxPitch > 0)) return 0
  const wide = smoothstep(cfg.bandAspectEnter, cfg.bandAspectFull, sit.aspectAngle)
  const far = sweetYield(basis.interceptTime, cfg)
  const hold = wide > far ? wide : far
  const gate = far >= 0.3 ? 1 : far / 0.3
  return hold * gate
}

/**
/**
 * 爬 `bandZoomGain` 這麼高之後，速度還在 `bandZoomRatio` 倍角落速度以上嗎？
 *
 * 【為什麼不是「現在夠不夠快」】`cornerRatio > 1.15` 就拉高的話：
 * 面對面交會後 109 以 174 m/s（`cornerRatio` 1.16）判定「速度夠」，爬完 400 m
 * 掉到 132 m/s —— **正好落在角落速度上**，之後 40 秒都在慢慢爬、追不上直飛的
 * 靶機，距離由 2.3 km 拉到 4.8 km。裸比值回答的是「我現在快不快」，而該問的是
 * **「這筆交易付得起嗎」**。
 *
 * ```
 *   可動用的高度 = (V² − (k·Vc)²) / 2g        k = bandZoomRatio
 *   付得起       = 可動用的高度 > bandZoomGain
 * ```
 *
 * 【它自動跟著 `bandZoomGain` 走】想爬得更高，門檻自己就變嚴 —— 不必再掃一次
 * 比值。這是把兩個本來會分岔的旋鈕收成一個的作法。
 *
 * 【`cornerRatio` 非有限值退化成不准】沒有角落速度就沒有這筆帳可算，而水平
 * 迴轉在任何狀態下都是安全的（與 `repositionKnobs` 同一條退化原則）。
 */
function zoomAffordable(sit: Situation, self: Aircraft, cfg: SteerConfig): boolean {
  if (!Number.isFinite(sit.cornerRatio) || sit.cornerRatio <= 0) return false
  const tas = self.state.velocity.length()
  const floor = (tas / sit.cornerRatio) * cfg.bandZoomRatio
  return (tas * tas - floor * floor) / (2 * G0) > cfg.bandZoomGain
}

/**
 * 維護空層鎖。每個物理步呼叫一次，就地改 `state`。
 *
 * @param active 現在是不是**攻擊階段**。`extend` 與 `defend` 有自己的高度邏輯，
 *               鎖要在那兩個意圖下退出 —— 不然脫離完回來會拿到一個幾十秒前的高度。
 */
export function stepBand(
  state: BandState,
  active: boolean,
  sit: Situation,
  basis: EngageBasis,
  self: Aircraft,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  const hold = active ? bandHold(sit, basis, cfg) : 0
  state.hold = hold
  if (hold <= 0) {
    state.kind = 'off'
    return
  }
  // 【側別只在方向明確時更新】正後方 ±20°（與 `EXTEND_SIDE_HOLD` 同值）是
  // 死區，沿用上一格 —— 理由見 `BandState.side`。
  const err = headingErrorTo(self, basis.losAxis)
  if (Math.abs(err) < Math.PI - EXTEND_SIDE_HOLD) state.side = err >= 0 ? 1 : -1
  // 【已經鎖住就不重挑走法】見 `BandState` 的註解 —— 但基準夾制（下方）
  // 每步都要重算，所以不能在這裡 return。
  if (state.kind === 'off') {
    const alt = self.state.position.y
    if (sit.altitudeAdvantage > cfg.bandDiveGap) {
      state.kind = 'dive'
      // 【不會低於敵人】俯衝迴轉是把**多餘的**高度換成速度，不是把優勢
      // 丟掉。兩項設定目前不可能讓這一行生效（Drop 400 < Gap 1200），但
      // 它是這個分支的**定義**而不是設定值的副作用。
      const floor = alt - sit.altitudeAdvantage
      const wanted = alt - cfg.bandDiveDrop
      state.anchor = wanted > floor ? wanted : floor
    } else if (zoomAffordable(sit, self, cfg)) {
      state.kind = 'zoom'
      state.anchor = alt + cfg.bandZoomGain
    } else {
      state.kind = 'level'
      state.anchor = alt
    }
  }

  // 【基準跟著下方的敵人走】沒有這一項時：
  // P-51 在 4800、敵機在下方射程內打轟炸機，夾角項鎖住俯仰 → 機頭壓不向
  // 他 → 攔截時間不收斂 → 讓位閘永遠不開 —— 「近在眼前卻死不低頭」，
  // 最後迴轉閂鎖把人帶走。鎖自己的層只在「敵人同層或在上」成立；敵人在
  // 下方時空層要**貼著他那層**，下降的過程會讓機頭壓得向他、攔截收斂、
  // 讓位閘照常打開。
  //
  //   `chaseAlt = max(目標高度, 被護送最低)` —— 護送中不低於轟炸機，
  //   「不陪他鑽到編隊下面」自動成立；下限另有高度鎖（floor）接著。
  //   取 min：敵人在上或同層時 chaseAlt ≥ anchor，行為一個字不變；
  //   敵人在下方時動態貼著他（他降我降、他爬回來最多回到 anchor）。
  //   俯衝走法的 anchor 在敵人低於它時同樣被貼下去 —— 與本設計一致，
  //   「多留一段優勢」讓位給「下去接戰」。
  state.altitude = state.anchor < sit.chaseAlt ? state.anchor : sit.chaseAlt
}

/**
 * 超出高度帶多遠，−1..1。**0 = 在帶內，本層完全不介入**。正 = 帶在上面、該爬。
 *
 * 【為什麼鎖的是一個帶而不是一條線】鎖 5000 m 指的是 4900~5100 這一段。
 * 鎖一條線的話，20 m 的誤差也會下指令 —— 而高度會被拉桿、
 * 推力、坡度不斷推開，結果是整個轉彎過程中俯仰指令一直在抗。帶內交給追擊，
 * 追擊才有空間把機首帶到該去的地方。
 *
 * 【為什麼出帶之後是斜坡而不是閥】帶緣上的閥就是一個裸門檻：跨線瞬間下滿舵、
 * 飛機有俯仰慣性、衝過頭、再跨回來 —— spec §3.5 量到的那個振盪 40 秒的極限環。
 * 回傳值同時驅動**指令角度**與**介入力道**（見呼叫端），所以帶緣上這一層是
 * 逐位元的恆等式，沒有任何不連續。
 */
export function bandError(deltaAltitude: number, cfg: SteerConfig = DEFAULT_STEER): number {
  if (!(cfg.bandPitchScale > 0)) return 0
  const tol = cfg.bandTolerance
  let excess = deltaAltitude > tol
    ? deltaAltitude - tol
    : deltaAltitude < -tol ? deltaAltitude + tol : 0
  if (excess === 0) return 0
  excess /= cfg.bandPitchScale
  if (excess < -1) return -1
  if (excess > 1) return 1
  return excess
}

const A = makeScratch(2)

/** `repositionKnobs` 的輸出暫存。與 `makeScratch` 同一個理由：不在熱路徑配置 */
const RK: Knobs = { leadLag: 0, vertical: 0, diveIas: 0 }

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

/**
 * `extend` 的俯仰角，rad。正 = 爬升。
 *
 * 【`extend` 只能搬能量，補不了能量】總能量由推力決定，而推力就那麼多。
 * 這一層唯一能決定的是**能量放在高度還是速度裡**。所以問題不是「我能量夠
 * 不夠」（那是 `rules.ts` 的閂鎖在管），而是「這些能量該擺哪」。
 *
 * 【三個分量，每一個都單向】疊加而不是 if-else：裸門檻跨線時指令瞬間翻號，
 * 而飛機有俯仰慣性，跨線後要幾秒才轉得過來 —— 衝過頭、翻號、再衝過頭。
 * 實測在 1000 m 線上持續震盪 40 秒（spec §3.5）。連續函數沒有翻轉點。
 *
 * ```
 *   速度不足 → 低頭     只在 cornerRatio < 1 時作用
 *   比敵人低 → 抬頭     altitudeGapScale 是尺標，**而且要先有機動速度**
 *   離地太近 → 抬頭     clearanceScale 是尺標，安全項
 * ```
 *
 * 【第二項的前提是第一項已經滿足】爬升花能量，而這個意圖存在的理由是補能量。
 * 沒速度就往上爬會走進一個死角，見下面 `gapDeficit` 那一段的實測。第三項
 * **沒有**這個前提 —— 它是安全項，撞地比沒速度嚴重。
 *
 * 兩個抬頭的理由**取較急的那個**而不是相加 —— 它們是同一件事的兩個來源
 * （「該往上」），相加只會讓兩者同時成立時多爬一倍。
 *
 * 【為什麼速度項只剩下半邊】「速度過剩就爬升」是把動能換成位能，而實測
 * 那筆交易在高空幾乎沒有收益：全場高度 +2,346 m、空速只 +2 m/s，總能量
 * 原地打轉，`extend` 因此佔掉 56% 的時間、能量閂鎖最長一段 197 秒。
 * 該不該往上由**敵人在哪**回答，不由「我此刻速度多少」回答。
 *
 * 【為什麼不是比總能量】`energyAdvantage` 已經把位能與動能加在一起，而
 * 搬運不會改變它 —— 拿它當這裡的判準，等於問一個對三個選項都相同的數字。
 * 見 `Situation.altitudeAdvantage`。
 *
 * @param cornerRatio TAS ÷ 自己的角落速度
 * @param altitudeAdvantage 我比目標高幾公尺。負 = 我在下面
 * @param groundClearance 離地（海面）高度，m
 */
export function extendPitchAngle(
  cornerRatio: number,
  altitudeAdvantage: number,
  groundClearance: number,
  cfg: SteerConfig = DEFAULT_STEER,
): number {
  // 【只有下半邊】速度過剩不構成爬升的理由，見上面
  let speedDeficit = 1 - cornerRatio
  if (speedDeficit < 0) speedDeficit = 0

  let floorDeficit = 1 - groundClearance / cfg.clearanceScale
  if (floorDeficit < 0) floorDeficit = 0
  else if (floorDeficit > 1) floorDeficit = 1

  // 【沒有目標時不表示意見】altitudeAdvantage 非有限值 = 沒得比
  let gapDeficit = 0
  if (cfg.altitudeGapScale > 0 && Number.isFinite(altitudeAdvantage)) {
    gapDeficit = -altitudeAdvantage / cfg.altitudeGapScale
    if (gapDeficit < 0) gapDeficit = 0
    else if (gapDeficit > 1) gapDeficit = 1
    // 【速度先於高度】爬升是**花**能量，而 `extend` 存在的理由是**補**能量。
    // 沒有機動速度就往敵人的高度爬，等於用僅剩的動能去換一個自己守不住的位置。
    //
    // 實測（`band-drill.probe.ts`，敵人在前上方 1000 m）：少了這道閘，109 在
    // 5750 m／137 m/s 進入一個死角 —— 高度項要它維持 +4°，速度項只給 −9° 的
    // 一小截，兩者抵成幾乎平飛。它於是既不俯衝換速度也追不上，一路直飛到
    // **10 km 外**，`extendEnergyLatch` 因為能量差 −945 m 永遠不解除。
    //
    // 【為什麼是斜坡不是 `if`】與這個函式的其他每一項同一條理由：裸門檻在
    // 線上會翻號，而飛機有俯仰慣性。
    gapDeficit *= smoothstep(1, cfg.unloadMargin, cornerRatio)
  }

  const climb = floorDeficit > gapDeficit ? floorDeficit : gapDeficit
  const raw = -cfg.pitchSpeedGain * speedDeficit + cfg.pitchAltitudeGain * climb
  if (raw < -cfg.extendPitch) return -cfg.extendPitch
  if (raw > cfg.extendPitch) return cfg.extendPitch
  return raw
}

const E = makeScratch(2)

/** 正後方的側別死區，rad。錨點落在這個扇形內時沿用上一格的側別 */
const EXTEND_SIDE_HOLD = 20 * (Math.PI / 180)

/**
 * 由**當前航向**轉到 `toTarget` 的水平方位要轉多少，rad，值域 (−π, π]。
 * `toTarget` 是**指向錨點的方向**（不必單位化），不是它的世界座標。
 * 正 = 繞 +Y 的正向（左）。與 `unloadAim` 的 `yaw` 同一個約定。
 *
 * 航向取**速度向量**的水平投影而不是機首：脫離時要問的是「我正在往哪裡
 * 走」，而機首在有側滑或大迎角時與航跡差一個角度。速度鉛直時水平投影
 * 退化，改用機首的水平投影（與 `unloadAim` 走同一條退化階梯）。
 *
 * 熱路徑（240 Hz），不配置。
 */
export function headingErrorTo(self: Aircraft, toTarget: Vector3): number {
  const v = self.state.velocity
  let ax = v.x
  let az = v.z
  let ah = Math.hypot(ax, az)
  if (ah < 1e-6) {
    const nose = E.v[0]!.copy(FWD).applyQuaternion(self.state.orientation)
    ax = nose.x
    az = nose.z
    ah = Math.hypot(ax, az)
    if (ah < 1e-6) return 0
  }
  ax /= ah
  az /= ah

  let bx = toTarget.x
  let bz = toTarget.z
  const bh = Math.hypot(bx, bz)
  // 【正上／正下方】水平方位沒有定義。回 0 = 不轉，那是安全的方向 ——
  // 目標就在頭頂時「往哪邊繞」本來就沒有答案，交給俯仰去處理。
  if (bh < 1e-6) return 0
  bx /= bh
  bz /= bh

  return Math.atan2(az * bx - ax * bz, ax * bx + az * bz)
}

/**
 * `extend` 期間瞄準點要偏離當前航向多少，rad。正 = 左，與 `unloadAim` 的
 * `yaw` 同一個約定。
 *
 * 【為什麼是 `min` 而不是比例】要的是「一直朝錨點轉，但每一格只准偏這麼
 * 多」。錨點已經在 `cap` 之內時就直接對準它 —— 用比例的話永遠差一截，
 * 航向會漸近而不抵達。
 *
 * 【側別由呼叫端給】與 `defendAim` 收 `axisSign` 是同一個分工：純函數沒有
 * 「這是不是第一格」的資訊，而正後方的翻轉只有跨格記憶治得了。
 *
 * @param side         `DefendState.extendSide`，+1 / −1。**0 = 不偏**
 * @param headingError `headingErrorTo` 的值
 * @param cornerRatio  速度餘裕。非有限值退化成滿偏（沒有角落速度就沒有
 *                     這本帳；收緊的退化會讓 extend 永遠直飛不回頭）
 */
export function extendHeadingBias(
  side: number,
  headingError: number,
  range: number,
  cornerRatio = Infinity,
  cfg: SteerConfig = DEFAULT_STEER,
): number {
  const cap = cfg.extendTurnCap
  // 【`!(cap > 0)`】同時擋掉 0、負值與 NaN —— 後者會讓下面的 min 回傳 NaN
  // 然後汙染整個 aimWorld。0 = 這一層關閉，是消融的開關。
  if (side === 0 || !(cap > 0)) return 0
  if (!Number.isFinite(headingError) || !Number.isFinite(range)) return 0
  // 【近距離不偏】見 `SteerConfig.extendTurnFade` —— 沒有這一層 AI 會繞著
  // 目標盤旋。壞掉的淡入距離退化成「全程套用」，與 0 同義。
  const fade = cfg.extendTurnFade > 0
    ? smoothstep(0, cfg.extendTurnFade, range)
    : 1
  if (fade === 0) return 0
  // 【速度先於轉向】上限限的是「瞄準點偏
  // 多遠」，不是「拉多少 G」：對著**持續旋轉**的方位（敵人在下方繞圈打
  // 轟炸機），20° 的誤差永遠追不完，飛控就一直壓 60~75° 坡度拉 4 G ——
  // 阻力吃掉俯衝的全部速度收益，空速釘死、「速度先於高度」閘門把爬升
  // 掐死、跌破地板繼續跌（belowOrbit 實測：50 秒漏 1300 m 出不了場）。
  //
  // 乘上速度餘裕把正回饋剪成負回饋：缺速度 → 翼平直飛 → 阻力小 → 速度
  // 真的回來 → 偏置線性開回來 → 轉太多掉速又自己收。斜坡是
  // `extendVigorEnter`..`Full`（0.85 → 1.05）：底在角落速度**下方** ——
  // cr = 1 是最會轉的速度，不是懸崖；定值依據見兩個欄位的註解。
  const vigor = Number.isFinite(cornerRatio)
    ? smoothstep(cfg.extendVigorEnter, cfg.extendVigorFull, cornerRatio)
    : 1
  if (vigor === 0) return 0
  const want = headingError < 0 ? -headingError : headingError
  return side * (want < cap ? want : cap) * fade * vigor
}

/**
 * 每個物理步更新 `extend` 的轉向側。與 `stepDefend` 同一個位階、同一個
 * 理由 —— 跨格狀態必須由持有它的那一層決定。
 *
 * 【為什麼不是純閂鎖】純閂鎖（進入時決定一次、整段不變）在換目標之後會
 * 讓 AI 往錯的一側繞遠路，而實測 23~33% 的脫離段落中途換過目標
 * （`energy-window.probe.ts`）。改成**只在錨點接近正後方時**沿用上一格 ——
 * 翻轉點被死區蓋住，其餘角度照實跟隨。這與 `FlightDirector` 的
 * `reverseHysteresis` 是同一個手法。
 *
 * @param extending 這一格的意圖是不是 `extend`
 */
export function stepExtendSide(
  state: DefendState,
  self: Aircraft,
  target: Aircraft | null,
  extending: boolean,
): void {
  if (!extending || target === null) {
    state.extendSide = 0
    return
  }
  const dir = E.v[1]!.copy(target.state.position).sub(self.state.position)
  const err = headingErrorTo(self, dir)
  if (state.extendSide !== 0 && Math.abs(err) > Math.PI - EXTEND_SIDE_HOLD) return
  state.extendSide = err >= 0 ? 1 : -1
}

/**
 * 繞 +Y 把向量轉 `yaw`，就地修改。**航跡角與長度天然不變** —— 這正是它
 * 適合當 `unloadAim` 的後處理的理由：俯仰那一層的決定完全不受影響。
 */
function rotateHeading(v: Vector3, yaw: number): void {
  if (yaw === 0) return
  const s = Math.sin(yaw)
  const c = Math.cos(yaw)
  const x = v.x * c + v.z * s
  const z = -v.x * s + v.z * c
  v.x = x
  v.z = z
}

/** 超前修正的固定旋鈕：全後置 + 全高 yo-yo。 */
const OVERSHOOT_KNOBS: Knobs = { leadLag: -1, vertical: 1, diveIas: 0 }

/**
 * 卸載的拉桿係數，0..1。1 = 照常拉、0 = 完全鬆桿（瞄準機首）。
 *
 * 【為什麼是 `(stallMargin − 1) / (unloadMargin − 1)`】兩端各自有物理意義：
 *
 *   `stallMargin` = 1          貼著 CLmax，再拉就失速 → 係數 0，完全鬆桿
 *   `stallMargin` = unloadMargin  剛好在門檻上         → 係數 1，與 normal 相同
 *
 * 後者是**消除抽動的關鍵**：進入與離開 `unload` 的瞬間指令完全不跳，所以
 * `geometryGate` 在門檻上翻來翻去不再有可見的後果。這與 `extendPitchAngle`
 * 改成連續量是同一手 —— 連續函數沒有翻轉點（spec §7.1）。
 *
 * @param stallMargin `Situation.stallMargin`，代數上恆等於 √(CLmax / CL)
 */
export function unloadPull(stallMargin: number, cfg: SteerConfig = DEFAULT_STEER): number {
  const span = cfg.unloadMargin - 1
  if (!(span > 0)) return 1
  const t = (stallMargin - 1) / span
  return t < 0 ? 0 : t > 1 ? 1 : t
}

const U = makeScratch(2)

/**
 * 沿著大圓把瞄準方向往機首收，**方位不變**。就地修改 `aim`。
 *
 * 【為什麼方位必須不動】指揮儀把瞄準誤差拆成兩件事：方位決定往哪邊滾
 * （`rollCommand = atan2(aimBody.x, aimBody.y)`），大小決定拉多少 G。而
 * 「卸載」在物理上只有一個意思 —— 少拉一點，與滾轉無關。
 *
 * 【不可以改成瞄準自身速度向量】`unloadAim(self, 0)` 那種寫法在**橫向**
 * 產生約 14° 的偏移，指揮儀讀成轉向需求：滾轉指令由 2–3° 暴增到 27–29°、
 * 副翼打到滿舵、滾轉率由 −46°/s 翻成 +12°/s。純量縮放不會。
 *
 * 【誰在呼叫它】`steerCommand` 的後處理，**以及 `AiController` 的早退路徑**
 * （rally／station／平飛）—— 那三格直接寫 `aimWorld` 然後 return，不經過
 * `steerCommand`，所以拉桿紀律要自己補一次（spec §4.4）。改動這個函式時
 * 兩個呼叫點都要顧到。
 *
 * @param factor 0..1。0 = 瞄準機首（完全鬆桿）、1 = 原樣不動
 */
export function shrinkTowardNose(self: Aircraft, factor: number, aim: Vector3): void {
  if (factor >= 1) return
  const nose = U.v[0]!.copy(FWD).applyQuaternion(self.state.orientation)
  if (factor <= 0) {
    aim.copy(nose)
    return
  }
  const dot = clampUnit(nose.dot(aim))
  const angle = Math.acos(dot)
  // 已經對準：沒有可縮的誤差角
  if (angle < 1e-4) return

  // 【正後方是奇異點】誤差趨近 π 時「誤差在哪一邊」數學上不定，垂直分量由
  // 浮點雜訊主導。此時取機首 —— 完全鬆桿在任何情況下都是安全的卸載動作，
  // 而挑一個由雜訊決定的方位會讓飛機亂滾。
  const perp = U.v[1]!.copy(aim).addScaledVector(nose, -dot)
  const len = perp.length()
  if (len < 1e-6) {
    aim.copy(nose)
    return
  }
  perp.divideScalar(len)

  const target = angle * factor
  aim.copy(nose).multiplyScalar(Math.cos(target)).addScaledVector(perp, Math.sin(target))
}

/**
 * `applyPitchBias` 的角度上界，rad。
 *
 * 【為什麼直接寫算式而不 import `DEG`】這個檔案裡的角度常數一律如此
 * （見 `EXTEND_PITCH`）—— 不為了一個常數多一條相依。
 */
const PITCH_BIAS_LIMIT = 80 * (Math.PI / 180)

/**
 * 把 `aim` 的**航跡角**加上 `deltaPitch`，水平方位不變。就地修改。
 *
 * 它服務甜蜜區與迴轉平面的俯仰偏置；兩者都只改航跡角、不改水平方位，避免
 * 被指揮儀誤讀成額外的滾轉需求。
 *
 * 【夾在 ±80°】超過就變成垂直，而俯仰偏置的用途是「偏一點」不是「翻過去」。
 *
 * 【為什麼不吃 `self`】這只是偏好；鉛直退化、沒有可保留的水平方位時直接
 * 放棄即可，所以簽名不需要飛機。
 *
 * `deltaPitch === 0` 時逐位元不動。假設 `aim` 是單位向量。
 */
export function applyPitchBias(deltaPitch: number, aim: Vector3): void {
  if (deltaPitch === 0) return
  const horiz = Math.hypot(aim.x, aim.z)
  // 已經鉛直時方位沒有定義；這一層只是偏好，放棄是安全的。
  if (horiz < 1e-9) return
  const pitch = Math.atan2(aim.y, horiz)
  let next = pitch + deltaPitch
  if (next > PITCH_BIAS_LIMIT) next = PITCH_BIAS_LIMIT
  else if (next < -PITCH_BIAS_LIMIT) next = -PITCH_BIAS_LIMIT
  const scale = Math.cos(next) / horiz
  aim.set(aim.x * scale, Math.sin(next), aim.z * scale)
}

/**
 * 把 `aim` 的**航跡角**往 `pitch` 拉 `weight` 那麼多，水平方位不變。就地修改。
 *
 * 【它與 `applyPitchBias` 的差別是「偏置」對「約束」】那一支是相對量（加幾
 * 度），所以追擊要往下拽它攝不住；這一支是絕對量，`weight = 1` 時航跡角
 * **完全由 `pitch` 決定**。空層鎖需要的正是後者 —— 「保持 5000 m」不是「比
 * 追擊想飛的高一點」。
 *
 * 【為什麼方位不能動】與 `applyPitchBias`、`shrinkTowardNose` 同一個理由：
 * 動了會被指揮儀讀成滾轉需求，副翼打到滿舵。
 *
 * `weight <= 0` 時逐位元不動。假設 `aim` 是單位向量。
 */
export function applyPitchToward(pitch: number, weight: number, aim: Vector3): void {
  if (!(weight > 0)) return
  const horiz = Math.hypot(aim.x, aim.z)
  // 【已經鉛直：方位沒有定義】與 `applyPitchBias` 走同一條退化路徑
  if (horiz < 1e-9) return
  const w = weight > 1 ? 1 : weight
  let next = Math.atan2(aim.y, horiz)
  next += w * (pitch - next)
  if (next > PITCH_BIAS_LIMIT) next = PITCH_BIAS_LIMIT
  else if (next < -PITCH_BIAS_LIMIT) next = -PITCH_BIAS_LIMIT
  const scale = Math.cos(next) / horiz
  aim.set(aim.x * scale, Math.sin(next), aim.z * scale)
}

/**
 * 甜蜜區偏置的讓位係數，0..1。1 = 照原樣偏、0 = 完全不偏。
 *
 * 【與 `unloadPull` / `energyPull` 同一族】三者都回傳係數、都由呼叫端乘上去、
 * 都不動方位。差別只在防的物理：
 *
 *   unloadPull   看 stallMargin    —— 防**失速**（迎角太大）
 *   energyPull   看 cornerRatio    —— 防**能量見底**（速度太低）
 *   sweetYield   看 interceptTime  —— 防**打法偏好擋住扳機**
 *
 * 【`NO_INTERCEPT` 回傳 1 而不是 0】沒有攔截解 = 沒有射擊機會 = 沒有東西要讓。
 * 回傳 0 會把「彈道無解」變成「連打法都不准表態」，方向剛好相反。
 *
 * 【`sweetYieldTime <= 0` 回傳 1】與 `energyPull` 的退化處理同一個理由：設定
 * 寫壞時讓本層失效、退回既有行為，比讓它把 AI 鎖死安全。這也是消融的開關。
 *
 * @param interceptTime `EngageBasis.interceptTime`，s。`NO_INTERCEPT` 表示無解
 */
export function sweetYield(interceptTime: number, cfg: SteerConfig = DEFAULT_STEER): number {
  // 【非有限值一律不讓位】`NaN` 會穿過下面每一個比較（與任何數比都是 false）
  // 然後從最後一行帶著 `NaN / span` 出去，乘進偏置、汙染整個 `aimWorld`。
  // 回傳 1 = 本層失效、退回既有行為，與 `sweetYieldTime <= 0` 同一個方向。
  if (!Number.isFinite(interceptTime)) return 1
  if (interceptTime === NO_INTERCEPT) return 1
  const span = cfg.sweetYieldTime
  // `span` 同樣要求有限：`Infinity` 會讓 `t / span` 恆為 0，變成「永遠完全
  // 讓位」—— 那是設定寫壞時最不該發生的方向。
  if (!Number.isFinite(span) || span <= 0) return 1
  // 【斜坡整段在開火範圍之外】`interceptTime <= span` 就是「打得到」——
  // 那一段必須完全讓位，見 `SteerConfig.sweetYieldTime`。淡出發生在
  // `span`..`2 × span`，玩家在畫面上看不到那一段（預瞄環還沒出現）。
  if (interceptTime >= 2 * span) return 1
  if (interceptTime <= span) return 0
  return interceptTime / span - 1
}

/** 夾到 [−1, 1]。浮點誤差會讓點積跑出範圍，acos 於是回傳 NaN。 */
function clampUnit(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x
}

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
  /** 該點的海面（未來為地表）高度，m。`extend` 的俯仰用它算離地餘裕 */
  seaHeight: number,
  k: Knobs,
  /** 破防狀態。由 `stepDefend` 每步維護 */
  defend: DefendState,
  /**
   * 指揮層的集合點；`null` = 沒有命令。
   *
   * 【為什麼是參數而不是從 `sit` 拿】`Situation` 是**態勢**（我與目標的
   * 幾何與能量），集合點是**命令**。混進去會讓 `assess.ts` 得知道有指揮層
   * 這回事，而它現在完全不需要知道。與 `defend: DefendState` 同一個理由：
   * 額外的狀態走參數，不塞進態勢。
   */
  rallyPoint: Vector3 | null,
  out: Command,
  cfg: SteerConfig = DEFAULT_STEER,
  /**
   * 「機頭追不上預瞄點，改為佈局下一次機會」。由 `stepTrack` 維護的閂鎖，
   * 呼叫端傳 `track.latched`。
   *
   * 【為什麼傳布林而不是 `TrackState`】這一層需要的是**決定**不是狀態；
   * 狀態的持有者是 `AiController`，與 `DefendState` 由 `stepDefend` 維護
   * 同一個道理。
   *
   * 【為什麼在最尾端】`steerCommand` 有 59 個呼叫點。插在中間會動到每一個，
   * 而那些呼叫點與本機制無關。預設 `false` = 既有行為逐位元不變。
   */
  repositioning = false,
  /**
   * 空層鎖。`null` = 沒有這一層（既有行為逐位元不變）。
   *
   * 【為什麼傳狀態物件而不是兩個數字】`kind` 只為量測與 HUD 存在，但它
   * 與 `altitude`、`hold` 是同一次決定的三個面向；拆開傳等於讓呼叫端有機會
   * 把三者配成不一致的組合。
   */
  band: BandState | null = null,
): void {
  // ── 瞄準點 ──────────────────────────────────────────────
  // 幾何模式壓過意圖：閘門存在的意義就是「這個幾何下一般解法會出錯」
  if (mode === 'planeDegenerate') {
    out.aimWorld.copy(basis.losAxis)
  } else if (mode === 'speedRecover') {
    // 【主動壓機頭】不是「沿著現在的速度向量飛」—— 在自己已經吊上去時，
    // 那個向量正指著天空，命令沿著它飛等於命令繼續爬（spec §5.1）。
    unloadAim(self, -cfg.speedRecoverPitch, out.aimWorld)
  } else if (mode === 'overshoot') {
    // 後置 + 高 yo-yo。engageKnobs 在這個態勢下本來就會給負的 leadLag 與
    // 正的 vertical，這裡強制到底，因為超前是要立刻解決的。
    aimFromKnobs(basis, sit, OVERSHOOT_KNOBS, out.aimWorld, cfg)
  } else {
    switch (intent) {
      case 'engage':
        // 【追不上就改為佈局】見 `repositionKnobs`。幾何閘門（上面的 mode
        // 分支）壓過這裡 —— 撞上去、失速、沒空速都比佈局急。
        if (repositioning) {
          repositionKnobs(sit, RK, cfg)
          aimFromKnobs(basis, sit, RK, out.aimWorld, cfg)
        } else {
          aimFromKnobs(basis, sit, k, out.aimWorld, cfg)
        }
        break
      case 'extend': {
        // 【卸載】把瞄準點放到自身速度向量上，指揮儀就沒有轉向需求，
        // 過載趨近 1 G、誘導阻力最小 —— 這是能量重整的核心手段
        // （spec §4.4：這是 aimWorld 介面唯一能表達的卸載近似）。
        // 俯仰由速度赤字與離地餘裕連續決定（見 extendPitchAngle）。
        const clearance = self.state.position.y - seaHeight
        let pitch = extendPitchAngle(sit.cornerRatio, sit.altitudeAdvantage, clearance, cfg)
        // 【規則 3 的俯衝】目標速度還沒到就以 `divePitch` 俯衝。離地餘裕仍然
        // 蓋在上面：cornerRatio = 1 讓速度項歸零、高度差傳 −Infinity 被
        // isFinite 擋掉，剩下的就是離地項 —— 它為正時貼海不俯衝。
        let diving = false
        if (k.diveIas > 0) {
          const ias = self.diag.aero.tas * Math.sqrt(self.diag.air.sigma)
          if (ias < k.diveIas) {
            const floor = extendPitchAngle(1, -Infinity, clearance, cfg)
            if (floor > 0) pitch = floor
            else { pitch = -cfg.divePitch; diving = true }
          }
        }
        unloadAim(self, pitch, out.aimWorld)
        // 【回場方向】卸載保住了「不轉向」，代價是脫離時機頭朝哪就一路朝哪
        // 飛到出場 —— 剛 merge 完就正對著敵人直直飛（人工回報）。往錨點偏
        // 一個**有上限**的角度：誤差角的大小決定拉多少 G，上限因此直接是
        // 能量損失的上限（見 `SteerConfig.extendTurnCap`）。
        //
        // 【俯衝中不偏】俯衝要的是最短時間換到速度，往錨點偏是在對追擊者
        // 畫弧、把速度花在轉彎上。俯衝有 `trackDiveMax` 兜底，不會直飛到天邊。
        //
        // 【錨點是當前目標】`losAxis` 由 `buildEngageBasis` 對攻擊目標建立。
        // 【錨點取敵人不取被保護單位】要的是「朝向敵人」，而且敵人每一格都
        // 有 —— 編隊形心會在一架陣亡時跳半個間距（spec §9.5）。
        if (!diving) {
          rotateHeading(
            out.aimWorld,
            extendHeadingBias(
              defend.extendSide, headingErrorTo(self, basis.losAxis), sit.range,
              sit.cornerRatio, cfg,
            ),
          )
        }
        break
      }
      case 'defend':
        // 【反轉讓位給破防的相反動作】他衝過頭之後，「轉開」把剛用高度與
        // 速度換來的機會丟掉。倒數期間改成對他的追擊解 —— 轉進去。
        if (defend.reversal > 0 && defend.attacker !== null) {
          reversalAim(self, defend.attacker, out.aimWorld)
        } else {
          defendAim(self, sit.threatLos, defend.axisSign, out.aimWorld, cfg)
        }
        break
      case 'rally':
        // 【指揮層的集合點】它不由 arbitrate 產生（見 rules.ts 的 Intent
        // 註解），所以這一格必然來自 AiController 的覆寫。
        //
        // 【null 時退化成機首】兩條路徑理論上不會不同步，但一個沉默地沿用
        // 前一格 aimWorld 的分支是查不出來的 bug。
        if (rallyPoint !== null) rallyAim(self, rallyPoint, out.aimWorld)
        else out.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
        break
      case 'approach':
        // 【這一格不可以退回純預瞄追擊】問題窗裡它佔 53.2% —— 交會之後一路
        // 追著預瞄點往下繞的就是這一格。
        if (repositioning) {
          repositionKnobs(sit, RK, cfg)
          aimFromKnobs(basis, sit, RK, out.aimWorld, cfg)
        } else {
          normalizeInto(basis.leadPoint, basis.losAxis, out.aimWorld)
        }
        break
      case 'merge':
        // 【merge 不套佈局】它管交會的那 2.5 秒，要的是乾淨的預瞄追擊、
        // 拿一次正面快照。見 `engageKnobs` 的註解。
        normalizeInto(basis.leadPoint, basis.losAxis, out.aimWorld)
        break
    }
  }

  // ── 空層鎖（上半）：方位的夾持 ──────────────────────────
  //
  // 【為什麼只有攻擊意圖】`extend` 的俰仰已經由 `extendPitchAngle` 完整回答
  // （速度不足就低頭、比敵人低就抬頭），`defend` 的由破防軋決定，
  // `rally` 是指揮層的命令。鎖上去只會跟這三層打架。
  //
  // 【為什麼 `speedRecover` 要例外】那個模式正在**主動壓機頭 20° 換速度**，
  // 而一個鎖在平飛的航跡角正好把它抵消到一格不剩 —— 沒空速比掉高度嚴重。
  // 這與它在 `geometryGate` 裡壓過 `unload` 是同一條優先序。
  if (
    band !== null && band.kind !== 'off' && mode !== 'speedRecover'
    && (intent === 'engage' || intent === 'approach' || intent === 'merge')
  ) {
    // 【上限隨 `hold` 從 π 收下來】`hold = 0` 時上限是 π，也就是完全沒有這一層。
    // 中間連續 —— 與這個檔案裡其他每一層同一條原則：不要有翻轉點。
    //
    // 【保持不了高度就收坡度】只壓瞄準點的俯仰擋不住下沉：指揮儀是
    // bank-to-turn，75° 的轉向誤差會讓它掛在 85° 坡度硬轉，升力全在水平面
    // 上，實測整段以 −18° 航跡角下沉、掉 270 m 才穩住。飛行員的做法是**收
    // 坡度換升力** —— 掉出帶越多，轉向上限收得越小（滿偏時砍半），指揮儀
    // 自然放平一點、把高度接回來；回到帶內上限自動放回去。
    const e = bandError(band.altitude - self.state.position.y, cfg)
    const capBase = cfg.bandTurnCap * (1 - 0.5 * Math.abs(e))
    const cap = capBase + (Math.PI - capBase) * (1 - band.hold)
    const err = headingErrorTo(self, out.aimWorld)
    // 【正後方走記住的側】死區裡 `err` 的符號是浮點雜訊，見 `BandState.side`
    if (Math.abs(err) > Math.PI - EXTEND_SIDE_HOLD) {
      rotateHeading(out.aimWorld, band.side * cap - err)
    } else if (err > cap) rotateHeading(out.aimWorld, cap - err)
    else if (err < -cap) rotateHeading(out.aimWorld, -cap - err)
  }


  // 【它必須排在卸載之前】這一層在**塑形瞄準點**（方位夾到上限、俯仰鎖到
  // 帶上），卸載與拉桿紀律在決定**對這個瞄準點拉多少**。反過來的話，紀律層
  // 先把 176° 的誤差縮到機首旁邊，這一層就看不到任何水平誤差可夾 —— 實測
  // 正是那個順序讓面對面交會後直飛了 18 秒。
  // ── 卸載：拉太猛時把誤差角收小，方位不動 ────────────────
  // 【為什麼是後處理而不是 if-else 的一支】卸載不是「改去指別的地方」，
  // 是「照原來的方位，但少拉一點」。寫成獨立的一支就得自己決定要指哪裡，
  // 而瞄準速度向量的寫法會製造橫向誤差、害飛機每 0.1 秒抖一下。當成係數
  // 套在既有指令上，方位天然保持不變。
  //
  // 【`unload` 的拉桿上限有兩個來源，取較小值】
  //   unloadPull(stallMargin)  防**失速**（迎角太大）—— 只在 `unload` 這個
  //                            幾何下有意義，那是 `geometryGate` 判出來的
  //   sit.pullCeiling          防**能量見底**（速度太低）—— 任何幾何下都要
  //                            生效，因為 AI 把自己拉爆不限於 `unload`
  //
  // 【為什麼能量那一層不能只掛在 `unload` 上】迴轉半徑一動，`ai-defence`
  // 正後方 400 m 挨打由 0.084 s 惡化到 0.518 s，而那一場的 mode 大多不是
  // `unload` —— 只掛在 `unload` 上的紀律看不到它。見 `ai/doctrine.ts` 的
  // `energyPull`。
  //
  // 【`overshoot` 與 `speedRecover` 仍然不套失速那一層】它們的優先序高於
  // `unload`（見 `geometryGate`），拿到那兩個 mode 時 `mode !== 'unload'`。
  // 但**能量那一層照套** —— 它們同樣會把速度拉光。
  // 【不要在這裡加「先滾轉再拉」層】那種層在「升力與修正方向相反」時把
  // 拉桿收到 0.25，但 `shrinkTowardNose` 縮的是誤差角，而滾轉率上限正比於
  // 誤差角（`rollRateErrorSlope`）—— 換邊的滾轉會被一起掐慢，看起來就是
  // 「敵機飛到右舷很久才開始右轉」。它要防的倒飛拉升由空層鎖的俯仰段
  // （排在偏置之後、滿權威）接住，倒飛開局的最低點 −239 m、重新對上 12 s。
  const stallPull = mode === 'unload' ? unloadPull(sit.stallMargin, cfg) : 1
  const pull = stallPull < sit.pullCeiling ? stallPull : sit.pullCeiling
  shrinkTowardNose(self, pull, out.aimWorld)

  // ── 甜蜜區：把航跡角偏向自己佔優的高度／速度，方位不動 ──
  // 【為什麼 rally 排除】指揮層的位階比戰術偏好高。「我想飛高一點」不該
  // 蓋過「去那個點集合」。拉桿紀律則相反，連早退路徑都涵蓋 —— 沒有任何
  // 命令的內容是「把自己拉爆」。見 spec §4.4。
  //
  // 【讓位給射擊解】「我想把仗帶到我的甜蜜區」不該蓋過「射擊解已經到手
  // 了」。109 在 500 km/h 的偏置是 +10°，機首因此穩定停在目標線上方 10°，
  // 而開火錐只有 3° —— 結構上開不了火。見 `sweetYield` 與
  // `SteerConfig.sweetYieldTime`。
  //
  // 【為什麼 defend 不讓位】`basis` 永遠對**攻擊目標**建立
  // （`AiController.ts:332`），而 `defend` 是對**威脅來源**做的（`defendAim`
  // 讀 `sit.threatLos`），兩者可以是不同的飛機。對 defend 套讓位會變成
  // 「我正在閃 A，但要不要讓位由我能不能射中 B 決定」—— 無意義的耦合。
  // 排除之後 defend 的行為逐位元不變。要正確地讓位需要對威脅來源另建一組
  // `EngageBasis`，那要動 `AiController`，列為未解（spec §7.3）。
  if (intent !== 'rally') {
    const yieldFactor = intent === 'defend' ? 1 : sweetYield(basis.interceptTime, cfg)
    // 【兩個偏置共用同一個讓位係數】它們是同一個位階的東西（都在改瞄準點的
    // 俯仰、都不看有沒有射擊解），所以有射擊解時要一起收手 —— 否則機首會
    // 穩定停在目標線上方，結構上開不了火。
    //
    // 【為什麼相加而不是二選一】`sweetPitch` 問「我的速度離最佳點多遠」、
    // `turnPitch` 問「這個彎往哪邊轉划算」。兩者可以同時成立，也可以互相
    // 抵銷。出貨值目前 `sweetSpotMaxPitch = 0`，所以實際上只有後者在作用。
    applyPitchBias((sit.sweetPitch + sit.turnPitch) * yieldFactor, out.aimWorld)
  }

  // ── 空層鎖（下半）：俯仰的定案 ──────────────────────────
  //
  // 【為什麼與方位夾持分開、而且排在甜蜜區之後】「鎖上時航跡角它說了算」
  // 必須落在字面上。俯仰鎖若跟方位一起放在卸載之前，倒飛開局 t=2 的指令
  // 會是 −19°：band 命令平飛之後，`shrinkTowardNose` 把瞄準點往（正在下沉
  // 的）機首拖、`turnPitch` 再疊 −10° —— 鎖形同虛設。放在這裡，甜蜜區與
  // 迴轉平面的偏置在鎖定期間自然被蓋掉，順帶補足甜蜜點偏移；`hold` 淡出
  // 時它們平滑回來。
  //
  // 真正的撞地判斷由 `AiController.emit` 最後執行的同步護欄與物理 Worker
  // 負責；這裡只處理戰術空層，不按離地高度改寫目標方向。
  if (
    band !== null && band.kind !== 'off' && mode !== 'speedRecover'
    && (intent === 'engage' || intent === 'approach' || intent === 'merge')
  ) {
    applyPitchToward(
      bandError(band.altitude - self.state.position.y, cfg) * cfg.bandMaxPitch,
      band.hold, out.aimWorld,
    )
  }

  // ── 油門與減速（spec §7.4）────────────────────────────
  //
  // 【`overshoot` 不可以有自己的一支油門／減速板】`throttle = THROTTLE_FLOOR`
  // + `brake = 1` 會讓後置、高 yo-yo、減速三者同時消耗能量。它的觸發條件
  // **純幾何**：`geometryGate` 只看
  // `range < overshootRange && closureRate > 0`，一個字都沒問「我還有速度
  // 嗎」，而它的優先序又是最高的，所以「我沒速度了該壓機頭」的
  // `speedRecover` 在同一個態勢下永遠輪不到。
  //
  // 實測（`stall-loop-trace.probe.ts`）：525 km/h 掉到 149 km/h 同時爬升
  // 700 m，安全層在壓機頭而瞄準點層還在拉 —— 兩層互相打架。進入
  // `overshoot` 的取樣有 73~88% 本來就已經低於角落速度，也就是它專挑
  // 最不該減速的時候減速。
  //
  // 現在只留**幾何**手段（瞄準點的後置與高 yo-yo，見上面的分支），能量
  // 交給下面這條既有的角落速度判準：真的超速才減速，低於角落速度時一點
  // 都不減。「衝過頭」在低速時本來就不成立 —— 低速的飛機追不上任何人。
  if (sit.cornerRatio > cfg.brakeCornerRatio) {
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

const D = makeScratch(4)

/**
 * 破防：由**威脅來源**的視線轉開一個大角度。
 *
 * 目的是**破壞他的預瞄解**，不是逃跑——逃跑會把尾巴一直送給他。
 *
 * 【對準的是威脅來源，不是當前目標】它吃 `Situation.threatLos`（由
 * AiController 掃全場填），**不可以改吃 `EngageBasis`** —— 那是對**當前
 * 目標**建的，而 20v20 實測長機被鎖定時 **97.8% 的鎖定來自不是它目標的
 * 敵機**，拿目標的視線去破防，破的是錯的人。
 *
 * 【轉開的角度相對視線量，不是相對機首的增量】所以它是一個固定的幾何目標，
 * 轉彎中不會每格滾雪球。
 *
 * ## 破防軸：世界水平面抬 `defendTilt`
 *
 * 軸取 `UP × threatLos` 正規化後往上抬 `defendTilt`。世界水平面不跟著飛機
 * 滾，所以破防維持在同一個平面上：位移 11.5°、玩家打得中 2.4%、最低高度
 * 零損失、收尾 TAS 123。
 *
 * 【軸不可以取自升力向量】升力向量跟著滾轉走，飛機一開始破防就會滾，滾了
 * 之後軸轉到別的地方 —— 破防於是不是一個持續的硬彎，是一個**方向一直飄的
 * 螺旋**，坡度常駐 ±150~180°（倒飛）。三個後果同時發生：視覺上跟「不閃」
 * 幾乎沒差別（1.8° 對 0.9°）、破壞不掉射擊解（玩家 77.1% 的時間仍打得
 * 中）、能量被榨乾（收尾 TAS 84）。
 *
 * 【退化】`threatLos` 平行於世界鉛直時 `UP × threatLos` 趨近 0，此時退到
 * 升力軸；升力與視線平行時再退到機體橫軸。兩者恆正交，所以不可能同時
 * 退化。
 *
 * `|升力⊥|² = 1 − a²`、`|橫軸⊥|² = 1 − b²`，而 `a² + b² ≤ 1`（a、b 是兩者
 * 與視線的餘弦）。`a` 趨近 ±1 時 `b` 必然趨近 0，橫軸的垂直分量反而趨近
 * 滿額。永遠有一側可選。
 *
 * @param sign 左右號誌 +1 / −1，由 `stepDefend` 在進入破防時決定一次。
 *             0 視同 +1（呼叫端不該傳 0，但傳了也要有定義的行為）。
 */
export function defendAim(
  self: Aircraft,
  threatLos: Vector3,
  sign: number,
  out: Vector3,
  cfg: SteerConfig = DEFAULT_STEER,
): void {
  // 【視線鉛直時沒有抬角】下面兩條退化路徑（視線鉛直、以及視線鉛直且升力
  // 平行視線）**一個字都沒用到 `cfg.defendTilt`**。而那個抬角是閃躲動作
  // 本身的一部分（見 spec §7），所以「鉛直威脅下閃躲會變弱」是一個已知的
  // 缺口 —— 目前沒有實測支持要補它。
  const axis = D.v[0]!
  const lift = D.v[1]!.copy(UP).applyQuaternion(self.state.orientation)

  // ── 首選：世界水平面內、垂直於視線 ──────────────────
  const horiz = D.v[3]!.copy(UP).cross(threatLos)
  if (horiz.length() >= AXIS_EPSILON) {
    horiz.normalize()
    if (sign < 0) horiz.multiplyScalar(-1)
    // 視線垂面內指天的方向。抬角在定號**之後**才套，所以永遠朝天
    const up = D.v[2]!.copy(UP).addScaledVector(threatLos, -UP.dot(threatLos))
    const upLen = up.length()
    if (upLen > 1e-6) {
      up.divideScalar(upLen)
      axis.copy(horiz).multiplyScalar(Math.cos(cfg.defendTilt))
        .addScaledVector(up, Math.sin(cfg.defendTilt))
    } else {
      axis.copy(horiz)
    }
  } else if (perpendicular(lift, threatLos, axis) < AXIS_EPSILON) {
    // 視線鉛直 **且** 升力平行視線 —— 此時機體橫軸必然垂直於視線
    const right = D.v[2]!.set(1, 0, 0).applyQuaternion(self.state.orientation)
    if (perpendicular(right, threatLos, axis) < AXIS_EPSILON) {
      // 數學上到不了，但浮點世界留一條退路：任何非平行的方向都比「指著他」好
      out.copy(threatLos)
      return
    }
  }

  out.copy(threatLos).multiplyScalar(Math.cos(cfg.defendOffset))
    .addScaledVector(axis, Math.sin(cfg.defendOffset))
    .normalize()
}

/**
 * 反轉的瞄準點：對攻擊者的**追擊解**。
 *
 * 【為什麼是預瞄解而不是直接指著他】反轉的目的是攻守易位，而攻擊的瞄準點
 * 一向是預瞄點（見 `buildEngageBasis`）。指著他本人在有相對速度時打不中，
 * 而反轉發生的時候相對速度正是最大的。
 *
 * 退化（無解、重合）時指向他的位置 —— 那至少是一個有定義的方向。
 */
function reversalAim(self: Aircraft, attacker: Aircraft, out: Vector3): void {
  const p = D.v[0]!.copy(attacker.state.position).sub(self.state.position)
  const v = D.v[1]!.copy(attacker.state.velocity).sub(self.state.velocity)
  const lead = D.v[2]!
  const t = solveLead(p, v, self.spec.battery.sight.muzzleVelocity, lead)
  if (t === NO_INTERCEPT) {
    normalizeInto(p, FWD, out)
    return
  }
  out.copy(lead)
}

/** 正規化 v 寫入 out；退化時用 fallback。 */
function normalizeInto(v: Vector3, fallback: Vector3, out: Vector3): void {
  const len = v.length()
  if (len > 1e-6) out.copy(v).divideScalar(len)
  else out.copy(fallback)
}
