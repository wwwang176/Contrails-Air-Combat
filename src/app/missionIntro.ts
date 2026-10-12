import { Vector3 } from 'three'
import type { IntroShot } from '../battle/missions/types'
import type { GroundTarget } from '../world/groundTargets'
import type { InputState } from '../input/InputState'
import type { GroundUnitId } from '../specs/ground'

/**
 * 開場導覽的狀態。規格見 `docs/superpowers/specs/2026-10-12-mission-intro-design.md`。
 *
 * 時鐘吃物理時間（暫停時不走）。`stepIntro` 在走完或跳過的那一步回 true 一次，
 * 呼叫端在那一刻起鏡頭的滑回、收黑邊、放出教學卡。
 */
export interface IntroState {
  active: boolean
  /** 導覽開始到現在幾秒 */
  t: number
  shots: readonly IntroShot[]
  /** 玩家要求跳過；下一步就結束 */
  skip: boolean
}

export function createIntroState(): IntroState {
  return { active: false, t: 0, shots: [], skip: false }
}

/** 開始一段導覽。沒有鏡位就不播 */
export function startIntro(s: IntroState, shots: readonly IntroShot[] | undefined): void {
  s.shots = shots ?? []
  s.active = s.shots.length > 0
  s.t = 0
  s.skip = false
}

export function skipIntro(s: IntroState): void {
  if (s.active) s.skip = true
}

/** 推進導覽。**走完或跳過的那一步回 true**，其餘（含沒在播）回 false */
export function stepIntro(s: IntroState, dt: number): boolean {
  if (!s.active) return false
  s.t += dt
  let total = 0
  for (const shot of s.shots) total += shot.seconds
  if (!s.skip && s.t < total) return false
  s.active = false
  return true
}

/** 現在播到第幾段、段內第幾秒。沒在播回 null */
export function introShotAt(s: IntroState): { index: number; local: number } | null {
  if (!s.active) return null
  let start = 0
  for (let i = 0; i < s.shots.length; i++) {
    const end = start + s.shots[i]!.seconds
    if (s.t < end || i === s.shots.length - 1) return { index: i, local: s.t - start }
    start = end
  }
  return null
}

const FWD = new Vector3()
const RIGHT = new Vector3()

/**
 * 這一段在段內 `local` 秒的鏡頭位置與看的點，寫進 `pos`／`look`。
 *
 * @param groundAt 地面高度。`follow` 的鏡頭高度量在鏡頭正下方的地面上 —— 量在
 *   目標的高度上的話，貼地拍的鏡頭遇到路邊高起的地會鑽進地裡
 * @returns false = 這一段沒東西可拍（`follow` 要跟的已經全滅），呼叫端照常用玩家的鏡頭
 */
export function introCameraPose(
  shot: IntroShot, local: number, targets: readonly GroundTarget[], pos: Vector3, look: Vector3,
  groundAt?: (x: number, z: number) => number,
): boolean {
  if (shot.kind === 'pan') {
    const k = Math.min(1, Math.max(0, local / shot.seconds))
    pos.set(
      shot.from.x + (shot.to.x - shot.from.x) * k,
      shot.from.y + (shot.to.y - shot.from.y) * k,
      shot.from.z + (shot.to.z - shot.from.z) * k,
    )
    look.set(
      shot.lookFrom.x + (shot.lookTo.x - shot.lookFrom.x) * k,
      shot.lookFrom.y + (shot.lookTo.y - shot.lookFrom.y) * k,
      shot.lookFrom.z + (shot.lookTo.z - shot.lookFrom.z) * k,
    )
    return true
  }
  const t = followTarget(targets, shot.unit)
  if (t === null) return false
  // 地面模型朝 −Z；右側是 +X（與機體同一套）
  FWD.set(0, 0, -1).applyQuaternion(t.orientation)
  RIGHT.set(1, 0, 0).applyQuaternion(t.orientation)
  const k = Math.min(1, Math.max(0, local / shot.seconds))
  const back = shot.backTo === undefined ? shot.back : shot.back + (shot.backTo - shot.back) * k
  pos.copy(t.position)
    .addScaledVector(FWD, -back)
    .addScaledVector(RIGHT, shot.side)
  const floor = groundAt === undefined ? t.position.y : Math.max(t.position.y, groundAt(pos.x, pos.z))
  pos.y = floor + shot.up
  look.copy(t.position).addScaledVector(FWD, shot.lead)
  look.y += shot.lookUp ?? 0
  return true
}

/** `unit` 裡還活著、會動、已經出場的第一座 */
function followTarget(targets: readonly GroundTarget[], unit: GroundUnitId): GroundTarget | null {
  for (const t of targets) {
    if (t.unit.id === unit && t.alive && !t.dormant && t.motion !== null) return t
  }
  return null
}

/**
 * 導覽期間玩家的飛機不吃操縱：清掉這一幀累積的所有輸入，瞄準點鎖在 `nose`，油門
 * 固定在 `throttle`。**每幀在 `stepPlayerControl` 之前呼叫** —— 鍵盤滑鼠的事件已經
 * 寫進來了，這裡把它們蓋掉，飛機就直直往前飛。
 *
 * 【上帝視角與代飛也蓋掉】按 G／I 會把 `godView`／`playerAi` 翻過去；在玩家控制
 * 讀到之前翻回來，就不會觸發進出上帝視角的那一段
 */
export function holdIntroInput(input: InputState, nose: Vector3, throttle: number): void {
  input.aimWorld.copy(nose)
  input.aimDeltaX = 0
  input.aimDeltaY = 0
  input.firing = false
  input.braking = false
  input.zoom = false
  input.lookActive = false
  input.lookYaw = 0
  input.lookPitch = 0
  input.godView = false
  input.playerAi = false
  input.bombTaps = 0
  input.throttle = throttle
}
