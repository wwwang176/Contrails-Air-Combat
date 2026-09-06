import { describe, it, expect } from 'vitest'
import {
  maxLoadFactorAero, stallSpeed, dragAt, thrustAt, specificExcessPower,
  maxLevelSpeed, maxClimbRate, serviceCeiling, instantaneousTurnRate,
  sustainedTurnRate, bestSustainedTurnRate, bestSustainedTurnRateCached,
  cornerSpeed, maxRollRate,
} from '../../src/analysis/envelope'
import { DEFAULT_RULES } from '../../src/ai/rules'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'

const KMH = 1 / 3.6
const RAD2DEG = 180 / Math.PI

describe('stallSpeed', () => {
  it('隨過載開根號成長', () => {
    const v1 = stallSpeed(P51D, 0, 1)
    const v4 = stallSpeed(P51D, 0, 4)
    expect(v4 / v1).toBeCloseTo(2, 6)
  })

  it('隨高度上升（密度下降）', () => {
    expect(stallSpeed(P51D, 6000, 1)).toBeGreaterThan(stallSpeed(P51D, 0, 1))
  })
})

describe('maxLoadFactorAero', () => {
  it('速度為失速速度時過載為 1', () => {
    const vs = stallSpeed(P51D, 0, 1)
    expect(maxLoadFactorAero(P51D, 0, vs)).toBeCloseTo(1, 6)
  })

  it('隨速度平方成長', () => {
    const vs = stallSpeed(P51D, 0, 1)
    expect(maxLoadFactorAero(P51D, 0, vs * 2)).toBeCloseTo(4, 6)
  })
})

describe('dragAt', () => {
  it('過載超出氣動極限時回傳 Infinity', () => {
    const vs = stallSpeed(P51D, 0, 1)
    expect(dragAt(P51D, 0, vs, 3)).toBe(Infinity)
  })

  it('相同速度下過載愈高阻力愈大（誘導阻力）', () => {
    expect(dragAt(P51D, 3000, 200, 4)).toBeGreaterThan(dragAt(P51D, 3000, 200, 1))
  })
})

describe('maxLevelSpeed 與 Ps 的一致性', () => {
  it('極速處的 Ps 接近 0', () => {
    const v = maxLevelSpeed(P51D, 7600)
    expect(Math.abs(specificExcessPower(P51D, 7600, v, 1))).toBeLessThan(0.5)
  })

  it('極速以下 Ps 為正、以上為負', () => {
    const v = maxLevelSpeed(P51D, 5000)
    expect(specificExcessPower(P51D, 5000, v * 0.9, 1)).toBeGreaterThan(0)
    expect(specificExcessPower(P51D, 5000, v * 1.05, 1)).toBeLessThan(0)
  })

  it('推力在極速處等於阻力', () => {
    const v = maxLevelSpeed(BF109K4, 6300)
    expect(thrustAt(BF109K4, 6300, v)).toBeCloseTo(dragAt(BF109K4, 6300, v, 1), 0)
  })

  // 直接釘住「動力曲線背面」修正：10,470 m 附近 T−D(v) 在失速上方先為負（誘導阻力過大，
  // 約 89.8 m/s 由負轉正）、中段轉正、接近極速再由正轉負（約 178.4 m/s）。若退回只檢查
  // 失速速度×1.05 這一點正負的舊寫法，這裡會誤判為「無法平飛」而回傳 0。
  // 正確答案是上面那個（較高的）根，實測約 177.939 m/s。
  it('動力曲線背面：10,470 m 處仍能正確找到較高速的那個根', () => {
    expect(maxLevelSpeed(P51D, 10470)).toBeGreaterThan(150)
  })

  // finding #1：增壓器換檔的臨界高度是 C0 但非 C1（斜率有 16 倍量級的跳變、正負號翻轉）。
  // 只要 maxLevelSpeed 還是「粗掃描＋二分」而非退化成導數法，跨越接縫時速度應該平滑變化，
  // 不會出現階梯或發散。這裡直接對 P-51D 的兩個換檔高度（1,900 m、5,900 m）做連續性檢查，
  // 守住促成整個掃描＋二分設計的那個性質。
  it('平飛極速跨越增壓器換檔接縫時連續（1,900 m、5,900 m）', () => {
    expect(Math.abs(maxLevelSpeed(P51D, 2000) - maxLevelSpeed(P51D, 1800))).toBeLessThan(10)
    expect(Math.abs(maxLevelSpeed(P51D, 6000) - maxLevelSpeed(P51D, 5800))).toBeLessThan(10)
  })
})

