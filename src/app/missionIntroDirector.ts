import { Vector3, type PerspectiveCamera, type Quaternion } from 'three'
import type { IntroFire, IntroShot } from '../battle/missions/types'
import { applyBlend, blendWeight, createCameraBlend, startBlend } from '../camera/cameraBlend'
import type { InputState } from '../input/InputState'
import {
  createIntroState, holdIntroInput, introCameraPose, introShotAt, skipIntro, startIntro, stepIntro,
  type IntroScene,
} from './missionIntro'

/**
 * 導覽結束時鏡頭由最後一個鏡位滑回玩家的秒數。比離開上帝視角（0.8 s）長：
 * 導覽的鏡位離玩家常有好幾公里，0.8 s 讀起來像瞬移
 */
export const INTRO_RETURN_SECONDS = 1.5

/** 黑邊滑入、滑出各要幾秒（遊戲時間） */
export const INTRO_BAR_SECONDS = 0.6

/**
 * 黑邊與跳過提示那一層。
 *
 * ```
 *   --k   黑邊進場的程度，0 = 收著、1 = 滿版（CSS 照它算位移與跳過提示的透明度）
 *   on    導覽中；觸控時這一層才接得到點擊
 * ```
 *
 * 【黑邊不用 CSS 轉場】轉場吃牆鐘：暫停時黑邊會自己跑完，回主選單時還看得到它
 * 慢慢收走。改成每幀由遊戲時間推進，暫停就停住，離開戰鬥就直接歸零
 */
export interface IntroOverlay {
  readonly classList: Pick<DOMTokenList, 'toggle'>
  readonly style: Pick<CSSStyleDeclaration, 'setProperty'>
}

/** 鏡位上排的砲擊交給地面戰（`IntroFire`）。呼叫端照 `from`／`to` 找最近的單位 */
export interface IntroCues {
  aim(fire: IntroFire): void
  fire(fire: IntroFire): void
}

/**
 * 開場導覽的每幀接線：吃跳過、蓋掉玩家輸入、推時鐘、覆寫鏡頭、結束時滑回。
 *
 * ```
 *   幀首      frameStart —— 在 `stepPlayerControl` 之前
 *   鏡頭之後  applyCamera —— 在照常算完玩家的鏡頭之後
 * ```
 */
