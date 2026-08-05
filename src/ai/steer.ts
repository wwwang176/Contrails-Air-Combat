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
/** extend 的爬升／俯衝角上限，rad。兩個增益都以它為基準 */
const EXTEND_PITCH = 25 * (Math.PI / 180)
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
   * 【1.25 → 1.15 是實測逼出來的】舊碼用 1.25，但它與「仰角 > 45°」是
   * **且**的關係，所以在水平追瞄時形同不存在。拿掉仰角前提之後 1.25 太急：
   * 戰鬥機在最大轉彎率下按定義就貼著 CLmax，追瞄的硬拉本來就會壓到 1.25
   * 以下 —— 閘門於是把每一次要害的拉桿都中止掉。實測高能量開局因此由
   * 「29 秒擊落」退化成「90 秒逾時」，而且能量超支（花 3428 > 開局優勢
   * 3213）。詳見 `speedRecoverMargin` 的掃描表。
   *
   * 【它同時是卸載強度的分母，2026-08-05】`unloadPull` 用
   * `(stallMargin − 1) / (unloadMargin − 1)` 當拉桿係數，所以這個值不只決定
   * 「何時介入」，也決定「介入得多深」——它是限制器的整條斜坡。
   *
   * **介入的形狀變了之後重掃過，結果是混沌的。** 舊版的介入是 0.1 秒的
   * 閃動（實質上等於沒有限制器），新版是連續削權。高能量開局：
   *
   * ```
   * unloadMargin   0（關掉）    1.02       1.05      1.10      1.15
   * 結果          240s 未分   紅方贏     藍 161s   藍 167s   藍 119s
   *                          113.6s
   * ```
   *
   * 相鄰值之間連勝負都會翻號 —— 沒有可辨識的最佳點，1.15 是這組裡最好的，
   * 維持不動。這也說明修補前那個「43.9 秒擊落」不是穩定的性能水準，只是
   * 這個決定性模擬的一次抽樣（見 `ai-duel-matrix.test.ts` 的相應註解）。
   */
  unloadMargin: number
  /**
   * **快沒空速**的判準：速度裕度（TAS ÷ 1G 失速速度）低於此值就壓機頭。
   *
   * 【為什麼不看仰角】舊版要求「仰角 > 45° **且** 速度低」才觸發，那個
   * `且` 讓它在 74° 仰角、速度裕度 1.49 時仍然不動，等到 1.34 才觸發
   * —— 已經 78 m/s 了。速度不足在任何姿態都是問題；俯衝時速度自然高，
   * 不會誤觸發（實測俯衝時觸發 0 次，spec §3.4）。
   *
   * 【兩個門檻的定值，2026-08-05 實測】高能量開局（boom-and-zoom）與
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
   * 這一項降到 1.25 是順帶收斂，主要的修正在 `unloadMargin`。
   */
  speedRecoverMargin: number
  /** `speedRecover` 的壓頭角度，rad。正值，實際命令的是它的負值 */
  speedRecoverPitch: number
  /** 瞄準點相對目標的最大角位移，rad */
  maxOffsetAngle: number
  /** cornerRatio 超過此值就開始減速 */
  brakeCornerRatio: number
  /** extend 的爬升／俯衝角上限，rad */
  extendPitch: number
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
   * 實測六場開局的 `belowStall` 全部落在 0.08%（修補前最差 22.2%），
   * 這個增益不需要再調。
   */
  pitchSpeedGain: number
  /**
   * 高度赤字 → 俯仰的增益。
   *
   * 【`2 × extendPitch` 怎麼來的】高度赤字 0.5（離地約 250 m）時就抵銷
   * 滿值的速度項，確保「低空缺速度 → 平飛」而不是俯衝。
   *
   * **這一個沒有單獨掃過。** 它只在離地 500 m 以內生效，而六場開局裡
   * 只有 1000 m 的三場短暫進入那個範圍 —— 掃它得不到訊號。真正守著它的
   * 是安全層的 `safetyShare`（最差 1.83%）：這一項若太弱，撞地分支的
   * 介入率會立刻上去。
   */
  pitchAltitudeGain: number
  /** 高度赤字的特徵離地高度，m。約為安全層 clearance（120 m）的四倍 */
  clearanceScale: number
  /** defend 的偏轉角，rad */
  defendOffset: number
}

