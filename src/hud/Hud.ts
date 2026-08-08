import { drawContacts } from './widgets/contacts'
import { drawDamageEdge } from './widgets/damageEdge'
import { drawDials } from './widgets/dials'
import { drawEnergy } from './widgets/energy'
import { drawGEffect } from './widgets/gEffect'
import { drawHealth } from './widgets/health'
import { drawHints } from './widgets/hints'
import { drawMinimap } from './widgets/minimap'
import { drawReticle } from './widgets/reticle'
import { drawRoster } from './widgets/roster'
import { drawHeadingTape } from './widgets/tape'
import type { HudFrame, HudLayout } from './types'

export type HudWidget =
  | 'gEffect' | 'damageEdge' | 'contacts' | 'reticle' | 'tape'
  | 'dials' | 'minimap' | 'health' | 'energy' | 'roster' | 'hints'

/**
 * 一般飛行的繪製順序。**順序有意義**：
 * 黑視／紅視先畫，其餘 HUD 元件疊在上面維持可讀；受擊方向壓在世界上面、
 * 儀表與數字之下；接觸點畫在準星底下 —— 準星必須壓在最上層。
 */
const FULL: readonly HudWidget[] = [
  'gEffect', 'damageEdge', 'contacts', 'reticle', 'tape',
  'dials', 'minimap', 'health', 'energy', 'roster', 'hints',
]

/**
 * 上帝視角只畫這三個。
 *
 * 其餘（姿態儀、速度高度帶、準星、過載黑視、受擊邊框、儀表、血條、能量、
 * 接觸點）全部是**座艙儀表** —— 鏡頭都不在飛機上了，留著只是雜訊，而
 * **準星更是直接誤導**：它會讓人以為那個方向會有子彈出去。
 */
const GOD: readonly HudWidget[] = ['minimap', 'roster', 'hints']

/**
 * 這一幀要畫哪些 widget，依序。
 *
 * 【為什麼是純函數】canvas 在 node 環境驗不到，而「準星在上帝視角下絕不
 * 出現」是一條真的會壞、壞了又很難察覺的性質。抽出來就驗得到，順帶把
 * 繪製順序也釘進測試裡。
 */
export function hudWidgets(godView: boolean): readonly HudWidget[] {
  return godView ? GOD : FULL
}

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
    for (const w of hudWidgets(f.godView)) {
      switch (w) {
        case 'gEffect': drawGEffect(ctx, L, f, dt); break
        case 'damageEdge': drawDamageEdge(ctx, L, f); break
        case 'contacts': drawContacts(ctx, L, f); break
        case 'reticle': drawReticle(ctx, L, f); break
        case 'tape': drawHeadingTape(ctx, L, f); break
        case 'dials': drawDials(ctx, L, f); break
        case 'minimap': drawMinimap(ctx, L, f); break
        case 'health': drawHealth(ctx, L, f); break
        case 'energy': drawEnergy(ctx, L, f); break
        case 'roster': drawRoster(ctx, L, f); break
        case 'hints': drawHints(ctx, L, f); break
      }
    }
  }
}
