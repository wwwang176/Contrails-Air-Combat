import { describe, it, expect } from 'vitest'
import {
  GUN_HEAT_CLEAR, GUN_HEAT_COOL, GUN_HEAT_SECONDS, GUN_HEAT_UNLOCK, GUN_HEAT_WARN,
  createGunHeat, dryClickInterval, gunHeatLevel, overheatSeconds, resetGunHeat, stepGunHeat,
  WARM_JAM_FLOOR_DB, warmJamGainDb,
} from '../../src/control/gunHeat'
import { BF109K4_BATTERY } from '../../src/weapons/bf109k4'
import { A6M5_BATTERY } from '../../src/weapons/a6m5'
import { KI84_BATTERY } from '../../src/weapons/ki84'
import { YAK1B_BATTERY } from '../../src/weapons/yak1b'
import { P51D_BATTERY } from '../../src/weapons/p51d'
import { F4F4_BATTERY } from '../../src/weapons/f4f4'
import { F6F5_BATTERY } from '../../src/weapons/f6f5'
import { JU87_BATTERY } from '../../src/weapons/ju87'

/** 前機槍過熱（SPEC `2026-10-08-gun-overheat-design.md` §3） */
const DT = 1 / 240
const run = (h: ReturnType<typeof createGunHeat>, firing: boolean, seconds: number, T = 3): void => {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepGunHeat(h, firing, T, DT)
}

describe('熱度', () => {
  it('門檻：黃 0.6 進、0.2 出；過熱冷到 0.6 解除；每秒冷 0.2；預設 6 秒', () => {
    expect(GUN_HEAT_WARN).toBe(0.6)
    expect(GUN_HEAT_CLEAR).toBe(0.2)
    expect(GUN_HEAT_UNLOCK).toBe(0.6)
    expect(GUN_HEAT_COOL).toBe(0.2)
    expect(GUN_HEAT_SECONDS).toBe(6)
  })

  it('連續射擊 T 秒剛好過熱，差一步還沒', () => {
    const h = createGunHeat()
    run(h, true, 3 - DT)
    expect(h.locked).toBe(false)
    expect(gunHeatLevel(h)).toBe('warn')
    run(h, true, DT)
    expect(h.locked).toBe(true)
    expect(gunHeatLevel(h)).toBe('hot')
  })

  it('T 依機型：2 秒的機型 2 秒就過熱', () => {
    const h = createGunHeat()
    run(h, true, 2, 2)
    expect(h.locked).toBe(true)
  })

  it('加熱到 0.6 才變黃', () => {
    const h = createGunHeat()
    run(h, true, 1.7)
    expect(gunHeatLevel(h)).toBe('cool')
    run(h, true, 0.2)
    expect(gunHeatLevel(h)).toBe('warn')
  })

  /** 【紅色時壓著扳機就不冷卻】要放開才開始恢復 —— 逼玩家鬆手，而不是按著等它自己解除 */
  it('過熱時扳機一直按著：停在過熱、不冷卻；放開才開始冷', () => {
    const h = createGunHeat()
    run(h, true, 3)
    run(h, true, 5)
    expect(h.heat).toBe(1)
    expect(h.locked).toBe(true)
    run(h, false, 0.5)
    expect(h.heat).toBeCloseTo(0.9, 6)
    // 冷到一半又按下去：仍在過熱，冷卻再暫停
    run(h, true, 1)
    expect(h.heat).toBeCloseTo(0.9, 6)
    expect(h.locked).toBe(true)
  })

  it('放開之後冷卻約 2 秒回黃、再約 2 秒回綠', () => {
    const h2 = createGunHeat()
    run(h2, true, 3)
    run(h2, false, 1.9)
    expect(gunHeatLevel(h2)).toBe('hot')
    run(h2, false, 0.2)
    expect(gunHeatLevel(h2)).toBe('warn')
    // 解除在 2.0 s（熱度 0.6），回綠在 4.0 s（熱度 0.2）
    run(h2, false, 1.7)
    expect(gunHeatLevel(h2)).toBe('warn')
    run(h2, false, 0.2)
    expect(gunHeatLevel(h2)).toBe('cool')
  })

  it('冷卻不低於 0', () => {
    const h = createGunHeat()
    run(h, false, 5)
    expect(h.heat).toBe(0)
  })

  it('秒數壞值當預設（6 秒）', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const h = createGunHeat()
      run(h, true, 6 - DT, bad)
      expect(h.locked, String(bad)).toBe(false)
      run(h, true, DT, bad)
      expect(h.locked, String(bad)).toBe(true)
    }
  })

  it('reset 歸零', () => {
    const h = createGunHeat()
    run(h, true, 3)
    resetGunHeat(h)
    expect(h).toEqual(createGunHeat())
  })
})

/** 【黃色時槍機聲疊在槍聲上，越來越大聲】過熱的那一刻剛好接上紅色空響的音量（0 dB） */
describe('快過熱的槍機聲音量', () => {
  it('熱度 0.6 時 −18 dB、0.8 時 −9 dB、1 時 0 dB；低於 0.6 停在 −18', () => {
    expect(WARM_JAM_FLOOR_DB).toBe(-18)
    expect(warmJamGainDb(0.6)).toBeCloseTo(-18, 9)
    expect(warmJamGainDb(0.8)).toBeCloseTo(-9, 9)
    expect(warmJamGainDb(1)).toBeCloseTo(0, 9)
    expect(warmJamGainDb(0.3)).toBeCloseTo(-18, 9)
    expect(warmJamGainDb(NaN)).toBe(-18)
  })
})

describe('各機的秒數與空響間隔', () => {
  /** 機砲連射比較吃：K-4（MK 108）4 秒；混裝機砲的零戰、疾風、Yak 5 秒；其餘 6 秒 */
  it('各機型的過熱秒數', () => {
    expect(overheatSeconds(BF109K4_BATTERY)).toBe(4)
    for (const b of [A6M5_BATTERY, KI84_BATTERY, YAK1B_BATTERY]) expect(overheatSeconds(b)).toBe(5)
    for (const b of [P51D_BATTERY, F4F4_BATTERY, F6F5_BATTERY, JU87_BATTERY]) expect(overheatSeconds(b)).toBe(6)
  })

  it('Battery 沒寫秒數時是 6', () => {
    expect(overheatSeconds({})).toBe(6)
    expect(overheatSeconds({ overheatSeconds: 2 })).toBe(2)
  })

  /** 射擊間隔的 2.5 倍；每一組依自己的射速 */
  it('空響間隔是那一組射擊間隔的 2.5 倍；射速壞值回 Infinity', () => {
    expect(dryClickInterval(800)).toBeCloseTo(60 / 800 * 2.5, 9)
    expect(dryClickInterval(650)).toBeCloseTo(60 / 650 * 2.5, 9)
    for (const bad of [0, -1, NaN, Infinity]) expect(dryClickInterval(bad)).toBe(Infinity)
  })
})
