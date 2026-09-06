import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { isGrass, shade, CANOPY, GRASS_MIN_HEIGHT } from '../../src/render/island'

const c = new Color()

/**
 * 島上的植被判準。
 *
 * 【為什麼要有這一組】`render/flora.ts` 要決定樹長在哪裡，而唯一說得過去的
 * 判準是「長在看起來是草的地方」。判準與地的顏色若是兩份，就會出現樹長在
 * 沙灘上 —— 而那在畫面上一眼就是錯的。
 *
 * 【坡度不能當判準】實測群島的島很陡：草帶 16.24 km² 裡，坡度 20° 以內只有
 * 0.60 km²（3.7%），最大兩座島的平均坡是 29.5° 與 32.7°。用坡度篩會砍掉
 * 95% 的地。坡度只用來壓密度。
 */
describe('島上的草帶', () => {
  it('isGrass 與 shade 對同一個高度給同一個答案', () => {
    const grassHex = shade(GRASS_MIN_HEIGHT + 1, 0, c).getHex()
    let checked = 0
    for (const top of [100, 350, 900]) {
      for (let h = 0; h < top; h += top / 400) {
        expect(isGrass(h)).toBe(shade(h, 0, c).getHex() === grassHex)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })

  /**
   * 【這一條擋的是拿錯常數】`world/archipelago.ts` 也有一個 `SHORE_BAND`，
   * 值是 **200**（烘岸用的距離），而顏色分帶這一個是 **12**。同名不同義，
   * 拿錯完全不報錯 —— 症狀是 12～200 m 的大片綠帶光禿，樹只剩山頂上有。
   *
   * 所以顏色分帶那一個已經改名成 `GRASS_MIN_HEIGHT`，而這一條把值釘死。
   */
  it('草帶的下界是 12，不是 200', () => {
    expect(GRASS_MIN_HEIGHT).toBe(12)
    expect(isGrass(20)).toBe(true)
    expect(isGrass(150)).toBe(true)
    expect(isGrass(11)).toBe(false)
  })

  /**
   * 【山頂是綠的】草帶沒有上界。把峰高一半以上塗成裸岩色的話，每一座島的
   * 上半截都是土色、樹也長不上去。
   */
  it('沙灘不是草，而山頂是', () => {
    expect(isGrass(0)).toBe(false)
    expect(isGrass(11.9)).toBe(false)
    expect(isGrass(400)).toBe(true)
    expect(isGrass(999)).toBe(true)
    expect(shade(999, 0, c).getHex()).toBe(shade(GRASS_MIN_HEIGHT, 0, c).getHex())
  })


  /**
   * 【為什麼地要先帶上林相】`FLORA_RADIUS` 外一棵樹都不畫，而地色比樹冠亮
   * 很多 —— 飛進圈的瞬間整座島同時變暗變花，那就是試飛回報的「突然長出來」。
   * 地先按實際被遮住的面積比調暗，樹進圈只是加上質感。
   */
  it('覆蓋率愈高地色愈暗，而且往樹冠色靠', () => {
    const bare = shade(400, 0, c).getHex()
    expect(shade(400, 0.35, c).getHex()).not.toBe(bare)
    // 全覆蓋就是樹冠色本身
    expect(shade(400, 1, c).getHex()).toBe(CANOPY.getHex())
    // 亮度單調遞減
    let prev = 999
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      const l = shade(400, k, c).getHSL({ h: 0, s: 0, l: 0 }).l
      expect(l).toBeLessThan(prev)
      prev = l
    }
  })

  it('沙灘不吃覆蓋率', () => {
    // 樹長不到沙灘上，那一段的顏色不得被覆蓋率動到
    expect(shade(5, 1, c).getHex()).toBe(shade(5, 0, c).getHex())
  })

  it('覆蓋率超出 0～1 也夾得住', () => {
    expect(shade(400, -1, c).getHex()).toBe(shade(400, 0, c).getHex())
    expect(shade(400, 9, c).getHex()).toBe(shade(400, 1, c).getHex())
  })

  it('shade 的兩段是硬分界，不漸層', () => {
    // low-poly 的面就是要看得出來 —— 相鄰兩個高度只會落在兩個顏色上
    const seen = new Set<number>()
    for (let h = 0; h < 1000; h += 0.5) seen.add(shade(h, 0, c).getHex())
    expect(seen.size).toBe(2)
  })
})
