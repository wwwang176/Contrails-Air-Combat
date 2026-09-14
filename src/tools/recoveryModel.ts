/**
 * 改出預測模型與閉迴路試飛。模型只讀飛機當下狀態與機種規格，不改遊戲安全層。
 * `recoveryFeatures` 與 `predictFromFeatures` 均可放在 240 Hz 熱路徑；呼叫端提供
 * 輸出物件，兩個函式本身不配置記憶體。
 */
import { Quaternion, Vector3 } from 'three'
import { Aircraft } from '../aircraft/Aircraft'
import { createCommand } from '../control/Controller'
import { DEFAULT_DIRECTOR_GAINS } from '../control/FlightDirector'
import {
  ALPHA_MARGIN, PILOT_G_NEGATIVE, QMAX_FLOOR, gLoadFromOrientation,
} from '../control/limiters'
import {
  applySafety, flightPathRate, recoveryAltitude, recoveryClearance, DEFAULT_SAFETY,
} from '../ai/safety'
import { cornerSpeed, maxLoadFactorAero, maxRollRate, thrustAt } from '../analysis/envelope'
import {
  controlEffectiveness, dragCoefficient, inducedDragFactor, liftCoefficient,
  lowSpeedEffectiveness, redlinePitchEffectiveness,
} from '../physics/aero'
import { atmosphere } from '../physics/atmosphere'
import { WEP_THROTTLE } from '../physics/propulsion'
import { THROTTLE_FLOOR } from '../input/throttle'
import type { AirData } from '../physics/types'
import type { AircraftSpec } from '../specs/types'

const DEG = Math.PI / 180
const G0 = 9.80665
export const DT = 1 / 240

export interface RecoveryCoeffs {
  /** 平穩拉起時，實際過載相對於限制器容許過載的比例。 */
  eta: number
  /** 由可用俯仰角加速度換算建立時間的無因次倍率。 */
  c1: number
}

/** P-51D 與 B-17G 共用的第二版係數；由離線擬合腳本產生。 */
export const RECOVERY_V2_COEFFS: RecoveryCoeffs = { eta: 0.840992, c1: 1.14964 }

/** 固定餘裕，m。 */
export function fixedMargin(spec: AircraftSpec): number {
  return recoveryClearance(spec)
}

export type RecoveryDirection = 'velocity' | 'lift-horizontal'

/**
 * 預測所需的純量特徵。所有欄位都在接管判定當下取得；離線擬合可直接保存
 * 這個物件，再反覆呼叫 `predictFromFeatures` 而不重跑物理。
 */
export interface RecoveryFeatures {
  tas0: number
  tasEnd: number
  gamma: number
  sinDown: number
  cosGamma: number
  initialLoad: number
  verticalLoad: number
  pitchRate: number
  gLoad: number
  nPullEnd: number
  nPushEnd: number
  alphaTravel: number
  turnRate: number
  pitchAcceleration: number
  baseDrag: number
  inducedDragPerNSq: number
  floorThrust: number
  mass: number
  gravityAlongDive: number
  rollRate: number
  rollAngle: number
  push: boolean
}

export function createRecoveryFeatures(): RecoveryFeatures {
  return {
    tas0: 0, tasEnd: 0, gamma: 0, sinDown: 0, cosGamma: 1,
    initialLoad: 0, verticalLoad: 0, pitchRate: 0, gLoad: 0,
    nPullEnd: 0, nPushEnd: 0, alphaTravel: 0, turnRate: 0, pitchAcceleration: 0,
    baseDrag: 0, inducedDragPerNSq: 0, floorThrust: 0, mass: 1,
    gravityAlongDive: 0, rollRate: 0, rollAngle: 0, push: false,
  }
}

