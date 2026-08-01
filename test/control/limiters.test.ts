import { describe, it, expect } from 'vitest'
import {
  ALPHA_MARGIN, PILOT_G_POSITIVE, createPitchLimit, pitchRateLimit,
} from '../../src/control/limiters'
import { atmosphere } from '../../src/physics/atmosphere'
import { computeAeroState } from '../../src/physics/aero'
import { cornerSpeed, stallSpeed } from '../../src/analysis/envelope'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { Vector3 } from 'three'
import type { AeroState, AirData } from '../../src/physics/types'

function setup(altitude: number, tas: number) {
  const air: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }
  atmosphere(altitude, air)
  const aero: AeroState = { tas: 0, alpha: 0, beta: 0, qbar: 0, mach: 0 }
  computeAeroState(new Vector3(0, 0, -tas), air, aero)
  return { air, aero }
}

describe('pitchRateLimit', () => {
  it('失速速度附近可用過載接近 1，迎角為限制來源', () => {
    const vs = stallSpeed(P51D, 0, 1)
    const { aero } = setup(0, vs)
    const out = pitchRateLimit(P51D, aero, false, createPitchLimit())
    expect(out.nLimit).toBeLessThan(1.3)
    expect(out.source).toBe('alpha')
  })

  it('高速時由飛行員或結構限制接手', () => {
    const { aero } = setup(0, 200)
    const out = pitchRateLimit(P51D, aero, false, createPitchLimit())
    expect(out.source === 'pilot' || out.source === 'structure').toBe(true)
    expect(out.nLimit).toBeLessThanOrEqual(P51D.limits.gPositive)
  })

  it('可用過載永不超過結構極限', () => {
    for (const v of [80, 150, 250, 350]) {
      const { aero } = setup(0, v)
      const out = pitchRateLimit(P51D, aero, false, createPitchLimit())
      expect(out.nLimit).toBeLessThanOrEqual(P51D.limits.gPositive + 1e-9)
    }
  })

  it('可用過載永不超過飛行員極限', () => {
    const { aero } = setup(0, 300)
    const out = pitchRateLimit(P51D, aero, false, createPitchLimit())
    expect(out.nLimit).toBeLessThanOrEqual(PILOT_G_POSITIVE + 1e-9)
  })

  it('qMax 隨速度上升先增後受過載上限壓平', () => {
    const rates: number[] = []
    for (const v of [80, 120, 160, 200, 260, 320]) {
      const { aero } = setup(0, v)
      rates.push(pitchRateLimit(P51D, aero, false, createPitchLimit()).qMax)
    }
    expect(rates[1]!).toBeGreaterThan(rates[0]!)
    // 高速段因 qMax = n·g/V 而遞減
    expect(rates[5]!).toBeLessThan(rates[3]!)
  })

  // 【已移除】原斷言比較 qMax(70) 與 qMax(160)*0.6，意圖驗證「低速能量不足」，
  // 但 qMax(V) = nLimit·g/V 是單峰函數：轉折點以下 nLimit=nAero∝V²，故
  // qMax∝V 遞增；轉折點以上 nLimit 被夾在 min(結構,飛行員)，qMax∝1/V 遞減。
  // 對 P-51D 海平面實測，轉折點在 V≈119.7 m/s（nAero 在此處等於飛行員上限
  // 6.5G）。V=70 落在遞增段（qMax=0.3117），V=160 已越過峰值、落在遞減段
  // （qMax=0.3984）——兩點分屬曲線兩側，比較它們並不能代表「低速能量不足」，
  // 只是恰好選到了峰值兩側的點。用解析式可證明：要讓 qMax(70)<0.6·qMax(160)
  // 成立，轉折速度需 >136.6 m/s；但這需要 ALPHA_MARGIN≈0.69，與下方
  // 「ALPHA_MARGIN 必須在 (0.8,1) 之間」的斷言互斥，因此在合法參數範圍內
  // 此斷言對 P-51D 真實數值無解。已改用下方三則斷言取代：直接釘住「低速時
  // 限制來源是氣動且遠低於結構極限」「高速時限制來源是飛行員且氣動遠超過
  // 飛行員上限」「qMax 峰值落在轉折速度附近，與 envelope.cornerSpeed 有
  // 可解釋的偏移」——這才是原斷言真正想守住的物理性質。
  // 若之後想再加回「低速 vs 高速」比較，請先用上面同一個解析關係驗證
  // 兩個參考速度落在峰值同一側，否則會重蹈覆轍。

  it('低速時限制來源是氣動（迎角），且遠低於結構極限', () => {
    // 實測（P-51D 海平面 V=70 m/s）：nAero=2.2253，結構極限 8G，
    // 餘裕 5.7747G——「低速拉不動」不是接近結構極限，而是氣動本身就
    // 給不出多少過載。
    const { aero } = setup(0, 70)
    const out = pitchRateLimit(P51D, aero, false, createPitchLimit())
    expect(out.source).toBe('alpha')
    expect(out.nLimit).toBeCloseTo(out.nAero, 10)
    expect(out.nAero).toBeLessThan(P51D.limits.gPositive * 0.5)
  })

  it('高速時限制來源是飛行員，且氣動可用過載遠超過飛行員上限', () => {
    // 實測（P-51D 海平面 V=160 m/s）：nAero=11.6258，飛行員上限 6.5G，
    // 比值 1.7886——機翼還能給更多，是飛行員先撐不住，不是機翼先斷。
    const { aero } = setup(0, 160)
    const out = pitchRateLimit(P51D, aero, false, createPitchLimit())
    expect(out.source).toBe('pilot')
    expect(out.nLimit).toBeCloseTo(PILOT_G_POSITIVE, 10)
    expect(out.nAero).toBeGreaterThan(PILOT_G_POSITIVE * 1.5)
  })

  it('qMax 峰值落在轉折速度附近，與 envelope.cornerSpeed 有可解釋的偏移', () => {
    // 實測峰值：V≈119.64 m/s，qMax≈0.53279。
    // envelope.cornerSpeed(P51D,0)=129.80 m/s——但那是「結構極限 8G、
    // 未計 0.95 迎角餘裕的滿 CL_max」對應的失速速度，與本限制器的
    // 峰值（受飛行員 6.5G 先夾住、且用 0.95·α_crit 的迎角餘裕算 CL）
    // 是兩個不同但可解釋的量：飛行員上限（6.5）低於結構（8）使峰值提前
    // 出現，迎角餘裕降低可用 CL 又讓峰值延後——兩者不完全抵銷，
    // 淨效果是峰值落在 cornerSpeed 的 92% 附近（偏移約 −10 m/s），
    // 而非精確重合。此處只驗證「量級相符、方向正確」，不假設兩者相等。
    let bestV = 0
    let bestQ = -Infinity
    for (let v = 50; v <= 200; v += 0.5) {
      const { aero } = setup(0, v)
      const q = pitchRateLimit(P51D, aero, false, createPitchLimit()).qMax
      if (q > bestQ) { bestQ = q; bestV = v }
    }
    for (let v = bestV - 1; v <= bestV + 1; v += 0.01) {
      const { aero } = setup(0, v)
      const q = pitchRateLimit(P51D, aero, false, createPitchLimit()).qMax
      if (q > bestQ) { bestQ = q; bestV = v }
    }
    const corner = cornerSpeed(P51D, 0)
    expect(bestV).toBeGreaterThan(corner * 0.85)
    expect(bestV).toBeLessThan(corner * 0.98)
  })

  it('Bf 109 縫翼展開時可用過載高於未展開', () => {
    const { aero } = setup(0, 110)
    const clean = pitchRateLimit(BF109G6, aero, false, createPitchLimit()).nAero
    const slats = pitchRateLimit(BF109G6, aero, true, createPitchLimit()).nAero
    expect(slats).toBeGreaterThan(clean)
  })

  it('高空同速度下可用過載低於海平面', () => {
    const low = setup(0, 180)
    const high = setup(8000, 180)
    const nLow = pitchRateLimit(P51D, low.aero, false, createPitchLimit()).nAero
    const nHigh = pitchRateLimit(P51D, high.aero, false, createPitchLimit()).nAero
    expect(nHigh).toBeLessThan(nLow)
  })

  it('迎角餘裕使 nAero 低於理論 CL_max 對應值', () => {
    expect(ALPHA_MARGIN).toBeLessThan(1)
    expect(ALPHA_MARGIN).toBeGreaterThan(0.8)
  })

  it('零速度不產生 NaN', () => {
    const { aero } = setup(0, 0)
    const out = pitchRateLimit(P51D, aero, false, createPitchLimit())
    expect(Number.isFinite(out.qMax)).toBe(true)
    expect(Number.isFinite(out.nLimit)).toBe(true)
  })

  it('寫入傳入的 out 並回傳同一參考（零配置）', () => {
    const { aero } = setup(0, 180)
    const out = createPitchLimit()
    expect(pitchRateLimit(P51D, aero, false, out)).toBe(out)
  })
})
