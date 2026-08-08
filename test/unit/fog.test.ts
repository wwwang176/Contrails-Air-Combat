import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { createFog, fogFactor, FOG_COLOR, FOG_DENSITY } from '../../src/render/fog'
import { skyColorAt, SKY_HORIZON } from '../../src/render/sky'
import { CAMERA_FAR } from '../../src/render/scene'
import { FAR_SEA_SIZE, SEA_COLOR } from '../../src/render/ocean'

describe('fogFactor', () => {
  it('零距離沒有霧', () => {
    expect(fogFactor(0, FOG_DENSITY)).toBe(0)
  })

  it('隨距離單調遞增且不超過 1', () => {
    let prev = -1
    for (let d = 0; d <= 400_000; d += 5_000) {
      const f = fogFactor(d, FOG_DENSITY)
      expect(f).toBeGreaterThanOrEqual(prev)
      expect(f).toBeLessThanOrEqual(1)
      prev = f
    }
  })
})

/**
 * 【這一組把設計意圖變成會紅的東西】
 *
 * 密度是一個數字，而它同時決定三件相互拉扯的事：纏鬥距離內顏色不失真、
 * 上帝視角看得到整個戰場、遠海的邊緣化得掉。只斷言「有霧」的話，這三個
 * 後果沒有任何一個被守住 —— 有人為了讓遠方更朦朧把密度加十倍，近處的
 * 敵機會一起變灰，而沒有東西會紅。
 */
describe('霧的濃度落在設計意圖上', () => {
  it('5 km（纏鬥距離）幾乎沒有霧', () => {
    expect(fogFactor(5_000, FOG_DENSITY)).toBeLessThan(0.01)
  })

  it('30 km（上帝視角的全戰場）開始化開但仍看得清楚', () => {
    const f = fogFactor(30_000, FOG_DENSITY)
    expect(f).toBeGreaterThan(0.10)
    expect(f).toBeLessThan(0.25)
  })

  it('遠海邊緣完全化進霧色（才不會看到硬邊）', () => {
    expect(fogFactor(FAR_SEA_SIZE / 2, FOG_DENSITY)).toBeGreaterThan(0.999)
  })
})

/** three 工作色彩空間下的 HSL 明度。 */
const lightness = (c: Color): number => c.getHSL({ h: 0, s: 0, l: 0 }).l

/**
 * 【這一組守的是需求本身，不是實作細節】專案負責人的原話是「遠方可以考慮
 * FOG，但是要看得出地平線」。霧色若等於地平線上的天空色，遠海化進霧色之後
 * 就與天空同色 —— 地平線消失，而畫面上不會有任何錯誤。
 *
 * 【比的是 `skyColorAt(0)` 不是 `SKY_HORIZON`】初版比錯了對象。天空著色器
 * 的 `t = dirY × 0.5 + 0.5`，地平線（`dirY = 0`）落在漸層的**正中間**，
 * 實際看到的是 `#6788a7`（L 0.261）；`SKY_HORIZON`（`#9fc3d8`，L 0.517）
 * 只出現在正下方、被海擋著，畫面上永遠不會出現。當時的霧色 L 0.380 因此
 * 比天空**亮**，而測試照樣綠 —— 專案負責人在試飛時一眼看出來。
 */
describe('地平線要看得出來', () => {
  it('霧色比**地平線上的**天空色暗', () => {
    const sky = skyColorAt(0, new Color())
    expect(lightness(FOG_COLOR)).toBeLessThan(lightness(sky))
  })

  it('暗的幅度看得出來（不是差幾個位元）', () => {
    const sky = skyColorAt(0, new Color())
    expect(lightness(sky) - lightness(FOG_COLOR)).toBeGreaterThan(0.05)
  })

  /**
   * 【另一頭也要守】霧色若暗到接近海的基本色，遠處的海與近處的海就一樣暗
   * —— 霧的深度感整個不見，而地平線那一階反而更明顯。兩件事互相拉扯，
   * 所以兩頭都要有斷言。
   */
  it('霧色仍然比近處的海亮（深度感靠這個差）', () => {
    expect(lightness(FOG_COLOR)).toBeGreaterThan(lightness(new Color(SEA_COLOR)) + 0.05)
  })

  it('`SKY_HORIZON` 這個常數本身並不出現在地平線上', () => {
    // 這一條記錄的是上面那個錯誤本身 —— 有人日後想「直接比 SKY_HORIZON
    // 不是更簡單嗎」，這裡有現成的反證。
    const atHorizon = skyColorAt(0, new Color())
    expect(lightness(atHorizon)).toBeLessThan(lightness(new Color(SKY_HORIZON)) - 0.2)
  })
})

describe('createFog', () => {
  it('用的是設計值', () => {
    const f = createFog()
    expect(f.density).toBe(FOG_DENSITY)
    // 【比 r/g/b 不比 getHex】FOG_COLOR 已經在工作色彩空間裡，getHex 會轉回
    // sRGB 並量化成 8 bit，來回一趟不保證逐位元相同。
    expect(f.color.r).toBeCloseTo(FOG_COLOR.r, 6)
    expect(f.color.g).toBeCloseTo(FOG_COLOR.g, 6)
    expect(f.color.b).toBeCloseTo(FOG_COLOR.b, 6)
  })

  it('回傳的是複本，改它不會汙染 FOG_COLOR', () => {
    const before = FOG_COLOR.clone()
    createFog().color.setRGB(1, 0, 0)
    expect(FOG_COLOR.r).toBe(before.r)
    expect(FOG_COLOR.g).toBe(before.g)
    expect(FOG_COLOR.b).toBe(before.b)
  })
})

/**
 * 遠平面若小於遠海的半邊，遠海的四個角會被裁掉 —— 而被裁掉的邊緣就是這
 * 一整件事正要消除的那條硬邊。
 */
describe('相機遠平面容得下遠海', () => {
  it('遠平面大於遠海的半對角線', () => {
    // 【要比半對角線不是半邊】方形的角比邊遠 √2 倍，而視野掃得到角
    expect(CAMERA_FAR).toBeGreaterThan((FAR_SEA_SIZE / 2) * Math.SQRT2)
  })
})
