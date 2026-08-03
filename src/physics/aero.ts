import type { Vector3 } from 'three'
import { G0, smoothstep } from '../core/math'
import { alphaFrom, betaFrom, bodyToStd, stdToBody, type StdVec } from './axes'
import { derivedClMax, type AircraftSpec } from '../specs/types'
import type { AeroState, AirData, Controls, ForceMoment } from './types'

// 模組私有暫存，避免熱路徑配置。禁止跨模組共用。
const stdVel: StdVec = { x: 0, y: 0, z: 0 }
const stdOmega: StdVec = { x: 0, y: 0, z: 0 }

/** 誘導阻力因子 1/(π·e·AR)。 */
export function inducedDragFactor(spec: AircraftSpec): number {
  const ar = (spec.wing.span * spec.wing.span) / spec.wing.area
  return 1 / (Math.PI * spec.wing.oswald * ar)
}

/**
 * 升力係數。
 *
 * 線性段：CL = clAlpha × (α − α₀)
 * 失速後：以 smoothstep 由 CL_max 平滑崩塌至 postStallFactor × CL_max
 * 深失速：以平板模型 sin 2α（保留符號）的「形狀」延伸，但縮放使其在
 * 交接點 blendEnd 與失速後段的終值恰好相等（見下方縮放推導），
 * 確保連續、大迎角不發散、且 |α|>90° 時方向正確。
 */
export function liftCoefficient(
  spec: AircraftSpec,
  alpha: number,
  slatsDeployed: boolean,
): number {
  const L = spec.lift
  const alphaCrit = L.alphaCrit + (slatsDeployed ? L.slatAlphaBonus : 0)
  const clMax = derivedClMax(spec, slatsDeployed)

  // 以零升迎角為對稱中心
  const rel = alpha - L.alphaZero
  const sign = rel < 0 ? -1 : 1
  const mag = Math.abs(rel)
  const critMag = alphaCrit - L.alphaZero

  if (mag <= critMag) return L.clAlpha * rel

  const blendEnd = critMag + L.stallBlend
  if (mag < blendEnd) {
    const t = smoothstep(0, 1, (mag - critMag) / L.stallBlend)
    return sign * (clMax + (L.postStallFactor * clMax - clMax) * t)
  }

  // 深失速：平板模型 CL ∝ sin 2α，但必須在交接點 blendEnd 與失速後段接續。
  // 未縮放的平板值與 postStallFactor × CL_max 並不相等（P-51 差 0.098，
  // Bf 109 展開縫翼時差 0.181），且因為縫翼會改變 CL_max，
  // 無法用單一 stallBlend 讓兩個縫翼狀態同時連續——所以在此縮放而非調參。
  // 縮放並非物理要求：真實平板在 40°~45° 攻角附近的 CL 峰值本就落在
  // 1.1~1.2，此處縮放後的峰值（P-51 1.134、Bf109 淨形 1.137、
  // 縫翼展開 1.218）與該範圍相符，比舊版恆 ≤1 的公式更符合物理。
  // 交接點的斜率仍有約 35% 的落差（失速崩塌段 smoothstep 在 t=1 處
  // 導數為 0，深失速段導數非 0）——這是接受的 kink，不是要消除的缺陷；
  // 崩塌段之所以不直接延伸到 90°/180°，是因為它本來就只描述失速剛發生
  // 的區段，深失速需要換一個形狀函數，兩者導數本來就不必相等。
  //
  // 分子 sin(2α) 保留符號（不取絕對值），分母 flatEnd 才取絕對值：
  // 這樣 |α|>90° 時（尾滑、錘頭失速等真實可達的姿態）CL 方向會自然
  // 隨 sin(2α) 變號，不會出現「升力方向與物理相反」的錯誤（例如
  // 未保留符號時 α=135° 會算出 +1.134，正確值應為 −1.0）。
  // 因此外層不再乘 sign——sign 已經反映在 alphaAtBlendEnd 的正負號中，
  // 若再乘一次會重複計入。
  const alphaAtBlendEnd = L.alphaZero + sign * blendEnd
  const flatEnd = Math.max(Math.abs(Math.sin(2 * alphaAtBlendEnd)), 1e-6)
  return L.postStallFactor * clMax * (Math.sin(2 * alpha) / flatEnd)
}

/**
 * 前緣自動縫翼狀態，含遲滯避免在閾值附近抖動。
 * 這是 Bf 109 低速盤旋優勢的物理來源，非憑空加成。
 */
