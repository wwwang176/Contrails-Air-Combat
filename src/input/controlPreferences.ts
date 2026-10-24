import type { MessageKey } from '../i18n'
import type { ControlMode, StickRecenter } from './InputState'

/** 設定頁「操控方式」的兩個選項 */
export const CONTROL_MODES: readonly { labelKey: MessageKey; value: ControlMode }[] = [
  { labelKey: 'settings.control.aim', value: 'aim' },
  { labelKey: 'settings.control.stick', value: 'stick' },
]

/** 設定頁「搖桿回中」的四檔 */
export const STICK_RECENTER_LEVELS: readonly { labelKey: MessageKey; value: StickRecenter }[] = [
  { labelKey: 'common.off', value: 'off' },
  { labelKey: 'settings.recenter.slow', value: 'slow' },
  { labelKey: 'settings.recenter.fast', value: 'fast' },
  { labelKey: 'settings.recenter.instant', value: 'instant' },
]

export const DEFAULT_CONTROL_MODE: ControlMode = 'aim'
export const DEFAULT_STICK_RECENTER: StickRecenter = 'off'

const MODE_KEY = 'input.controlMode'
const RECENTER_KEY = 'input.stickRecenter'

/** 讀寫都包 try，理由同 `aimAssistPreferences.ts`。不認得的值當成沒設定 */
export function readControlMode(): ControlMode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    return CONTROL_MODES.find((m) => m.value === v)?.value ?? DEFAULT_CONTROL_MODE
  } catch {
    return DEFAULT_CONTROL_MODE
  }
}

export function saveControlMode(mode: ControlMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch { /* 存不了就算了 */ }
}

export function readStickRecenter(): StickRecenter {
  try {
    const v = localStorage.getItem(RECENTER_KEY)
    return STICK_RECENTER_LEVELS.find((m) => m.value === v)?.value ?? DEFAULT_STICK_RECENTER
  } catch {
    return DEFAULT_STICK_RECENTER
  }
}

export function saveStickRecenter(recenter: StickRecenter): void {
  try {
    localStorage.setItem(RECENTER_KEY, recenter)
  } catch { /* 存不了就算了 */ }
}
