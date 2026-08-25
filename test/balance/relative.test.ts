import { describe, it, expect } from 'vitest'
import {
  maxLevelSpeed, maxClimbRate, sustainedTurnRate, instantaneousTurnRate,
  maxRollRate, specificExcessPower, serviceCeiling,
} from '../../src/analysis/envelope'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'

const KMH = 1 / 3.6

/**
 * 掃描 [loKmh, hiKmh] 找出 diffAt(kmh) 由正轉負的速度（線性內插）。
 * diffAt 應回傳「(欲檢查領先方) − (對手)」，正值代表前者領先。
 * 找不到交叉點（掃描範圍內恆正或恆負）時回傳 null。
 *
 * 供下方「交叉點落在合理區間」測試使用：只驗證交叉點存在於某個粗頻寬，
 * 不做二分法收斂到機器精度——頻寬夠寬才不會變成調參地雷，
 * 但也要夠窄，讓交叉點被腰斬或加倍時測試會炸。
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

    it('P-51 在 7,600 m 的速度優勢超過 60 km/h', () => {
      const diff = (maxLevelSpeed(P51D, 7600) - maxLevelSpeed(BF109K4, 7600)) / KMH
      expect(diff).toBeGreaterThan(60)
    })

    it('P-51 升限高於 Bf 109', () => {
      expect(serviceCeiling(P51D)).toBeGreaterThan(serviceCeiling(BF109K4))
    })

    it('高度愈高 P-51 的優勢愈大', () => {
      const low = maxLevelSpeed(P51D, 0) - maxLevelSpeed(BF109K4, 0)
      const high = maxLevelSpeed(P51D, 8000) - maxLevelSpeed(BF109K4, 8000)
      expect(high).toBeGreaterThan(low)
    })
  })

  describe('爬升與盤旋', () => {
    // 原本這裡有一條「Bf109 海平面爬升率優於 P-51」的斷言，已移除：
    // test/performance/historical.test.ts:127 已鎖住 modelRatio ≈ 1.0849
    // （±0.005），這蘊含 ratio > 1.08 > 1，也就是「Bf109 海平面爬升率恆優於
    // P-51」在 L2 綠燈的任何狀態下都自動成立——L2 沒過，這條也不會過；
    // L2 過了，這條必過。它不能在 L2 通過、本測試失敗的狀態下被觸發，
    // 所以它其實沒有鎖住任何 L2 尚未鎖住的性質。
    //
    // 換成下面這條「爬升優勢限定在特定高度區間」——這是 L2 的比值斷言鎖不住
    // 的新資訊：兩級增壓器讓 P-51 在 2,000–3,000 m 與 8,000 m 以上反超，
    // 而不是「Bf109 從頭到尾贏」。
    it('Bf109 的海平面爬升優勢僅限特定高度區間，不是全程通吃（P-51 二級增壓器的反例）', () => {
      // 0 m：Bf109 領先（DB605A 單級增壓器在低空的優勢），實測 983.83 vs
      // 906.84 m/min，+8.49%。
      expect(maxClimbRate(BF109K4, 0).rate).toBeGreaterThan(maxClimbRate(P51D, 0).rate)
      // 3,000 m：P-51 反超（二級增壓器切檔後），實測 1018.84 vs 947.33
      // m/min，P-51 領先 7.02%。
      expect(maxClimbRate(P51D, 3000).rate).toBeGreaterThan(maxClimbRate(BF109K4, 3000).rate)
      // 6,000 m：Bf109 再度領先，實測 903.85 vs 797.57 m/min，+13.33%。
      expect(maxClimbRate(BF109K4, 6000).rate).toBeGreaterThan(maxClimbRate(P51D, 6000).rate)
      // 9,000 m：P-51 再度反超，且優勢隨高度繼續擴大，實測 457.33 vs
      // 437.40 m/min，P-51 領先 4.36%。
      expect(maxClimbRate(P51D, 9000).rate).toBeGreaterThan(maxClimbRate(BF109K4, 9000).rate)
    })

    // 原本這裡有一條「Bf109 在 300 km/h 的持續轉彎率優於 P-51」的斷言，
    // 已拆成下面兩條。300 km/h 這一點測的其實不是縫翼：反事實驗證
    // （slatAlphaBonus 設為 0）顯示 Bf109 在 300 km/h 的讀數完全不變
    // （17.201067703953207 → 17.201067703953218，浮點雜訊等級），因為
    // 300 km/h 時 sustained（17.201°/s）遠低於 instantaneous（22.143°/s），
    // 代表尚未觸及 CL_max 邊界、是 Ps=0 的功率邊界在限制轉彎率，
    // 與縫翼無關。而且餘裕只有 0.57%——300 km/h 離真實交叉點（約
    // 319–320 km/h）僅 20 km/h。
    it('Bf 109 在 250 km/h 的持續轉彎率優於 P-51（縫翼效果）', () => {
      // 250 km/h 時 sustained 與 instantaneous 相等（雙方在此速度皆為氣動
      // 極限，尚未觸及 Ps=0 的功率邊界），所以這條與下方「瞬間轉彎率」測試
      // 在物理上量的是同一件事——不是重複造假的綠燈，是同一個機制的兩種
      // 呈現方式。反事實驗證：slatAlphaBonus 設為 0 時 Bf109 讀數從
      // 17.5096°/s 掉到 14.8117°/s（低於 P-51 的 16.6676°/s），斷言失敗。
      expect(sustainedTurnRate(BF109K4, 0, 250 * KMH)).toBeGreaterThan(
        sustainedTurnRate(P51D, 0, 250 * KMH),
      )
    })

    it('400 km/h 時優勢反轉：P-51 持續轉彎率優於 Bf 109', () => {
      // 這條才是原本 300 km/h 斷言遺漏的資訊：轉彎優勢會隨速度反轉，
      // 而不是「Bf109 在中低速恆優」。實測 13.833 vs 13.104 °/s，
      // P-51 領先 5.56%。
      expect(sustainedTurnRate(P51D, 0, 400 * KMH)).toBeGreaterThan(
        sustainedTurnRate(BF109K4, 0, 400 * KMH),
      )
    })

    it('Bf 109 低速瞬間轉彎率優於 P-51（縫翼效果）', () => {
      expect(instantaneousTurnRate(BF109K4, 0, 250 * KMH)).toBeGreaterThan(
        instantaneousTurnRate(P51D, 0, 250 * KMH),
      )
    })
  })

  describe('滾轉', () => {
    it('P-51 在 600 km/h 的滾轉率超過 Bf 109 的 1.5 倍', () => {
      const p = maxRollRate(P51D, 0, 600 * KMH)
      const b = maxRollRate(BF109K4, 0, 600 * KMH)
      expect(p).toBeGreaterThan(b * 1.5)
    })

    it('低速時兩者滾轉率差距不大（109 的弱點只在高速）', () => {
      // 門檻由 0.6 提高到 0.85：實測比值 0.965，0.6 的門檻允許在偵測前
      // 先劣化 38% 才會報警，等於沒有守住「109 的弱點只在高速」這句話。
      // 0.85 仍留 13% 餘裕，但能在劣化到接近 1 成時就示警。
      const p = maxRollRate(P51D, 0, 350 * KMH)
      const b = maxRollRate(BF109K4, 0, 350 * KMH)
      expect(b).toBeGreaterThan(p * 0.85)
    })
  })

  describe('能量保持（Boom & Zoom 的物理基礎）', () => {
    it('P-51 高速平飛的 Ps 優於 Bf 109（層流翼低阻）', () => {
      const v = 550 * KMH
      expect(specificExcessPower(P51D, 5000, v, 1)).toBeGreaterThan(
        specificExcessPower(BF109K4, 5000, v, 1),
      )
    })

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
    // 上面兩條「存在⋯區間」的測試只確認交叉點存在，不管它在哪裡。這意味著
    // 若某次調參把持續轉彎交叉點從 319 km/h 推到 800 km/h——等於 Bf109
    // 在幾乎整個速度範圍都出彎優於 P-51，戰術定位整個跑掉——上面兩條
    // 「存在⋯區間」斷言全部依然綠燈。這裡才是真正守住「P-51 佔有高速端、
    // Bf109 佔有低速端，且轉手位置在合理範圍」的測試。
    //
    // 頻寬選擇：寬到不會變成調參地雷（模型現有的鋸齒式極速曲線、增壓器
    // 檔位接縫等既有波動不會誤觸），但窄到交叉點被腰斬或加倍就會失敗。
    it('海平面持續轉彎率交叉點落在 [280, 380] km/h（實測約 319 km/h）', () => {
      // 反事實驗證：把 Bf109 的 oswald 從 0.78 調到與 P-51 相同的 0.88
      // （誘導阻力下降，轉彎更省能量），交叉點從 319.44 km/h 推到
      // 411.54 km/h，超出上界，斷言失敗——證明頻寬不是永遠通過的地雷。
      const crossover = crossoverKmh(
        (kmh) => sustainedTurnRate(BF109K4, 0, kmh * KMH) - sustainedTurnRate(P51D, 0, kmh * KMH),
        200, 500, 1,
      )
      expect(crossover).not.toBeNull()
      expect(crossover as number).toBeGreaterThanOrEqual(280)
      expect(crossover as number).toBeLessThanOrEqual(380)
    })

    it('瞬間轉彎率交叉點落在 [400, 520] km/h（實測約 452 km/h）', () => {
      // 反事實驗證：把 Bf109 的 slatAlphaBonus 從 2.5° 降到 1.5°
      // （縫翼效果減弱 40%），Bf109 在整個 200–500 km/h 掃描範圍內完全
      // 不再領先（差值全部轉負，200 km/h 處已是 −0.22°/s），此頻寬內
      // 找不到交叉點，斷言失敗——證明這條確實與縫翼機制掛鉤。
      const crossover = crossoverKmh(
        (kmh) => instantaneousTurnRate(BF109K4, 0, kmh * KMH) -
          instantaneousTurnRate(P51D, 0, kmh * KMH),
        350, 600, 1,
      )
      expect(crossover).not.toBeNull()
      expect(crossover as number).toBeGreaterThanOrEqual(400)
      expect(crossover as number).toBeLessThanOrEqual(520)
    })
  })
})
