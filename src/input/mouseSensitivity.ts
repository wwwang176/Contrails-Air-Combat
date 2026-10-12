/** 滑鼠／觸控靈敏度的倍率範圍與步距（設定頁的拉桿） */
export const MOUSE_SENSITIVITY_MIN = 0.5
export const MOUSE_SENSITIVITY_MAX = 4
export const MOUSE_SENSITIVITY_STEP = 0.1
export const DEFAULT_MOUSE_SENSITIVITY = 1

const KEY = 'input.mouseSensitivity'

/**
 * 夾進範圍、對齊到 0.1 的格子。
 *
 * 【要對齊】拉桿回報的是浮點字串（`2.3000000000000003`）；不對齊的話「有沒有改」
 * 的比較會把同一格當成兩個值，讀數也會多出一串尾數。
 */
export function snapMouseSensitivity(v: number): number {
  const clamped = Math.min(MOUSE_SENSITIVITY_MAX, Math.max(MOUSE_SENSITIVITY_MIN, v))
  // 除以每單位的格數而不是乘步距：23 × 0.1 是 2.3000000000000003
  return Math.round(clamped / MOUSE_SENSITIVITY_STEP) / (1 / MOUSE_SENSITIVITY_STEP)
}

/**
 * 讀寫都包 try，理由同 `audio/volume.ts` 的 `readVolume`。
 *
 * 【超出範圍當成沒設定，不夾】`Number('')` 是 0，夾進範圍會變成最慢的 0.5 倍。
 */
export function readMouseSensitivity(): number {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null || raw.trim() === '') return DEFAULT_MOUSE_SENSITIVITY
    const v = Number(raw)
    if (!Number.isFinite(v) || v < MOUSE_SENSITIVITY_MIN || v > MOUSE_SENSITIVITY_MAX) {
      return DEFAULT_MOUSE_SENSITIVITY
    }
    return snapMouseSensitivity(v)
  } catch {
    return DEFAULT_MOUSE_SENSITIVITY
  }
}

export function saveMouseSensitivity(v: number): void {
  try {
    localStorage.setItem(KEY, String(v))
  } catch { /* 存不了就算了 */ }
}
