import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fillStickHud } from '../../src/app/battleFlightHud'
import { STICK_BOX_HALF, STICK_DOT_RADIUS, drawReticle } from '../../src/hud/widgets/reticle'
import { hintKeys } from '../../src/hud/widgets/hints'
import { createHudFrame, HUD_COLORS, type HudLayout } from '../../src/hud/types'
import { createInputState } from '../../src/input/InputState'
import { zh } from '../../src/i18n/zh'
import { en } from '../../src/i18n/en'

const LAYOUT: HudLayout = { width: 1280, height: 720, cx: 640, cy: 360, unit: 360, scale: 1.5 }

/** 記下每一個圓（中心、半徑）與它是描邊還是填滿、用什麼顏色，以及描邊的方框 */
function fakeCtx() {
  const arcs: { x: number; y: number; r: number; how: 'stroke' | 'fill' | '?'; color: string }[] = []
  const rects: { x: number; y: number; w: number; h: number }[] = []
  let pending: { x: number; y: number; r: number }[] = []
  const ctx = {
    strokeStyle: '', fillStyle: '', lineWidth: 0, globalAlpha: 1,
    beginPath(): void { pending = [] },
    moveTo(): void {}, lineTo(): void {}, closePath(): void {}, setLineDash(): void {},
    arc(x: number, y: number, r: number): void { pending.push({ x, y, r }) },
    strokeRect(x: number, y: number, w: number, h: number): void { rects.push({ x, y, w, h }) },
    stroke(): void { for (const a of pending) arcs.push({ ...a, how: 'stroke', color: String(ctx.strokeStyle) }) },
    fill(): void { for (const a of pending) arcs.push({ ...a, how: 'fill', color: String(ctx.fillStyle) }) },
  } as unknown as CanvasRenderingContext2D & { strokeStyle: string; fillStyle: string }
  return { ctx, arcs, rects }
}

function stickFrame(x: number, y: number, alpha = 0) {
  const f = createHudFrame()
  f.stickMode = true
  f.stickX = x
  f.stickY = y
  f.aimVisible = false
  f.noseVisible = true
  f.alphaCrit = 1
  f.alpha = alpha
  return f
}

describe('fillStickHud：搖桿寫進 HUD 幀', () => {
  it('滑鼠搖桿：顯示搖桿、藏滑鼠圓圈、位置照抄', () => {
    const f = createHudFrame()
    f.aimVisible = true
    const input = createInputState()
    input.stickActive = true
    input.stickX = 0.3
    input.stickY = -0.6
    fillStickHud(f, input)
    expect(f.stickMode).toBe(true)
    expect(f.aimVisible).toBe(false)
    expect([f.stickX, f.stickY]).toEqual([0.3, -0.6])
  })

  it('滑鼠瞄準：不顯示搖桿，滑鼠圓圈照舊', () => {
    const f = createHudFrame()
    f.aimVisible = true
    fillStickHud(f, createInputState())
    expect(f.stickMode).toBe(false)
    expect(f.aimVisible).toBe(true)
  })

  /** 【代飛與上帝視角不畫搖桿】那時搖桿不在飛這架飛機 */
  it('代飛、上帝視角：不顯示搖桿，滑鼠圓圈也不畫', () => {
    for (const k of ['playerAi', 'godView'] as const) {
      const f = createHudFrame()
      f.aimVisible = true
      const input = createInputState()
      input.stickActive = true
      input[k] = true
      fillStickHud(f, input)
      expect(f.stickMode, k).toBe(false)
      expect(f.aimVisible, k).toBe(false)
    }
  })

  it('接上：updateBattleFlightHud 在投影瞄準點之後呼叫它', () => {
    const src = readFileSync('src/app/battleFlightHud.ts', 'utf8')
    const at = src.indexOf('fillStickHud(hudFrame, input)')
    expect(at).toBeGreaterThan(src.indexOf('hudFrame.aimVisible = probe.z < 1'))
  })
})

describe('搖桿指示', () => {
  it('中央一個方框；點在搖桿位置（上為正，畫面 y 往下）', () => {
    const c = fakeCtx()
    drawReticle(c.ctx, LAYOUT, stickFrame(0.5, -0.5))
    const H = STICK_BOX_HALF * LAYOUT.scale
    expect(c.rects).toEqual([{ x: LAYOUT.cx - H, y: LAYOUT.cy - H, w: 2 * H, h: 2 * H }])
    const dot = c.arcs.find((a) => a.how === 'fill' && a.r === STICK_DOT_RADIUS * LAYOUT.scale)
    expect(dot).toBeDefined()
    expect(dot!.x).toBeCloseTo(LAYOUT.cx + 0.5 * H, 9)
    expect(dot!.y).toBeCloseTo(LAYOUT.cy + 0.5 * H, 9)
  })

  /** 斜推到底的點落在方框的角上，不跑出框外 */
  it('滿桿斜推：點在方框右上角', () => {
    const c = fakeCtx()
    drawReticle(c.ctx, LAYOUT, stickFrame(1, 1))
    const H = STICK_BOX_HALF * LAYOUT.scale
    const dot = c.arcs.find((a) => a.how === 'fill')!
    expect([dot.x, dot.y]).toEqual([LAYOUT.cx + H, LAYOUT.cy - H])
  })

  it('不畫滑鼠圓圈（半徑 11 的那一個）', () => {
    const c = fakeCtx()
    drawReticle(c.ctx, LAYOUT, stickFrame(0, 0))
    expect(c.arcs.some((a) => a.r === 11 * LAYOUT.scale)).toBe(false)
  })

  /** 【點接手圓圈的失速警示】滑鼠瞄準下是圓圈變色，搖桿下沒有圓圈 */
  it('點的顏色：平常綠、接近失速黃、再近紅', () => {
    const colorAt = (alpha: number) => {
      const c = fakeCtx()
      drawReticle(c.ctx, LAYOUT, stickFrame(0.2, 0.2, alpha))
      return c.arcs.find((a) => a.how === 'fill')!.color
    }
    expect(colorAt(0.5)).toBe(HUD_COLORS.primary)
    expect(colorAt(0.9)).toBe(HUD_COLORS.warn)
    expect(colorAt(0.97)).toBe(HUD_COLORS.danger)
  })

  it('不是搖桿模式就不畫', () => {
    const c = fakeCtx()
    const f = createHudFrame()
    f.alphaCrit = 1
    drawReticle(c.ctx, LAYOUT, f)
    expect(c.rects).toEqual([])
    expect(c.arcs.some((a) => a.how === 'fill')).toBe(false)
  })
})

describe('按鍵提示', () => {
  it('滑鼠搖桿多一項 A/D 方向舵；上帝視角照舊', () => {
    expect(hintKeys(false, true)).toBe('hud.keysStick')
    expect(hintKeys(false, false)).toBe('hud.keys')
    expect(hintKeys(true, true)).toBe('hud.godKeys')
    for (const table of [zh, en]) {
      expect(table['hud.keysStick']).toContain('A/D')
      expect(table['hud.keysStick']).toContain('W/S')
    }
  })
})
