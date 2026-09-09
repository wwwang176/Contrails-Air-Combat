import { Quaternion, Vector3 } from 'three'
import { atmosphere } from '../physics/atmosphere'
import { bodyToStd, stdToBody, type StdVec } from '../physics/axes'
import type { AirData } from '../physics/types'
import type { AircraftSpec } from '../specs/types'
import { hash01 } from './scatter'

/**
 * # 殘骸的角向氣動
 *
 * 一具失去動力與操縱的機體怎麼翻滾。**只算力矩，不算力** —— 平移在
 * `wrecks.ts` 那一層，是彈道加指數阻尼（`WRECK_DRAG`）。少了升力，殘骸不會
 * 自己滑翔脫離；而力矩這一半讓它翻得像那個尺寸的機體該有的樣子。
 *
 * 【為什麼轉速要算而不是給一個常數】常數之下 B-17 與 Bf 109 亂轉得一樣
 * 快。真正分開兩者的是慣性矩與氣動阻尼：B-17 的滾轉慣性矩是 Bf 109 的
 * 六十七倍，翼展是三點二倍。
 *
 * 【為什麼不直接用 `physics/aero.ts` 的力矩】那一支的靜穩定項
 * （`clBeta`、`cmAlpha`、`cnBeta`）是線性化的，只在正負十五度左右成立。
 * 翻滾中的殘骸迎角與側滑角整圈掃過正負一百八十度，照原樣算下去會得到
 * 暴力的假振盪；定常俯仰力矩 `cm0` 是常數，會讓殘骸永遠加速轉下去。
 * 這裡只取角速率阻尼那三項。
 *
 * 純表現：不進判定、不需要決定性以外的精度。
 */

/**
 * 自轉的平衡無因次角速率。平衡轉速 = `這個數 × 2V / 翼展`。
 *
 * 【為什麼需要一個平衡點，不能只有阻尼】三個機種的滾轉阻尼時間常數都在
 * 零點二秒上下 —— 只有阻尼的話殘骸半秒內就完全不轉，剩下一分鐘像一塊磚頭
 * 直直落下。失速之後的機翼是**自轉**的（尾旋就是這個機制），氣動力在低於
 * 平衡轉速時推它、高於才阻尼。
 *
 * 0.0325 讓 Bf 109 在終端速度下約每秒 30 度、B-17 約每秒 9 度。
 * **起始值，由試飛裁定。**
 */
export const WRECK_AUTOROTATION = 0.0325

/**
 * 動壓與無因次角速率的速度下限，m/s。
 *
 * 【為什麼一定要有】無因次角速率是**除以**速度的，而殘骸入水後會被減速。
 * 沒有下限的話力矩會除以趨近零的數而爆掉。
 */
export const WRECK_MIN_SPEED = 5

/** 種子角速度相對平衡轉速的上限倍率。爆炸那一下把它踢過頭，再收斂回來 */
const SEED_OVERSHOOT = 1.5

/**
 * 角向積分的子步上限，s。
 *
 * 【為什麼要切】九個機種裡最短的阻尼時間常數約 0.15 s，而呼叫端傳的是
 * 畫面時間 —— 掉幀時可以到 0.25 s。那個比例下顯式 Euler 加上陀螺項會
 * 發散（見 `stepWreckSpin`）。不掉幀時 `dt` 本來就小於這個值，迴圈只跑
 * 一次，不多付任何成本。
 */
const WRECK_SPIN_SUBSTEP = 1 / 120

/** 這一具殘骸在這個速度下的平衡轉速，rad/s。三軸共用同一個目標 */
export function autorotationRate(spec: AircraftSpec, speed: number): number {
  const v = speed > WRECK_MIN_SPEED ? speed : WRECK_MIN_SPEED
  return (WRECK_AUTOROTATION * 2 * v) / spec.wing.span
}

/**
 * 爆炸那一下的角衝量：三軸各給一個隨機方向、隨機大小的角速度。
 *
 * 【為什麼寫成角速度而不是力矩】衝量除以慣性矩就是角速度，而這裡要的正是
 * 那個商。直接給角速度少一次除法，也少一組單位。
 *
 * 【大小以平衡轉速為尺度】固定一個 rad/s 的話又回到「轟炸機與戰鬥機一樣
 * 快」；以平衡轉速為尺度，翼展大的自然被踢得慢。
 *
 * @param seed 同一個種子恆得同一種翻法
 */
