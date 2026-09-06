import { describe, it, expect } from 'vitest'
import {
  energyPull, sweetSpotAdvantage, sweetSpotPitch, DEFAULT_DOCTRINE,
  turnPlaneCost, turnPlanePitch,
} from '../../src/ai/doctrine'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'

const P = applyFeel(P51D, GAME_FEEL)
const B = applyFeel(BF109K4, GAME_FEEL)
const KMH = 1 / 3.6

describe('energyPull：能量見底時少拉一點', () => {
  it('速度充足時完全放行', () => {
    expect(energyPull(1.0, DEFAULT_DOCTRINE)).toBe(1)
    expect(energyPull(1.5, DEFAULT_DOCTRINE)).toBe(1)
  })

  it('速度見底時夾到下限，但不歸零', () => {
    // 【為什麼不歸零】完全鬆桿的 AI 是靶子。下限保留最低限度的機動
    expect(energyPull(0.5, DEFAULT_DOCTRINE)).toBe(DEFAULT_DOCTRINE.energyMinPull)
    expect(DEFAULT_DOCTRINE.energyMinPull).toBeGreaterThan(0)
  })

  it('中間段單調遞增且連續', () => {
    let prev = -1
    for (let r = 0.5; r <= 1.2; r += 0.01) {
      const p = energyPull(r, DEFAULT_DOCTRINE)
      expect(p).toBeGreaterThanOrEqual(prev)
      expect(p).toBeLessThanOrEqual(1)
      prev = p
    }
  })

  it('兩端接得上：門檻處剛好等於邊界值', () => {
    const c = DEFAULT_DOCTRINE
    expect(energyPull(c.energyFreeRatio, c)).toBeCloseTo(1, 12)
    expect(energyPull(c.energyFloorRatio, c)).toBeCloseTo(c.energyMinPull, 12)
  })

  it('門檻退化時安全回傳 1（不得意外把 AI 鎖死）', () => {
    const degenerate = { ...DEFAULT_DOCTRINE, energyFreeRatio: 0.7, energyFloorRatio: 0.7 }
    expect(energyPull(0.5, degenerate)).toBe(1)
  })
})

describe('sweetSpotAdvantage：在哪裡我贏得過他', () => {
  it('鏡像對戰處處為零', () => {
    for (const alt of [0, 4000, 8000]) {
      for (const kmh of [300, 450, 600]) {
        expect(sweetSpotAdvantage(P, P, alt, kmh * KMH)).toBeCloseTo(0, 12)
      }
    }
  })

  /**
   * 【換邊的方向翻了，而且 4,000 m 變成兩個分水嶺】
   *
   * **每個高度只有一個分水嶺：低／中速 K-4，高速端 P-51。** 實測換號點
   *（**套過 `applyFeel` 之後**，也就是本檔的 `P` 與 `B`）：
   *
   * ```
   *        0 m   560 km/h（→P-51），600 以上兩台都轉不動、優勢歸零
   *    4,000 m   660 km/h（→P-51），670 以上歸零
   *    8,000 m   675 km/h（→P-51）
   * ```
   *
   * 【P-51 的窗口很窄，所以不要釘單點】4,000 m 只有 660–665 那一格是正的，
   * 再高一點兩台都拉不出持續轉彎。斷言因此寫成「低中速為負」＋「高速帶內
   * 存在一格為正」，而不是三個定點。
   *
   * 機制：縫翼讓 K-4 的 CL_max 高 12.4% 而翼載只高 3.7%，加上功率負荷
   * 436 對 300 W/kg —— 低中速兩項都指向 K-4。高速端誘導阻力讓位給零升
   * 阻力，P-51 的層流翼才翻回來。與史實敘事一致。
   */
  it('4000 m 只有一個分水嶺：低中速 K-4、高速端 P-51', () => {
    expect(sweetSpotAdvantage(P, B, 4000, 280 * KMH)).toBeLessThan(0)
    expect(sweetSpotAdvantage(P, B, 4000, 450 * KMH)).toBeLessThan(0)
    let found = false
    for (let v = 560; v <= 700; v += 5) {
      if (sweetSpotAdvantage(P, B, 4000, v * KMH) > 0) { found = true; break }
    }
    expect(found, '高速帶內找不到 P-51 佔優的速度').toBe(true)
  })

  it('反對稱：交換雙方等於變號', () => {
    const a = sweetSpotAdvantage(P, B, 4000, 500 * KMH)
    const b = sweetSpotAdvantage(B, P, 4000, 500 * KMH)
    expect(a).toBeCloseTo(-b, 12)
  })
})

