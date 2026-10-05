/**
 * 超速搖晃開始的 `vneRatio`。**與 HUD 亮 OVERSPEED 的門檻同一個**
 * （`hud/widgets/energy.ts`）—— 字還沒亮就先搖，玩家會找不到原因。
 */
export const OVERSPEED_ONSET = 0.85

/**
 * 超速搖晃升到上限的 `vneRatio`。**與 HUD 的 OVERSPEED 轉紅同一個門檻**
 * —— 過了之後不再增加，紅字與黃字頂端搖得一樣。
 */
export const OVERSPEED_FULL = 0.95

/**
 * 超速搖晃的上限，與 `trauma` 同一個尺度。角度吃平方，0.25 是 0.23°，與
 * 高砲彈幕下的穩態抖動（`FLAK_SHAKE`）同級。
 *
 * 【比爆炸小很多】它會一直持續。幅度大到準星離開目標的話，玩家會覺得是
 * 操縱在飄 —— 見 `SHAKE_MAX_ANGLE`。
 */
export const OVERSPEED_SHAKE = 0.25

/**
 * 超速時的持續震動量，寫進 `CameraShake.sustained`。
 *
 * `OVERSPEED_ONSET` 以下是 0，到 `OVERSPEED_FULL` 線性升到 `OVERSPEED_SHAKE`，
 * 再往上不增加。角度吃平方，所以剛過門檻時幾乎感覺不到。
 */
export function overspeedShake(vneRatio: number): number {
  if (vneRatio <= OVERSPEED_ONSET) return 0
  if (vneRatio >= OVERSPEED_FULL) return OVERSPEED_SHAKE
  return OVERSPEED_SHAKE * (vneRatio - OVERSPEED_ONSET) / (OVERSPEED_FULL - OVERSPEED_ONSET)
}
