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
 * ── 【現況：誰在哪一段佔優】────────────────────────────────────
 *
 *   Bf 109 K-4 佔優   爬升（全高度）、持續轉彎（**全速域**）、475 km/h
 *                     以下的瞬間轉彎、620 km/h 以下的 1G 能量保持、升限、
 *                     5,000–7,000 m 的極速
 *   P-51D 佔優        海平面與 8,000 m 以上的極速、475 km/h 以上的瞬間轉彎、
 *                     570 km/h 以上的大 G 能量保持、高速滾轉
 *
 * 其中兩項與史實敘事相反，**這不是測試過期，是規格的問題**：
 *
 *   升限            模型 K-4 12,791 > P-51 12,274；史實 P-51D 12,680 > K-4 ~12,500
 *   高速 Ps         模型 K-4 領先到 620 km/h；層流翼該讓 P-51 更早勝出
 *
 * 【第三項「低速轉彎方向相反」已經不在了，成因值得記住】它一度是
 * 「模型 P-51 領先到 270 km/h，但縫翼該讓 K-4 贏下低速端」。成因不在這個
 * 檔案，也不在 `bf109k4.ts` —— 是 `specs/p51d.ts` 兩處資料錯誤：
 *
 *   `engine.gears`         低增壓檔的海平面填了 61″Hg 的軍用值（1,490 hp）
 *                          而不是 67″Hg 的 WEP 值，高增壓檔的臨界也偏低。
 *                          海平面短少 9.4%、高增壓臨界短少 13.5%。
 *   `P51D_HISTORICAL`      極速／爬升／升限來自 9,760 lb 的試飛，失速那個
 *                          數字卻屬於約 8,600 lb —— 混了載重狀態。
 *
 * 兩者合起來的症狀是「P-51D 的海平面爬升差史實 14.45%，本模型物理上達不到」，
 * 於是質量被校準到 3,900 kg（真實試飛重量是 4,427 kg）去補。翼負荷因此由
 * 202.8 掉到 178.7 kg/m²，比 K-4 的 210.3 低太多，低速轉彎就翻了過來。
 *
 * 資料修正之後質量回到 4,427 kg，K-4 拿回全速域的持續轉彎優勢，
 * `historical.test.ts` 的五項與爬升比值也全部同時變好。細節見
 * `specs/p51d.ts` 的 `mass`、`engine.gears` 與 `P51D_HISTORICAL`。
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

    /**
     * 【是 U 形，不是單調】以前這條寫「高度愈高優勢愈大」，拿海平面對
     * 8,000 m 比。現在 P-51 在海平面就小幅領先，而中空整段由 K-4 拿走，
     * 所以那個比法會誤判 —— 實測差值（P−K，km/h）：
     *
     *   0 m +9.6　3,000 +10.0　5,000 −20.0　6,000 −14.0
     *   7,000 −8.1　8,000 +9.2　9,000 +25.1　10,000 +22.3
     *
     * 中間那個谷是 K-4 單檔增壓器的臨界高度（6,000 m）。守的是**谷的存在**
     * 與**高空的峰值最大**：谷被填平表示 K-4 沒有中空主場，峰值不再最大
     * 表示 P-51 的兩檔增壓器沒發揮。
     */
    it('P-51 的極速優勢是 U 形：中空有谷，9,000 m 是峰', () => {
      const at = (alt: number): number => maxLevelSpeed(P51D, alt) - maxLevelSpeed(BF109K4, alt)
      expect(at(6000)).toBeLessThan(0)              // K-4 的中空主場
      expect(at(9000)).toBeGreaterThan(at(0))       // 高空優勢大於海平面
      expect(at(9000)).toBeGreaterThan(at(6000))
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
     * 【持續轉彎沒有交叉點：K-4 全速域領先，而這與史實一致】縫翼＋功率負荷
     * （K-4 436 W/kg 對 P-51D 300）讓 109 拿下整個持續轉彎域。盟軍飛行員的
     * 報告也是這樣講的：低速纏鬥追不上 109，要把它拉到高速去打。
     *
     * 【所以要守的是「幅度有界」】K-4 贏太多的話狗鬥就只剩單方面。實測
     * K/P 比：200 km/h 1.189、250 1.109、300 1.114、400 1.112、500 1.089、
     * 550 1.028 —— 隨速度收斂，因為高速端誘導阻力讓位給零升阻力，P-51 的
     * 層流翼把差距吃回來。
     *
     * 【P-51 的補償在別處】475 km/h 以上的瞬間轉彎、570 km/h 以上的大 G
     * 能量保持、高速滾轉。那三條各自有斷言。
     */
    it('持續轉彎全速域由 Bf 109 領先，但幅度不超過 25%', () => {
      for (const v of [200, 250, 300, 400, 500]) {
        const b = sustainedTurnRate(BF109K4, 0, v * KMH)
        const p = sustainedTurnRate(P51D, 0, v * KMH)
        expect(b).toBeGreaterThan(p)
        expect(b / p).toBeLessThan(1.25)
      }
    })

    /**
     * 【瞬間轉彎有交叉點，位置在 475 km/h 附近】低速端由 K-4 的縫翼拿走、
     * 高速端由 P-51 的過載限制（8G 對 K-4 的 7.5G）接手。實測 P/K：
     * 200 km/h 0.841、250 0.902、300 0.914、400 0.920、480 1.009、
     * 500 1.068、600 1.068。
     *
     * 【反事實驗證 —— 這條是縫翼的守衛】把 K-4 的 `slatAlphaBonus` 歸零，
     * 200 km/h 的 P/K 由 **0.841 跳到 1.147**（低速端整個翻給 P-51），
     * 250 km/h 由 0.902 跳到 1.073。所以它確實綁在縫翼上。
     *
     * 兩端都要守：低速端 K-4 贏但不能贏到 P-51 指不過去，高速端 P-51 贏。
     */
    it('瞬間轉彎有交叉點：低速端 Bf 109（縫翼），高速端 P-51', () => {
      for (const v of [200, 250, 300, 400]) {
        const p = instantaneousTurnRate(P51D, 0, v * KMH)
        const b = instantaneousTurnRate(BF109K4, 0, v * KMH)
        expect(b).toBeGreaterThan(p)
        expect(b / p).toBeLessThan(1.25)
      }
      for (const v of [500, 600]) {
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
     * 【Boom & Zoom 的物理基礎，方向與史實一致，但只在高速端】拉 G 之後
     * 誘導阻力主導，P-51 的高展弦比與 oswald 勝出。3,000 m、4G 的實測
     * P−K（m/s）：450 −3.37、500 −2.12、550 −0.52、**570 +0.11**、
     * 600 +1.20、650 +3.40、700 +6.07 —— 交叉點在 570 km/h。
     *
     * 【為什麼低速端輸】4G 在 500 km/h 以下已經逼近 P-51 的氣動極限
     * （4,427 kg、CL_max 1.382），升力係數一高誘導阻力就吃掉展弦比的好處。
     * 那一段本來就不是 Boom & Zoom 的工作區。
     */
    it('P-51 在 600 km/h 以上的大 G 能量流失小於 Bf 109', () => {
      for (const v of [600, 650, 700]) {
        expect(specificExcessPower(P51D, 3000, v * KMH, 4)).toBeGreaterThan(
          specificExcessPower(BF109K4, 3000, v * KMH, 4),
        )
      }
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

    it('瞬間轉彎率交叉點落在 [400, 560] km/h（實測約 475 km/h）', () => {
      // 【換成瞬間轉彎，因為持續轉彎已經沒有交叉點了】K-4 在持續轉彎是
      // 全速域領先（見上方），所以那個量已經沒有位置可以守。真正還有交叉點、
      // 而且決定戰術定位的是**瞬間轉彎**：低速端由 K-4 的縫翼拿走、高速端
      // 由 P-51 的 8G 過載限制接手（K-4 是 7.5G）。交叉點被推到速度域之外的話，就變成
      // 某一方在整個狗鬥範圍都指得比較快。
      //
      // 【反事實驗證】兩邊各自綁在不同的東西上：
      //   低速端（K-4 要贏）  縫翼歸零 → 交叉點**消失**、K-4 加重 10% → 消失、
      //                       P-51 減重 10%（回到舊的 3,984 kg）→ 消失。
      //                       三者都是「K-4 丟掉低速端」的同一個方向。
      //   高速端（P-51 要贏）  P-51 的 gPositive 由 8 降到 7
      //                       → 消失。9 則不動（478 不變）。
      //   位置本身            P-51 加重 10% → 502 km/h。K-4 減重 10% 與縫翼
      //                       加倍都**不動**（仍是 478）—— 低速端本來就由
      //                       K-4 的氣動極限主宰，再加強也改不了交叉點在哪。
      const crossover = crossoverKmh(
        (kmh) => instantaneousTurnRate(BF109K4, 0, kmh * KMH)
          - instantaneousTurnRate(P51D, 0, kmh * KMH),
        300, 700, 1,
      )
      expect(crossover).not.toBeNull()
      expect(crossover as number).toBeGreaterThanOrEqual(400)
      expect(crossover as number).toBeLessThanOrEqual(560)
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
