import { Vector3 } from 'three'
import { G0 } from '../core/math'
import { makeScratch } from '../core/pool'
import { cornerSpeed, maxLoadFactorAero } from '../analysis/envelope'
import { PILOT_G_POSITIVE } from '../control/limiters'
import { WEP_THROTTLE } from '../physics/propulsion'
import { THROTTLE_FLOOR } from '../input/throttle'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'

const FWD = new Vector3(0, 0, -1)
const S = makeScratch(2)

/**
 * 由俯衝角 γ 拉回水平所需的高度，m。
 *
 * 拉起半徑 `R = V² / (g·√(n²−1))`，弧線由 γ 回到 0 掉的高度是
 * `R·(1 − cos|γ|)`。
 *
 * 【為什麼用閉式解而不是迭代預測】spec §9.2 原本寫「預測 1–3 秒航跡 →
 * 不夠就提高脫離偏置 → 重新預測」。但迭代版每次都在找的正是這個閉式量。
 * 閉式解**更精確**（不受預測步長影響）、**更便宜**（240 Hz 跑得起）、
 * 而且**可單獨測試**：給定速度與俯衝角，所需高度是一個確定的數字。
 *
 * 【nMax ≤ 1 回傳 Infinity 而不是大數】它會流進「離海高度夠不夠」的比較。
 * 用大數的話，在極高空仍可能通過比較而不介入；Infinity 保證任何有限高度
 * 都會觸發。
 */
export function recoveryAltitude(tas: number, gamma: number, nMax: number): number {
  if (gamma >= 0) return 0
  if (!(nMax > 1)) return Infinity
  const radius = (tas * tas) / (G0 * Math.sqrt(nMax * nMax - 1))
  return radius * (1 - Math.cos(Math.abs(gamma)))
}

export interface SafetyConfig {
  /** 所需脫離高度的安全倍率 */
  factor: number
  /** 額外的固定餘裕，m。水平飛行時它就是最低容許高度 */
  clearance: number
  /** 硬接管時的爬升角，rad */
  recoveryPitch: number
}

/**
 * **起始值，待 Task 14 由安全矩陣量測後回填。**
 *
 * `factor` 取 1.5 是因為閉式解假設立刻拉到 nMax，而實際上指揮儀要花時間
 * 滾平與建立過載。`clearance` 取 120 m 是「就算完全水平也不准比這更低」。
 */
export const DEFAULT_SAFETY: SafetyConfig = {
  factor: 1.5,
  clearance: 120,
  recoveryPitch: 20 * (Math.PI / 180),
}

/**
 * 安全層。**可覆寫整個 `Command`**，回傳是否介入。
 *
 * 【為什麼是濾網而不是規則表的第一條】它要能改寫 `aimWorld` **本身**
 * （而不只是換一個意圖），而且新增規則的人不可能繞過它。它同時覆寫
 * `throttle`、`brake` 與 `firing` —— 快撞海時不該還在開火。這也是本計畫
 * 不另外加 `recover` 意圖的理由：覆寫整個 Command 已經涵蓋它的效果，
 * 少一組要維護的優先序關係。
 *
 * @param seaHeight 該點的海面（未來為地表）高度，m
 */
export function applySafety(
  self: Aircraft,
  seaHeight: number,
  out: Command,
  cfg: SafetyConfig = DEFAULT_SAFETY,
): boolean {
  const vel = self.state.velocity
  const tas = vel.length()
  const gamma = tas > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, vel.y / tas))) : 0

  const nMax = Math.min(
    maxLoadFactorAero(self.spec, self.state.position.y, tas),
    PILOT_G_POSITIVE,
  )
  const needed = recoveryAltitude(tas, gamma, nMax) * cfg.factor + cfg.clearance
  const margin = self.state.position.y - seaHeight
  if (margin > needed) return false

  // ── 硬接管 ──────────────────────────────────────────────
  // 【脫離向量必須滾轉友善】指揮儀是 bank-to-turn：大坡度時命令「世界正
  // 上方」會要求飛機先滾平再拉，而滾平的過程中高度還在掉。保持當前航向、
  // 只把仰角抬起來，指揮儀就能同時滾平與拉起。
  const horiz = S.v[0]!.set(vel.x, 0, vel.z)
  const horizLen = horiz.length()
  if (horizLen > 1e-3) horiz.divideScalar(horizLen)
  else {
    // 垂直俯衝：水平分量趨近 0，改用機首的水平投影
    const nose = S.v[1]!.copy(FWD).applyQuaternion(self.state.orientation)
    horiz.set(nose.x, 0, nose.z)
    const len = horiz.length()
    if (len > 1e-3) horiz.divideScalar(len)
    else horiz.set(0, 0, -1)
  }

  out.aimWorld.copy(horiz).multiplyScalar(Math.cos(cfg.recoveryPitch))
  out.aimWorld.y = Math.sin(cfg.recoveryPitch)
  out.aimWorld.normalize()

  // 【油門不是固定滿檔】拉起半徑 ∝ V²，高速時減速才拉得起來；但低速時
  // 收油門會失速。判準用角落速度：高於它代表速度多到轉不動。
  if (tas > cornerSpeed(self.spec, self.state.position.y)) {
    out.throttle = THROTTLE_FLOOR
    out.brake = 1
  } else {
    out.throttle = WEP_THROTTLE
    out.brake = 0
  }

  out.firing = false
  return true
}
