import { Quaternion, Vector3 } from 'three'
import { G0, clamp, lerp, smoothstep } from '../core/math'
import { makeScratch } from '../core/pool'
import { Pid, type PidGains } from './pid'
import {
  PILOT_G_NEGATIVE, QMAX_FLOOR, createPitchLimit, gLoadFromOrientation, pitchRateLimit,
  type PitchLimit,
} from './limiters'
import { controlEffectiveness } from '../physics/aero'
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
  /**
   * 外環：方向舵輔助瞄準的增益，(rad/s)/rad。
   *
   * 【0.5 → 3.0：為什麼放開】Bank-To-Turn 的滾轉階段對瞄準毫無貢獻——升力
   * 向量還沒指過去，機首哪都不去。實測目標右偏 45° 時，前 0.49 s 全在滾轉，
   * 2 秒後仍有 18.9° 未修（且與舵面作動速率無關：作動器設為無限快也是
   * 18.9°）。這就是「難操控」的實際來源。
   *
   * 方向舵可以繞過這個等待：它讓機首**直接**橫掃過去。實測 1/4 舵量在
   * 220 m/s 給出 38.6°/s 的偏航率，而且機首在 0.096 s 就開始動——比滾轉
   * 路徑的 0.146 s 更快，且一開始就朝正確方向。原本的權限上限是
   * `0.5 × 0.1 rad = 0.05 rad/s = 2.86°/s`，只有可用量的十三分之一。
   *
   * 【代價是能量，這是刻意的】側滑讓機身斜著劃過空氣，`cdBeta` 產生額外
   * 阻力。實測 1/4 舵量在 220 m/s 的 Ps 約 −52 m/s，與持續硬轉（−57.5）
   * 同一量級。於是「機首立刻指過去」與「保住能量」成為同一個天平的兩端，
   * 而不是在物理之外貼一層外掛。附帶效果：側滑時機首指向不等於彈道方向，
   * 踩舵搶指向的人本來就比較打不中——平衡是自然發生的。
   */
  yawAim: number
  /** 瞄準輔助對偏航率指令的絕對上限，rad/s。 */
  maxYawRateCommand: number
  /**
   * 側滑夾制的起點與上限，rad：|β| 由 `betaFadeStart` 增至 `betaMax` 時，
   * 瞄準輔助的權限由 1 平滑降到 0。
   *
   * 【為什麼夾的是側滑角而不是舵量】舵踩多深在不同速度、不同機種上意義
   * 完全不同；側滑角才是物理上有意義且跨機種一致的量。夾制側滑會自動
   * 適應速度（低速需要更多舵才有同樣的 β）與機種（`cnDr/cnBeta` 各異）。
   * 與 `rollOrPush` 的時間比較是同一套思路：用物理量當判準，不寫死數字。
   *
   * 【上限為什麼是 10°】本專案的側力與偏航力矩模型是**純線性**的——
   * `cyBeta`、`cnBeta` 由 0° 到 90° 都是同一條直線，垂直尾翼永遠不會失速。
   * 真飛機側滑超過約 15~20° 尾翼即進入失速、效力急遽下降並開始掉向螺旋。
   * 因此模型在大側滑區不只是數字偏大，而是**根本不成立**：實測滿舵得到
   * 44° 側滑與 325°/s 偏航率，那是模型在無效區的產物，不是飛機做得到的事。
   *
   * 模型自身的平衡側滑角是 `cnDr/cnBeta`：P-51D 為 0.07/0.10 = 40.1°、
   * Bf 109 為 0.065/0.09 = 39.1°——即「滿舵 = 側著飛 40°」，約為真實
   * 二戰戰鬥機（10~20°）的兩倍。10° 的上限把使用範圍留在線性模型仍然
   * 可信、且真實飛機做得到的區間內；對應約 1/4 舵量、25~38°/s 的偏航率，
   * 仍是原本 2.86°/s 的十倍以上。
   *
   * 【為什麼不直接改 cnDr】它是可調參數，把 0.07 降到 0.04 會讓滿舵側滑
   * 變成 22°、較接近真實，但會動到已驗證的 L4 矩陣與側滑平衡測試。
   * 夾制之後玩家根本到不了那個區域，故先以夾制處理，係數留待 M1 驗收。
   */
  betaFadeStart: number
  betaMax: number
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
  /**
   * 「翻轉後拉」與「不翻轉、推頭」抉擇的遲滯比例（見 `rollOrPush`）。
   * 門檻在平衡點兩側各偏移這個比例，避免飛機在平衡點附近反覆改變主意。
   */
  pushHysteresis: number
  /**
   * 外環積分增益：俯仰（垂直誤差）與機翼改平（坡度），單位 (rad/s)/(rad·s)。
   *
   * 【為什麼非要積分不可】指揮儀原本從外環到內環**每一項權限都正比於誤差**：
   *   desiredQ   = pitchOuter × 垂直誤差
   *   rAim       = yawAim × 橫向誤差
   *   slopeLimit = rollRateErrorSlope × 總誤差
   *   levelP     = wingsLevelGain × 坡度
   * 誤差減半、修正力道也減半——一階系統，指數衰減，數學上永遠到不了 0。
   * 玩家的描述精準：「很像 LERP 轉向到滑鼠位置，會等不到」。
   *
   * 實測（P-51D 4000 m 220 m/s，目標右偏 30°，每 2 秒取樣的衰減比值）：
   *   0.866 → 0.888 → 0.825 → 0.786 → 0.761 → 0.746 → 0.739 → 0.740 → 0.748
   * 比值鎖在 0.74 附近不動，正是純指數的特徵（時間常數約 7 s）。
   * 30 秒時殘差 0.020°，其中橫向 −0.0201°、垂直 0.0026°——幾乎全在橫向，
   * 且與當下坡度 −0.202° 同步衰減。機制是兩層指數串接：
   *   殘留坡度 → 重力把機首拉偏 → 橫向誤差；而坡度本身也只被比例項拉回。
   *
   * 把增益調大不能解決：那只是讓指數衰減得快一點，**形狀不變**。
   * （上一輪 pitchOuter 由 2.0 加到 4.0 即是如此，尾巴照樣是指數。）
   * 積分項讓「誤差持續存在」本身累積出力道——力道不再隨誤差歸零，
   * 於是必然穿越零點。那個穿越就是被要求的「稍微過衝」，
   * 也是「真的抵達」與「無限趨近」的分界。
   *
   * 【防積分飽和】兩個積分都必須在對應指令被夾住時停止累積，否則一次長時間
   * 的硬機動會把積分灌爆，鬆手瞬間變成巨大的過衝。俯仰看 `limiter`
   * 是否夾住 desiredQ，改平看 `wingsLevelBlend` 是否仍為滿權限。
   */
  pitchOuterI: number
  wingsLevelI: number
  /**
   * 方向舵瞄準的外環積分增益，(rad/s)/(rad·s)。
   *
   * 【為什麼小角度特別需要它】小角度修正本來就該由方向舵完成——它不必
   * 先滾轉。但 rAim = yawAim × 橫向誤差 只在誤差大於
   * `maxYawRateCommand / yawAim` 時才貼著上限；yawAim = 8 時那個門檻是 5°，
   * 也就是說**整個小角度區都落在比例段**，誤差一小舵就跟著收。
   * 純靠拉高 yawAim 走不通：實測 12 以上開始震盪、16 以上災難性發散
   * （回升 116°、側滑 42°，已衝破 10° 的軟上限），而 yawOuter 是消側滑項，
   * 調高它反而與瞄準輔助對抗（安定時間由 7.06 s 惡化到 13.73 s）。
   */
  yawAimI: number
  /** 三個外環積分項各自的絕對上限，rad/s。 */
  pitchOuterILimit: number
  wingsLevelILimit: number
  yawAimILimit: number
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
  // 2.0 → 4.0（專案負責人要求「末段更敏捷、容許微幅過衝」）。
  // 【為什麼動的是俯仰外環而不是內環或滾轉】大幅度機動根本不受增益支配：
  // desiredQ 被 pitchRateLimit 的 qMax 夾住、滾轉率頂在機體物理極限，
  // 實測 45° 橫向機動的 t90 在 rollOuter 3.0~7.5 之間只由 3.03 變到 2.94。
  // 受增益支配的只有「誤差已經小到脫離限制器」的末段——正是準星附近。
  // 實測（12 s，油門 WEP，t90 = 誤差降到初值 10% 的時刻）：
  //   P-51D 上拉 20° 110 m/s 1 km：t90 1.60→1.14 s，@2s 誤差 1.05→0.19
  //   P-51D 上拉 20° 220 m/s 4 km：t90 1.70→1.44 s，@2s 誤差 1.05→0.20
  //   P-51D 橫向 15° 220 m/s 4 km：t90 2.64→2.48 s，@4s 誤差 0.53→0.24
  //   Bf 109 上拉 20° 110 m/s 1 km：t90 1.66→1.19 s，@2s 誤差 1.19→0.25
  // 代價是末段回升（過衝）由 0.02° 增為 0.14°（P-51D 橫向）——這正是被
  // 要求的「微微過衝」。安全邊界未受影響：G 峰值 5.42→5.58、迎角峰值
  // 8.61°→9.87°（α_crit 17°），限制器仍在夾；升降舵飽和步數比例全案例 0.000，
  // 相鄰步變號率 ≤1.3%，離散穩定性（見下方不變量二）不受影響。
  // 再往上收益歸零：pO 8.0 的 t90 只再快 0.04 s，回升卻翻倍到 0.24°，
  // 且 P-51D 推頭 20° 出現 1.62° 的明顯過衝。4.0 是收益曲線的膝點。
  // 4.0 → 16.0（專案負責人：「飛機要很靠近或穿越準星之後才開始回正」）。
  // 【這與前一次調整解決的不是同一件事】前一次（2.0→4.0）改善的是脫離
  // 限制器之後的末段速度，外環積分改善的是 0.1° 以下的尾巴。但玩家描述的
  // 「像 LERP」發生在**接近過程**：desiredQ = pitchOuter × 垂直誤差 是比例
  // 律，誤差一小指令就跟著小，機首在還沒到準星時就開始減速。
  // 實測（右偏 45°，誤差 1° 時的機首角速度）：pO 4 → 4.58°/s，pO 16 →
  // 13.11°/s。提高外環增益的作用不是「轉得更猛」——大角度早就被 qMax
  // 夾住了——而是讓指令**在更小的誤差處才脫離飽和**：
  //   脫離飽和的誤差角 ≈ qMax / pitchOuter，pO 4 時約 4.3°、pO 16 時約 1.1°。
  // 於是機首維持限制器允許的最大速度直到幾乎抵達，剩下的動能自然造成穿越。
  // 安全邊界未受影響（G 峰值 7.98→8.08、迎角 7.9°→8.0°，限制器仍在夾），
  // 且這是**外環**增益，與「不變量二」的離散穩定性無關。
  pitchOuter: 16.0,
  yawOuter: 1.5,
  // 3.0 → 8.0：見 yawAimI。8 是純增益路線的上限，12 以上開始震盪。
  yawAim: 8.0,
  // 0.7 rad/s ≈ 40°/s：實測 1/4 舵量（側滑 10°）在 220 m/s 的偏航率量級。
  // 指令再高也只會被舵效與側滑夾制擋下，徒然讓內環積分項飽和。
  maxYawRateCommand: 0.7,
  betaFadeStart: 6 * (Math.PI / 180),
  betaMax: 10 * (Math.PI / 180),
  // kp 0.45 → 1.5：0.45 時滾轉率迴路的直流開迴增益只有
  // kp·(p_ss/δa) = 0.45 × 1.44 = 0.65 < 1，比例項永遠追不上指令，
  // 全靠 ki = 0.12 慢慢補（積分交越頻率僅 0.17 rad/s，時間常數 6 s）。
  // kp = 1.5 讓直流增益到 2.2，L4 矩陣末段誤差最壞值由 5.19° 降到 4.35°。
  rollInner: { kp: 1.5, ki: 0.12, kd: 0.02, integralLimit: 2, outputLimit: 1 },
  // kd 0.04 → 0.005：見上方「不變量二」。這是本任務修掉的最大缺陷。
  pitchInner: { kp: 1.6, ki: 0.5, kd: 0.005, integralLimit: 1.5, outputLimit: 1 },
  yawInner: { kp: 1.2, ki: 0.3, kd: 0.02, integralLimit: 1, outputLimit: 1 },
  // 3° → 1.5°：死區內滾轉完全交給水平儀、瞄準修正歸零，所以殘餘的**橫向**
  // 誤差再也修不掉（俯仰修不了橫向）。3° 是水平儀還不存在時訂的保守值；
  // 極限環現在已由 rollRateErrorSlope 與水平儀各擋一層，死區是第三層。
  // 實測（右移拉滿 47°，P-51D 4000 m 220 m/s WEP）末段誤差：
  //   死區 3.0°：@4s 1.98  @6s 1.24  @10s 0.58   觸底後回升 0.00
  //   死區 1.5°：@4s 1.52  @6s 0.91  @10s 0.27   觸底後回升 0.00
  //   死區 1.0°：@4s 0.67  @6s 0.79  @10s 0.56   觸底後回升 0.40 ← 開始過衝
  // 1.5 是「尾段誤差減半且完全不過衝」的邊界；再縮就會出現回升。
  // 60 秒放手驗證極限環未復發：最後 10 秒坡度區間 ±0.03°（3° 時為 ±0.01°）。
  deadZoneAngle: 1.5 * (Math.PI / 180),
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
  // 10° → 2.5°：這是「接近時就開始回正」的主因。實測右偏 45° 的接近過程，
  // 誤差還有 8° 時改平權限已是 0.143、6° 時 0.457、3° 時 0.920——坡度由
  // −94° 被一路拉回 −57°，機首角速度同步由 16°/s 腰斬到 4.6°/s。
  // 改平的職責只是「瞄準指令病態時接手那個未被約束的自由度」，那個病態
  // 只在誤差趨近 0 時才發生，沒有理由從 10° 就開始接管。
  // 收窄到 2.5° 後仍高於 deadZoneAngle（1.5°），兩者的結構關係不變。
  wingsLevelFadeAngle: 2.5 * (Math.PI / 180),
  // ±15%：門檻本身是由 qMin / qMax / 滾轉率算出的物理量，會隨飛行條件連續
  // 移動，所以遲滯只需要蓋住那個移動的抖動幅度，不需要大。
  pushHysteresis: 0.15,
  // 積分增益取「約 1/3 個比例增益、時間常數約 3 s」的量級：夠快到在人類
  // 感受得到的時間內穿越零點，又慢到不與內環（時間常數 0.1~0.3 s）耦合。
  // 上限則刻意壓得很低——積分只負責啃掉比例項留下的殘渣，不參與大機動。
  // 0.15 rad/s ≈ 8.6°/s，遠小於任一軸的可用角速度。
  // 【增益的挑選】兩軸分開掃描（P-51D / Bf 109 × 右30°/右10°/右上30°/上30°，
  // 4000 m 220 m/s，20 秒）。結論分明：
  //   · wingsLevelI 是主力——尾段殘差幾乎全在橫向，而橫向來自殘留坡度。
  //     右 30° 的 @10s 誤差由 0.280° 掉到 0.043°（只開改平積分即達成），
  //     而且峰值坡度反而由 3.77° 降到 2.83°：積分讓坡度真的歸零，
  //     比例項就不必一直硬撐。
  //   · pitchOuterI 對橫向案例幾乎無感（1.2/0 與 0/0 的曲線重疊），
  //     但救垂直軸：上拉 30° 的 @8s 由 0.100° 掉到 0.025°。
  //   · wI 0.5 在右 30° 略優，但 0.25 在右 10°（@20s 0.023 對 0.053）與
  //     Bf 109 右 30°（@20s 0.015 對 0.065）明顯較好，五案例中三勝，
  //     且坡度過衝較小。取 0.25。
  // 主力案例（P-51D 右 30°）的改善集中在玩家感受得到的視窗：
  //   @6s 0.311°→0.085°   @8s 0.316°→0.055°   @10s 0.280°→0.076°
  // 換算 1080p 螢幕中心：4.6 px → 1.2 px。
  // 【×2：專案負責人要求「過衝再加大一倍」】增益與上限**一起**加倍。
  // 只加倍增益不會加倍過衝——實測現行設定已有 6~8% 的步數卡在積分上限，
  // 封頂的是上限而不是增益：2.4/0.50 配 lim 0.15 的過衝峰值反而由 3.25°
  // 降到 2.86°（積分更快撞頂，等效於更早停止加碼）。連上限一起加倍才是
  // 真的加大力度。
  // 實測（P-51D 4000 m 220 m/s 右偏 30°，坡度的過衝峰值）：
  //   1.2/0.25 lim0.15  過衝 3.25°  零點穿越 1 次  包絡比 0.019  @40s 0.0044°
  //   2.4/0.50 lim0.30  過衝 6.79°  零點穿越 1 次  包絡比 0.005  @40s 0.0030°
  //   3.6/0.75 lim0.45  過衝 10.05° 零點穿越 1 次  包絡比 0.002
  //   4.8/1.00 lim0.60  過衝 13.07° 零點穿越 3 次 ← 開始震盪
  // ×2 拿到 2.1 倍的過衝、穿越次數不變（仍是單次阻尼過衝），末段收斂
  // 反而更好。×4 時穿越次數跳到 3（Bf 109 為 4），那是極限環的起點。
  pitchOuterI: 2.4,
  wingsLevelI: 0.5,
  // 16：與 yawAim 8 搭配。實測六案例（P-51D/Bf109 × 右 3°/5°/8°/右上 5°）
  // 的最差值——回升 0.255°、安定 4.35 s、側滑 6.20°、誤差 1° 時最慢的機首
  // 角速度 4.01°/s，且**六個案例全數穿越目標**。對照現行值（yawAim 3、
  // 無積分）的 13.89 s 與 0.30°/s，安定快 3.2 倍、末段速度快 13 倍。
  // 純拉高 yawAim 到 12 雖然 @1° 更快（6.42°/s），但回升翻倍到 0.587°、
  // 安定退回 6.82 s；積分路線在每一項都更好。
  yawAimI: 16,
  pitchOuterILimit: 0.3,
  wingsLevelILimit: 0.3,
  yawAimILimit: 0.2,
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
  /**
   * 本步是否選擇「不翻轉、推頭」（見 `rollOrPush`）。
   * 判讀：玩家把準星往下拉卻發現飛機翻過去時，這個旗標說明那是刻意的
   * ——判準算出翻轉後拉比較快。目標在機翼平面之上時恆為 false。
   */
  pushMode: boolean
  /**
   * 方向舵瞄準輔助在本步的權限，0~1（見 betaMax）。
   * 判讀：1 = 側滑還有餘裕，機首可以自由橫掃；0 = 已頂到側滑上限，
   * 再踩也不會更快，只會多掉能量。玩家覺得「機首推不過去」時看這個值，
   * 就知道是撞到側滑上限而非指揮儀不肯出力。
   */
  betaAuthority: number
  /**
   * 機翼改平的積分項當下值，rad/s（見 wingsLevelI）。
   * 判讀：它應在玩家指令轉彎期間保持 0（閘門關閉），只在瞄準已對上、
   * 改平接手之後才累積。歸因面板可據此分辨「坡度收不掉」是積分還沒作用
   * 還是積分已飽和。
   */
  wingsLevelIntegral: number
  /**
   * 方向舵瞄準的積分項當下值，rad/s（見 yawAimI）。
   * 判讀：指令貼上 maxYawRateCommand 期間它必須停止成長（防積分飽和），
   * 否則脫離飽和的瞬間會多出一大截殘留指令。
   */
  yawAimIntegral: number
  limiter: PitchLimit
}