describe('maxClimbRate', () => {
  it('最佳爬升速度介於失速速度與極速之間', () => {
    const { speed } = maxClimbRate(P51D, 0)
    expect(speed).toBeGreaterThan(stallSpeed(P51D, 0, 1))
    expect(speed).toBeLessThan(maxLevelSpeed(P51D, 0))
  })

  it('爬升率隨高度下降', () => {
    expect(maxClimbRate(P51D, 8000).rate).toBeLessThan(maxClimbRate(P51D, 0).rate)
  })

  // 絕對升限（P-51D 約 11,470 m，高於 0.5 m/s 判定用的 serviceCeiling≈11,242 m）以上，
  // maxLevelSpeed 會回傳「查無可平飛速度」的哨兵值 0。若把這個 0 直接餵給
  // Math.max(vLevel, vMin+1) 當搜尋上界，掃描區間會塌縮成失速速度正上方僅 1 m/s 的
  // 窄窗——剛好是阻力最大的一段，導致 rate 出現階梯式跳變（曾實測 11,450→11,500 m
  // 從 +0.017 掉到 −2.122，而 [v_stall·1.02, 400] 全域搜尋的真實值只有 −0.098）。
  // 這裡直接跨越該高度檢查連續性，防止此問題再度發生。
  it('爬升率跨越絕對升限時連續，不因哨兵值污染搜尋上界而跳變', () => {
    const below = maxClimbRate(P51D, 11450).rate
    const above = maxClimbRate(P51D, 11500).rate
    expect(Math.abs(above - below)).toBeLessThan(1) // 50 m 高度差，真實爬升率變化遠小於 1 m/s
  })
})

describe('serviceCeiling', () => {
  it('落在合理區間並高於 8,000 m', () => {
    const c = serviceCeiling(P51D)
    expect(c).toBeGreaterThan(8000)
    expect(c).toBeLessThan(16000)
  })

  it('升限處爬升率接近判定門檻', () => {
    const c = serviceCeiling(P51D)
    expect(maxClimbRate(P51D, c).rate).toBeCloseTo(0.5, 1)
  })

  // serviceCeiling 在二分前必須先驗證 [0, 20000] 真的括住 CEILING_RATE 這個門檻，
  // 否則二分法在無解時會直接收斂到端點，回傳一個與合法答案無法區分的數字
  // （0 看起來像「升限就在海平面」，20000 看起來像「升限恰好在搜尋上限」）。
  // 這裡用 spread 建構暫時的機體變體（不動 src/specs 底下任何檔案）驗證兩個方向。
  it('海平面就已達不到門檻爬升率（機體過重）時回傳 NaN，而非誤判為 0', () => {
    const tooHeavy = { ...P51D, mass: 40000 }
    expect(maxClimbRate(tooHeavy, 0).rate).toBeLessThan(0.5)
    expect(Number.isNaN(serviceCeiling(tooHeavy))).toBe(true)
  })

  it('20,000 m 處爬升率仍超過門檻（搜尋範圍未括住解）時回傳 NaN，而非誤判為 20000', () => {
    const veryLight = { ...P51D, mass: 100 }
    expect(maxClimbRate(veryLight, 20000).rate).toBeGreaterThan(0.5)
    expect(Number.isNaN(serviceCeiling(veryLight))).toBe(true)
  })
})

