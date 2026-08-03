import type { Quaternion, Vector3 } from 'three'

/** 飛機的完整運動狀態。position/velocity 為世界座標，angularVelocity 為機體座標。 */
export interface FlightState {
  position: Vector3
  velocity: Vector3
  /** 機體 → 世界 */
  orientation: Quaternion
  /** 機體座標，rad/s */
  angularVelocity: Vector3
}

/** 舵面與油門指令。舵面 −1..1，油門 0..1.1（>1 為 WEP）。 */
export interface Controls {
  aileron: number
  elevator: number
  rudder: number
  throttle: number
  /**
   * 減速，0..1（0 = 無、1 = 全開）。
   *
   * 【這是刻意的街機化，不是模擬】真機沒有這個能力——P-51 與 Bf 109 都沒有
   * 減速板，那是二戰俯衝轟炸機的裝備。採用的理由是遊戲性：讓「俯衝進場減速
   * 以延長瞄準窗口」與「減速過彎以提高轉彎率」成為可用戰術（M4 spec §2.1）。
   *
   * 【為什麼是 0..1 而不是布林】玩家的按鍵給 0 或 1，但 AI 可以只踩一部分
   * ——「剛好把接近率殺掉」比「全開然後掉太多速度」好。成本是一次乘法。
   *
   * 【不經致動器延遲】與油門同樣由 slewSurfaces 原樣複製。spec 規定立即生效。
   */
  brake: number
}

export interface AirData {
  /** kg/m³ */
  density: number
  /** Pa */
  pressure: number
  /** K */
  temperature: number
  /** m/s */
  soundSpeed: number
  /** 密度比 ρ/ρ₀ */
  sigma: number
}

export interface AeroState {
  /** 真空速，m/s */
  tas: number
  /** 迎角，rad */
  alpha: number
  /** 側滑角，rad */
  beta: number
  /** 動壓，Pa */
  qbar: number
  mach: number
}

/** 機體座標下的力與力矩。 */
export interface ForceMoment {
  force: Vector3
  moment: Vector3
}