const UP = new Vector3(0, 1, 0)
const FWD = new Vector3(0, 0, -1)
const tmpV = new Vector3()
const tmpC = new Vector3()
const tmpL = new Vector3()
const tmpAim = new Vector3()
const tmpBody = new Vector3()
const tmpQ = new Quaternion()
const FEATURE_SCRATCH = createRecoveryFeatures()
const AIR: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }

/** 升力方向與垂直速度平面內朝上方向的夾角，rad。僅供量測顯示。 */
export function bankFromUpright(a: Aircraft): number {
  const v = a.state.velocity
  const tas = v.length()
  if (tas < 1e-3) return 0
  tmpV.copy(v).divideScalar(tas)
  tmpC.copy(UP).addScaledVector(tmpV, -UP.dot(tmpV))
  const len = tmpC.length()
  // 近鉛直時垂直速度平面退化，沒有唯一的坡度可顯示。
  if (len < 1e-3) return 0
  tmpC.divideScalar(len)
  tmpL.copy(UP).applyQuaternion(a.state.orientation)
  return Math.acos(Math.max(-1, Math.min(1, tmpL.dot(tmpC))))
}

/** 與 `applySafety` 相同的航跡角前瞻。 */
export function worstGamma(a: Aircraft): number {
  const vel = a.state.velocity
  const tas = vel.length()
  if (tas < 1e-3) return 0
  const gamma = Math.asin(Math.max(-1, Math.min(1, vel.y / tas)))
  const predicted = gamma < 0
    ? Math.max(-Math.PI / 2, gamma + flightPathRate(a) * DEFAULT_SAFETY.lookahead)
    : gamma
  return Math.min(gamma, predicted)
}

/**
 * 取得撞地接管使用的水平航向。變體以升力方向的水平投影為優先；投影退化時
 * 回到速度水平投影，再回到機首，確保近鉛直與正立平飛都有定義。
 */
function recoveryHeading(a: Aircraft, direction: RecoveryDirection, out: Vector3): void {
  const vel = a.state.velocity
  const tas = vel.length()
  const horizontalFraction = Math.hypot(vel.x, vel.z) / Math.max(tas, 1e-3)
  // 水平速度只剩 TAS 的四分之一時，投影航向對微小擾動很敏感；變體僅在這個
  // 近鉛直區使用升力投影，其他姿態逐位沿用現行速度航向。
  if (direction === 'lift-horizontal' && horizontalFraction < 0.25) {
    out.copy(UP).applyQuaternion(a.state.orientation)
    out.y = 0
    const liftLen = out.length()
    if (liftLen > 1e-3) {
      out.divideScalar(liftLen)
      return
    }
  }

  out.set(vel.x, 0, vel.z)
  const velLen = out.length()
  if (velLen > 1e-3) {
    out.divideScalar(velLen)
    return
  }

  out.copy(FWD).applyQuaternion(a.state.orientation)
  out.y = 0
  const noseLen = out.length()
  if (noseLen > 1e-3) out.divideScalar(noseLen)
  else out.set(0, 0, -1)
}

function setRecoveryAim(a: Aircraft, direction: RecoveryDirection, out: Vector3): void {
  recoveryHeading(a, direction, out)
  out.multiplyScalar(Math.cos(DEFAULT_SAFETY.recoveryPitch))
  out.y = Math.sin(DEFAULT_SAFETY.recoveryPitch)
  out.normalize()
}

/**
 * 將飛機當下狀態轉成第二版模型特徵。限制器過載、負 G 配額、滾轉率、阻力、
 * 推力與俯仰力矩能力都直接取自機種規格及遊戲使用的既有函式。
 */
