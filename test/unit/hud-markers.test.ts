import { describe, it, expect } from 'vitest'
import {
  MARKER_GAP, MARKER_HALF, MARKER_HEIGHT, markerPath,
} from '../../src/hud/widgets/markers'
import { HUD_COLORS, contactColor, createHudMarker } from '../../src/hud/types'

/**
 * # 倒三角形標記的幾何
 *
 * 【為什麼抽成純函數】繪製函數在 node 環境驗不到，而「三角形是不是倒的」
 * 與「尖端有沒有對準物體」是兩條真的會壞、壞了又只能靠眼睛看的性質 ——
 * 與 `edgeIndicatorPosition`、`minimapSymbol` 同一個做法。
 */

/** 三個頂點寫進這裡：x0,y0（尖端）、x1,y1（左上）、x2,y2（右上）。 */
const P = new Float64Array(6)

describe('markerPath', () => {
  /**
   * 【畫布 y 往下為正】所以「倒三角形」＝尖端的 y **大於**上緣兩點的 y。
   * 寫反的話畫出來是一個正三角形，指向物體的上方 —— 而那裡什麼都沒有。
   */
  it('是倒的：尖端在下、上緣兩點在上', () => {
    markerPath(100, 200, 1, P)
    const tipY = P[1]!
    expect(tipY).toBeGreaterThan(P[3]!)
    expect(tipY).toBeGreaterThan(P[5]!)
    expect(P[3]).toBe(P[5])
  })

  /**
   * 【尖端在物體上方留一個空隙】貼死在物體上的話，符號會把炸彈那種只有
   * 幾個像素的東西整個蓋掉 —— 標記反而變成遮蔽物。
   */
  it('尖端在物體上方 MARKER_GAP，不是壓在它身上', () => {
    markerPath(100, 200, 1, P)
    expect(P[0]).toBe(100)
    expect(P[1]).toBe(200 - MARKER_GAP)
  })

  it('本體從尖端往上長 MARKER_HEIGHT、寬 2×MARKER_HALF', () => {
    markerPath(100, 200, 1, P)
    expect(P[3]).toBe(200 - MARKER_GAP - MARKER_HEIGHT)
    expect(P[2]).toBe(100 - MARKER_HALF)
    expect(P[4]).toBe(100 + MARKER_HALF)
  })

  /**
   * 【尺寸跟著 scale，位置不跟】x/y 進來時已經是 CSS px（呼叫端乘過
   * `L.unit`）。把位置也乘一次 scale 會讓標記在高解析度視窗上飄離物體。
   */
  it('只有尺寸吃 scale，位置不吃', () => {
    markerPath(100, 200, 2, P)
    expect(P[0]).toBe(100)
    expect(P[1]).toBe(200 - MARKER_GAP * 2)
    expect(P[3]).toBe(200 - (MARKER_GAP + MARKER_HEIGHT) * 2)
    expect(P[2]).toBe(100 - MARKER_HALF * 2)
  })
})

describe('標記的顏色', () => {
  /**
   * 【第三個參數固定 false】分隊只對飛機有意義 —— 一顆炸彈不屬於任何
   * Schwarm。走 `contactColor` 而不是自己寫三元式，是因為 M6 改色時
   * 目標框改了、小地圖沒改。
   */
  it('同隊藍、敵對紅', () => {
    expect(contactColor(false, false)).toBe(HUD_COLORS.friendly)
    expect(contactColor(true, false)).toBe(HUD_COLORS.danger)
  })
})

describe('createHudMarker', () => {
  /** 【預設 active=false】池是固定長度的，沒被填到的那幾格不能畫。 */
  it('開出來是空的一格', () => {
    const m = createHudMarker()
    expect(m.active).toBe(false)
    expect(m.behind).toBe(false)
  })
})
