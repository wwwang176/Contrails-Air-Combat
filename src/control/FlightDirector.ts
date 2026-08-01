import { Quaternion, Vector3 } from 'three'
import { G0, clamp, lerp, smoothstep } from '../core/math'
import { makeScratch } from '../core/pool'
import { Pid, type PidGains } from './pid'
import {
  PILOT_G_NEGATIVE, QMAX_FLOOR, createPitchLimit, gLoadFromOrientation, pitchRateLimit,
  type PitchLimit,
} from './limiters'
import type { AircraftSpec } from '../specs/types'
import type { AeroState, Controls, FlightState } from '../physics/types'

// 模組私有暫存（熱路徑零配置）。只需要 1 個向量（aimBody）與 1 個四元數
// （orientation 的逆）；gLoadFromOrientation 使用 limiters 自己的暫存，
// 不與此處別名衝突。
const S = makeScratch(3, 1)

/** 世界上方。模組常數，任何情況下都不得被寫入。 */
const WORLD_UP = new Vector3(0, 1, 0)

export interface BankAttitude {
  /** 坡度角，rad。正值＝左坡度（右翼上揚），負值＝右坡度。 */
  angle: number
  /**
   * 坡度角的可信度，0~1，等於 |cos(俯仰角)|。
   *
   * 機首指向正上或正下時「坡度」在幾何上沒有意義（世界上方向量與機首平行，
   * 它在機體右／上平面內的投影長度為零，方位角是 0/0）。此值就是那個投影
   * 的長度，所以它天然地在奇異點歸零——不需要額外的分支判斷，機翼改平
   * 會自己在垂直飛行時鬆手，而不是去追一個沒有意義的角度。
   */
  authority: number
}

export function createBankAttitude(): BankAttitude {
  return { angle: 0, authority: 1 }
}

/**
 * 由姿態四元數求坡度角。熱路徑零配置（使用模組私有 scratch）。
 *
 * 【為什麼不從歐拉角取】專案的硬性約束是「狀態絕不以歐拉角儲存」。
 * 這裡直接把世界上方向量轉進機體座標的右／上平面求方位角，
 * 與 gLoadFromOrientation 由四元數求 cosγ·cosφ 是同一手法。
 * （已與 Euler 'YXZ' 的 z 分量逐案比對，60 秒極限環的每個視窗端點
 * 都吻合到小數點後一位，見 task-20-report.md §20。）
 */
export function bankAttitude(orientation: Quaternion, out: BankAttitude): BankAttitude {
  const bodyRight = S.v[1]!.set(1, 0, 0).applyQuaternion(orientation)
  const bodyUp = S.v[2]!.set(0, 1, 0).applyQuaternion(orientation)
  const lateral = WORLD_UP.dot(bodyRight)
  const vertical = WORLD_UP.dot(bodyUp)
  out.angle = Math.atan2(lateral, vertical)
  out.authority = Math.hypot(lateral, vertical)
  return out
}