export function updateSlatState(
  spec: AircraftSpec,
  alpha: number,
  wasDeployed: boolean,
): boolean {
  if (spec.lift.slatAlphaBonus <= 0) return false
  const mag = Math.abs(alpha)
  if (wasDeployed) return mag > spec.lift.slatRetractAlpha
  return mag > spec.lift.slatDeployAlpha
}

/**
 * 減速全開時附加的阻力係數（M4 spec §2.1）。
 *
 * 【為什麼是全域常數而非機種參數】實測 P-51D 與 Bf 109 的翼載幾乎相同
 * （S/m 分別為 0.00508 與 0.00510 m²/kg），所以同一個 CD 給出兩台**相同的
 * 減速度**，不偏袒任何一方。未來若加入翼載差異大的機種，減速度自然會不同
 * ——那是物理上正確的結果，不是需要修正的偏差。
 *
 * 【數值怎麼來的】目標手感由專案負責人定為「水平飛行 700 → 400 km/h 約
 * 4 秒」。本值由 test/unit/brake.test.ts 實測驗證；改動時該測試會紅。
 *
 * 【這個量級不是真機】乾淨機體零推力要 114 秒、放下起落架約 37 秒。刻意的
 * 街機化，理由與取捨見 M4 spec §2.1。
 */
export const BRAKE_CD = 0.45

/**
 * 阻力係數：零升阻力 + 誘導阻力 + 側滑阻力，超音速臨界後加壓縮性修正，
 * 再加上減速的附加阻力。
 *
 * 【brake 為什麼有預設值】它預設 0，所以 M1 的既有呼叫端（含 542 條測試與
 * analysis/ 的包絡求解器）行為完全不變——包絡分析問的是「乾淨機體能飛多快」，
 * 那個問題與減速無關。
 */
export function dragCoefficient(
  spec: AircraftSpec,
  cl: number,
  beta: number,
  mach: number,
  brake = 0,
): number {
  let cd0 = spec.drag.cd0
  if (mach > spec.drag.machCrit) {
    const excess = mach - spec.drag.machCrit
    cd0 *= 1 + spec.drag.machDragFactor * excess * excess
  }
  return cd0 + inducedDragFactor(spec) * cl * cl + spec.drag.cdBeta * beta * beta
    + BRAKE_CD * brake
}

/** 高速舵面變重：δ_eff = δ × min(1, (qRef/q)^k)。 */
export function controlEffectiveness(k: number, qRef: number, qbar: number): number {
  if (qbar <= qRef) return 1
  return Math.pow(qRef / qbar, k)
}

/**
 * 拐點動壓相對 1 G 失速動壓的倍率。**1.2² = 1.44** —— 拐點在 1.2 × Vs。
 *
 * 【為什麼是 1.2】實測纏鬥不會發生在 1.44 × Vs 以下（最佳持續轉彎
 * 1.44–1.61、109／P-51 轉彎率交叉區 1.69–2.35、角落速度 2.74–2.83），
 * 所以 1.2 與有戰術意義的速度有安全距離。真實世界的進場速度也訂在
 * 1.2–1.3 × Vs，理由正是「操縱仍堪用但已開始變軟」（spec §3）。
 */
export const LOW_SPEED_KNEE = 1.44

/**
 * 1 G 失速時的動壓，Pa。**與高度無關。**
 *
 *   Vs(1G) = √( 2W / (ρ·S·CLmax) )
 *   q      = ½ρ·Vs² = W / (S·CLmax)      ← ρ 消掉了
 *
 * 所以低速拐點是每機種一個常數：P-51D 1290 Pa、Bf 109 1239 Pa。不必查
 * 大氣、不必開根號，而且它自動處理高度——9,000 m 要 268 km/h 才有同樣的
 * 動壓，這正是真實情況。
 *
 * 【CL_max 的慣例】用 `derivedClMax(spec, 有縫翼就當展開)`，與
 * `analysis/envelope.ts` 的 `stallSpeed()` **完全一致**。否則 109 的拐點會
 * 對不上它自己的 Vs，「1.2 × Vs」在兩個地方會是不同的意思（spec §4.3）。
 */
export function stallDynamicPressure(spec: AircraftSpec): number {
  return (spec.mass * G0)
    / (spec.wing.area * derivedClMax(spec, spec.lift.slatAlphaBonus > 0))
}