export function recoveryFeatures(
  a: Aircraft,
  out: RecoveryFeatures,
  direction: RecoveryDirection = 'velocity',
): RecoveryFeatures {
  const spec = a.spec
  const alt = a.state.position.y
  const tas0 = a.state.velocity.length()
  const gamma = worstGamma(a)
  atmosphere(alt, AIR)

  const vc = cornerSpeed(spec, alt)
  const tasEnd = Math.min(tas0, vc)
  const tasMid = Math.sqrt((tas0 * tas0 + tasEnd * tasEnd) * 0.5)
  const qbarStart = 0.5 * AIR.density * tas0 * tas0
  const qbarEnd = 0.5 * AIR.density * tasEnd * tasEnd
  const qbarMid = 0.5 * AIR.density * tasMid * tasMid

  const slatsNow = a.diag.slatsDeployed
  const slatsAtLimit = spec.lift.slatAlphaBonus > 0
  const alphaStart = spec.lift.alphaCrit * ALPHA_MARGIN
    + (slatsNow ? spec.lift.slatAlphaBonus : 0)
  const alphaEnd = spec.lift.alphaCrit * ALPHA_MARGIN
    + (slatsAtLimit ? spec.lift.slatAlphaBonus : 0)
  const clStart = liftCoefficient(spec, alphaStart, slatsNow)
  const clEnd = liftCoefficient(spec, alphaEnd, slatsAtLimit)
  const nAeroStart = (qbarStart * spec.wing.area * clStart) / (spec.mass * G0)
  const nAeroEnd = (qbarEnd * spec.wing.area * clEnd) / (spec.mass * G0)
  const nPullStart = Math.max(0, Math.min(nAeroStart, spec.limits.gPositive))
  const nPullEnd = Math.max(0, Math.min(nAeroEnd, spec.limits.gPositive))
  const nNegStart = Math.max(PILOT_G_NEGATIVE, spec.limits.gNegative, -nAeroStart)
  const nNegEnd = Math.max(PILOT_G_NEGATIVE, spec.limits.gNegative, -nAeroEnd)

  const gLoad = gLoadFromOrientation(a.state.orientation)
  const qMax = tas0 > 1
    ? Math.max((G0 * (nPullStart - gLoad)) / tas0, QMAX_FLOOR)
    : 0
  const qMin = tas0 > 1
    ? Math.min((G0 * (nNegStart - gLoad)) / tas0, -QMAX_FLOOR)
    : 0
  const qMaxEnd = tasEnd > 1
    ? Math.max((G0 * (nPullEnd - gLoad)) / tasEnd, QMAX_FLOOR)
    : 0
  const qMinEnd = tasEnd > 1
    ? Math.min((G0 * (nNegEnd - gLoad)) / tasEnd, -QMAX_FLOOR)
    : 0

  setRecoveryAim(a, direction, tmpAim)
  tmpBody.copy(tmpAim).applyQuaternion(tmpQ.copy(a.state.orientation).invert())
  const errorAngle = Math.atan2(Math.hypot(tmpBody.x, tmpBody.y), -tmpBody.z)
  const rollPull = Math.atan2(tmpBody.x, tmpBody.y)
  const rollPush = Math.atan2(tmpBody.x, -tmpBody.y)
  const rollRate = Math.max(maxRollRate(spec, alt, Math.max(tas0, 1)), 1e-3)
  let push = false
  if (tmpBody.y < 0) {
    const extraRoll = Math.abs(rollPull) - Math.abs(rollPush)
    const tPull = extraRoll / rollRate + errorAngle / Math.max(qMax, 1e-6)
    const tPush = errorAngle / Math.max(Math.abs(qMin), 1e-6)
    push = tPush <= tPull * (1 - DEFAULT_DIRECTOR_GAINS.pushHysteresis)
  }

  const elevatorEff = lowSpeedEffectiveness(spec, qbarMid)
    * redlinePitchEffectiveness(spec.limits.vne, qbarMid)
    * controlEffectiveness(
      spec.controlStiffening.elevatorK, spec.controlStiffening.qRef, qbarMid,
    )
  const pitchAcceleration = (
    qbarMid * spec.wing.area * spec.wing.chord * Math.abs(spec.moments.cmDe) * elevatorEff
  ) / spec.inertia.pitch

  const machMid = AIR.soundSpeed > 0 ? tasMid / AIR.soundSpeed : 0
  const qS = qbarMid * spec.wing.area
  const baseDrag = qS * dragCoefficient(spec, 0, 0, machMid, 1)
  const inducedDragPerNSq = qS > 1e-6
    ? inducedDragFactor(spec) * (spec.mass * G0) ** 2 / qS
    : 0

  tmpV.copy(a.state.velocity).divideScalar(Math.max(tas0, 1e-3))
  tmpC.copy(UP).addScaledVector(tmpV, -UP.dot(tmpV))
  const cLen = tmpC.length()
  let verticalLoad = 0
  if (cLen > 1e-3) {
    tmpC.divideScalar(cLen)
    tmpL.copy(UP).applyQuaternion(a.state.orientation)
    verticalLoad = a.diag.loadFactor * tmpL.dot(tmpC)
  }

  out.tas0 = tas0
  out.tasEnd = tasEnd
  out.gamma = gamma
  out.sinDown = Math.max(0, -Math.sin(gamma))
  out.cosGamma = Math.cos(gamma)
  out.initialLoad = Number.isFinite(a.diag.loadFactor) ? a.diag.loadFactor : 0
  out.verticalLoad = verticalLoad
  out.pitchRate = a.state.angularVelocity.x
  out.gLoad = gLoad
  out.nPullEnd = nPullEnd
  out.nPushEnd = Math.abs(nNegEnd)
  out.alphaTravel = push
    ? Math.max(0, alphaEnd + a.diag.aero.alpha)
    : Math.max(0, alphaEnd - a.diag.aero.alpha)
  out.turnRate = push ? Math.abs(qMinEnd) : qMaxEnd
  out.pitchAcceleration = Math.max(pitchAcceleration, 1e-6)
  out.baseDrag = baseDrag
  out.inducedDragPerNSq = inducedDragPerNSq
  out.floorThrust = thrustAt(spec, alt, Math.max(tasMid, 1), THROTTLE_FLOOR)
  out.mass = spec.mass
  out.gravityAlongDive = G0 * out.sinDown
  out.rollRate = rollRate
  out.rollAngle = push ? 0 : Math.abs(rollPull)
  out.push = push
  return out
}

