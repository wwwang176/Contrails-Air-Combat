import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { THROTTLE_FLOOR } from '../../src/input/throttle'
import { BRAKE_CD, dragCoefficient } from '../../src/physics/aero'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import type { AircraftSpec } from '../../src/specs/types'

/**
 * 減速機制（M4 spec §2.1）。
 *
 * 【這是刻意的街機化，不是模擬】真機沒有這個能力——P-51 與 Bf 109 都沒有
 * 減速板。所以這裡守的不是史實值，而是**專案負責人指定的手感目標**：
 * 水平飛行由 700 km/h 減到 400 km/h 約 4 秒。
 */
const DT = 1 / 240
const KMH = 1 / 3.6

/**
 * 量測**維持水平飛行**時由 v0 減到 v1 需要幾秒。
 *
 * 【為什麼用 Aircraft 而不是直接呼叫 stepDynamics】把升降舵固定為 0 去跑
 * stepDynamics，飛機會自己抬頭爬升——量到的減速有一大半是**重力**拿走的，
 * 不是減速機制。實測差距很大：不按減速、油門 0.2 的情況下，固定舵面量到
 * 17.6 秒，而純阻力的閉式解是 100 秒以上。那個 17.6 秒量的是爬升。
 *
 * 改用 Aircraft + 水平瞄準點，讓 M1 的指揮儀真的把飛機壓在水平——這才是
 * 專案負責人指定的「水平飛行 700 → 400 km/h」，也才是玩家實際的體驗。
 *
 * 【為什麼不用閉式解】閉式解忽略了油門在下限仍有推力（拖慢減速）與維持
 * 升力帶來的誘導阻力（加快減速），兩者方向相反且量級都不小。
 */
function brakeSeconds(spec: AircraftSpec, v0: number, v1: number, altitude = 4000): number {
  const a = new Aircraft(spec, altitude, v0)
  const level = new Vector3(0, 0, -1)

  for (let i = 0; i < 240 * 60; i++) {
    a.update(level, THROTTLE_FLOOR, DT, 1)
    if (a.state.velocity.length() <= v1) return i * DT
  }
  return Infinity
}

describe('BRAKE_CD 的手感校準', () => {
  it('P-51D：700 → 400 km/h 約 4 秒', () => {
    const t = brakeSeconds(P51D, 700 * KMH, 400 * KMH)
    // 容差 ±0.5 s：這是手感目標不是物理常數，過緊的門檻只會讓日後的微調
    // 變成改測試。真正要擋的是「有人不小心把 BRAKE_CD 改掉一個數量級」。
    expect(t).toBeGreaterThan(3.5)
    expect(t).toBeLessThan(4.5)
  })

  it('Bf 109 G-6：與 P-51 的減速時間相近（機制不偏袒任何一方）', () => {
    // 兩台翼載幾乎相同（S/m 0.00508 vs 0.00510），所以同一個 CD 給出
    // 幾乎相同的減速度。這是用全域常數而非機種參數的理由。
    const p51 = brakeSeconds(P51D, 700 * KMH, 400 * KMH)
    const bf109 = brakeSeconds(BF109K4, 700 * KMH, 400 * KMH)
    expect(Math.abs(bf109 - p51)).toBeLessThan(1.0)
  })

  it('不按減速時慢得多 —— 對照組', () => {
    // 同樣維持水平飛行、同樣的低油門，差別只有減速。
    const a = new Aircraft(P51D, 4000, 700 * KMH)
    const level = new Vector3(0, 0, -1)
    for (let i = 0; i < 240 * 10; i++) a.update(level, THROTTLE_FLOOR, DT, 0)
    // 10 秒後仍遠高於 400 km/h
    expect(a.state.velocity.length()).toBeGreaterThan(500 * KMH)
  })
})

describe('BRAKE_CD 在阻力係數裡的行為', () => {
  it('brake 預設為 0 —— M1 的既有呼叫端行為完全不變', () => {
    // 這一條是「不改動已驗證程式碼」的保證。包絡求解器問的是「乾淨機體能飛
    // 多快」，那個問題與減速無關，所以它不傳 brake，也不該受影響。
    expect(dragCoefficient(P51D, 0.3, 0, 0.4))
      .toBe(dragCoefficient(P51D, 0.3, 0, 0.4, 0))
  })

  it('brake = 1 時剛好加上 BRAKE_CD', () => {
    const clean = dragCoefficient(P51D, 0.3, 0, 0.4, 0)
    expect(dragCoefficient(P51D, 0.3, 0, 0.4, 1) - clean).toBeCloseTo(BRAKE_CD, 12)
  })

  it('中間值線性 —— AI 可以只踩一部分', () => {
    const clean = dragCoefficient(P51D, 0.3, 0, 0.4, 0)
    expect(dragCoefficient(P51D, 0.3, 0, 0.4, 0.5) - clean).toBeCloseTo(BRAKE_CD / 2, 12)
  })

  it('減速阻力遠大於乾淨機體的零升阻力（否則按了沒感覺）', () => {
    expect(BRAKE_CD).toBeGreaterThan(P51D.drag.cd0 * 10)
  })
})
