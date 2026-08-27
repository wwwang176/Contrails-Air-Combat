import { describe, it, expect } from 'vitest'
import {
  maxLevelSpeed, maxClimbRate, sustainedTurnRate, instantaneousTurnRate,
  maxRollRate, specificExcessPower, serviceCeiling,
} from '../../src/analysis/envelope'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'

const KMH = 1 / 3.6

/**
 * ── 【這個檔案守的是什麼】────────────────────────────────────────
 *
 * **兩架各有勝場，狗鬥才有互動。** 不是「哪一架比較強」——那是規格的事，由
 * `test/performance/historical.test.ts` 對著史實數字守。這裡守的是**優勢的
 * 分界線在哪**：任何一方把交叉點推到速度域或高度域之外，戰術定位就整個垮掉，
 * 而那種劣化在單機的絕對數字上完全看不出來。
 *
 * ── 【2026-08-27：方向與史實相反，成因記在這裡】───────────────────
 *
 * G-6 → K-4 換裝（`803c1b8`）之後，兩架的性格**對調**了。現況：
 *
 *   Bf 109 K-4 佔優   爬升（全高度）、270 km/h 以上的持續轉彎、
 *                     660 km/h 以下的 1G 能量保持、升限
 *   P-51D 佔優        8,000 m 以上的極速、270 km/h 以下的持續轉彎、
 *                     全速域的瞬間轉彎、高速滾轉、大 G 能量保持
 *
 * 其中三項與史實敘事相反，**這不是測試過期，是規格的問題**：
 *
 *   升限            模型 K-4 12,791 > P-51 12,198；史實 P-51D 12,770 > K-4 ~12,500
 *   高速 Ps         模型 K-4 領先到 660 km/h；層流翼該讓 P-51 更早勝出
 *   低速轉彎        模型 P-51 領先到 270 km/h；縫翼該讓 K-4 贏下低速端
 *
 * 【量到的成因】兩架不在同一個出力檔上比：
 *
 *   P-51D  第一檔 1,511 PS 海平面 / 1,744 PS @1,900 m；第二檔 1,389 PS @5,900 m
 *   109K-4        2,000 PS 海平面 / 1,800 PS @6,000 m
 *
 * K-4 吃的是 MW-50 全緊急出力，P-51D 吃的卻低於它自己 67″ WEP 的 1,720 PS。
 * 海平面功率差 32%，爬升就差 60%（史實約 +27%）。衝壓回收 0.95 對 0.60、
 * 兩檔增壓器對一檔，則是 P-51 在 8,000 m 以上翻盤的原因。
 *
 * 【為什麼還是把斷言改成現況】專案負責人 2026-08-27 裁決：現況玩起來合理，
 * 護欄照現況重定值。把 P-51D 拉到 WEP 是改規格、要重跑五項史實驗收，那是
 * 另一件事。**這段註解就是那件事的待辦**——不要因為測試綠了就以為它不存在。
 */

/**
 * 掃描 [loKmh, hiKmh] 找出 diffAt(kmh) 由正轉負的速度（線性內插）。
 * diffAt 應回傳「(欲檢查領先方) − (對手)」，正值代表前者領先。
 * 找不到交叉點（掃描範圍內恆正或恆負）時回傳 null。
 *
 * 只驗證交叉點落在某個粗頻寬，不做二分法收斂到機器精度——頻寬夠寬才不會
 * 變成調參地雷，但也要夠窄，讓交叉點被腰斬或加倍時測試會炸。
 */
function crossoverKmh(
  diffAt: (kmh: number) => number,
  loKmh: number,
  hiKmh: number,
  stepKmh: number,
): number | null {
  let prevKmh = loKmh
  let prev = diffAt(loKmh)
  for (let kmh = loKmh + stepKmh; kmh <= hiKmh; kmh += stepKmh) {
    const cur = diffAt(kmh)
    if (prev > 0 && cur <= 0) {
      const frac = prev / (prev - cur)
      return prevKmh + frac * (kmh - prevKmh)
    }
    prevKmh = kmh
    prev = cur
  }
  return null
}

