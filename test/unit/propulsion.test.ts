import { describe, it, expect } from 'vitest'
import {
  WEP_THROTTLE, ramFactor, enginePower, propThrust, propEfficiency,
} from '../../src/physics/propulsion'
import { atmosphere } from '../../src/physics/atmosphere'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
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

  it('Bf 109 K-4 海平面 WEP 接近 2,000 PS', () => {
    // 【2026-08-25：1,475 → 2,000】機種由 G-6（DB 605A）換成 K-4
    //（DB 605DC，1.98 ata、C3 + MW-50）。見 specs/bf109k4.ts 檔頭。
    expect(enginePower(BF109K4, air(0), 0, WEP_THROTTLE)).toBeCloseTo(2000 * PS, -3)
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

  /**
   * 【2026-08-25：這一條換了斷言的對象，守的性質沒變】
   *
   * 舊版寫「P-51 在 8,000 m 的**絕對功率**高於 Bf 109」。109 換成 K-4 之後
   * 那不再成立——不是因為增壓器，是因為海平面就多了 32% 的功率：
   *
   * ```
   *              海平面      8,000 m     保留率
   *   P-51D      1111.1 kW   1013.9 kW   91.3%   ← 雙級二速
   *   Bf 109 K-4 1471.0 kW   1215.4 kW   82.6%   ← 單級無段
   * ```
   *
   * 雙級增壓器的高空優勢在**保留率**上，而那一項 P-51D 仍然贏，而且贏得
   * 更明顯（91.3% 對 82.6%）。改斷言保留率也讓這一條對日後的動力調參
   * 免疫——它問的本來就是「增壓器好不好」，不是「誰的引擎大」。
   */
  it('P-51 的高空功率保留率高於 Bf 109（雙級增壓器的高空優勢）', () => {
    const retention = (spec: typeof P51D): number =>
      enginePower(spec, air(8000), 0.6, WEP_THROTTLE)
      / enginePower(spec, air(0), 0.6, WEP_THROTTLE)
    expect(retention(P51D)).toBeGreaterThan(retention(BF109K4))
    // 實測 0.913 對 0.826
    expect(retention(P51D) - retention(BF109K4)).toBeGreaterThan(0.05)
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

  it('V = 0 時推力有限，且落在 15–30 kN 的合理區間（兩款機種）', () => {
    // 修正前 propThrust(v=0) 恆為 0（η(0)=0，V_FLOOR 引入前無下限保護），
    // 飛機永遠無法從靜止起動。這裡直接在 v=0 斷言，不像舊測試在 v=5 迴避問題。
    for (const spec of [P51D, BF109K4]) {
      const power = enginePower(spec, a0, 0, WEP_THROTTLE)
      const t0 = propThrust(spec, power, 0, a0)
      expect(Number.isFinite(t0)).toBe(true)
      expect(t0).toBeGreaterThan(15000)
      expect(t0).toBeLessThan(30000)
    }
  })

  it('V → 0 的推力收斂到解析極限 etaMax·P/vRef（兩款機種，容差 0.5%）', () => {
    // η(V) = etaMax·(1−e^(−V/vRef)) 在 V→0 時一階趨近 etaMax·V/vRef，
    // 故 η(V)·P/V 的極限是有限值 etaMax·P/vRef。這裡把機制本身釘住，
    // 而不只是檢查數字落在某個寬鬆區間內。
    for (const spec of [P51D, BF109K4]) {
      const power = enginePower(spec, a0, 0, WEP_THROTTLE)
      const t0 = propThrust(spec, power, 0, a0)
      const analyticLimit = (spec.prop.etaMax * power) / spec.prop.vRef
      const relError = Math.abs(t0 - analyticLimit) / analyticLimit
      expect(relError).toBeLessThan(0.005)
    }
  })

  // Task 14 調參把 P-51D 推到離這個夾制只剩 1.37% 的地方，因此必須有一個
  // 直接、訊息明確的守衛。若 etaMax 再往上、vRef 再往下、或 figureOfMerit
  // 再往下，dynamic 就會超過 staticMax，夾制開始生效——屆時上面那條
  // 「V→0 收斂到 etaMax·P/vRef」的測試會由 0.12% 誤差跳到約 1.4% 而轉紅，
  // 看起來像 propThrust 壞掉，實際上是**調參的後果**。這條測試先失敗，
  // 並在此把因果寫清楚，免得下一個人去改 propThrust。
  //
  // 若這條測試失敗：不要動 propThrust，去看 src/specs/*.ts 的
  // etaMax / vRef / figureOfMerit 最近改了什麼。
  it('動量理論靜推力夾制在兩款機種的出貨參數下皆不 binding（守住 V→0 解析極限測試的前提）', () => {
    for (const spec of [P51D, BF109K4]) {
      const power = enginePower(spec, a0, 0, WEP_THROTTLE)
      const radius = spec.prop.diameter / 2
      const ideal = Math.cbrt(2 * a0.density * Math.PI * radius * radius * power * power)
      const staticMax = spec.prop.figureOfMerit * ideal
      const dynamic = (spec.prop.etaMax * power) / spec.prop.vRef
      const margin = (staticMax - dynamic) / dynamic
      expect(
        dynamic,
        `${spec.name}：η·P/vRef = ${(dynamic / 1000).toFixed(3)} kN 已超過動量理論夾制 ` +
        `${(staticMax / 1000).toFixed(3)} kN（figureOfMerit ${spec.prop.figureOfMerit} × 理想 ` +
        `${(ideal / 1000).toFixed(3)} kN）。這是調參越界，不是 propThrust 迴歸——` +
        `請檢查 specs 的 etaMax / vRef / figureOfMerit。`,
      ).toBeLessThan(staticMax)
      // 實測餘裕：P-51D 1.37%、Bf 109 11.56%。P-51D 是刻意貼著界限調的。
      expect(margin).toBeGreaterThan(0)
    }
  })

  it('動量理論靜推力上限公式正確（以巨大合成功率強制觸發，因為兩款機種在正常範圍內都不會自然觸發它）', () => {
    const hugePower = 1e9
    for (const spec of [P51D, BF109K4]) {
      const radius = spec.prop.diameter / 2
      const diskArea = Math.PI * radius * radius
      const expectedStaticMax =
        spec.prop.figureOfMerit * Math.cbrt(2 * a0.density * diskArea * hugePower * hugePower)
      const t = propThrust(spec, hugePower, 0, a0)
      expect(Math.abs(t - expectedStaticMax) / expectedStaticMax).toBeLessThan(1e-9)
    }
  })

  it('極小速度下推力仍有限，不發散', () => {
    const power = enginePower(P51D, a0, 0, WEP_THROTTLE)
    const t = propThrust(P51D, power, 1e-6, a0)
    expect(Number.isFinite(t)).toBe(true)
    expect(t).toBeLessThan(40000)
  })

  it('高速時推力隨速度下降（定功率）', () => {
    const power = enginePower(P51D, a0, 0.4, WEP_THROTTLE)
    expect(propThrust(P51D, power, 200, a0)).toBeLessThan(propThrust(P51D, power, 120, a0))
  })

  it('功率為 0 時推力為 0', () => {
    expect(propThrust(P51D, 0, 150, a0)).toBe(0)
  })
})