describe('轉彎性能', () => {
  it('持續轉彎率永不超過瞬間轉彎率', () => {
    for (const v of [120, 160, 200, 250, 300]) {
      expect(sustainedTurnRate(P51D, 0, v)).toBeLessThanOrEqual(
        instantaneousTurnRate(P51D, 0, v) + 1e-9,
      )
    }
  })

  // V_corner = V_stall × √n_limit。
  // P-51D：停轉 ~172 km/h（史實 160）× √8   = 486 km/h
  // Bf 109：停轉 ~162 km/h（史實 170）× √7.5 = 443 km/h
  // 二戰戰機在 7~8 G 結構限制下，corner speed 本來就落在 450~500 km/h 附近。
  // 計畫原本寫的 250~400 km/h 對本專案任何一架飛機都不成立
  // （見 Task 13 報告的協調者裁決：獨立手算與本模型的 486.4 km/h 完全吻合）。
  it('角落速度落在 400–550 km/h 的合理區間', () => {
    const vcP51 = cornerSpeed(P51D, 0) / KMH
    const vcBf = cornerSpeed(BF109K4, 0) / KMH
    expect(vcP51).toBeGreaterThan(400)
    expect(vcP51).toBeLessThan(550)
    expect(vcBf).toBeGreaterThan(400)
    expect(vcBf).toBeLessThan(550)
  })

  it('角落速度處瞬間轉彎率達到峰值附近', () => {
    const vc = cornerSpeed(P51D, 0)
    const peak = instantaneousTurnRate(P51D, 0, vc)
    expect(instantaneousTurnRate(P51D, 0, vc * 0.8)).toBeLessThan(peak)
    expect(instantaneousTurnRate(P51D, 0, vc * 1.3)).toBeLessThan(peak)
  })

  // 角落速度的定義就是「瞬間轉彎率峰值所在的速度」——氣動過載曲線（隨速度平方上升）
  // 與結構過載上限的交點以下轉彎率隨速度上升，以上則因過載被夾在常數 gPositive
  // 而隨速度增加反而下降，兩段恰在 cornerSpeed 交接。這裡用細掃描直接驗證峰值
  // 落點與 cornerSpeed 的解析解一致，把兩個獨立求解器（instantaneousTurnRate 與
  // cornerSpeed）串起來做交叉驗證，而不只是猜一個合理區間。
  //
  // 【修正】掃描網格不可以讓 vc 本身剛好是格點——原本 vc*0.5 + vc*(i/N) 在 i=N/2=200
  // 時會位元精確等於 vc，於是「峰值落在 vc」是網格構造保證的，不是實測出來的。
  // 改用 vc*(0.5 + (i+0.5)/N) 把每個格點都偏移半格，讓 vc 落在兩個格點中間、
  // 不會被抽樣命中；容差收緊到約 2 倍格距（格距 = vc/N = 0.25%，2 倍 = 0.5%），
  // 使其成為真正的檢查而非同義重複。
  it('cornerSpeed 與 instantaneousTurnRate 的峰值交叉驗證', () => {
    for (const spec of [P51D, BF109K4]) {
      const vc = cornerSpeed(spec, 0)
      let bestV = 0
      let bestRate = -Infinity
      const N = 400
      for (let i = 0; i <= N; i++) {
        const v = vc * (0.5 + (i + 0.5) / N)
        const r = instantaneousTurnRate(spec, 0, v)
        if (r > bestRate) {
          bestRate = r
          bestV = v
        }
      }
      expect(Math.abs(bestV - vc) / vc).toBeLessThan(0.005)
    }
  })

  it('低速持續轉彎率為正且落在合理範圍', () => {
    const rate = sustainedTurnRate(BF109K4, 0, 300 * KMH) * RAD2DEG
    expect(rate).toBeGreaterThan(5)
    expect(rate).toBeLessThan(35)
  })
})