/**
 * 低速舵面失效：δ_eff = δ × min(1, q / q_low)。
 *
 * 【為什麼這樣就會產生懲罰】舵面力矩與氣動阻尼**原本都正比於動壓**，
 * 比值與速度無關——這正是未修正前飛機能在 15 km/h 維持乾淨姿態的原因：
 * 能達到的角**速率**幾乎不隨速度變化。乘上這個因子之後控制力矩被砍、
 * 阻尼不變，飛機變糊，重力接管（spec §4.4）。
 *
 * 【為什麼不設下限】速度趨近 0 時力矩本來就趨近 0（力矩 = 動壓 × 面積 ×
 * 係數），乘數再小也不會除出無限大或 NaN（spec §4.5）。
 */
export function lowSpeedEffectiveness(spec: AircraftSpec, qbar: number): number {
  const qLow = LOW_SPEED_KNEE * stallDynamicPressure(spec)
  return qbar >= qLow ? 1 : qbar / qLow
}

/** 由機體座標的空速向量計算迎角、側滑、動壓、馬赫數。 */
export function computeAeroState(
  velocityBody: Vector3,
  air: AirData,
  out: AeroState,
): AeroState {
  bodyToStd(velocityBody, stdVel)
  const tas = velocityBody.length()
  out.tas = tas
  out.alpha = tas > 1e-6 ? alphaFrom(stdVel) : 0
  out.beta = betaFrom(stdVel, tas)
  out.qbar = 0.5 * air.density * tas * tas
  out.mach = air.soundSpeed > 0 ? tas / air.soundSpeed : 0
  return out
}

/**
 * 氣動力與力矩，輸出於機體座標。
 *
 * 力在風軸計算後轉入標準氣動軸，再由 stdToBody 轉回機體軸。
 * 力矩的阻尼項以無因次角速度 (p·b/2V) 等形式計入。
 */
export function aeroForceMoment(
  spec: AircraftSpec,
  aero: AeroState,
  omegaBody: Vector3,
  controls: Controls,
  slatsDeployed: boolean,
  out: ForceMoment,
): ForceMoment {
  const { area, span, chord } = spec.wing

  if (aero.qbar <= 0 || aero.tas <= 1e-6) {
    out.force.set(0, 0, 0)
    out.moment.set(0, 0, 0)
    return out
  }

  const cl = liftCoefficient(spec, aero.alpha, slatsDeployed)
  const cd = dragCoefficient(spec, cl, aero.beta, aero.mach, controls.brake)
  const cy = spec.side.cyBeta * aero.beta

  const qS = aero.qbar * area
  const lift = qS * cl
  const drag = qS * cd
  const side = qS * cy

  const ca = Math.cos(aero.alpha)
  const sa = Math.sin(aero.alpha)
  const cb = Math.cos(aero.beta)
  const sb = Math.sin(aero.beta)

  // 風軸 → 標準氣動軸（x 前、y 右、z 下）
  const fx = -drag * ca * cb - side * ca * sb + lift * sa
  const fy = -drag * sb + side * cb
  const fz = -drag * sa * cb - side * sa * sb - lift * ca
  stdToBody(fx, fy, fz, out.force)

  // 角速度轉標準軸：p = −ω.z、q = ω.x、r = −ω.y
  bodyToStd(omegaBody, stdOmega)
  const v2 = 2 * aero.tas
  const pHat = (stdOmega.x * span) / v2
  const qHat = (stdOmega.y * chord) / v2
  const rHat = (stdOmega.z * span) / v2

  const CS = spec.controlStiffening
  // 【低速衰減與高速變重是同一個概念的兩端】兩者相乘。中間有一大段兩者
  // 都不作用——P-51D 是 1858 → 10884 Pa，相隔 5.9 倍（spec §4.2）。
  //
  // 三軸乘同一個因子是專案負責人的裁決：不做副翼／升降舵／方向舵的差異化。
  const low = lowSpeedEffectiveness(spec, aero.qbar)
  const da = controls.aileron * low * controlEffectiveness(CS.aileronK, CS.qRef, aero.qbar)
  const de = controls.elevator * low * controlEffectiveness(CS.elevatorK, CS.qRef, aero.qbar)
  const dr = controls.rudder * low * controlEffectiveness(CS.rudderK, CS.qRef, aero.qbar)

  const M = spec.moments
  const cRoll = M.clBeta * aero.beta + M.clP * pHat + M.clDa * da
  const cPitch = M.cm0 + M.cmAlpha * aero.alpha + M.cmQ * qHat + M.cmDe * de
  const cYaw = M.cnBeta * aero.beta + M.cnR * rHat + M.cnDr * dr

  stdToBody(qS * span * cRoll, qS * chord * cPitch, qS * span * cYaw, out.moment)
  return out
}