export interface DirectorGains {
  /** 外環：滾轉角誤差 → 期望滾轉率，(rad/s)/rad */
  rollOuter: number
  /** 外環：俯仰角誤差 → 期望俯仰率 */
  pitchOuter: number
  /** 外環：側滑消除增益 */
  yawOuter: number
  /** 外環：方向舵微量輔助瞄準的增益 */
  yawAim: number
  rollInner: PidGains
  pitchInner: PidGains
  yawInner: PidGains
  /** 誤差小於此角度時停止滾轉修正，rad */
  deadZoneAngle: number
  /**
   * 期望滾轉率相對於「總誤差角」的上限斜率，(rad/s)/rad。
   * 亦即 |desiredP| ≤ rollRateErrorSlope × errorAngle。
   *
   * 【為什麼需要這一項】rollCommand = atan2(x, y) 只描述「升力向量要轉到
   * 哪個方位」，完全不含「還差多遠」的資訊：一個純橫向的 4° 誤差與一個
   * 純橫向的 90° 誤差，rollCommand 都是 ±90°，desiredP 都是
   * rollOuter × π/2 = 4.71 rad/s——而 P-51D 在這些速度下的最大滾轉率只有
   * 0.72~2.17 rad/s。結果是：只要誤差稍微漂出死區，副翼就被打到滿舵。
   *
   * 這一項把滾轉指令的「急迫度」與總誤差綁在一起：誤差小的時候不需要
   * 用最大滾轉率去搬升力向量。它同時讓滾轉權限在 errorAngle → 0 時
   * 連續地收斂到 0，而不是像單純的死區那樣在門檻上跳一個階梯——
   * 死區處理的是「對準之後不要抖」，這一項處理的是「快對準時不要暴衝」。
   */
  rollRateErrorSlope: number
  /** 目標接近正後方時的遲滯半徑，rad */
  reverseHysteresis: number
  /** 期望滾轉率的絕對上限，rad/s */
  maxRollRateCommand: number
  /**
   * 機翼改平：坡度角 → 期望滾轉率，(rad/s)/rad。
   *
   * 【為什麼需要這一項】rollCommand = atan2(aimBody.x, aimBody.y) 在瞄準點
   * 接近機首正前方時兩個引數同時趨近 0——**滾轉在數學上完全沒有被約束**。
   * 任何坡度都同樣滿足「機首對準目標」，因為繞機首軸的旋轉根本不會移動機首。
   * 但帶著坡度的飛機會被重力把機首拉離瞄準點，指揮儀修正、又留下坡度，
   * 於是自我維持。實測（P-51D 4000 m 220 m/s，甩 6° 後完全放手 60 秒）：
   * 坡度在 ±35° 之間以約 6.5 s 的週期擺盪，每 10 秒只衰減約 1°，
   * 在任何人類尺度上都是永久的。誤差角始終小於 6°，所以 L4 矩陣
   * （量的是瞄準誤差，不是坡度）完全看不到它。
   *
   * 【為什麼不會與瞄準迴路打架】期望滾轉率作用在機首軸上，而繞機首軸旋轉
   * 不改變機首指向——這正是瞄準指令留下來沒有決定的那一個自由度。
   * 兩個迴路在幾何上正交，不是兩個迴路在吵架。
   */
  wingsLevelGain: number
  /**
   * 機翼改平的淡出角，rad：誤差角由 deadZoneAngle 增加到此值時，改平權限
   * 由 1 平滑降到 0，超過即完全不介入。用 smoothstep 連續淡出而不是硬切換，
   * 理由與 rollRateErrorSlope 相同——階梯式的權限切換自己就會變成極限環的
   * 來源。出貨值 10° 讓它在圓錐邊緣（11.375°）的持續轉彎中權限恰為 0，
   * 玩家刻意壓坡度轉彎時它一點力都不會出。
   */
  wingsLevelFadeAngle: number
}

/**
 * 【不變量一：積分項夾制】pid.ts 的防積分飽和是單純的積分項夾制，不是
 * 感知輸出飽和的 anti-windup。呼叫端必須自行維持
 * `ki·integralLimit ≤ outputLimit`，否則誤差反向後輸出仍會被積分項鎖在
 * 飽和邊界（task-17 實測延遲 1.500 s）。以下三組皆滿足：
 *   roll  0.12 × 2.0 = 0.24 ≤ 1
 *   pitch 0.50 × 1.5 = 0.75 ≤ 1
 *   yaw   0.30 × 1.0 = 0.30 ≤ 1
 *
 * 【不變量二：離散微分增益】內環在 dt = 1/240 s 上執行，微分項的等效增益
 * 是 kd/dt（= 240·kd），會直接乘上「單一物理步內舵面對角速度的影響量」
 * Δω₁ = qbar·S·ℓ·C_δ·dt / I。該乘積必須明顯小於 1，否則迴路在 Nyquist
 * 頻率上不穩定。俯仰軸最危險，因為 Ixx 只有 11,000 kg·m² 而 cmDe = 1.2：
 *   600 km/h 海平面：Δq₁ ≈ 0.30 rad/s（每步、每單位升降舵）
 *   kd = 0.04（brief 原值）→ 240 × 0.04 × 0.30 = 2.9 ≫ 1  → 發散
 *   kd = 0.005（出貨值）   → 240 × 0.005 × 0.30 = 0.36 < 1 → 穩定
 * 【實測】kd = 0.04 時升降舵在相鄰兩步之間於 +1 / −1 之間跳動（120 Hz
 * 極限環），俯仰率在 +0.123 / −0.065 rad/s 之間彈跳，飛機完全無法建立
 * 穩定的拉升。把 kd 由 0.04 降到 0.005，L4 矩陣 400/600 km/h 兩列的失敗
 * 由 13/80 掉到 1/80。同一條件下滾轉與偏航軸的 Δ₁ 分別是 0.056 與 0.054
 * （Izz = 8,800、Iyy = 20,000，且 clDa = 0.033、cnDr = 0.07 都遠小於 cmDe），
 * kd = 0.02 對應 0.27 與 0.26，本來就在安全區，故不動。
 *
 * 任何調參都必須重新檢查這兩個不等式。
 */
