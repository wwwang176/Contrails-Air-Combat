import type { Controls } from '../physics/types'

/**
 * 舵面作動速率上限，每秒的行程比例（1.0 = 中立到滿舵的全行程）。
 *
 * 【為什麼需要這一項】指揮儀的 PID 每個物理步輸出一個新的舵面指令，而
 * 物理層直接照單全收——實測滑鼠一甩，副翼在**單一步（4.2 ms）內**由 0
 * 跳到 1.000，等效速率 240 /s。真實的飛行員／連桿／配平片系統做不到：
 * 中立到滿舵是一個有質量、有摩擦、有人類神經肌肉反應的動作。
 *
 * 【與 controlStiffening 的分工】`controlStiffening` 模擬的是「高速時同樣的
 * 舵面偏轉產生的力矩較小」——氣動負載那一側。本項模擬的是「舵面本身移動
 * 需要時間」——機械／人體那一側。兩者物理成因不同，不是重複計算：
 * 前者與動壓相關（故為 qbar 的函數），後者不是（故為常數）。
 *
 * 【數值依據】P-51D 的飛行員報告顯示，中立到滿副翼的快速輸入約需
 * 0.2 秒，對應 5 /s。升降舵行程較短且槓桿較直接，取略快的 6 /s；
 * 方向舵靠腳蹬、質量大且行程長，取較慢的 4 /s。
 */
export interface ActuatorRates {
  aileron: number
  elevator: number
  rudder: number
}

export const DEFAULT_ACTUATOR_RATES: ActuatorRates = {
  aileron: 5,
  elevator: 6,
  rudder: 4,
}

/** 把單一軸的實際位置朝指令移動，單步最多走 rate·dt。 */
function slew(actual: number, command: number, rate: number, dt: number): number {
  const maxStep = rate * dt
  const delta = command - actual
  if (delta > maxStep) return actual + maxStep
  if (delta < -maxStep) return actual - maxStep
  return command
}

/**
 * 把實際舵面位置朝指揮儀的指令移動一個物理步。就地修改 `actual`。
 *
 * 【油門與減速不在此列】兩者都是玩家/AI 直接控制的量，不經過指揮儀。
 * 油門的行程限制已由輸入層的 `applyThrottleRate` 處理（Task 19），減速則
 * 依 M4 spec §2.1 規定立即生效。兩者在此原樣複製，避免同一個量被兩處各限一次。
 */
export function slewSurfaces(
  actual: Controls, command: Controls, rates: ActuatorRates, dt: number,
): Controls {
  actual.aileron = slew(actual.aileron, command.aileron, rates.aileron, dt)
  actual.elevator = slew(actual.elevator, command.elevator, rates.elevator, dt)
  actual.rudder = slew(actual.rudder, command.rudder, rates.rudder, dt)
  actual.throttle = command.throttle
  // 減速與油門同類：玩家/AI 直接控制的量，立即生效，不經致動器延遲
  actual.brake = command.brake
  return actual
}