/**
 * M4 交付時全部是起始值。2026-08-05 的 AI 四缺陷修補由實測回填了
 * `unloadMargin`、`speedRecoverMargin`、`speedRecoverPitch` 與 `extend` 的
 * 三個俯仰參數（掃描表在各欄位的註解裡）。`overshootRange`、
 * `maxOffsetAngle`、`defendOffset` 仍是起始值。
 *
 * `brakeCornerRatio` 掃過 1.05–1.6：**放低沒有幫助**。俯衝掠襲要的是把
 * 高度差換成一次乾淨的射擊機會，減速等於把那個高度差丟掉 —— 1.2 甚至
 * 讓佔優勢的一方輸掉那一場。維持 1.6。
 *
 * ## 已經試過並否決的：射程內控速（2026-08-05）
 *
 * 提案是把速度政策**依距離分成兩段**：射程外全推力接近，射程內把
 * `cornerRatio` 收到角落速度附近（太快與太慢都轉不好，角落速度是那條曲線
 * 的頂點）。空氣動力學上完全成立，而且與上面那次 `brakeCornerRatio` 掃描
 * 不同 —— 那一次是**無條件**減速，連俯衝進場都踩，這一次只在近距離踩。
 *
 * 實作方式：`engage`／`approach` 意圖且距離低於門檻時，用一個比例控制器
 * 把速度收到目標值（油門先收、收到底才踩減速板，比照 `station.ts`）。
 * 兩套政策以 `AiController.steerConfig` 注入，**在同一場仗裡直接對打**，
 * 六種開局 × 三種機種配對 × 雙向 = 每組設定 36 場。
 *
 * ```
 * saddleRange（目標 1.15×角落速度）   300     600     750     900    1050   1200   1500
 * 傷害差總和（正 = 新政策較優）      −109   −2394   −3932  +3860    +68    −83   −395
 *
 * 目標速度（range 900）              1.0×   1.15×   1.3×
 * 傷害差總和                        −3981   +3860  −1826
 * ```
 *
 * 【900 那個亮點是混沌，不是最佳點】它的左右鄰居是 −3932 與 +68，150 m 的
 * 差距造成 7800 的擺盪；目標速度那一軸同樣是尖點。模擬是完全決定性的，
 * 這種形狀代表軌跡分岔的巧合。七組設定、252 場對戰，六組是負的或持平。
 *
 * 【為什麼沒有效：前提不成立】診斷量到，六場 1v1 開局在 600 m 內時
 *
 *   - 平均 `cornerRatio` 只有 **0.85–1.02** —— AI 幾乎總是**低於**角落速度，
 *     沒有多餘的速度可以丟。速度真的高於目標的取樣只有 0.0–11.2%。
 *   - 少數真的過快的場合幾乎都是俯衝掠襲，而那正是**唯一不該減速**的時候
 *     （加上能量豁免後：−1713，依然是負的）。
 *
 * 政策生效的集合與它造成傷害的集合幾乎是同一個集合。
 *
 * 【順帶量到的、還沒處理的】近距離平均 `cornerRatio` 0.85 意味著 AI 長期
 * 待在曲線「太慢」的那一側，白白讓出轉彎率。但油門已經在 WEP，這個方向
 * 沒有油門可推 —— 要補只能少拉一點（誘導阻力）或換高度，那是
 * `unloadMargin` 與 `extendPitchAngle` 的地盤，不是速度政策的。
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
  brakeCornerRatio: 1.6,
  extendPitch: EXTEND_PITCH,
  pitchSpeedGain: 4 * EXTEND_PITCH,
  pitchAltitudeGain: 2 * EXTEND_PITCH,
  clearanceScale: 500,
  defendOffset: 75 * (Math.PI / 180),
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
  // 舊版把兩者合併成同一個 mode 並共用 `unloadAim(self, 0)`，對後者正確、
  // 對前者是無操作 —— 那就是缺陷 3（spec §5.1）。
  //
  // 【仰角前提整條刪掉】舊版要求「目標仰角 > 45° 或自己航跡角 > 45°」才
  // 可能觸發，於是同一空層平飛追擊時速度掉到一半也不動。速度不足在任何
  // 姿態都是問題；俯衝時速度自然高，不會誤觸發。
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

/**
 * `extend` 的俯仰角，rad。正 = 爬升。
 *
 * 【為什麼是兩個分量相加而不是 if-else】舊版用兩個裸門檻
 * （`energyReserve < 0`、`y < 1000`）決定爬或衝，跨線時指令瞬間翻號。
 * 飛機有俯仰慣性，跨線後要幾秒才轉得過來，於是衝過頭、翻號、再衝過頭
 * —— 極限環，振幅由飛機的俯仰響應決定，不由任何設計參數決定。實測在
 * 1000 m 線上持續震盪 40 秒（spec §3.5）。連續函數沒有翻轉點。
 *
 * 【高度分量的來源是離地餘裕，不是能量判準】「我還打得動嗎」只問速度
 * （spec §4.1）；高度出現在這裡是因為**低空不能用高度換速度**，那是
 * 安全關切，與能量判斷在不同的軸上。三種情況自然長出來：
 *
 *   高空缺速度 → 高度赤字 0，純俯衝換速度
 *   低空缺速度 → 兩項抵消，平飛加速
 *   極低空     → 高度項主導，爬升
 *
 * @param cornerRatio TAS ÷ 角落速度
 * @param groundClearance 離地（海面）高度，m
 */
