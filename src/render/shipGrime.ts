import { CanvasTexture, SRGBColorSpace, type Texture } from 'three'
import {
  SHIP_LIVERY_GUTTER, SHIP_LIVERY_HEIGHT, SHIP_LIVERY_WIDTH, shipLiveryRects,
  type ShipLiveryLayout, type ShipRect,
} from './shipLivery'

/**
 * # 船的髒污
 *
 * **載入時**在左右舷條上隨機蓋髒污：色斑、由上往下的雨痕、小污點。同艦級的船共用
 * 結果，每次載入位置不同。
 *
 * - 船身：蓋在塗裝原圖上，產生遊戲讀的那一張（原圖不動）
 * - 細件：蓋在一張白底的圖上，細件的材質拿它當貼圖（白 = 不變）
 *
 * 【為什麼在載入時蓋、不在著色器裡疊】遊戲中每一幀的成本是 0 —— 讀的仍是那一張圖。
 * 代價是髒污的解析度跟著塗裝貼圖（一格 6–17 cm），近看不如即時疊加細。
 *
 * 只蓋左右舷條：甲板條與單色區（水平面）不髒。
 */

export type GrimeKind = 'blotch' | 'streak' | 'speck'

/** 一個髒污印子，座標是 2048 × 1024 版面上的 px */
export interface GrimeStamp {
  readonly kind: GrimeKind
  /** 中心（色斑、污點）或頂端中點（雨痕） */
  readonly x: number
  readonly y: number
  /** 寬（雨痕）或半徑（色斑、污點），px */
  readonly w: number
  /** 雨痕往下拖的長度，px；色斑是縱向半徑 */
  readonly h: number
  /** 最暗處蓋多黑，0…1 */
  readonly alpha: number
  /** 蓋在哪一條，畫的時候裁在它往外半個空白之內 */
  readonly strip: ShipRect
}

/**
 * 每平方公尺舷側的印子數與尺寸（公尺）。**起始值，由截圖裁定。**
 */
const GRIME = {
  blotch: { perM2: 0.15, r: [0.6, 3.5], alpha: [0.06, 0.16] },
  streak: { perM2: 0.36, w: [0.08, 0.35], len: [0.6, 4.5], alpha: [0.12, 0.28] },
  speck: { perM2: 0.75, r: [0.03, 0.12], alpha: [0.14, 0.34] },
} as const

/**
 * 產生一艘船的髒污印子。`rand` 回 [0, 1)；遊戲傳 `Math.random`（每次載入不同），
 * 測試傳固定的序列。
 */
export function grimeStamps(L: ShipLiveryLayout, rand: () => number): GrimeStamp[] {
  const R = shipLiveryRects(L)
  const s = L.scale
  const between = (r: readonly [number, number]) => r[0] + (r[1] - r[0]) * rand()
  const out: GrimeStamp[] = []
  for (const strip of [R.port, R.starboard]) {
    const area = (strip.w / s) * (strip.h / s)
    const at = () => ({ x: strip.x + rand() * strip.w, y: strip.y + rand() * strip.h })
    for (let i = Math.round(area * GRIME.blotch.perM2); i > 0; i--) {
      const r = between(GRIME.blotch.r) * s
      out.push({ kind: 'blotch', ...at(), w: r, h: r * between([0.5, 1]), alpha: between(GRIME.blotch.alpha), strip })
    }
    for (let i = Math.round(area * GRIME.streak.perM2); i > 0; i--) {
      out.push({
        kind: 'streak', ...at(), w: between(GRIME.streak.w) * s, h: between(GRIME.streak.len) * s,
        alpha: between(GRIME.streak.alpha), strip,
      })
    }
    for (let i = Math.round(area * GRIME.speck.perM2); i > 0; i--) {
      const r = between(GRIME.speck.r) * s
      out.push({ kind: 'speck', ...at(), w: r, h: r, alpha: between(GRIME.speck.alpha), strip })
    }
  }
  return out
}

/** 印子的小圖邊長，px。縮放貼上，所以只決定邊緣的平滑度 */
const SPRITE = 64

/**
 * 三種印子各一張小圖（黑、透明度照形狀），蓋的時候縮放貼上、`globalAlpha` 給深淺。
 *
 * 【為什麼不每個印子畫一次漸層】Essex 兩舷有三萬多個印子；每個都新建漸層、各自裁切
 * 的話載入要多等一兩秒。預畫的小圖用 `drawImage` 貼，快一個量級。
 */