export function seedWreckSpin(
  spec: AircraftSpec, speed: number, seed: number, out: Vector3,
): void {
  const eq = autorotationRate(spec, speed) * SEED_OVERSHOOT
  // 【三軸各自取樣】共用一個值的話三軸同步，翻出來是繞單一固定軸
  out.x = (hash01(seed * 3) * 2 - 1) * eq
  out.y = (hash01(seed * 3 + 1) * 2 - 1) * eq
  out.z = (hash01(seed * 3 + 2) * 2 - 1) * eq
}

/** 熱路徑：每幀每具殘骸一次，不配置 */
const AIR: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }
const STD_OMEGA: StdVec = { x: 0, y: 0, z: 0 }
const MOMENT = new Vector3()
const IW = new Vector3()
const GYRO = new Vector3()
const DQ = new Quaternion()

/**
 * 往平衡轉速收斂的力矩係數。
 *
 * 低於平衡轉速時符號與角速度**同向**（推），高於時反向（阻尼），所以
 * 平衡點就是 `target`。`rate` 恰為零時算成正向 —— 零是一個排斥的平衡點，
 * 實際上停不在那裡。
 */
function autorotationCoef(rate: number, target: number, damp: number, refLen: number, v2: number): number {
  const dir = rate >= 0 ? 1 : -1
  return (damp * (rate - dir * target) * refLen) / v2
}

/**
 * 積分一步的角向運動。**就地改寫 `q` 與 `w`，不回傳。**
 *
 * @param vx,vy,vz 殘骸的世界速度，m/s
 * @param altitude 高度，m。只影響收斂快慢 —— 平衡轉速與空氣密度無關
 * @param q        姿態，世界座標
 * @param w        角速度，**機體座標**，rad/s
 * @param dt       **畫面時間**，不是物理子步
 */
export function stepWreckSpin(
  spec: AircraftSpec,
  vx: number, vy: number, vz: number,
  altitude: number,
  q: Quaternion, w: Vector3, dt: number,
): void {
  const speed = Math.hypot(vx, vy, vz)
  const v = speed > WRECK_MIN_SPEED ? speed : WRECK_MIN_SPEED
  atmosphere(altitude, AIR)
  const qbar = 0.5 * AIR.density * v * v
  const { span, chord, area } = spec.wing
  const qS = qbar * area
  const v2 = 2 * v

  const target = autorotationRate(spec, speed)
  const M = spec.moments
  const I = spec.inertia

  // 【角向要自己分子步】呼叫端傳的是畫面時間，掉幀時可能到零點二五秒。
  // 陀螺項 `ω × Iω` 連續下不做功，但顯式 Euler 會灌入數值能量 —— 單步
  // 大 dt 是正回饋：dt = 0.1 時角速率在五秒內衝到 10⁹ rad/s。
  // 平移那一半是指數解析解，不受影響，所以只有這一段要切。
  const steps = Math.ceil(dt / WRECK_SPIN_SUBSTEP)
  const h = dt / steps
  for (let n = 0; n < steps; n++) {
    // 角速度轉標準軸：p = −ω.z、q = ω.x、r = −ω.y
    bodyToStd(w, STD_OMEGA)
    const cRoll = autorotationCoef(STD_OMEGA.x, target, M.clP, span, v2)
    const cPitch = autorotationCoef(STD_OMEGA.y, target, M.cmQ, chord, v2)
    const cYaw = autorotationCoef(STD_OMEGA.z, target, M.cnR, span, v2)
    stdToBody(qS * span * cRoll, qS * chord * cPitch, qS * span * cYaw, MOMENT)

    // 角加速度 = I⁻¹(M − ω × Iω)，與 `physics/dynamics.ts` 同一條
    IW.set(w.x * I.pitch, w.y * I.yaw, w.z * I.roll)
    GYRO.copy(w).cross(IW)
    w.x += ((MOMENT.x - GYRO.x) / I.pitch) * h
    w.y += ((MOMENT.y - GYRO.y) / I.yaw) * h
    w.z += ((MOMENT.z - GYRO.z) / I.roll) * h

    // 四元數積分：q ← q ⊗ (1, ½ω·h)。**一定要正規化** —— 一階近似會讓長度
    // 慢慢漂離 1，而那會把模型拉歪而不是報錯
    DQ.set(w.x * h * 0.5, w.y * h * 0.5, w.z * h * 0.5, 1)
    q.multiply(DQ).normalize()
  }
}
