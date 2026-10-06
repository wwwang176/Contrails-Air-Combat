import type { MessageKey } from '../i18n'

/** 設定頁的兩個選項 */
export const AIM_ASSIST_LEVELS: readonly { labelKey: MessageKey; value: boolean }[] = [
  { labelKey: 'common.on', value: true },
  { labelKey: 'common.off', value: false },
]

const AIM_ASSIST_KEY = 'input.aimAssist'

/**
 * 沒有設定過時：**觸控裝置開、滑鼠關。** 滑鼠本來就瞄得準，被拉住反而干擾；
 * 玩家改過一次就以玩家的為準。
 */
export function defaultAimAssist(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

/** 讀寫都包 try，理由同 `render/quality.ts` 的 `readQuality` */
export function readAimAssist(): boolean {
  try {
    const v = localStorage.getItem(AIM_ASSIST_KEY)
    return v === null ? defaultAimAssist() : v === '1'
  } catch {
    return defaultAimAssist()
  }
}

export function saveAimAssist(on: boolean): void {
  try {
    localStorage.setItem(AIM_ASSIST_KEY, on ? '1' : '0')
  } catch { /* 存不了就算了 */ }
}