export const DEFAULT_DIRECTOR_GAINS: DirectorGains = {
  rollOuter: 3.0,
  // 2.5 → 2.0：L4 矩陣末段誤差標準差的最壞值由 1.45 降到 1.39（門檻 1.5）。
  pitchOuter: 2.0,
  yawOuter: 1.5,
  yawAim: 0.5,
  // kp 0.45 → 1.5：0.45 時滾轉率迴路的直流開迴增益只有
  // kp·(p_ss/δa) = 0.45 × 1.44 = 0.65 < 1，比例項永遠追不上指令，
  // 全靠 ki = 0.12 慢慢補（積分交越頻率僅 0.17 rad/s，時間常數 6 s）。
  // kp = 1.5 讓直流增益到 2.2，L4 矩陣末段誤差最壞值由 5.19° 降到 4.35°。
  rollInner: { kp: 1.5, ki: 0.12, kd: 0.02, integralLimit: 2, outputLimit: 1 },
  // kd 0.04 → 0.005：見上方「不變量二」。這是本任務修掉的最大缺陷。
  pitchInner: { kp: 1.6, ki: 0.5, kd: 0.005, integralLimit: 1.5, outputLimit: 1 },
  yawInner: { kp: 1.2, ki: 0.3, kd: 0.02, integralLimit: 1, outputLimit: 1 },
  deadZoneAngle: 3 * (Math.PI / 180),
  // = 5 × rollOuter。見下方掃描表：3~8 全部 120/120 通過，5 是末段標準差
  // 與末段誤差的綜合最佳點。
  rollRateErrorSlope: 15,
  reverseHysteresis: 5 * (Math.PI / 180),
  maxRollRateCommand: 6,
  // 1.5 (rad/s)/rad：35° 坡度對應 0.92 rad/s 的改平率，遠低於 P-51D 在
  // 巡航速度的最大滾轉率（約 2.2 rad/s），所以內環不會被指令到飽和；
  // 對應的一階時間常數約 0.7 s，比極限環的 6.5 s 週期快一個量級，
  // 因此是把環壓掉而不是與它共振。
  wingsLevelGain: 1.5,
  wingsLevelFadeAngle: 10 * (Math.PI / 180),
}

/**
 * 歸因面板資料（spec §8.4）：指揮儀指令與物理實際響應並列。
 *
 * 判讀方式：desiredP/Q/R 是外環＋限制器算出的「要求」，actualP/Q/R 是
 * 物理層實際做到的角速度。兩者並列即可把手感問題歸因到正確的一層：
 *   desired 平穩但 actual 追不上／震盪 → 內環 PID 或氣動舵效問題
 *   desired 自己就在震盪／被夾住      → 外環增益或限制器問題
 *                                       （再看 limiter.source 是哪一項在夾）
 */
export interface DirectorDebug {
  errorAngle: number
  verticalError: number
  lateralError: number
  rollCommand: number
  desiredP: number
  desiredQ: number
  desiredR: number
  actualP: number
  actualQ: number
  actualR: number
  /** 坡度角，rad。正值＝左坡度 */
  bankAngle: number
  /**
   * 機翼改平在本步的權限，0~1。
   * 判讀：desiredP 是「瞄準要求的滾轉率」與「改平要求的滾轉率」以此值
   * 內插的結果。1 = 完全由改平主導（瞄準已到位，滾轉未被約束），
   * 0 = 完全由瞄準主導（玩家正在指揮一個轉彎）。
   */
  wingsLevelBlend: number
  limiter: PitchLimit
}