describe('maxRollRate', () => {
  it('P-51 在 480 km/h 約 100 度/秒', () => {
    expect(maxRollRate(P51D, 0, 480 * KMH) * RAD2DEG).toBeCloseTo(100, -1)
  })

  it('Bf 109 在 400 km/h 約 80 度/秒', () => {
    expect(maxRollRate(BF109K4, 0, 400 * KMH) * RAD2DEG).toBeCloseTo(80, -1)
  })

  it('Bf 109 在 650 km/h 因副翼變重而大幅衰減', () => {
    const r = maxRollRate(BF109K4, 0, 650 * KMH) * RAD2DEG
    expect(r).toBeGreaterThan(20)
    expect(r).toBeLessThan(45)
  })
})

describe('bestSustainedTurnRate', () => {
  const ALTS = [0, 1000, 2000, 4000, 6000, 8000, 10000]

  /**
   * 【它與 sustainedTurnRate 回答不同的問題】後者問「現在這個速度能轉多快」，
   * 本函數問「這台飛機最多能轉多快」。AI 的投入／退出決定要用後者：迴旋戰
   * 一開打，兩台的速度就會各自收斂到自己的最佳點，當下的速度差會被抹平。
   */
  it('等於全速度範圍的最大值（對照 0.25 m/s 步長的暴力掃描）', () => {
    for (const spec of [P51D, BF109K4]) {
      for (const alt of ALTS) {
        let brute = 0
        for (let v = 30; v <= 260; v += 0.25) {
          brute = Math.max(brute, sustainedTurnRate(spec, alt, v))
        }
        // 【由單邊「不得低於暴力解」改成雙邊容差】
        //
        // 舊版寫 `fast >= brute - 1e-9`，也就是要求細化解**永遠**不低於
        // 0.25 m/s 網格的暴力解。那不是 `searchBestTurn` 保證得了的性質：
        // 它跑 12 次黃金分割，收斂殘差約 1e-5 rad/s（該函數的註解自己就
        // 寫了這個數字），而暴力解本身也是從下方逼近的近似值。兩個近似
        // 誤差誰大誰小是碰運氣。
        //
        // 舊版之所以一直綠，是因為 0.25 m/s 的網格夠粗、殘差剛好比較大。
        // 把網格加密到 0.05 m/s 之後，**沒有動過的 P-51D** 在 8,000 m 也
        // 同樣是 −4.6e-6（K-4 在海平面是 −9.1e-6）——這條斷言原本就在賭
        // 運氣，不是這次換機種才壞的。
        //
        // 現在兩個方向各有各的容差，因為兩個誤差來源本來就不同量級：
        //   上方 0.0005：0.25 m/s 粗網格自己的低估量（實測最大 1.3e-4），
        //                這是舊版就有的上界，沒有動。
        //   下方 1e-4  ：12 次黃金分割的收斂殘差（實測最大 9.1e-6）。
        // 消費端的決策門檻是 `DEFAULT_RULES.turnEnter` = 0.02 rad/s，
        // 兩邊都留了至少 40 倍餘裕。
        const fast = bestSustainedTurnRate(spec, alt)
        expect(fast - brute).toBeLessThan(0.0005)   // < 0.03°/s
        expect(brute - fast).toBeLessThan(1e-4)
      }
    }
  })

  it('隨高度單調下降', () => {
    for (const spec of [P51D, BF109K4]) {
      let prev = Infinity
      for (const alt of ALTS) {
        const r = bestSustainedTurnRate(spec, alt)
        expect(r).toBeLessThan(prev)
        prev = r
      }
    }
  })

  /**
   * **K-4 在每一個高度都轉贏 P-51，沒有例外。**
   *
   * 實測（P−K，rad/s）：
   *
   * ```
   *      0 m −0.0382   1,000 −0.0364   2,000 −0.0352   3,000 −0.0439
   *   4,000 m −0.0429   6,000 −0.0316   8,000 −0.0261
   * ```
   *
   * 機制：縫翼讓 K-4 的 CL_max 1.5533 對 P-51D 的 1.3823 高 12.4%，而翼載
   * 只高 3.7%（210.3 對 202.8 kg/m²）；再加上功率負荷 436 對 300 W/kg。
   * 持續轉彎是推力受限的，兩項都指向同一邊。這與史實敘事一致 —— 盟軍飛行員
   * 的報告就是「低速纏鬥追不上 109」。
   *
   * ── 【重要：`turnEnter` 現在醒著了】────────────────────────────
   *
   * `DEFAULT_RULES.turnEnter` 是 −0.02 rad/s，也就是「這台飛機真的轉不贏他」
   * 的界線。上表**七格全部超過**（最小 −0.0261），所以 P-51D 的 AI 對上 K-4
   * 會判定轉不贏而選擇 extend。這不是缺陷，是野馬該有的打法（能量戰而非
   * 纏鬥），但它會改變 AI 的行為 —— 相關的行為測試若有變動，先看這裡。
   *
   * 【所以這條斷言守什麼】
   *   1. 方向：每一格都是 K-4 領先。翻掉表示某一台的質量／出力／oswald 被動過。
   *   2. 幅度有上界（0.06）：K-4 再拉開，狗鬥就只剩單方面。
   */
  it('K-4 的最佳持續轉彎率在每個高度都領先 P-51', () => {
    for (const alt of ALTS) {
      const d = bestSustainedTurnRate(P51D, alt) - bestSustainedTurnRate(BF109K4, alt)
      expect(d, `${alt} m`).toBeLessThan(0)
      expect(d, `${alt} m`).toBeGreaterThan(-0.06)
    }
  })
})