function sprites(): Record<GrimeKind, HTMLCanvasElement> {
  const make = (draw: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas')
    c.width = SPRITE
    c.height = SPRITE
    draw(c.getContext('2d')!)
    return c
  }
  const radial = (hard: number) => (g: CanvasRenderingContext2D) => {
    const r = SPRITE / 2
    const grad = g.createRadialGradient(r, r, 0, r, r, r)
    grad.addColorStop(0, 'rgba(0,0,0,1)')
    grad.addColorStop(hard, 'rgba(0,0,0,0.8)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, SPRITE, SPRITE)
  }
  return {
    // 色斑邊緣軟、污點邊緣硬
    blotch: make(radial(0.2)),
    speck: make(radial(0.7)),
    // 雨痕：上寬下窄，頂端最黑、往下淡掉（版面的 y 向下 = 艦上往下）
    streak: make((g) => {
      const grad = g.createLinearGradient(0, 0, 0, SPRITE)
      grad.addColorStop(0, 'rgba(0,0,0,1)')
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = grad
      g.beginPath()
      g.moveTo(0, 0)
      g.lineTo(SPRITE, 0)
      g.lineTo(SPRITE * 0.75, SPRITE)
      g.lineTo(SPRITE * 0.25, SPRITE)
      g.fill()
    }),
  }
}

/** `drawStamps` 用到的畫布操作（測試用錄製呼叫的假畫布） */
export type StampCanvas = Pick<CanvasRenderingContext2D,
  'save' | 'restore' | 'beginPath' | 'rect' | 'clip' | 'drawImage' | 'globalAlpha'> & {
  readonly canvas: { readonly width: number }
}

/**
 * 把印子蓋到畫布上。畫布可以是版面的任何等比縮放，倍率由畫布寬度推（寬 / 2048）。
 * 每一條裁在它往外半個空白之內 —— 伸出去的部分會蓋到隔壁那一條。
 */
export function drawStamps(
  g: StampCanvas, stamps: readonly GrimeStamp[], img: Record<GrimeKind, CanvasImageSource>,
): void {
  const k = g.canvas.width / SHIP_LIVERY_WIDTH
  const half = SHIP_LIVERY_GUTTER / 2
  const byStrip = new Map<ShipRect, GrimeStamp[]>()
  for (const st of stamps) {
    const list = byStrip.get(st.strip)
    if (list === undefined) byStrip.set(st.strip, [st])
    else list.push(st)
  }
  for (const [strip, list] of byStrip) {
    g.save()
    g.beginPath()
    g.rect((strip.x - half) * k, (strip.y - half) * k, (strip.w + 2 * half) * k, (strip.h + 2 * half) * k)
    g.clip()
    for (const st of list) {
      g.globalAlpha = st.alpha
      const x = st.x * k, y = st.y * k, w = st.w * k, h = st.h * k
      if (st.kind === 'streak') g.drawImage(img.streak, x - w / 2, y, w, h)
      else g.drawImage(img[st.kind], x - w, y - h, 2 * w, 2 * h)
    }
    g.restore()
  }
  g.globalAlpha = 1
}

function canvasTexture(c: HTMLCanvasElement): Texture {
  const t = new CanvasTexture(c)
  // 與塗裝貼圖相同：UV 原點在左上角、sRGB、斜看不糊
  t.flipY = false
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** 塗裝原圖蓋上髒污，回傳遊戲讀的那一張。**只在瀏覽器裡跑** */
export function grimedLivery(base: Texture, stamps: readonly GrimeStamp[]): Texture {
  const img = base.image as CanvasImageSource & { width: number, height: number }
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0)
  drawStamps(g, stamps, sprites())
  return canvasTexture(c)
}

/** 細件用的髒污圖：白底蓋上髒污，版面的一半大小。**只在瀏覽器裡跑** */
export function fittingGrime(stamps: readonly GrimeStamp[]): Texture {
  const c = document.createElement('canvas')
  c.width = SHIP_LIVERY_WIDTH / 2
  c.height = SHIP_LIVERY_HEIGHT / 2
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, c.width, c.height)
  drawStamps(g, stamps, sprites())
  return canvasTexture(c)
}