export function createDirectorDebug(): DirectorDebug {
  return {
    errorAngle: 0, verticalError: 0, lateralError: 0, rollCommand: 0,
    desiredP: 0, desiredQ: 0, desiredR: 0,
    actualP: 0, actualQ: 0, actualR: 0,
    bankAngle: 0, wingsLevelBlend: 0,
    limiter: createPitchLimit(),
  }
}

/**
 * Bank-To-Turn 飛行指揮儀。
 *
 * 玩家用滑鼠給一個世界空間的瞄準方向；指揮儀把它轉進機體座標，
 * 先算出「要把誤差轉進俯仰面需要滾轉多少」，再用串級 PID
 * （外環：角度誤差 → 期望角速度；內環：角速度誤差 → 舵面）驅動。
 *
 * 【瞄準方向在機體座標求解，不經過相機】這是自由視角不影響飛行的原因，
 * 也是偏離中心的準星會產生「持續轉速」而非一次性修正的原因：誤差角只有
 * 在機首真正轉到目標方向上時才歸零，準星維持偏離就會維持一個非零誤差，
 * 外環持續要求一個非零角速度。
 *
 * 【只輸出舵面指令】本類別絕不寫入 FlightState（姿態、速度、角速度）。
 * 物理層是唯一的真相來源；指揮儀能做的只有 out.aileron/elevator/rudder。
 * out.throttle 也不碰——油門由玩家直接控制。
 */
export class FlightDirector {
  readonly gains: DirectorGains
  private readonly rollPid: Pid
  private readonly pitchPid: Pid
  private readonly yawPid: Pid
  private lastRollCommand = 0
  /** 每步覆寫的坡度暫存，實例私有（熱路徑零配置）。 */
  private readonly bank: BankAttitude = createBankAttitude()

  constructor(gains: DirectorGains = DEFAULT_DIRECTOR_GAINS) {
    this.gains = structuredClone(gains)
    this.rollPid = new Pid(this.gains.rollInner)
    this.pitchPid = new Pid(this.gains.pitchInner)
    this.yawPid = new Pid(this.gains.yawInner)
  }

  reset(): void {
    this.rollPid.reset()
    this.pitchPid.reset()
    this.yawPid.reset()
    this.lastRollCommand = 0
  }

