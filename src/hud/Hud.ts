import { drawContacts } from './widgets/contacts'
import { drawDials } from './widgets/dials'
import { drawEnergy } from './widgets/energy'
import { drawGEffect } from './widgets/gEffect'
import { drawHealth } from './widgets/health'
import { drawHints } from './widgets/hints'
import { drawMinimap } from './widgets/minimap'
import { drawReticle } from './widgets/reticle'
import { drawHeadingTape } from './widgets/tape'
import type { HudFrame, HudLayout } from './types'

export class Hud {
  private readonly ctx: CanvasRenderingContext2D
  private readonly layout: HudLayout = { width: 0, height: 0, cx: 0, cy: 0, unit: 0, scale: 1 }

  constructor(private readonly canvas: HTMLCanvasElement) {
    const c = canvas.getContext('2d')
    if (!c) throw new Error('無法取得 HUD 的 2D context')
    this.ctx = c
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio, 2)
    const w = window.innerWidth
    const h = window.innerHeight
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const L = this.layout
    L.width = w
    L.height = h
    L.cx = w / 2
    L.cy = h / 2
    L.unit = h / 2
    L.scale = Math.max(0.75, Math.min(1.4, h / 900))
  }

  render(f: HudFrame, dt: number): void {
    const { ctx, layout: L } = this
    ctx.clearRect(0, 0, L.width, L.height)
    // 黑視/紅視先畫，其餘 HUD 元件疊在上面維持可讀
    drawGEffect(ctx, L, f, dt)
    // 接觸點畫在準星底下——準星必須壓在最上層
    drawContacts(ctx, L, f)
    drawReticle(ctx, L, f)
    drawHeadingTape(ctx, L, f)
    drawDials(ctx, L, f)
    drawMinimap(ctx, L, f)
    drawHealth(ctx, L, f)
    drawEnergy(ctx, L, f)
    drawHints(ctx, L, f)
  }
}
