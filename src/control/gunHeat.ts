import type { Battery } from '../weapons/types'

/**
 * # 前機槍過熱
 *
 * 只管玩家正在操縱的那一架的前射武器（`PlayerController`）。熱度 0…1：
 * 扳機按著而且沒過熱就加熱（`T` 秒到 1），其餘時候冷卻。到 1 就過熱、打不出去，
 * 冷卻到 `GUN_HEAT_UNLOCK` 才解除。準星的十字照熱度變色（`gunHeatLevel`）。
 *
 * 熱路徑（240 Hz），不配置。
 */

/** `Battery.overheatSeconds` 省略時打到過熱的秒數 */
export const GUN_HEAT_SECONDS = 6
/** 加熱中到這裡變黃（提醒快過熱） */
export const GUN_HEAT_WARN = 0.6
/** 冷卻到這裡才回綠。與 `GUN_HEAT_WARN` 拉開，黃色不會在門檻附近一閃一閃 */
export const GUN_HEAT_CLEAR = 0.2
/** 過熱冷卻到這裡解除，回到黃色、可以再開火：約 2 秒 */
export const GUN_HEAT_UNLOCK = 0.6
/** 每秒冷卻多少：全熱到全冷 5 秒 */
export const GUN_HEAT_COOL = 0.2
/** 過熱時十字準星每秒閃幾次 */
export const GUN_HEAT_BLINK_HZ = 4

export interface GunHeat {
  heat: number
  /** 黃色（有遲滯，見 `GUN_HEAT_CLEAR`） */
  warn: boolean
  /** 過熱：打不出去 */
  locked: boolean
}

export function createGunHeat(): GunHeat {
  return { heat: 0, warn: false, locked: false }
}

export function resetGunHeat(h: GunHeat): void {
  h.heat = 0
  h.warn = false
  h.locked = false
}

/**
 * 推進一步。`firing` 是這一步扳機按著。
 * 【過熱時按著扳機：不加熱也不冷卻】打不出去，但要放開才開始恢復 —— 逼玩家鬆手。
 * `seconds` 非正或非有限時當 `GUN_HEAT_SECONDS`。
 */
export function stepGunHeat(h: GunHeat, firing: boolean, seconds: number, dt: number): void {
  const T = Number.isFinite(seconds) && seconds > 0 ? seconds : GUN_HEAT_SECONDS
  if (firing && h.locked) return
  if (firing) {
    h.heat = Math.min(1, h.heat + dt / T)
    // 【浮點的最後一步】T / dt 步加完可能差 1e-15 到不了 1
    if (h.heat >= 1 - 1e-9) {
      h.heat = 1
      h.locked = true
    }
  } else {
    h.heat = Math.max(0, h.heat - GUN_HEAT_COOL * dt)
    if (h.locked && h.heat <= GUN_HEAT_UNLOCK) h.locked = false
  }
  if (h.heat >= GUN_HEAT_WARN) h.warn = true
  else if (h.heat <= GUN_HEAT_CLEAR) h.warn = false
}

export type GunHeatLevel = 'cool' | 'warn' | 'hot'

export function gunHeatLevel(h: GunHeat): GunHeatLevel {
  if (h.locked) return 'hot'
  return h.warn ? 'warn' : 'cool'
}

export function overheatSeconds(b: Pick<Battery, 'overheatSeconds'>): number {
  return b.overheatSeconds ?? GUN_HEAT_SECONDS
}

/** 空響間隔是射擊間隔的幾倍 */
const DRY_CLICK_SPACING = 2.5

/**
 * 過熱時扣扳機的空響間隔，s：這一組射擊間隔的 2.5 倍（M2 每分鐘 800 發 → 0.19 s 一聲）。
 * 一聲一聲分得開，聽起來是扣不下去的扳機。混裝的機種每一組依自己的射速。射速壞值回 Infinity。
 */
export function dryClickInterval(roundsPerMinute: number): number {
  return Number.isFinite(roundsPerMinute) && roundsPerMinute > 0
    ? (60 / roundsPerMinute) * DRY_CLICK_SPACING
    : Infinity
}
