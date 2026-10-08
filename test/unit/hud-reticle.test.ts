import { describe, it, expect } from 'vitest'
import { drawReticle } from '../../src/hud/widgets/reticle'
import { createHudFrame, HUD_COLORS, type HudLayout } from '../../src/hud/types'

/**
 * 飛機準星（十字）照前機槍的熱度變色，過熱時閃爍（SPEC `2026-10-08-gun-overheat-design.md`）。
 * 圓形準星與命中 X 不受影響。
 */
const LAYOUT: HudLayout = { width: 1280, height: 720, cx: 640, cy: 360, unit: 360, scale: 1 }

/** 記下每一次 stroke 的顏色與那一筆的 moveTo 數 —— 十字是四筆 moveTo 一次 stroke */
function fakeCtx() {
  const strokes: { color: string; moves: number }[] = []
  let moves = 0
  const ctx = {
    strokeStyle: '', fillStyle: '', lineWidth: 0, globalAlpha: 1,
    beginPath(): void { moves = 0 },
    moveTo(): void { moves++ },
    lineTo(): void {}, arc(): void {}, closePath(): void {}, fill(): void {}, setLineDash(): void {},
    stroke(): void { strokes.push({ color: String(ctx.strokeStyle), moves }) },
  } as unknown as CanvasRenderingContext2D & { strokeStyle: string }
  return { ctx, strokes }
}

function frame(heat: 'cool' | 'warn' | 'hot', blink = true) {
  const f = createHudFrame()
  f.noseVisible = true
  f.aimVisible = true
  f.alphaCrit = 1
  f.gunHeat = heat
  f.gunHeatBlink = blink
  return f
}

/** 十字那一筆：四段線、一次 stroke */
const cross = (s: { color: string; moves: number }[]) => s.filter((x) => x.moves === 4)

describe('十字準星與前機槍熱度', () => {
  it('冷：綠；熱：黃；過熱：紅', () => {
    for (const [heat, color] of [['cool', HUD_COLORS.primary], ['warn', HUD_COLORS.warn], ['hot', HUD_COLORS.danger]] as const) {
      const c = fakeCtx()
      drawReticle(c.ctx, LAYOUT, frame(heat))
      expect(cross(c.strokes).map((s) => s.color), heat).toEqual([color])
    }
  })

  it('過熱時閃爍：暗的那一幀不畫十字；冷與熱不閃', () => {
    const off = fakeCtx()
    drawReticle(off.ctx, LAYOUT, frame('hot', false))
    expect(cross(off.strokes)).toHaveLength(0)
    for (const heat of ['cool', 'warn'] as const) {
      const c = fakeCtx()
      drawReticle(c.ctx, LAYOUT, frame(heat, false))
      expect(cross(c.strokes), heat).toHaveLength(1)
    }
  })

  it('圓形準星不受熱度影響', () => {
    const c = fakeCtx()
    drawReticle(c.ctx, LAYOUT, frame('hot'))
    // 圓是第一筆（moveTo 0 次、一個 arc）
    expect(c.strokes[0]!.moves).toBe(0)
    expect(c.strokes[0]!.color).toBe(HUD_COLORS.primary)
  })
})