/** 線性建立過程在 `[t0, t1]` 的平均值。 */
function averageDuringBuild(
  initial: number, target: number, t0: number, t1: number, buildTime: number,
): number {
  if (t1 <= t0) return target
  if (buildTime <= 1e-6 || t0 >= buildTime) return target
  const endRamp = Math.min(t1, buildTime)
  const d = target - initial
  const rampIntegral = initial * (endRamp - t0)
    + d * (endRamp * endRamp - t0 * t0) / (2 * buildTime)
  const steadyIntegral = target * Math.max(0, t1 - buildTime)
  return (rampIntegral + steadyIntegral) / (t1 - t0)
}

/** 線性建立過程在 `[0, duration]` 的均方值，供誘導阻力使用。 */
function meanSquareDuringBuild(
  initial: number, target: number, duration: number, buildTime: number,
): number {
  if (duration <= 1e-6 || buildTime <= 1e-6) return target * target
  const ramp = Math.min(duration, buildTime)
  const d = target - initial
  const x = ramp / buildTime
  const rampIntegral = buildTime * (
    initial * initial * x + initial * d * x * x + d * d * x * x * x / 3
  )
  const steadyIntegral = target * target * Math.max(0, duration - buildTime)
  return (rampIntegral + steadyIntegral) / duration
}

/**
 * 由已保存的物理特徵預測改出掉高，m。公式分為減速、過載／滾轉建立、拉平三段；
 * 建立與滾轉和減速同時進行，因此只計尚未被減速時間覆蓋的部分。
 */