export function extendPitchAngle(
  cornerRatio: number,
  groundClearance: number,
  cfg: SteerConfig = DEFAULT_STEER,
): number {
  const speedDeficit = 1 - cornerRatio
  let altitudeDeficit = 1 - groundClearance / cfg.clearanceScale
  if (altitudeDeficit < 0) altitudeDeficit = 0
  else if (altitudeDeficit > 1) altitudeDeficit = 1

  const raw = -cfg.pitchSpeedGain * speedDeficit + cfg.pitchAltitudeGain * altitudeDeficit
  if (raw < -cfg.extendPitch) return -cfg.extendPitch
  if (raw > cfg.extendPitch) return cfg.extendPitch
  return raw
}

/** 超前修正的固定旋鈕：全後置 + 全高 yo-yo。 */
const OVERSHOOT_KNOBS: Knobs = { leadLag: -1, vertical: 1 }

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
 * 舊版用 `unloadAim(self, 0)`（瞄準自身速度向量）表達卸載，那在**橫向**
 * 產生約 14° 的偏移，指揮儀讀成轉向需求：實測滾轉指令由 2–3° 暴增到
 * 27–29°、副翼打到滿舵、滾轉率由 −46°/s 翻成 +12°/s。純量縮放不會。
 *
 * @param factor 0..1。0 = 瞄準機首（完全鬆桿）、1 = 原樣不動
 */
function shrinkTowardNose(self: Aircraft, factor: number, aim: Vector3): void {
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
  out: Command,
  cfg: SteerConfig = DEFAULT_STEER,
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
        aimFromKnobs(basis, sit, k, out.aimWorld, cfg)
        break
      case 'extend': {
        // 【卸載】把瞄準點放到自身速度向量上，指揮儀就沒有轉向需求，
        // 過載趨近 1 G、誘導阻力最小 —— 這是能量重整的核心手段
        // （spec §4.4：這是 aimWorld 介面唯一能表達的卸載近似）。
        // 俯仰由速度赤字與離地餘裕連續決定（見 extendPitchAngle）。
        const clearance = self.state.position.y - seaHeight
        unloadAim(self, extendPitchAngle(sit.cornerRatio, clearance, cfg), out.aimWorld)
        break
      }
      case 'defend':
        defendAim(basis, out.aimWorld, cfg)
        break
      case 'merge':
      case 'approach':
        normalizeInto(basis.leadPoint, basis.losAxis, out.aimWorld)
        break
    }
  }

  // ── 卸載：拉太猛時把誤差角收小，方位不動 ────────────────
  // 【為什麼是後處理而不是 if-else 的一支】卸載不是「改去指別的地方」，
  // 是「照原來的方位，但少拉一點」。寫成獨立的一支就得自己決定要指哪裡，
  // 而那正是舊版（瞄準速度向量）製造出橫向誤差、害飛機每 0.1 秒抖一下的
  // 來源。當成係數套在既有指令上，方位天然保持不變。
  //
  // 【`overshoot` 與 `speedRecover` 不套】它們的優先序高於 `unload`
  // （見 `geometryGate`），拿到那兩個 mode 時就不會是 `unload`。
  if (mode === 'unload') {
    shrinkTowardNose(self, unloadPull(sit.stallMargin, cfg), out.aimWorld)
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