describe('L3 平衡關係', () => {
  describe('速度與高空', () => {
    it('P-51 臨界高度極速高於 Bf 109', () => {
      expect(maxLevelSpeed(P51D, 7600)).toBeGreaterThan(maxLevelSpeed(BF109K4, 6300))
    })

    /**
     * 【原本寫「7,600 m 快 60 km/h」】那是 G-6 時代的關係。K-4 有 MW-50，
     * 那個高度反而是它領先 9 km/h。P-51 的優勢**移到 8,000 m 以上**——
     * 兩檔增壓器加上 0.95 的衝壓回收，在 K-4 的單檔臨界高度（6,000 m）
     * 之上才拉開。實測 8,000 m +4.2、9,000 m +24.9、10,000 m +21.8 km/h。
     */
    it('P-51 的極速優勢在 8,000 m 以上才出現，且到 9,000 m 拉開 20 km/h', () => {
      const at = (alt: number): number =>
        (maxLevelSpeed(P51D, alt) - maxLevelSpeed(BF109K4, alt)) / KMH
      expect(at(7000)).toBeLessThan(0)          // K-4 的臨界高度附近仍由它領先
      expect(at(8000)).toBeGreaterThan(0)
      expect(at(9000)).toBeGreaterThan(20)
    })

    /**
     * 【方向與史實相反，見檔頭】史實 P-51D 12,770 m 高於 K-4 的 ~12,500 m，
     * 模型是反的。所以這裡不斷言誰高，改守**差距不得放大**——兩架都要留在
     * 同一個高度層，否則高空攔截的戰術定位會分家。實測 12,198 / 12,791，
     * 差 4.9%。
     */
    it('兩者升限落在同一層，差距不到 8%', () => {
      const p = serviceCeiling(P51D)
      const b = serviceCeiling(BF109K4)
      expect(Math.abs(p - b) / Math.min(p, b)).toBeLessThan(0.08)
      for (const c of [p, b]) {
        expect(c).toBeGreaterThan(11_000)
        expect(c).toBeLessThan(13_500)
      }
    })

    it('高度愈高 P-51 的優勢愈大', () => {
      const low = maxLevelSpeed(P51D, 0) - maxLevelSpeed(BF109K4, 0)
      const high = maxLevelSpeed(P51D, 8000) - maxLevelSpeed(BF109K4, 8000)
      expect(high).toBeGreaterThan(low)
    })
  })

  describe('爬升與盤旋', () => {
    /**
     * 【原本寫「爬升優勢僅限特定高度區間」】那是 G-6：P-51 的兩級增壓器會在
     * 2,000–3,000 m 與 8,000 m 以上反超。K-4 的 2,000 PS 讓那兩個窗口整個
     * 消失——它在**每一個高度**都爬得比較快，到 11,000 m 仍領先 192 m/min。
     *
     * 這一條因此改成守「領先幅度不得再擴大」：+60% 已經比史實的 +27% 多了
     * 一倍（成因見檔頭），再往上就會變成 P-51 完全爬不上去、垂直機動沒有
     * 任何互動。
     *
     * 【比值只在 9,000 m 以下有意義】再往上 P-51 逼近它 12,198 m 的升限，
     * 分母趨近 0、比值必然發散——實測 10,000 m 已是 1.76、11,000 m 1.94、
     * 12,000 m 3.21。那不是劣化，是升限的定義。所以高處只斷言「還是領先」。
     * 實測 1.60 / 1.36 / 1.65 / 1.68。
     *
     * 【反事實驗證】K-4 出力 +20% → 9,000 m 的比值 **2.28**，失敗；
     * K-4 減重 10% → **2.01**，失敗。1.8 留約 7% 餘裕。
     */
    it('Bf 109 全高度爬升領先，9,000 m 以下的幅度不得再擴大', () => {
      for (const alt of [0, 3000, 6000, 9000]) {
        const b = maxClimbRate(BF109K4, alt).rate
        const p = maxClimbRate(P51D, alt).rate
        expect(b).toBeGreaterThan(p)
        expect(b / p).toBeLessThan(1.8)
      }
      expect(maxClimbRate(BF109K4, 11_000).rate)
        .toBeGreaterThan(maxClimbRate(P51D, 11_000).rate)
    })

    /**
     * 【方向與史實相反，見檔頭】縫翼該讓 K-4 贏下低速端，模型是 P-51 贏。
     * 機制上說得通：K-4 翼負荷更高（低速吃虧），功率大很多（高速吃香），
     * 所以交叉點翻了過來。實測 250 km/h P-51 領先 0.59°/s，300 km/h 換
     * K-4 領先 3.03°/s。
     */
    it('持續轉彎：270 km/h 以下 P-51 領先', () => {
      expect(sustainedTurnRate(P51D, 0, 250 * KMH)).toBeGreaterThan(
        sustainedTurnRate(BF109K4, 0, 250 * KMH),
      )
    })

    it('持續轉彎：270 km/h 以上換 Bf 109 領先', () => {
      for (const v of [300, 400, 500]) {
        expect(sustainedTurnRate(BF109K4, 0, v * KMH)).toBeGreaterThan(
          sustainedTurnRate(P51D, 0, v * KMH),
        )
      }
    })

    /**
     * 【瞬間轉彎已經沒有交叉點了】P-51 在 150–600 km/h 全域領先 0.58～2.04°/s。
     * 原本那條「交叉點落在 [400, 520]」因此不可能綠，換成守**領先幅度有界**
     * ——差距再拉開，K-4 就連把機首指過去都做不到，狗鬥剩下單方面。
     * 實測最大差距在 500 km/h：32.11 對 30.07°/s，6.4%。
     *
     * 【反事實驗證 —— 這條接管了原本縫翼守衛的職責】把 K-4 的
     * `slatAlphaBonus` 歸零，比值從 1.068 跳到 **1.441**，斷言失敗；K-4
     * 加重 10% 跳到 **1.303**，也失敗。所以它確實綁在縫翼與翼負荷上。
     */
    it('瞬間轉彎 P-51 全速域領先，但領先幅度不超過 10%', () => {
      for (const v of [200, 250, 300, 400, 500, 600]) {
        const p = instantaneousTurnRate(P51D, 0, v * KMH)
        const b = instantaneousTurnRate(BF109K4, 0, v * KMH)
        expect(p).toBeGreaterThan(b)
        expect(p / b).toBeLessThan(1.10)
      }
    })
  })

  describe('滾轉', () => {
    it('P-51 在 600 km/h 的滾轉率超過 Bf 109 的 1.5 倍', () => {
      const p = maxRollRate(P51D, 0, 600 * KMH)
      const b = maxRollRate(BF109K4, 0, 600 * KMH)
      expect(p).toBeGreaterThan(b * 1.5)
    })

    it('低速時兩者滾轉率差距不大（109 的弱點只在高速）', () => {
      // 門檻由 0.6 提高到 0.85：實測比值 0.970，0.6 的門檻允許在偵測前
      // 先劣化 38% 才會報警，等於沒有守住「109 的弱點只在高速」這句話。
      // 0.85 仍留 13% 餘裕，但能在劣化到接近 1 成時就示警。
      const p = maxRollRate(P51D, 0, 350 * KMH)
      const b = maxRollRate(BF109K4, 0, 350 * KMH)
      expect(b).toBeGreaterThan(p * 0.85)
    })
  })

  describe('能量保持（Boom & Zoom 的物理基礎）', () => {
    /**
     * 【方向與史實相反，見檔頭】層流翼該讓 P-51 在高速平飛勝出，模型要到
     * 660 km/h 才交叉。這條因此改守**交叉點的位置**而不是「誰贏」：交叉點
     * 被推到速度域之外的話，K-4 就變成全速域能量都更好，Boom & Zoom 沒了
     * 物理基礎。實測 5,000 m、1G 的交叉點在 659 km/h。
     *
     * 【反事實驗證】K-4 出力 −20% → 521 km/h，低於下界、失敗。+20% → 757，
     * 仍在界內但已逼近上界 760。
     */
    it('1G 平飛的 Ps 交叉點落在 [560, 760] km/h（實測約 659 km/h）', () => {
      const crossover = crossoverKmh(
        (kmh) => specificExcessPower(BF109K4, 5000, kmh * KMH, 1)
          - specificExcessPower(P51D, 5000, kmh * KMH, 1),
        300, 900, 2,
      )
      expect(crossover).not.toBeNull()
      expect(crossover as number).toBeGreaterThanOrEqual(560)
      expect(crossover as number).toBeLessThanOrEqual(760)
    })

    /**
     * 【這一條是 Boom & Zoom 真正的物理基礎，而且方向與史實一致】拉 G 之後
     * 誘導阻力主導，P-51 的高展弦比與 oswald 勝出——實測 3,000 m、4G 時
     * P-51 在 400～700 km/h 全域領先（+0.32 到 +8.21 m/s）。
     */
    it('P-51 在大 G 高速時的能量流失小於 Bf 109', () => {
      const v = 500 * KMH
      expect(specificExcessPower(P51D, 3000, v, 4)).toBeGreaterThan(
        specificExcessPower(BF109K4, 3000, v, 4),
      )
    })

    it('兩台飛機大 G 轉彎時 Ps 皆為顯著負值（能量戰成立）', () => {
      const v = 450 * KMH
      expect(specificExcessPower(P51D, 3000, v, 5)).toBeLessThan(-20)
      expect(specificExcessPower(BF109K4, 3000, v, 5)).toBeLessThan(-20)
    })
  })

  describe('交叉優勢區間存在（避免單方全面碾壓）', () => {
    it('存在 Bf 109 佔優的速度區間', () => {
      let found = false
      for (let kmh = 250; kmh <= 400; kmh += 10) {
        if (sustainedTurnRate(BF109K4, 0, kmh * KMH) > sustainedTurnRate(P51D, 0, kmh * KMH)) {
          found = true
          break
        }
      }
      expect(found).toBe(true)
    })

    it('存在 P-51 佔優的速度區間', () => {
      let found = false
      for (let kmh = 500; kmh <= 700; kmh += 20) {
        if (specificExcessPower(P51D, 3000, kmh * KMH, 1) >
            specificExcessPower(BF109K4, 3000, kmh * KMH, 1)) {
          found = true
          break
        }
      }
      expect(found).toBe(true)
    })
  })

  describe('交叉點落在合理區間（真正守住優勢區間的位置，而非只確認存在）', () => {
    // 上面兩條「存在⋯區間」只確認交叉點存在，不管它在哪裡。若某次調參把
    // 持續轉彎交叉點推到 800 km/h——等於 K-4 在幾乎整個速度範圍都出彎優於
    // P-51，戰術定位整個跑掉——上面兩條依然綠燈。這裡才是真正守住位置的。
    //
    // 頻寬選擇：寬到不會變成調參地雷（模型現有的鋸齒式極速曲線、增壓器
    // 檔位接縫等既有波動不會誤觸），但窄到交叉點被腰斬或加倍就會失敗。
    it('海平面持續轉彎率交叉點落在 [230, 320] km/h（實測約 270 km/h）', () => {
      // 【方向已經翻過來了】掃的是「P-51 − K-4 由正轉負」，也就是低速端
      // 由 P-51 領先、過了交叉點換 K-4。原本是相反的方向，見檔頭。
      //
      // 【反事實驗證】K-4 減重 10% → 交叉點消失（K-4 全速域領先），失敗；
      // K-4 加重 10% → 288 km/h；縫翼歸零 → 295 km/h；縫翼加倍 → 消失，
      // 失敗。所以它綁在翼負荷與縫翼上。
      //
      // 【注意：oswald 已經不是這條的探針了】舊版用「K-4 oswald 0.78→0.88」
      // 當反事實。方向翻轉之後交叉點落在**氣動極限**而不是 Ps=0 的功率
      // 邊界上，實測 oswald 改 0.88 交叉點仍是 270 km/h，完全不動。
      const crossover = crossoverKmh(
        (kmh) => sustainedTurnRate(P51D, 0, kmh * KMH) - sustainedTurnRate(BF109K4, 0, kmh * KMH),
        200, 500, 1,
      )
      expect(crossover).not.toBeNull()
      expect(crossover as number).toBeGreaterThanOrEqual(230)
      expect(crossover as number).toBeLessThanOrEqual(320)
    })

    /**
     * 【極速的交叉高度】P-51 由劣勢翻成優勢的高度。它綁的是「兩檔增壓器
     * 在 K-4 的單檔臨界高度之上才發揮」這件事——被推到 11,000 m 以上，
     * 高空攔截就沒有任何飛機性能上的理由。實測約 7,900 m。
     */
    it('極速交叉高度落在 [6500, 9500] m（實測約 7,900 m）', () => {
      const crossover = crossoverKmh(
        (alt) => (maxLevelSpeed(BF109K4, alt) - maxLevelSpeed(P51D, alt)) / KMH,
        6000, 11_000, 50,
      )
      expect(crossover).not.toBeNull()
      expect(crossover as number).toBeGreaterThanOrEqual(6500)
      expect(crossover as number).toBeLessThanOrEqual(9500)
    })
  })
})