describe('sweetSpotPitch：往優勢上升的方向偏俯仰', () => {
  /**
   * 【為什麼不用 `DEFAULT_DOCTRINE`】出貨值的 `sweetSpotMaxPitch` 目前是 **0**
   * ——這一層在出貨路徑上是關著的（見該欄位的註解）。函式本身沒有變，
   * 也還有呼叫端，所以它的行為要繼續被釘住；用出貨值測會讓每一條都回 0，
   * 那不是「函式對了」，是「函式沒被叫到」。
   */
  const ON = { ...DEFAULT_DOCTRINE, sweetSpotMaxPitch: 10 * (Math.PI / 180) }

  it('鏡像對戰不偏', () => {
    expect(sweetSpotPitch(P, P, 4000, 450 * KMH, ON)).toBeCloseTo(0, 12)
  })

  // 【兩條的取樣速度換了，斷言的方向沒換】換邊的位置隨機種
  // 資料移動（見上方 sweetSpotAdvantage 那一條），所以取樣點要跟著移到
  // 新的劣勢區裡。函式的行為本身沒有變。
  it('P-51 太慢時低頭換速度', () => {
    // 450 km/h 落在 K-4 的優勢帶內，P-51 的出路是加速衝過 660 那個換號點
    // → 低頭 → 負。實測滿上界 −10.00°
    expect(sweetSpotPitch(P, B, 4000, 450 * KMH, ON)).toBeLessThan(0)
  })

  /**
   * 【為什麼用掃的而不是釘一個速度】K-4 只在**自己劣勢**時才需要換速度，
   * 而它的劣勢帶只有 660 km/h 以上那一小段（再高一點兩台都轉不動、偏置
   * 歸零）。實測 4,000 m：650 km/h 給 0.00°（還在自己的優勢區，不必動）、
   * 662 km/h 給 +9.83°。釘單點會變成調參地雷。
   */
  it('K-4 太快時抬頭換高度（減速）', () => {
    let found = false
    for (let v = 655; v <= 700; v += 1) {
      if (sweetSpotPitch(B, P, 4000, v * KMH, ON) > 0) { found = true; break }
    }
    expect(found, '高速帶內找不到 K-4 該抬頭的速度').toBe(true)
  })

  it('偏置不得超過上界', () => {
    for (const alt of [0, 4000, 8000]) {
      for (let kmh = 250; kmh <= 700; kmh += 10) {
        const p = Math.abs(sweetSpotPitch(P, B, alt, kmh * KMH, DEFAULT_DOCTRINE))
        expect(p).toBeLessThanOrEqual(ON.sweetSpotMaxPitch + 1e-12)
      }
    }
  })
})

/**
 * 三個迴轉候選挑一個。要模仿的動作是 ——
 * 「敵人如果在我的夾角超過 90 度⋯⋯轉向這件事情可能沒幫助，因為如果我迴旋後
 * 高度還比別人低，那我等於讓自己陷入 extend 地獄；除非敵人真的非常低（我付出
 * 代價也值得）才會用俯衝迴旋。」
 */
