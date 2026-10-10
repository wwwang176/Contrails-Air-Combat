import { clamp } from '../core/math'
import type { InputState } from './InputState'

/**
 * 自由視角的靈敏度：每移動「一個螢幕半高」轉多少弧度。
 *
 * 比瞄準靈敏度高一截是刻意的——瞄準要能穩穩壓在目標上，看四周則是要能
 * 一把甩過去。5.5 之下掃滿 ±160° 偏航約需 180 px 的滑鼠位移。
 *
 * 手感的另一半在 CameraRig.lookFollowTime——靈敏度決定「移多少轉多少」，
 * 時間常數決定「多久才轉到」。兩個都要短，轉頭才跟手。
 */
const LOOK_SENSITIVITY = 5.5
const LOOK_YAW_LIMIT = 160 * (Math.PI / 180)
const LOOK_PITCH_LIMIT = 80 * (Math.PI / 180)

/**
 * 自由視角轉一段，單位螢幕半高。滑鼠右鍵與觸控右半邊共用。
 *
 * 【死亡鏡頭下不轉】視線由 `deathCamAim` 接管，轉頭會把它從擊殺者身上拉走
 */
export function slewLook(state: Pick<InputState, 'dead' | 'lookYaw' | 'lookPitch'>, dx: number, dy: number): void {
  if (state.dead) return
  state.lookYaw = clamp(state.lookYaw - dx * LOOK_SENSITIVITY, -LOOK_YAW_LIMIT, LOOK_YAW_LIMIT)
  state.lookPitch = clamp(state.lookPitch - dy * LOOK_SENSITIVITY, -LOOK_PITCH_LIMIT, LOOK_PITCH_LIMIT)
}

/** 放開自由視角：鏡頭回正 */
export function endLook(state: Pick<InputState, 'lookActive' | 'lookYaw' | 'lookPitch'>): void {
  state.lookActive = false
  state.lookYaw = 0
  state.lookPitch = 0
}

/**
 * 投彈鍵（鍵盤 `B`、觸控的投彈鈕）。
 *
 * 【只有掛得了彈的飛機能按】`bombCapable` 由 `main.ts` 在換飛機時寫入
 * —— 輸入層對飛機一無所知（見 `attachInput` 的檔頭）
 * 【死亡鏡頭下也不作用】那條相機分支完全不看視線，進去就把死亡鏡頭蓋掉
 * 【掛彈的戰鬥機與 Ju 87：直接投彈】不切視角，見 `InputState.bombRelease`
 * 【`repeat` 為真不連投】作業系統的自動重複只算第一次
 */
export function pressBomb(
  state: Pick<InputState, 'bombCapable' | 'dead' | 'viewMode' | 'bombRelease' | 'bombTaps'>,
  repeat = false,
): void {
  if (state.bombCapable && !state.dead) {
    state.viewMode = state.viewMode === 'bomb' ? 'third' : 'bomb'
  } else if (state.bombRelease && !state.dead && !repeat) {
    state.bombTaps++
  }
}
