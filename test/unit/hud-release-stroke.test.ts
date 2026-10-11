import { describe, it, expect } from 'vitest'
import { createHudFrame, type HudLayout } from '../../src/hud/types'
import { drawBombsight } from '../../src/hud/widgets/bombsight'
import { drawTorpedoLine } from '../../src/hud/widgets/torpedoLine'
import { CIRCLE_WIDTH } from '../../src/hud/widgets/reticle'
import { TORPEDO_RUN_SAMPLES } from '../../src/world/torpedo'

/** scale 不是 1，才分得出有沒有乘 */
const LAYOUT: HudLayout = {
  width: 1280, height: 720, cx: 640, cy: 360, unit: 360, scale: 1.5,
}

function fakeCtx() {
  const strokes: number[] = []
  const fonts: string[] = []
  const ctx = {
    font: '', textAlign: '', textBaseline: '',
    strokeStyle: '', fillStyle: '', lineWidth: 0,
    beginPath(): void {}, moveTo(): void {}, lineTo(): void {}, arc(): void {}, fill(): void {},
    stroke(): void { strokes.push(ctx.lineWidth) },
    fillText(): void { fonts.push(ctx.font) },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes, fonts }
}

describe('投彈圈與魚雷航跡線的線寬', () => {
  it('投彈圈與準星的圓一樣粗', () => {
    const f = createHudFrame()
    f.bombing = true
    f.bombState = 'solved'
    f.bombVisible = true
    const { ctx, strokes } = fakeCtx()
    drawBombsight(ctx, LAYOUT, f)
    expect(strokes).toEqual([CIRCLE_WIDTH * LAYOUT.scale])
  })

  it('航跡線與準星的圓一樣粗；刻度與射程數字不加粗', () => {
    const f = createHudFrame()
    f.bombing = true
    f.ordnance = 'torpedo'
    f.bombState = 'solved'
    f.releaseOk = true
    f.runCount = TORPEDO_RUN_SAMPLES
    for (let k = 0; k < TORPEDO_RUN_SAMPLES; k++) {
      f.runX[k] = 0
      f.runY[k] = -0.4 + (0.8 * k) / (TORPEDO_RUN_SAMPLES - 1)
    }
    const { ctx, strokes, fonts } = fakeCtx()
    drawTorpedoLine(ctx, LAYOUT, f)
    expect(strokes[0]).toBe(CIRCLE_WIDTH * LAYOUT.scale)
    expect(strokes.length).toBe(TORPEDO_RUN_SAMPLES)
    for (const w of strokes.slice(1)) expect(w).toBe(1 * LAYOUT.scale)
    expect(fonts.length).toBe(1)
    expect(fonts[0]).not.toContain('bold')
  })
})