export function predictFromFeatures(f: RecoveryFeatures, k: RecoveryCoeffs): number {
  if (f.tas0 < 1e-3 || f.gamma >= 0) return 0

  const eta = Math.max(k.eta, 0.05)
  const nTurn = Math.max(eta * (f.push ? f.nPushEnd : f.nPullEnd), 0.05)
  const signedTurn = f.push ? -nTurn : nTurn
  const qTarget = G0 * (signedTurn - f.gLoad) / Math.max(f.tasEnd, 1)
  const qDelta = f.push
    ? Math.max(0, f.pitchRate - qTarget)
    : Math.max(0, qTarget - f.pitchRate)
  const buildTime = Math.max(k.c1, 0) * (
    f.alphaTravel / Math.max(f.turnRate, QMAX_FLOOR)
    + qDelta / f.pitchAcceleration
  )
  const rollTime = f.rollAngle / Math.max(f.rollRate, 1e-3)
  const readyTime = Math.max(buildTime, rollTime)

  let decelTime = 0
  if (f.tas0 > f.tasEnd + 1e-6) {
    const fullRampNSq = (
      f.initialLoad * f.initialLoad
      + f.initialLoad * signedTurn
      + signedTurn * signedTurn
    ) / 3
    let decel = (
      f.baseDrag + f.inducedDragPerNSq * fullRampNSq - f.floorThrust
    ) / f.mass - f.gravityAlongDive
    decel = Math.max(decel, 0.1)
    decelTime = (f.tas0 - f.tasEnd) / decel

    const nSq = meanSquareDuringBuild(
      f.initialLoad, signedTurn, decelTime, buildTime,
    )
    decel = (
      f.baseDrag + f.inducedDragPerNSq * nSq - f.floorThrust
    ) / f.mass - f.gravityAlongDive
    decel = Math.max(decel, 0.1)
    decelTime = (f.tas0 - f.tasEnd) / decel
  }

  let gamma = f.gamma
  let drop = 0
  if (decelTime > 1e-6 && gamma < 0) {
    const vMean = 0.5 * (f.tas0 + f.tasEnd)
    const nVertical = averageDuringBuild(
      f.verticalLoad, nTurn, 0, decelTime, readyTime,
    )
    const omega = G0 * (nVertical - Math.cos(gamma)) / Math.max(vMean, 1)
    let turnTime = decelTime
    let verticalTime = 0
    if (omega > 1e-9 && gamma + omega * turnTime > 0) turnTime = -gamma / omega
    if (omega < -1e-9 && gamma + omega * turnTime < -Math.PI / 2) {
      turnTime = (-Math.PI / 2 - gamma) / omega
      verticalTime = decelTime - turnTime
    }
    if (Math.abs(omega) > 1e-9) {
      const nextGamma = gamma + omega * turnTime
      drop += vMean * (Math.cos(nextGamma) - Math.cos(gamma)) / omega
      gamma = nextGamma
    } else {
      drop += vMean * -Math.sin(gamma) * turnTime
    }
    if (verticalTime > 0) {
      drop += vMean * verticalTime
      gamma = -Math.PI / 2
    } else if (turnTime < decelTime) {
      gamma = 0
    }
  }

  if (readyTime > decelTime && gamma < 0) {
    const nVertical = averageDuringBuild(
      f.verticalLoad, nTurn, decelTime, readyTime, readyTime,
    )
    const omega = G0 * (nVertical - Math.cos(gamma)) / Math.max(f.tasEnd, 1)
    const stageTime = readyTime - decelTime
    let turnTime = stageTime
    let verticalTime = 0
    if (omega > 1e-9 && gamma + omega * turnTime > 0) turnTime = -gamma / omega
    if (omega < -1e-9 && gamma + omega * turnTime < -Math.PI / 2) {
      turnTime = (-Math.PI / 2 - gamma) / omega
      verticalTime = stageTime - turnTime
    }
    if (Math.abs(omega) > 1e-9) {
      const nextGamma = gamma + omega * turnTime
      drop += f.tasEnd * (Math.cos(nextGamma) - Math.cos(gamma)) / omega
      gamma = nextGamma
    } else {
      drop += f.tasEnd * -Math.sin(gamma) * turnTime
    }
    if (verticalTime > 0) {
      drop += f.tasEnd * verticalTime
      gamma = -Math.PI / 2
    } else if (turnTime < stageTime) {
      gamma = 0
    }
  }

  return Math.max(0, drop) + recoveryAltitude(f.tasEnd, gamma, nTurn)
}

