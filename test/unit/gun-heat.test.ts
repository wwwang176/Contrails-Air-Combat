import { describe, it, expect } from 'vitest'
import {
  GUN_HEAT_CLEAR, GUN_HEAT_COOL, GUN_HEAT_SECONDS, GUN_HEAT_UNLOCK, GUN_HEAT_WARN,
  createGunHeat, dryClickInterval, gunHeatLevel, overheatSeconds, resetGunHeat, stepGunHeat,
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
  it('門檻：黃 0.6 進、0.2 出；過熱冷到 0.6 解除；每秒冷 0.2；預設 3 秒', () => {
    expect(GUN_HEAT_WARN).toBe(0.6)
    expect(GUN_HEAT_CLEAR).toBe(0.2)
    expect(GUN_HEAT_UNLOCK).toBe(0.6)
    expect(GUN_HEAT_COOL).toBe(0.2)
    expect(GUN_HEAT_SECONDS).toBe(3)
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

  it('過熱時扳機按著也不加熱（打不出去）；冷卻約 2 秒回黃、再約 2 秒回綠', () => {
    const h = createGunHeat()
    run(h, true, 3)
    run(h, true, 1)
    expect(h.heat).toBeLessThan(1)
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

  it('秒數壞值當預設', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const h = createGunHeat()
      run(h, true, 3 - DT, bad)
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

describe('各機的秒數與空響間隔', () => {
  /** 機砲連射比較吃：K-4（MK 108）2 秒；混裝機砲的零戰、疾風、Yak 2.5 秒；其餘 3 秒 */
  it('各機型的過熱秒數', () => {
    expect(overheatSeconds(BF109K4_BATTERY)).toBe(2)
    for (const b of [A6M5_BATTERY, KI84_BATTERY, YAK1B_BATTERY]) expect(overheatSeconds(b)).toBe(2.5)
    for (const b of [P51D_BATTERY, F4F4_BATTERY, F6F5_BATTERY, JU87_BATTERY]) expect(overheatSeconds(b)).toBe(3)
  })

  it('Battery 沒寫秒數時是 3', () => {
    expect(overheatSeconds({})).toBe(3)
    expect(overheatSeconds({ overheatSeconds: 2 })).toBe(2)
  })

  /** 射擊間隔的 5 倍（射速的五分之一）；混裝取最慢那一挺 */
  it('空響間隔是最慢那一挺射擊間隔的 5 倍；沒有前射武器回 Infinity', () => {
    const m = (rpm: number) => ({ weapon: { roundsPerMinute: rpm } }) as never
    expect(dryClickInterval({ mounts: [m(800), m(800)] })).toBeCloseTo(60 / 800 * 5, 9)
    expect(dryClickInterval({ mounts: [m(900), m(620)] })).toBeCloseTo(60 / 620 * 5, 9)
    expect(dryClickInterval({ mounts: [] })).toBe(Infinity)
  })
})