describe('bestSustainedTurnRateCached', () => {
  /**
   * 【為什麼要快取】原函數要掃過整個速度範圍，實測 1,076 µs/次；AI 的能量
   * 評估是 10 Hz、每次算兩台，等於每 100 ms 花掉 2.1 ms，而 240 Hz 一格的
   * 預算只有 4.17 ms。快取後 78 ns。
   */
  /**
   * 【誤差要小於什麼】不是小於兩台的機體差距，而是小於**消費端的決策門檻**。
   * 唯一的消費端是 `DEFAULT_RULES.turnEnter`（0.02 rad/s），所以要求內插誤差
   * 低於它的十分之一。實測 0.0013 rad/s，是門檻的 6.5%。
   */
  it('交戰高度帶（0–11,000 m）的內插誤差低於決策門檻的十分之一', () => {
    for (const spec of [P51D, BF109K4]) {
      for (let alt = 0; alt <= 11000; alt += 137) {
        const err = Math.abs(
          bestSustainedTurnRateCached(spec, alt) - bestSustainedTurnRate(spec, alt),
        )
        expect(err, `${spec.name} @ ${alt} m`).toBeLessThan(0.1 * Math.abs(DEFAULT_RULES.turnEnter))
      }
    }
  })

  /**
   * 格點上沒有內插誤差，只剩求解器本身的收斂精度差異：表格是用**熱啟動**
   * （上一格的最佳速度當起點）求出來的，搜尋區間比冷啟動窄，收斂點因此
   * 略有不同。實測差距 1.2e-5 rad/s（7e-4 °/s），是決策門檻 0.02 的 0.06%；
   * 取 1e-4 當門檻（8 倍餘裕）。
   */
  it('格點上與原函數的差距僅為求解器收斂精度', () => {
    for (const alt of [0, 250, 1000, 4000, 9000]) {
      const diff = Math.abs(
        bestSustainedTurnRateCached(P51D, alt) - bestSustainedTurnRate(P51D, alt),
      )
      expect(diff, `@ ${alt} m`).toBeLessThan(1e-4)
    }
  })

  it('高度夾在表的範圍內，不產生 NaN', () => {
    for (const alt of [-500, 0, 14000, 20000]) {
      const r = bestSustainedTurnRateCached(P51D, alt)
      expect(Number.isFinite(r)).toBe(true)
      expect(r).toBeGreaterThanOrEqual(0)
    }
  })
})