/** 第二版模型所需高度（不含固定餘裕），m。 */
export function predictRecovery(
  a: Aircraft,
  k: RecoveryCoeffs,
  direction: RecoveryDirection = 'velocity',
): number {
  recoveryFeatures(a, FEATURE_SCRATCH, direction)
  return predictFromFeatures(FEATURE_SCRATCH, k)
}

export interface RecoveryRollout {
  /** 從目前位置到最低點的實際物理掉高，m。 */
  drop: number
  /** 到垂直速度首次轉為非負的時間，s。 */
  seconds: number
  /** 是否在時間上限內完成改出。 */
  recovered: boolean
}

/**
 * 以完整 `Aircraft.update` 物理與正式撞地改出指令，從當下狀態向前試飛到最低點。
 * 這是混合式方案的高精度慢路徑原型，不會修改來源飛機。預演時間不是固定的：
 * 戰鬥機一開始爬升就停，反應較慢的轟炸機會自然多跑；`maxSeconds` 只防失控。
 *
 * 指揮儀的 PID、遲滯與外環積分狀態，以及舵面指令／實際位置，都從來源飛機
 * 複製；因此預演分支與本體只有後續是否立刻採取撞地改出指令這一項差異。
 */
export function predictRecoveryRollout(
  source: Aircraft,
  direction: RecoveryDirection = 'velocity',
  maxSeconds = 20,
  stepDt = DT,
): RecoveryRollout {
  if (source.state.velocity.y >= 0) return { drop: 0, seconds: 0, recovered: true }
  const a = new Aircraft(source.spec, source.state.position.y, source.state.velocity.length())
  a.state.position.copy(source.state.position)
  a.state.velocity.copy(source.state.velocity)
  a.state.orientation.copy(source.state.orientation)
  a.state.angularVelocity.copy(source.state.angularVelocity)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
  a.diag.slatsDeployed = source.diag.slatsDeployed
  Object.assign(a.diag.air, source.diag.air)
  Object.assign(a.diag.aero, source.diag.aero)
  a.diag.thrustN = source.diag.thrustN
  a.diag.powerW = source.diag.powerW
  a.diag.loadFactor = source.diag.loadFactor
  a.diag.controlAuthority = source.diag.controlAuthority
  a.controls.aileron = source.controls.aileron
  a.controls.elevator = source.controls.elevator
  a.controls.rudder = source.controls.rudder
  a.controls.throttle = source.controls.throttle
  a.controls.brake = source.controls.brake
  a.surfaces.aileron = source.surfaces.aileron
  a.surfaces.elevator = source.surfaces.elevator
  a.surfaces.rudder = source.surfaces.rudder
  a.surfaces.throttle = source.surfaces.throttle
  a.surfaces.brake = source.surfaces.brake
  a.director.copyStateFrom(source.director)

  const startY = a.state.position.y
  let minY = startY
  const recover = createCommand()
  const dt = Math.max(DT, stepDt)
  const steps = Math.round(maxSeconds / dt)
  for (let i = 0; i < steps; i++) {
    applySafety(a, 1e9, recover)
    if (direction === 'lift-horizontal') setRecoveryAim(a, direction, recover.aimWorld)
    a.update(recover.aimWorld, recover.throttle, dt, recover.brake, recover.upright)
    minY = Math.min(minY, a.state.position.y)
    if (a.state.velocity.y >= 0) {
      return { drop: startY - minY, seconds: (i + 1) * dt, recovered: true }
    }
  }
  return { drop: startY - minY, seconds: maxSeconds, recovered: false }
}

