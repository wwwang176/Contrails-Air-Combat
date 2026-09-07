import { describe, it, expect } from 'vitest'
import { createHudFrame, HUD_COLORS, type HudLayout } from '../../src/hud/types'
import { drawDials } from '../../src/hud/widgets/dials'

const LAYOUT: HudLayout = {
  width: 1280, height: 720, cx: 640, cy: 360, unit: 360, scale: 1,
}

/** 記下每一次 fillText 當時的 fillStyle —— 顏色是在畫字的那一刻決定的 */
function fakeCtx(): { ctx: CanvasRenderingContext2D; texts: Array<{ text: string; color: string }> } {
  const texts: Array<{ text: string; color: string }> = []
  const ctx = {
    font: '', textAlign: '', textBaseline: '',
    strokeStyle: '', fillStyle: '', lineWidth: 0, lineCap: '',
    beginPath(): void {}, closePath(): void {}, clip(): void {},
    moveTo(): void {}, lineTo(): void {}, stroke(): void {}, fill(): void {},
    fillRect(): void {}, strokeRect(): void {},
    fillText(text: string): void {
      texts.push({ text, color: String((this as unknown as { fillStyle: string }).fillStyle) })
    },
    save(): void {}, restore(): void {},
    translate(): void {}, rotate(): void {}, setTransform(): void {},
    arc(): void {},
  } as unknown as CanvasRenderingContext2D
  return { ctx, texts }
}

function tasColor(vneRatio: number): string {
  const f = createHudFrame()
  f.vneRatio = vneRatio
  const { ctx, texts } = fakeCtx()
  drawDials(ctx, LAYOUT, f)
  const line = texts.find((t) => t.text.startsWith('TAS '))
  expect(line).toBeDefined()
  return line!.color
}

/**
 * 速度錶的紅線警告，與失速警告同一組門檻（0.85 黃、0.95 紅）。
 * 0.85 是操縱面開始變重的點（`REDLINE_KNEE`），0.95 剩 22% 權限。
 */
describe('速度錶的紅線警告', () => {
  it('0.84 —— 沒事，維持暗色', () => {
    expect(tasColor(0.84)).toBe(HUD_COLORS.dim)
  })

  it('0.86 —— 黃', () => {
    expect(tasColor(0.86)).toBe(HUD_COLORS.warn)
  })

  it('0.96 —— 紅', () => {
    expect(tasColor(0.96)).toBe(HUD_COLORS.danger)
  })

  it('速度錶上面那行標籤不跟著變色', () => {
    const f = createHudFrame()
    f.vneRatio = 1.2
    const { ctx, texts } = fakeCtx()
    drawDials(ctx, LAYOUT, f)
    const label = texts.find((t) => t.text === 'IAS km/h')
    expect(label?.color).toBe(HUD_COLORS.dim)
  })
})
