import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { createFog, fogFactor, FOG_COLOR, FOG_DENSITY } from '../../src/render/fog'
import { SKY_HORIZON } from '../../src/render/sky'
import { CAMERA_FAR } from '../../src/render/scene'
import { FAR_SEA_SIZE } from '../../src/render/ocean'

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

/**
 * 【這一組守的是需求本身，不是實作細節】專案負責人的原話是「遠方可以考慮
 * FOG，但是要看得出地平線」。霧色若等於天空的地平色，遠海化進霧色之後就與
 * 天空完全同色 —— 地平線消失，而畫面上不會有任何錯誤，也不會有任何測試紅。
 */
describe('地平線要看得出來', () => {
  it('霧色與天空的地平色不是同一個值', () => {
    expect(FOG_COLOR).not.toBe(SKY_HORIZON)
  })

  it('霧色比天空的地平色暗', () => {
    const fog = new Color(FOG_COLOR).getHSL({ h: 0, s: 0, l: 0 })
    const sky = new Color(SKY_HORIZON).getHSL({ h: 0, s: 0, l: 0 })
    expect(fog.l).toBeLessThan(sky.l)
  })
})

describe('createFog', () => {
  it('用的是設計值', () => {
    const f = createFog()
    expect(f.density).toBe(FOG_DENSITY)
    expect(f.color.getHex()).toBe(FOG_COLOR)
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