export type Intent = 'strafe' | 'turn'

export interface Scenario {
  spec: AircraftSpec
  /** 地面的海拔，m。 */
  ground: number
  /** 起始離地高度，m。 */
  agl: number
  tas: number
  gammaDeg: number
  bankDeg: number
  /** 初始滾轉角速度，°/s。正值代表坡度增加。 */
  rollRateDeg: number
  /** 初始過載，並用來設定一致的初始俯仰角速度。 */
  load: number
  intent: Intent
}

export interface ModelParams extends RecoveryCoeffs {
  /** 一旦接管就撐到垂直速度不再向下才放手。 */
  latch: boolean
  margin: number
}

export type SafetyModel = 'current' | 'new' | 'rollout'

export interface TrialOptions {
  /** `lift-horizontal` 只改試驗中的撞地改出航向，不改正式安全層。 */
  recoveryDirection?: RecoveryDirection
  /** 第一次接管後一旦不再下降便結束，供批次量測節省無關的後續步進。 */
  stopAfterFirstRecovery?: boolean
}

export interface TrialStep {
  t: number
  aircraft: Aircraft
  agl: number
  needed: number
  takeover: boolean
}

export interface TrialResult {
  triggerT: number
  triggerAgl: number
  minAgl: number
  minT: number
  crashed: boolean
}

export function setupAircraft(s: Scenario): Aircraft {
  const alt = s.ground + s.agl
  const a = new Aircraft(s.spec, alt, s.tas)
  const g = s.gammaDeg * DEG
  const dir = new Vector3(0, Math.sin(g), -Math.cos(g))
  a.state.position.set(0, alt, 0)
  a.state.velocity.copy(dir).multiplyScalar(s.tas)
  a.state.orientation.setFromUnitVectors(FWD, dir)
  a.state.orientation.multiply(new Quaternion().setFromAxisAngle(FWD, s.bankDeg * DEG))
  const phi = s.bankDeg * DEG
  const q = s.load > 1 ? (G0 * (s.load - Math.cos(g) * Math.cos(phi))) / s.tas : 0
  a.state.angularVelocity.set(q, 0, -s.rollRateDeg * DEG)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)

  // 第一個判定發生在物理步進之前；以場景宣告的初始過載及真實高度的大氣
  // 初始化診斷值，避免把尚未就位的 0 G 誤當成正在加深俯衝。
  atmosphere(alt, AIR)
  a.diag.aero.tas = s.tas
  a.diag.aero.alpha = 0
  a.diag.aero.beta = 0
  a.diag.aero.qbar = 0.5 * AIR.density * s.tas * s.tas
  a.diag.aero.mach = AIR.soundSpeed > 0 ? s.tas / AIR.soundSpeed : 0
  a.diag.loadFactor = s.load
  return a
}

const TURN_AIM = 25 * DEG