  /**
   * 由滑鼠指向的世界空間目標方向產生舵面指令。
   * 不修改 out.throttle——油門由玩家直接控制。
   *
   * 【簽名修正：移除 air】brief 原稿在 state 與 aero 之間帶一個
   * `air: AirData`，但本函式從頭到尾不讀它——tsc 的 noUnusedParameters
   * 會直接報 TS6133（已實測確認：中間位置的未使用參數同樣會被抓）。
   * 這與 Task 17 在 pitchRateLimit、Task 10 在 aeroForceMoment 遇到的
   * 是同一件事，兩次的結論都是「參數本身多餘，整個移除，而不是用底線
   * 遮蓋編譯錯誤」。指揮儀需要的密度資訊已經由呼叫端的 computeAeroState
   * 算進 aero.qbar；若未來需要馬赫相依的舵效，AeroState 已有 aero.mach。
   */
  update(
    spec: AircraftSpec,
    state: FlightState,
    aero: AeroState,
    slatsDeployed: boolean,
    aimDirWorld: Vector3,
    dt: number,
    out: Controls,
    dbg: DirectorDebug,
  ): void {
    const invQ: Quaternion = S.q[0]!.copy(state.orientation).invert()
    const aimBody = S.v[0]!.copy(aimDirWorld).normalize().applyQuaternion(invQ)

    // 機首方向在機體座標恆為 (0, 0, −1)，所以 −aimBody.z 就是「目標與機首
    // 夾角」的餘弦分量。
    const forward = -aimBody.z
    const lateralMag = Math.hypot(aimBody.x, aimBody.y)

    dbg.errorAngle = Math.atan2(lateralMag, forward)
    dbg.verticalError = Math.atan2(aimBody.y, forward)
    dbg.lateralError = Math.atan2(aimBody.x, forward)

    // 滾轉指令：把誤差轉進俯仰面。
    //   目標在正上方 (x=0, y>0) → atan2(0, y) = 0     不需滾轉
    //   目標在正右方 (x>0, y=0) → atan2(x, 0) = π/2   右滾 90°
    const g = this.gains
    if (dbg.errorAngle < g.deadZoneAngle) {
      // 特例一（spec §8.2）：已經對準時停止滾轉修正，否則方位角的雜訊
      // 會讓飛機正對目標時持續左右滾轉。
      dbg.rollCommand = 0
    } else if (dbg.errorAngle > Math.PI - g.reverseHysteresis) {
      // 特例二（spec §8.2）：目標接近機首正後方時 atan2(x, y) 的兩個引數
      // 同時趨近 0，方位角數學上不定 → 沿用上一幀，遲滯鎖定一側，避免
      // 在「往左繞或往右繞」之間抖動而卡死（spin-lock）。
      //
      // 【判據修正】brief 原稿用 `lateralMag < sin(reverseHysteresis)`。
      // lateralMag = sin(errorAngle)，該式在誤差趨近 0 與趨近 π 時同時成立
      // ——也就是說它把「正前方 3°~5°」這條窄帶一併關進了遲滯分支。後果不是
      // 「死區稍微加寬」而已：飛機在該帶內完全不修正，橫向誤差自由漂到 5°，
      // 一越過 5° rollCommand 立刻跳到 ±90°（純橫向誤差的 atan2(x,y) 必為
      // ±90°），副翼瞬間打滿 ±1.0，於是形成週期約 2.5 s、振幅 1°~5.6° 的
      // bang-bang 極限環（實測見 task-18-report.md）。
      // 改用 errorAngle > π − reverseHysteresis，等價於「lateralMag 小 __且__
      // 目標在機首後方」，只保留真正需要遲滯的那一極。
      dbg.rollCommand = this.lastRollCommand
    } else {
      dbg.rollCommand = Math.atan2(aimBody.x, aimBody.y)
    }
    this.lastRollCommand = dbg.rollCommand

    // 限制器：只擋失速與過載，不擋能量流失。
    // 硬拉時速度該掉就得掉——指揮儀不替玩家吸收機動的代價。
    const gLoad = gLoadFromOrientation(state.orientation)
    pitchRateLimit(spec, aero, slatsDeployed, gLoad, dbg.limiter)

    // 負向（推桿）上限與正向同一套推導：n = q·V/g + gLoad ⇒ q = g(n − gLoad)/V。
    // 【公式修正】brief 原稿寫 qMaxNeg = PILOT_G_NEGATIVE·g/V，漏了重力
    // 支持項——這正是 Task 17 在正向 qMax 上抓到並修掉的同一個錯誤。
    // 倒飛時 gLoad = −1，原式會指令 q = −3g/V，實際達成
    // n = q·V/g + gLoad = −3 + (−1) = −4，直接吃穿 −3 的飛行員負 G 上限
    // 並觸及 P-51D 的 gNegative = −4 結構極限。修正後為 g(−3−(−1))/V。
    // nNeg 取飛行員、結構、氣動三者中最先夾住的那個（即最大者），
    // 與 pitchRateLimit 正向分支取 min(nAero, gPositive, PILOT_G_POSITIVE)
    // 的邏輯完全對稱。
    //
    // 【−nAero 這一項是 brief 完全沒有的】brief 的負向上限只看飛行員 G 值，
    // 從不問「機翼在這個速度下做不做得出這麼多負升力」。低速時做不出來：
    // 200 km/h 海平面的 P-51D 氣動可達過載只有 ±1.47 G，指令 −3 G 等於
    // 要求一個倒飛失速。實測（r135° 方位315° 200 km/h 海平面）α 被推到
    // −18.2°，而負向失速臨界是 alphaZero − (alphaCrit − alphaZero) = −22°，
    // 但 |α| 已越過 α_crit = 17°——矩陣的失速斷言用的是 |α|，這是唯一一個
    // 在整個矩陣裡越界的案例。
    // 用 −nAero 作鏡像界限在本升力模型下是精確的：liftCoefficient 以
    // alphaZero 為對稱中心，正負兩側的失速 |CL| 相同，故負向氣動上限的
    // 量值就等於 nAero。
    const nNeg = Math.max(PILOT_G_NEGATIVE, spec.limits.gNegative, -dbg.limiter.nAero)
    // 與 QMAX_FLOOR 對稱的負向地板：確保任何姿態下都保有最小的推桿權限。
    const qMin = aero.tas > 1
      ? Math.min((G0 * (nNeg - gLoad)) / aero.tas, -QMAX_FLOOR)
      : 0

    // 兩道上限：一道來自總誤差角（見 rollRateErrorSlope），一道是絕對上限。
    const slopeLimit = g.rollRateErrorSlope * dbg.errorAngle
    const aimP = clamp(
      clamp(g.rollOuter * dbg.rollCommand, -slopeLimit, slopeLimit),
      -g.maxRollRateCommand, g.maxRollRateCommand,
    )

    // 機翼改平（見 wingsLevelGain 的說明）：只在滾轉指令病態的區域接手。
    // 【為什麼是內插而不是相加】相加會在誤差角中段變成兩個迴路各出一份力
    // 的疊加，總權限可能超過任一方的設計上限；內插則保證權限恆等於 1 份，
    // 且在兩端各自退化成純瞄準／純改平。
    // 【注意】改平權限不能塞回 rollCommand 再走 slopeLimit——slopeLimit 正比
    // 於誤差角，在誤差趨近 0 時本身就趨近 0，會把改平指令一併夾成 0，
    // 而那正是最需要改平的地方。故在夾制之後才內插。
    const bank = bankAttitude(state.orientation, this.bank)
    dbg.bankAngle = bank.angle
    dbg.wingsLevelBlend =
      bank.authority * (1 - smoothstep(g.deadZoneAngle, g.wingsLevelFadeAngle, dbg.errorAngle))
    const levelP = clamp(
      g.wingsLevelGain * bank.angle, -g.maxRollRateCommand, g.maxRollRateCommand,
    )
    dbg.desiredP = lerp(aimP, levelP, dbg.wingsLevelBlend)
    dbg.desiredQ = clamp(g.pitchOuter * dbg.verticalError, qMin, dbg.limiter.qMax)
    // 【符號修正】brief 原稿寫 g.yawOuter * -aero.beta，符號相反，是正回授。
    // β>0 的定義是相對氣流從右方來（機體 y 向速度分量為正），此時機首偏在
    // 速度向量的左側，要消除側滑必須把機首往「右」偏，即 r>0。
    // 推導：β̇ ≈ Y/(mV) − r，故 r = +k·β 才會讓 β 收斂。
    // 這也與 cnBeta = +0.1 的風標穩定性同號（Cn = cnBeta·β 對 β>0 產生
    // 機首右偏力矩）；原式與飛機自身的方向穩定性反向作用。
    // 【實測證據】未修正時 P-51D 由 400 km/h、目標右偏 25° 起飛，β 從 0
    // 單調爬到 43.8°（8 秒內），方向舵自 t≈4.3 s 起釘死在 −1.0，迎角衝到
    // 23.4°（>α_crit 17°）——完整發散紀錄見 task-18-report.md。
    dbg.desiredR =
      g.yawOuter * aero.beta + g.yawAim * clamp(dbg.lateralError, -0.1, 0.1)

    // 實際角速度轉標準軸：p = −ω.z、q = ω.x、r = −ω.y
    const w = state.angularVelocity
    dbg.actualP = -w.z
    dbg.actualQ = w.x
    dbg.actualR = -w.y

    out.aileron = this.rollPid.update(dbg.desiredP - dbg.actualP, dt)
    out.elevator = this.pitchPid.update(dbg.desiredQ - dbg.actualQ, dt)
    out.rudder = this.yawPid.update(dbg.desiredR - dbg.actualR, dt)
  }
}