describe('turnPlanePitch：俯衝／水平／拉高，挑一個', () => {
  const DEG2 = Math.PI / 180
  const ALT = 3400
  const TAS = 188
  const LOS = 10 * DEG2

  /** 敵人在我下方 `below` 公尺、同速；回傳偏置（度，正 = 抬頭） */
  const bias = (swingDeg: number, below: number, cfg = DEFAULT_DOCTRINE) =>
    turnPlanePitch(B, ALT, TAS, swingDeg * DEG2, LOS, ALT - below, TAS, cfg) * (180 / Math.PI)

  /**
   * 【小角度自己就安靜 —— 這是「不需要角度門檻」的根據】三個候選在小夾角下
   * 幾乎同分，強度（最好 − 次好）於是趨近 0。實測夾角 15° 以內三者的能量差
   * 中位數是 0 公尺。
   */
  it('夾角很小時偏置趨近 0', () => {
    expect(Math.abs(bias(5, 0))).toBeLessThan(0.1)
    expect(Math.abs(bias(2, 0))).toBeLessThan(0.1)
  })

  it('夾角越大偏置越強', () => {
    const seq = [15, 30, 45, 60, 90].map((d) => Math.abs(bias(d, 0)))
    for (let i = 1; i < seq.length; i++) expect(seq[i]!).toBeGreaterThanOrEqual(seq[i - 1]!)
  })

  /** 【預設是拉高】敵人在同高度附近時，保住能量位置比較重要。 */
  it('敵人同高時大夾角給抬頭（拉高迴旋）', () => {
    expect(bias(90, 0)).toBeGreaterThan(1)
    expect(bias(120, 0)).toBeGreaterThan(1)
  })

  /**
   * 【俯衝是例外，要敵人夠低才划算】這一條就是原話的後半句。門檻沒有寫死在
   * 程式裡 —— 它是「轉完之後離想要的位置多遠」自己長出來的。
   */
  it('敵人低很多時大夾角翻成低頭（俯衝迴旋）', () => {
    expect(bias(90, 2000)).toBeLessThan(-1)
    expect(bias(120, 2000)).toBeLessThan(-1)
  })

  it('由拉高翻成俯衝是隨敵人的高度單調的', () => {
    const seq = [0, 500, 1000, 1500, 2000, 3000].map((d) => bias(90, d))
    for (let i = 1; i < seq.length; i++) expect(seq[i]!).toBeLessThanOrEqual(seq[i - 1]! + 1e-9)
  })

  it('偏置不得超過上界', () => {
    for (const sw of [10, 45, 90, 150]) {
      for (const below of [-2000, 0, 1000, 4000]) {
        expect(Math.abs(bias(sw, below)))
          .toBeLessThanOrEqual(DEFAULT_DOCTRINE.turnPlaneMaxPitch * (180 / Math.PI) + 1e-9)
      }
    }
  })

  /**
   * 【只剩一條路就給滿】舊版寫「沒得選就不出手」，那是反的 —— 沒得選正是
   * 最該出手的時候。
   *
   * 這一格是掃出來的實例：109 在 500 m、105 m/s、夾角 60°、視線角速度
   * 26°/s，只有俯衝轉得過去（低速時往下換速度會把轉彎率拉起來，水平與
   * 拉高都收斂不了）。舊版在這裡回 0 —— 明明只剩一條路卻不動。
   *
   * 【換了一格】原本的實例是 1000 m、110 m/s，同樣的夾角與
   * 視線角速度。K-4 多了 525 匹馬力，那一格的**三個候選全部變得可行**
   *（實測 [true, true, true]），於是不再是「只剩一條路」。這是取樣點
   * 失效，不是函式壞掉——重掃一次網格拿到上面那一格（高度與速度各降
   * 一階，夾角與視線角速度原封不動），斷言的內容一字未改。
   *
   * 【為什麼這個缺陷在護送關看不出來】那一場「只剩一個候選」時贏的都是水平
   * 迴旋，而水平迴旋的偏置本來就是 0。它被自己蓋住了。
   */
  it('只有一個候選可行時給滿偏置，不是回 0', () => {
    const only = [-1, 0, 1].map((k) =>
      Number.isFinite(turnPlaneCost(B, 500, 105, 60 * DEG2, 26 * DEG2,
        k * DEFAULT_DOCTRINE.turnPlaneGamma).seconds))
    expect(only).toEqual([true, false, false])   // 只有俯衝可行

    const b = turnPlanePitch(B, 500, 105, 60 * DEG2, 26 * DEG2, 500, 105, DEFAULT_DOCTRINE)
    expect(b).toBeCloseTo(-DEFAULT_DOCTRINE.turnPlaneMaxPitch, 12)
  })

  /** 【消融開關】上界 0 = 整層關掉。 */
  it('turnPlaneMaxPitch = 0 時恆為 0', () => {
    const off = { ...DEFAULT_DOCTRINE, turnPlaneMaxPitch: 0 }
    for (const sw of [5, 45, 90, 150]) expect(bias(sw, 1500, off)).toBe(0)
  })

  /** 非有限輸入不得產生 NaN —— 它會一路乘進瞄準點。 */
  it('非有限輸入回 0', () => {
    expect(turnPlanePitch(B, ALT, TAS, NaN, LOS, ALT, TAS, DEFAULT_DOCTRINE)).toBe(0)
    expect(turnPlanePitch(B, ALT, TAS, 1, NaN, ALT, TAS, DEFAULT_DOCTRINE)).toBe(0)
    expect(turnPlanePitch(B, ALT, 0, 1, LOS, ALT, TAS, DEFAULT_DOCTRINE)).toBe(0)
    expect(Number.isNaN(turnPlanePitch(B, ALT, TAS, 1, LOS, NaN, TAS, DEFAULT_DOCTRINE))).toBe(false)
  })

  /**
   * 【視線角速度超過轉彎率就收斂不了】這正是舊判準 `trackRatio > 1` 在問的
   * 事，在這個模型裡它是一個特例：三個候選全部回 `Infinity`。
   */
  it('轉不贏視線角速度時所有候選都做不到', () => {
    const fast = 90 * DEG2   // 90°/s，遠超過任何瞬時轉彎率
    for (const g of [-0.5, 0, 0.5]) {
      expect(Number.isFinite(turnPlaneCost(B, ALT, TAS, 1, fast, g).seconds)).toBe(false)
    }
    expect(turnPlanePitch(B, ALT, TAS, 1, fast, ALT, TAS, DEFAULT_DOCTRINE)).toBe(0)
  })

  /** 拉高迴旋會把速度往迴旋速度帶，所以它轉得比俯衝快 —— 那是它常勝的原因。 */
  it('高速時拉高迴旋比俯衝迴旋轉得快', () => {
    const g = DEFAULT_DOCTRINE.turnPlaneGamma
    const up = turnPlaneCost(B, ALT, TAS, 90 * DEG2, LOS, g)
    const down = turnPlaneCost(B, ALT, TAS, 90 * DEG2, LOS, -g)
    expect(up.seconds).toBeLessThan(down.seconds)
    expect(up.endEnergyAlt).toBeGreaterThan(down.endEnergyAlt)
  })
})