/** 閉迴路試飛；兩個模型共用正式安全層產生的撞地改出指令。 */
export function simulateTrial(
  s: Scenario, model: SafetyModel, p: ModelParams, seconds: number,
  stopAtGround: boolean, onStep?: (step: TrialStep) => void, options?: TrialOptions,
): TrialResult {
  const a = setupAircraft(s)
  const direction = options?.recoveryDirection ?? 'velocity'
  const g = s.gammaDeg * DEG
  const reach = g < -0.5 * DEG ? s.agl / Math.tan(-g) : 1e6
  const groundPoint = new Vector3(0, s.ground, -reach)
  const cmd = createCommand()
  const recover = createCommand()
  const vhat = new Vector3()
  const liftPerp = new Vector3()
  const result: TrialResult = {
    triggerT: NaN, triggerAgl: NaN, minAgl: Infinity, minT: 0, crashed: false,
  }
  let latched = false
  let rolloutNeeded = 0
  let nextRolloutStep = 0
  const rolloutRefreshSteps = Math.max(1, Math.round(0.1 / DT))

  const steps = Math.round(seconds / DT)
  for (let i = 0; i <= steps; i++) {
    const t = i * DT
    const pos = a.state.position
    const vel = a.state.velocity
    const tas = vel.length()
    const agl = pos.y - s.ground

    if (s.intent === 'strafe') {
      cmd.aimWorld.copy(groundPoint).sub(pos)
      if (cmd.aimWorld.lengthSq() < 1) cmd.aimWorld.copy(FWD).applyQuaternion(a.state.orientation)
    } else {
      vhat.copy(vel).divideScalar(Math.max(tas, 1e-3))
      liftPerp.copy(UP).applyQuaternion(a.state.orientation)
      liftPerp.addScaledVector(vhat, -liftPerp.dot(vhat))
      if (liftPerp.lengthSq() < 1e-6) liftPerp.copy(UP)
      liftPerp.normalize()
      cmd.aimWorld.copy(vhat).multiplyScalar(Math.cos(TURN_AIM))
        .addScaledVector(liftPerp, Math.sin(TURN_AIM))
    }
    cmd.aimWorld.normalize()
    cmd.throttle = WEP_THROTTLE
    cmd.brake = 0
    cmd.upright = false

    let takeover: boolean
    let needed: number
    if (model === 'current') {
      const nMax = Math.min(maxLoadFactorAero(s.spec, pos.y, tas), s.spec.limits.gPositive)
      needed = recoveryAltitude(tas, worstGamma(a), nMax) * DEFAULT_SAFETY.factor
        + recoveryClearance(s.spec)
      const action = applySafety(a, s.ground, cmd)
      takeover = action === 'ground' || action === 'terrain'
    } else {
      if (model === 'rollout') {
        // 展示／慢路徑每 0.1 s 重算一次 60 Hz 完整物理預演；兩次之間沿用前值。
        // 一旦鎖定接管便不必再預演，因為實體軌跡已在執行同一套改出指令。
        if (!latched && i >= nextRolloutStep) {
          const rollout = predictRecoveryRollout(a, direction, 20, 1 / 60)
          rolloutNeeded = rollout.recovered ? rollout.drop : Infinity
          nextRolloutStep = i + rolloutRefreshSteps
        }
        needed = rolloutNeeded + p.margin
      } else {
        needed = predictRecovery(a, p, direction) + p.margin
      }
      if (agl <= needed) latched = p.latch
      else if (latched && vel.y >= 0) latched = false
      takeover = agl <= needed || latched
      if (takeover) {
        applySafety(a, 1e9, recover)
        cmd.aimWorld.copy(recover.aimWorld)
        if (direction === 'lift-horizontal') setRecoveryAim(a, direction, cmd.aimWorld)
        cmd.throttle = recover.throttle
        cmd.brake = recover.brake
        cmd.upright = recover.upright
      } else {
        applySafety(a, -1e9, cmd)
      }
    }
    if (takeover && Number.isNaN(result.triggerT)) {
      result.triggerT = t
      result.triggerAgl = agl
    }
    if (agl < result.minAgl) {
      result.minAgl = agl
      result.minT = t
    }
    onStep?.({ t, aircraft: a, agl, needed, takeover })
    if (
      options?.stopAfterFirstRecovery === true
      && !Number.isNaN(result.triggerT)
      && vel.y >= 0
    ) break
    if (agl <= 0 && stopAtGround) {
      result.crashed = true
      break
    }
    if (agl <= 0) result.crashed = true
    a.update(cmd.aimWorld, cmd.throttle, DT, cmd.brake, cmd.upright)
  }
  return result
}
