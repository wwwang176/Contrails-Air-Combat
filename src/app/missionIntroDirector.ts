import { Vector3, type PerspectiveCamera, type Quaternion } from 'three'
import type { IntroShot } from '../battle/missions/types'
import { applyBlend, createCameraBlend, startBlend } from '../camera/cameraBlend'
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

/** 黑邊與跳過提示那一層。`on` 類別控制滑入滑出（CSS 轉場） */
export interface IntroOverlay {
  readonly classList: Pick<DOMTokenList, 'toggle'>
}

/**
 * 開場導覽的每幀接線：吃跳過、蓋掉玩家輸入、推時鐘、覆寫鏡頭、結束時滑回。
 *
 * ```
 *   幀首      frameStart —— 在 `stepPlayerControl` 之前
 *   鏡頭之後  applyCamera —— 在照常算完玩家的鏡頭之後
 * ```
 */
export function createMissionIntroDirector(overlay: IntroOverlay, fovBase: number) {
  const state = createIntroState()
  const blend = createCameraBlend(INTRO_RETURN_SECONDS)
  const nose = new Vector3()
  let throttle = 0
  const pos = new Vector3()
  const look = new Vector3()

  /** 開始播。沒有鏡位就什麼都不做 */
  function begin(shots: readonly IntroShot[] | undefined, input: InputState, orientation: Quaternion): void {
    startIntro(state, shots)
    blend.active = false
    nose.set(0, 0, -1).applyQuaternion(orientation)
    throttle = input.throttle
    overlay.classList.toggle('on', state.active)
  }

  /** 離開戰鬥：導覽與滑回都收掉 */
  function stop(): void {
    state.active = false
    blend.active = false
    overlay.classList.toggle('on', false)
  }

  /**
   * 幀首。**回傳 true = 導覽在這一幀結束**（走完或跳過）：鏡頭從上一幀的鏡位
   * 開始滑回，黑邊退場。跳過旗標每幀都清，沒在播時按的空白鍵不留到下一場
   */
  function frameStart(input: InputState, camera: PerspectiveCamera, dt: number): boolean {
    if (input.skipRequested) skipIntro(state)
    input.skipRequested = false
    if (!state.active) return false
    holdIntroInput(input, nose, throttle)
    if (!stepIntro(state, dt)) return false
    // 【幀首的相機還停在上一幀的鏡位】那正是玩家眼前的畫面，從這裡滑回
    startBlend(blend, camera)
    overlay.classList.toggle('on', false)
    return true
  }

  /** 照常算完玩家的鏡頭之後：導覽中覆寫成鏡位，滑回中往鏡位拉回一部分 */
  function applyCamera(camera: PerspectiveCamera, scene: IntroScene, dt: number): void {
    const at = introShotAt(state)
    if (at !== null && introCameraPose(state.shots[at.index]!, at.local, scene, pos, look)) {
      camera.position.copy(pos)
      camera.up.set(0, 1, 0)
      camera.lookAt(look)
      if (camera.fov !== fovBase) {
        camera.fov = fovBase
        camera.updateProjectionMatrix()
      }
      return
    }
    applyBlend(blend, camera, dt)
  }

  return {
    get active(): boolean { return state.active },
    /** 導覽中或還在滑回玩家。教學卡等這個變 false 才彈 —— 彈在滑回途中的話鏡頭會停在半路 */
    get busy(): boolean { return state.active || blend.active },
    begin, stop, frameStart, applyCamera,
  }
}