export function createMissionIntroDirector(overlay: IntroOverlay, fovBase: number, cues: IntroCues) {
  const state = createIntroState()
  /** 每一段的每一發（`fires`）開過了沒有 */
  let fired: boolean[][] = []
  const blend = createCameraBlend(INTRO_RETURN_SECONDS)
  const nose = new Vector3()
  let throttle = 0
  const pos = new Vector3()
  const look = new Vector3()
  const returnFocus = new Vector3()
  const chaseFocus = new Vector3()
  const orbit = new Vector3()
  let lastPlayerShot: IntroShot | null = null
  let lastLocal = 0
  let returnDistance = 0
  /** 黑邊進場的程度，見 `IntroOverlay` */
  let bars = 0

  function setBars(k: number): void {
    bars = k
    overlay.style.setProperty('--k', String(k))
  }

  /** 開始播。沒有鏡位就什麼都不做 */
  function begin(shots: readonly IntroShot[] | undefined, input: InputState, orientation: Quaternion): void {
    startIntro(state, shots)
    fired = state.shots.map((s) => (s.fires ?? []).map(() => false))
    blend.active = false
    lastPlayerShot = null
    nose.set(0, 0, -1).applyQuaternion(orientation)
    throttle = input.throttle
    setBars(0)
    overlay.classList.toggle('on', state.active)
  }

  /** 離開戰鬥：導覽、滑回、黑邊都立刻收掉 —— 主選單是另一個場景，不該看到黑邊滑走 */
  function stop(): void {
    state.active = false
    blend.active = false
    lastPlayerShot = null
    setBars(0)
    overlay.classList.toggle('on', false)
  }

  /**
   * 幀首。**回傳 true = 導覽在這一幀結束**（走完或跳過）：鏡頭從上一幀的鏡位
   * 開始滑回，黑邊開始退場。跳過旗標每幀都清，沒在播時按的空白鍵不留到下一場。
   * 黑邊在這裡照 `dt`（遊戲時間）推進，暫停時這一支不被呼叫，黑邊就停住
   */
  function frameStart(input: InputState, camera: PerspectiveCamera, dt: number): boolean {
    if (input.skipRequested) skipIntro(state)
    input.skipRequested = false
    let ended = false
    if (state.active) {
      holdIntroInput(input, nose, throttle)
      if (stepIntro(state, dt)) {
        // 【幀首的相機還停在上一幀的鏡位】那正是玩家眼前的畫面，從這裡滑回
        startBlend(blend, camera)
        returnDistance = camera.position.distanceTo(returnFocus)
        overlay.classList.toggle('on', false)
        ended = true
      } else {
        stepCues()
      }
    }
    const target = state.active ? 1 : 0
    if (bars !== target) {
      const step = dt / INTRO_BAR_SECONDS
      setBars(target > bars ? Math.min(target, bars + step) : Math.max(target, bars - step))
    }
    return ended
  }

  /**
   * 還沒開的每一發：先把砲塔轉向目標（每幀重新指定 —— 地面戰開場前還沒有砲塔，
   * 而它自己的瞄準也可能換掉目標）；播到那一段的第 `at` 秒就開
   */
  function stepCues(): void {
    const at = introShotAt(state)
    for (let i = 0; i < state.shots.length; i++) {
      const fires = state.shots[i]!.fires ?? []
      for (let k = 0; k < fires.length; k++) {
        const fire = fires[k]!
        if (fired[i]![k] === true) continue
        cues.aim(fire)
        if (at !== null && at.index === i && at.local >= fire.at) {
          fired[i]![k] = true
          cues.fire(fire)
        }
      }
    }
  }

  /** 照常算完玩家的鏡頭之後：導覽中覆寫成鏡位，滑回中往鏡位拉回一部分 */
  function applyCamera(camera: PerspectiveCamera, scene: IntroScene, dt: number): void {
    const at = introShotAt(state)
    const shot = at === null ? null : state.shots[at.index]!
    if (at !== null && shot !== null && introCameraPose(shot, at.local, scene, pos, look)) {
      lastPlayerShot = shot.kind === 'follow' && 'player' in shot.subject ? shot : null
      lastLocal = at.local
      returnFocus.copy(look)
      camera.position.copy(pos)
      camera.up.set(0, 1, 0)
      camera.lookAt(look)
      // 【長焦的鏡位】滑回時 `CameraBlend` 連視角一起內插回玩家的鏡頭
      const fov = shot.fov ?? fovBase
      if (camera.fov !== fov) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
      return
    }
    if (state.active) lastPlayerShot = null
    if (blend.active && lastPlayerShot !== null && scene.player !== undefined) {
      // 玩家跟拍的焦點繼續隨主體移動；主體消失時保留最後的焦點。
      if (introCameraPose(lastPlayerShot, lastLocal, scene, pos, look)) returnFocus.copy(look)
      const distance = camera.position.distanceTo(scene.player.aircraft.state.position)
      orbit.set(0, 0, 1).applyQuaternion(camera.quaternion)
      chaseFocus.copy(camera.position).addScaledVector(orbit, -distance)
      applyBlend(blend, camera, dt)
      if (blend.active) {
        const w = blendWeight(blend.elapsed / blend.duration)
        // 以插值後的朝向及視距反推鏡位，讓位置與注視點一起繞行。
        // 直線插值鏡位會切過機身附近，且高速飛機會飛離固定的起點。
        orbit.set(0, 0, 1).applyQuaternion(camera.quaternion)
        camera.position.lerpVectors(returnFocus, chaseFocus, w)
          .addScaledVector(orbit, returnDistance + (distance - returnDistance) * w)
      }
    } else {
      applyBlend(blend, camera, dt)
    }
  }

  return {
    get active(): boolean { return state.active },
    /** 導覽中或還在滑回玩家。教學卡等這個變 false 才彈 —— 彈在滑回途中的話鏡頭會停在半路 */
    get busy(): boolean { return state.active || blend.active },
    begin, stop, frameStart, applyCamera,
  }
}