export function createDirectorDebug(): DirectorDebug {
  return {
    errorAngle: 0, verticalError: 0, lateralError: 0, rollCommand: 0,
    desiredP: 0, desiredQ: 0, desiredR: 0,
    actualP: 0, actualQ: 0, actualR: 0,
    bankAngle: 0, wingsLevelBlend: 0, pushMode: false, betaAuthority: 1, wingsLevelIntegral: 0, yawAimIntegral: 0,
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
  /** 上一步是否選擇了「不翻轉、推頭」，遲滯用（見 rollOrPush）。 */
  private pushMode = false
  /** 外環積分器（見 pitchOuterI / wingsLevelI）。 */
  private pitchIntegral = 0
  private levelIntegral = 0
  private yawIntegral = 0
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
    this.pushMode = false
    this.pitchIntegral = 0
    this.levelIntegral = 0
    this.yawIntegral = 0
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

    const g = this.gains

    // 限制器：只擋失速與過載，不擋能量流失。
    // 硬拉時速度該掉就得掉——指揮儀不替玩家吸收機動的代價。
    //
    // 【為什麼在滾轉指令之前算】qMax / qMin 是「拉桿」與「推桿」各自的俯仰率
    // 配額，而下方的推桿／翻轉抉擇正是在比較這兩個配額誰划算。順序上必須
    // 先有配額才能比。限制器本身不讀滾轉指令，移前無副作用。
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

    // 滾轉指令：把誤差轉進俯仰面。
    //   目標在正上方 (x=0, y>0) → atan2(0, y) = 0     不需滾轉
    //   目標在正右方 (x>0, y=0) → atan2(x, 0) = π/2   右滾 90°
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
      dbg.rollCommand = this.rollOrPush(spec, aero, aimBody, dbg, qMin)
    }
    this.lastRollCommand = dbg.rollCommand

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
    // 【拆成兩項】levelWeight 只回答「玩家是否在指令一個轉彎」（由瞄準誤差
    // 決定）；bank.authority 另外回答「坡度角在這個姿態下有沒有意義」
    // （垂直飛行時為 0）。輸出權限是兩者相乘，但**積分的閘門只能用前者**：
    // 用相乘的結果當閘門會讓飛機一進入爬升（|cos(俯仰角)| < 0.99）積分就
    // 停擺——實測上拉 30° 時 wingsLevelI 完全沒有作用，掃描表裡該組數據
    // 與關閉積分逐位元相同。那不是設計，是把兩個無關的條件混在一起。
    const levelWeight = 1 - smoothstep(g.deadZoneAngle, g.wingsLevelFadeAngle, dbg.errorAngle)
    dbg.wingsLevelBlend = bank.authority * levelWeight
    // 機翼改平的積分項：比例項只讓坡度指數趨近 0，殘留的 0.2~0.5° 會被重力
    // 轉成持續的橫向瞄準誤差（見 wingsLevelI 的實測）。只在改平擁有滿權限時
    // 累積——玩家正在指令一個轉彎時（blend < 1）坡度**應該**存在，
    // 那時累積等於把玩家的意圖當成誤差在對抗。
    if (levelWeight > 0.99) {
      this.levelIntegral = clamp(
        this.levelIntegral + g.wingsLevelI * bank.angle * dt,
        -g.wingsLevelILimit, g.wingsLevelILimit,
      )
    } else if (levelWeight < 0.01) {
      this.levelIntegral = 0
    }
    dbg.wingsLevelIntegral = this.levelIntegral
    const levelP = clamp(
      g.wingsLevelGain * bank.angle + this.levelIntegral,
      -g.maxRollRateCommand, g.maxRollRateCommand,
    )
    dbg.desiredP = lerp(aimP, levelP, dbg.wingsLevelBlend)
    // 俯仰外環積分：同理，比例項讓垂直誤差指數趨近而非抵達。
    // 【防飽和】只在指令未被限制器夾住時累積。硬拉時 desiredQ 整段貼在 qMax，
    // 若照樣累積，數秒的機動就會把積分灌到上限，改平瞬間變成一記大過衝。
    const qRaw = g.pitchOuter * dbg.verticalError + this.pitchIntegral
    const qClamped = clamp(qRaw, qMin, dbg.limiter.qMax)
    if (qRaw === qClamped) {
      this.pitchIntegral = clamp(
        this.pitchIntegral + g.pitchOuterI * dbg.verticalError * dt,
        -g.pitchOuterILimit, g.pitchOuterILimit,
      )
    }
    dbg.desiredQ = qClamped
    // 【符號修正】brief 原稿寫 g.yawOuter * -aero.beta，符號相反，是正回授。
    // β>0 的定義是相對氣流從右方來（機體 y 向速度分量為正），此時機首偏在
    // 速度向量的左側，要消除側滑必須把機首往「右」偏，即 r>0。
    // 推導：β̇ ≈ Y/(mV) − r，故 r = +k·β 才會讓 β 收斂。
    // 這也與 cnBeta = +0.1 的風標穩定性同號（Cn = cnBeta·β 對 β>0 產生
    // 機首右偏力矩）；原式與飛機自身的方向穩定性反向作用。
    // 【實測證據】未修正時 P-51D 由 400 km/h、目標右偏 25° 起飛，β 從 0
    // 單調爬到 43.8°（8 秒內），方向舵自 t≈4.3 s 起釘死在 −1.0，迎角衝到
    // 23.4°（>α_crit 17°）——完整發散紀錄見 task-18-report.md。
    //
    // 【瞄準輔助與側滑夾制】見 yawAim / betaMax 的說明。
    // 正的 r（機首右偏）會把 β 推向**負**方向，所以「還能不能再往右踩」
    // 要看 −β 距離上限多遠，往左則看 +β——夾制必須是有方向性的，
    // 否則會在需要**改出**側滑時把修正指令一併關掉，飛機就卡在側滑裡出不來。
    // 積分只在指令未貼上限時累積（與俯仰同一套防飽和邏輯）。
    const rRaw = g.yawAim * dbg.lateralError + this.yawIntegral
    const rAim = clamp(rRaw, -g.maxYawRateCommand, g.maxYawRateCommand)
    if (rRaw === rAim) {
      this.yawIntegral = clamp(
        this.yawIntegral + g.yawAimI * dbg.lateralError * dt,
        -g.yawAimILimit, g.yawAimILimit,
      )
    }
    dbg.yawAimIntegral = this.yawIntegral
    const betaToward = rAim > 0 ? -aero.beta : aero.beta
    dbg.betaAuthority = 1 - smoothstep(g.betaFadeStart, g.betaMax, betaToward)
    dbg.desiredR = g.yawOuter * aero.beta + rAim * dbg.betaAuthority

    // 實際角速度轉標準軸：p = −ω.z、q = ω.x、r = −ω.y
    const w = state.angularVelocity
    dbg.actualP = -w.z
    dbg.actualQ = w.x
    dbg.actualR = -w.y

    out.aileron = this.rollPid.update(dbg.desiredP - dbg.actualP, dt)
    out.elevator = this.pitchPid.update(dbg.desiredQ - dbg.actualQ, dt)
    out.rudder = this.yawPid.update(dbg.desiredR - dbg.actualR, dt)
  }

  /**
   * 目標在機翼平面**以下**時，決定「翻過去拉」還是「留著推」。
   *
   * 【問題】`atan2(x, y)` 在 y < 0 時必然給出 |指令| > 90°，目標正下方時
   * 恰為 180°——指揮儀因此無條件要求翻轉。Bank-To-Turn 只會拉不會推，
   * 這在大角度是對的（見下方時間比較），但小角度會變成「滾一半又滾回來」：
   * 實測 P-51D 4000 m 220 m/s 瞄準正下方 10°，坡度衝到 33.8°、過載掉到
   * −1.30 G，然後放棄翻轉滾回來，兩邊的好處都沒拿到。切換點原本只是
   * `atan2` 的 180° 撞上 `slopeLimit`（正比於誤差角）之後的副產品，
   * 沒有任何判準。
   *
   * 【判準】比較兩條路徑蓋完同一個誤差角所需的時間：
   *   t_推 = 誤差角 / |qMin|
   *   t_翻 = (翻轉多出來的角度) / 穩態滾轉率 + 誤差角 / qMax
   * 推桿被飛行員 −3 G 夾住，翻過去之後 gLoad = −1 讓重力幫忙，配額大得多，
   * 但要先付一筆固定的翻轉時間。實測 P-51D 4000 m 220 m/s：
   * |qMin| = 0.178、qMax = 0.334 rad/s、翻轉約 1.7 s
   *   ⇒ 平衡點 = 1.7 / (1/0.178 − 1/0.334) = 0.65 rad ≈ 37°
   * 這個門檻會自己隨條件移動——高速時推桿配額（∝1/V）縮得比翻轉時間快，
   * 門檻下降；低速時推桿相對划算，門檻上升。沒有任何魔術數字。
   *
   * 【推桿分支為什麼不是 rollCommand = 0】0 只在目標「正下方」時才正確。
   * 目標在右下時橫向分量仍需靠滾轉解決。`atan2(x, −y)` 是「把目標轉到機腹
   * 方向（−y）」的角度，正是推桿版本的同一個幾何：目標正下方時它恰為 0
   * （機翼放平、純推頭），目標右下時它給出一個小於 90° 的右坡度，
   * 讓副翼管橫向、升降舵管垂直。兩個分支因此在 y = 0 上連續。
   *
   * @returns 滾轉指令，rad
   */
  private rollOrPush(
    spec: AircraftSpec, aero: AeroState, aimBody: Vector3, dbg: DirectorDebug, qMin: number,
  ): number {
    const rollPull = Math.atan2(aimBody.x, aimBody.y)
    // 目標在機翼平面之上：翻轉問題不存在，拉桿永遠是對的。
    if (aimBody.y >= 0) {
      this.pushMode = false
      dbg.pushMode = false
      return rollPull
    }
    const rollPush = Math.atan2(aimBody.x, -aimBody.y)

    const pSs = steadyRollRate(spec, aero)
    const extraRoll = Math.abs(rollPull) - Math.abs(rollPush)
    // qMax 取的是**當下**姿態的配額（正飛時偏小），翻轉後 gLoad = −1 會更大，
    // 所以 t_翻 是高估的——判準偏保守，傾向多推一點、少翻一點。
    const tPull = extraRoll / pSs + dbg.errorAngle / Math.max(dbg.limiter.qMax, 1e-6)
    const tPush = dbg.errorAngle / Math.max(Math.abs(qMin), 1e-6)

    // 遲滯：門檻兩側各偏移 pushHysteresis，避免飛機在平衡點附近反覆改變主意
    // （那會是一個 bang-bang 極限環，與 Task 18 特例二遇到的是同一類問題）。
    const g = this.gains
    const margin = this.pushMode ? 1 + g.pushHysteresis : 1 - g.pushHysteresis
    this.pushMode = tPush <= tPull * margin
    dbg.pushMode = this.pushMode
    return this.pushMode ? rollPush : rollPull
  }
}

/**
 * 滿舵下的穩態滾轉率，rad/s。滾轉力矩與滾轉阻尼平衡時：
 *   0 = clDa·δa + clP·(p·b / 2V)  ⇒  p = (clDa / −clP)·(2V / b)
 * 再乘上高速副翼變重的權限折減（`controlEffectiveness`，與 aeroForceMoment
 * 用的是同一個函式——這正是 Bf 109 在 600 km/h 滾不動的來源）。
 *
 * 只用於上方的時間比較，不參與力的計算；估得夠準即可，重點是它會隨速度、
 * 高度與機種自己變化，門檻才不是一個寫死的角度。
 */
function steadyRollRate(spec: AircraftSpec, aero: AeroState): number {
  const s = spec.controlStiffening
  const eff = controlEffectiveness(s.aileronK, s.qRef, aero.qbar)
  const p = (eff * spec.moments.clDa / -spec.moments.clP) * ((2 * aero.tas) / spec.wing.span)
  return Math.max(p, 1e-3)
}
