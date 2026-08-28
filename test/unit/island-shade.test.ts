import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import {
  isGrass, shade, GRASS_MIN_HEIGHT, ROCK_FRACTION,
} from '../../src/render/island'

const c = new Color()

/**
 * 島上的植被判準。
 *
 * 【為什麼要有這一組】`render/flora.ts` 要決定樹長在哪裡，而唯一說得過去的
 * 判準是「長在看起來是草的地方」。判準與地的顏色若是兩份，就會出現樹長在
 * 沙灘上或裸岩上 —— 而那兩者在畫面上一眼就是錯的。
 *
 * 【坡度不能當判準】實測群島的島很陡：草帶 16.24 km² 裡，坡度 20° 以內只有
 * 0.60 km²（3.7%），最大兩座島的平均坡是 29.5° 與 32.7°。用坡度篩會砍掉
 * 95% 的地。坡度只用來壓密度。
 */
describe('島上的草帶', () => {
  it('isGrass 與 shade 對同一個高度給同一個答案', () => {
    const grassHex = shade(GRASS_MIN_HEIGHT + 1, 1000, c).getHex()
    let checked = 0
    for (const peak of [100, 350, 900]) {
      for (let h = 0; h < peak; h += peak / 400) {
        expect(isGrass(h, peak)).toBe(shade(h, peak, c).getHex() === grassHex)
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
    expect(isGrass(20, 900)).toBe(true)
    expect(isGrass(150, 900)).toBe(true)
    expect(isGrass(11, 900)).toBe(false)
  })

  it('沙灘與裸岩都不是草', () => {
    expect(isGrass(0, 800)).toBe(false)
    expect(isGrass(11.9, 800)).toBe(false)
    expect(isGrass(800 * ROCK_FRACTION, 800)).toBe(false)
    expect(isGrass(799, 800)).toBe(false)
  })

  it('峰高低到草帶消失時，isGrass 恆為假', () => {
    // peak × ROCK_FRACTION ≤ GRASS_MIN_HEIGHT 的島沒有草帶
    const peak = GRASS_MIN_HEIGHT / ROCK_FRACTION
    for (let h = 0; h < peak; h += 0.5) expect(isGrass(h, peak)).toBe(false)
  })

  it('shade 的三段是硬分界，不漸層', () => {
    // low-poly 的面就是要看得出來 —— 相鄰兩個高度只會落在三個顏色上
    const seen = new Set<number>()
    for (let h = 0; h < 1000; h += 0.5) seen.add(shade(h, 1000, c).getHex())
    expect(seen.size).toBe(3)
  })
})
