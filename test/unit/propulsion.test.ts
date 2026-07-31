import { describe, it, expect } from 'vitest'
import {
  WEP_THROTTLE, ramFactor, enginePower, propThrust, propEfficiency,
} from '../../src/physics/propulsion'
import { atmosphere } from '../../src/physics/atmosphere'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import type { AirData } from '../../src/physics/types'

const air = (h: number): AirData =>
  atmosphere(h, { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 })

const HP = 745.7
const PS = 735.5

describe('ramFactor', () => {
  it('靜止時為 1（無衝壓）', () => {
    expect(ramFactor(0, 0.8)).toBeCloseTo(1, 12)
  })

  it('效率為 0 時恆為 1', () => {
    expect(ramFactor(0.7, 0)).toBeCloseTo(1, 12)
  })

  it('M = 0.63 且效率 0.8 時約為 1.245', () => {
    expect(ramFactor(0.6306, 0.8)).toBeCloseTo(1.245, 2)
  })

  it('隨馬赫數單調遞增', () => {
    let prev = 0
    for (let m = 0; m <= 0.8; m += 0.05) {
      const f = ramFactor(m, 0.8)
      expect(f).toBeGreaterThan(prev)
      prev = f
    }
  })
})

describe('enginePower', () => {
  it('海平面靜止 WEP 等於登錄的海平面功率', () => {
    const p = enginePower(P51D, air(0), 0, WEP_THROTTLE)
    expect(p).toBeCloseTo(1490 * HP, -2)
  })

  it('油門 0 時功率為 0', () => {
    expect(enginePower(P51D, air(0), 0, 0)).toBe(0)
  })

  it('油門與功率成正比', () => {
    const full = enginePower(P51D, air(3000), 0.3, WEP_THROTTLE)
    const half = enginePower(P51D, air(3000), 0.3, WEP_THROTTLE / 2)
    expect(half).toBeCloseTo(full / 2, 3)
  })

  it('油門超過 WEP 上限時被夾制', () => {
    const wep = enginePower(P51D, air(0), 0, WEP_THROTTLE)
    expect(enginePower(P51D, air(0), 0, 5)).toBeCloseTo(wep, 6)
  })

  it('P-51 低檔臨界高度 1,900 m 靜止功率接近 1,720 hp', () => {
    expect(enginePower(P51D, air(1900), 0, WEP_THROTTLE)).toBeCloseTo(1720 * HP, -3)
  })

  it('P-51 高檔臨界高度 5,900 m 靜止功率接近 1,370 hp', () => {
    expect(enginePower(P51D, air(5900), 0, WEP_THROTTLE)).toBeCloseTo(1370 * HP, -3)
  })

  it('P-51 功率曲線呈雙峰（兩級增壓的特徵）', () => {
    const samples: number[] = []
    for (let h = 0; h <= 9000; h += 250) {
      samples.push(enginePower(P51D, air(h), 0, WEP_THROTTLE))
    }
    // 尋找局部極大值個數
    let peaks = 0
    for (let i = 1; i < samples.length - 1; i++) {
      if (samples[i]! > samples[i - 1]! && samples[i]! >= samples[i + 1]!) peaks++
    }
    expect(peaks).toBeGreaterThanOrEqual(2)
  })

  it('Bf 109 海平面 WEP 接近 1,475 PS', () => {
    expect(enginePower(BF109G6, air(0), 0, WEP_THROTTLE)).toBeCloseTo(1475 * PS, -3)
  })

  it('臨界高度以上功率隨高度遞減', () => {
    let prev = Infinity
    for (let h = 6000; h <= 12000; h += 500) {
      const p = enginePower(P51D, air(h), 0.3, WEP_THROTTLE)
      expect(p).toBeLessThan(prev)
      prev = p
    }
  })

  it('Spec 修訂 2：ram 使 7,600 m 高速時功率顯著高於靜止', () => {
    const still = enginePower(P51D, air(7600), 0, WEP_THROTTLE)
    const fast = enginePower(P51D, air(7600), 0.63, WEP_THROTTLE)
    expect(fast).toBeGreaterThan(still * 1.15)
    // 應回到接近高檔臨界功率
    expect(fast).toBeGreaterThan(1350 * HP)
  })

  it('P-51 在 8,000 m 的引擎功率高於 Bf 109（雙級增壓器的高空優勢）', () => {
    // 比較原始功率而非推重比。Bf 109 輕 1150 kg，推重比本來就佔優——
    // 史實爬升率 1150 m/min vs P-51 的 1060 m/min 正是如此，
    // 那屬於 Task 15 的平衡測試範圍，不是本模組要斷言的事。
    const p51 = enginePower(P51D, air(8000), 0.6, WEP_THROTTLE)
    const bf = enginePower(BF109G6, air(8000), 0.6, WEP_THROTTLE)
    expect(p51).toBeGreaterThan(bf)
  })
})

describe('propEfficiency', () => {
  it('靜止時效率趨近 0', () => {
    expect(propEfficiency(P51D, 0)).toBeCloseTo(0, 6)
  })

  it('高速時趨近 etaMax', () => {
    expect(propEfficiency(P51D, 400)).toBeCloseTo(P51D.prop.etaMax, 2)
  })

  it('單調遞增', () => {
    let prev = -1
    for (let v = 0; v <= 300; v += 10) {
      const e = propEfficiency(P51D, v)
      expect(e).toBeGreaterThan(prev)
      prev = e
    }
  })
})

describe('propThrust', () => {
  const a0 = air(0)

  it('低速受靜推力上限限制，不發散', () => {
    const power = enginePower(P51D, a0, 0, WEP_THROTTLE)
    const t0 = propThrust(P51D, power, 0, a0)
    const t1 = propThrust(P51D, power, 0.01, a0)
    expect(Number.isFinite(t0)).toBe(true)
    expect(t0).toBeLessThan(40000)
    expect(t1).toBeLessThan(40000)
  })

  it('海平面靜推力落在 15–30 kN 的合理區間', () => {
    const power = enginePower(P51D, a0, 0, WEP_THROTTLE)
    const t = propThrust(P51D, power, 5, a0)
    expect(t).toBeGreaterThan(15000)
    expect(t).toBeLessThan(30000)
  })

  it('高速時推力隨速度下降（定功率）', () => {
    const power = enginePower(P51D, a0, 0.4, WEP_THROTTLE)
    expect(propThrust(P51D, power, 200, a0)).toBeLessThan(propThrust(P51D, power, 120, a0))
  })

  it('功率為 0 時推力為 0', () => {
    expect(propThrust(P51D, 0, 150, a0)).toBe(0)
  })
})
