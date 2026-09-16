import { describe, it, expect } from 'vitest'
import {
  drawCachedLayer, LAYER_ORIGIN, LOW_RATE, LOW_RATE_PHASE, newLayerCache,
} from '../../src/hud/widgets/layerCache'
import type { HudLayout } from '../../src/hud/types'

const LAYOUT: HudLayout = {
  width: 1280, height: 720, cx: 640, cy: 360, unit: 360, scale: 1,
}

describe('低頻更新的設定', () => {
  it('降頻要真的降：至少兩幀才重畫一次', () => {
    expect(LOW_RATE).toBeGreaterThanOrEqual(2)
  })

  /**
   * 【這一條在擋什麼】兩個元件的相位如果同餘，它們會在同一幀一起重畫，
   * 變成一幀重、一幀輕的交替 —— 那是週期性慢幀，比不降頻還糟。
   */
  it('姿態盤與地圖不在同一幀重畫', () => {
    const phases = Object.values(LOW_RATE_PHASE).map((p) => ((p % LOW_RATE) + LOW_RATE) % LOW_RATE)
    expect(new Set(phases).size).toBe(phases.length)
  })
})

describe('drawCachedLayer 在沒有 canvas 的環境', () => {
  /**
   * node 裡沒有 `document`，離屏畫布造不出來。那時**必須原地畫**：
   * 退路壞掉的話這裡不會紅，但所有用假 ctx 驗繪圖內容的 HUD 測試會一起失去意義。
   */
  it('原地畫，而且拿到的就是傳進去的 ctx', () => {
    const cache = newLayerCache()
    const ctx = {} as CanvasRenderingContext2D
    const got: CanvasRenderingContext2D[] = []
    for (let i = 0; i < 3; i++) {
      drawCachedLayer(ctx, LAYOUT, cache, { x: 10, y: 20, w: 100, h: 80 }, LOW_RATE, 0, (c) => {
        got.push(c)
      })
    }
    expect(got).toHaveLength(3)
    expect(got.every((c) => c === ctx)).toBe(true)
  })
})

describe('LAYER_ORIGIN', () => {
  /**
   * 不在離屏層裡時必須是 0 —— `dials.ts` 的 `drawFace` 每幀拿它去扣貼圖位置，
   * 殘留非 0 的話盤面會整個偏移出畫面。
   */
  it('平常是原點', () => {
    expect(LAYER_ORIGIN.x).toBe(0)
    expect(LAYER_ORIGIN.y).toBe(0)
  })
})
