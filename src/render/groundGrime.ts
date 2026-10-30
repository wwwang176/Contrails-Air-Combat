import { CanvasTexture, SRGBColorSpace, type Texture } from 'three'
import {
  GRIME_ATLAS_HEIGHT, GRIME_ATLAS_WIDTH, GRIME_GUTTER, type GrimeRect, type GroundGrimeLayout,
} from './geometry/ground/grime'
import { groundGrimeLayouts } from './geometry/ground/glb'
import { grimeSprites, type GrimeKind } from './shipGrime'

/**
 * # 車輛與地面砲的髒污：圖集
 *
 * **載入時**在白底的圖集上蓋髒污（色斑、雨痕、小污點，與船同一組小圖），每一支 GLB 一格
 * （版面見 `geometry/ground/grime.ts`）；側面、車頭、車尾的下緣另外刷一條泥巴帶。
 * 車輛與地面砲的材質拿它當貼圖，乘上頂點色：白 = 不變，所以冬季塗裝照樣換、髒污照樣蓋。
 *
 * 同一支 GLB 的車共用一組印子，每次載入位置不同 —— 與船同一個做法。遊戲中每一幀的成本只是
 * 多讀一次貼圖。
 */

/** 一個髒污印子，座標是圖集上的 px */
export interface GroundGrimeStamp {
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
  /** 蓋在哪一塊，畫的時候裁在它往外半個空白之內 */
  readonly clip: GrimeRect
}

/**
 * 每平方公尺的印子數與尺寸（公尺）。車比船小得多，印子也小、也密。**起始值，由截圖裁定。**
 */
const GRIME = {
  blotch: { perM2: 0.9, r: [0.15, 0.6], alpha: [0.06, 0.16] },
  streak: { perM2: 1.8, w: [0.03, 0.1], len: [0.2, 1.0], alpha: [0.1, 0.25] },
  speck: { perM2: 6, r: [0.01, 0.04], alpha: [0.15, 0.35] },
} as const

/** 泥巴帶從模型最低點往上多高，m。履帶、輪子、車身下緣 */
export const GROUND_MUD_HEIGHT = 0.9
/** 泥巴帶最下緣的顏色與濃度（往上淡到 0）。**起始值，由截圖裁定。** */
const MUD_COLOR = '110, 92, 70'
const MUD_ALPHA = 0.55
/** 泥巴帶裡另外濺的泥點，每平方公尺幾個 */
const MUD_SPECKS_PER_M2 = 15

/** 一塊泥巴帶：圖集上的 px，`y1` 是那一塊的下緣（最濃），往上到 `y0` 淡掉 */
export interface GroundMudBand {
  readonly clip: GrimeRect
  readonly y0: number
  readonly y1: number
}

/** 側面、車頭、車尾的泥巴帶 */
export function groundMudBands(L: GroundGrimeLayout): GroundMudBand[] {
  return [L.right, L.left, L.front, L.back].map((clip) => {
    const y1 = clip.y + clip.h
    return { clip, y0: y1 - Math.min(GROUND_MUD_HEIGHT * L.scale, clip.h), y1 }
  })
}

/**
 * 一支 GLB 的髒污印子。`rand` 回 [0, 1)；遊戲傳 `Math.random`（每次載入不同），測試傳固定的序列。
 * 雨痕只蓋在側面、車頭、車尾；頂面只有色斑與污點。
 */
export function groundGrimeStamps(L: GroundGrimeLayout, rand: () => number): GroundGrimeStamp[] {
  const s = L.scale
  const between = (r: readonly [number, number]) => r[0] + (r[1] - r[0]) * rand()
  const out: GroundGrimeStamp[] = []
  const stamp = (clip: GrimeRect, y0: number, y1: number, area: number, streaks: boolean) => {
    const at = () => ({ x: clip.x + rand() * clip.w, y: y0 + rand() * (y1 - y0) })
    for (let i = Math.round(area * GRIME.blotch.perM2); i > 0; i--) {
      const r = between(GRIME.blotch.r) * s
      out.push({ kind: 'blotch', ...at(), w: r, h: r * between([0.5, 1]), alpha: between(GRIME.blotch.alpha), clip })
    }
    for (let i = streaks ? Math.round(area * GRIME.streak.perM2) : 0; i > 0; i--) {
      out.push({
        kind: 'streak', ...at(), w: between(GRIME.streak.w) * s, h: between(GRIME.streak.len) * s,
        alpha: between(GRIME.streak.alpha), clip,
      })
    }
    for (let i = Math.round(area * GRIME.speck.perM2); i > 0; i--) {
      const r = between(GRIME.speck.r) * s
      out.push({ kind: 'speck', ...at(), w: r, h: r, alpha: between(GRIME.speck.alpha), clip })
    }
  }
  for (const clip of [L.right, L.left, L.front, L.back]) stamp(clip, clip.y, clip.y + clip.h, clip.w * clip.h / (s * s), true)
  stamp(L.top, L.top.y, L.top.y + L.top.h, L.top.w * L.top.h / (s * s), false)
  // 泥巴帶裡濺的泥點
  for (const b of groundMudBands(L)) {
    for (let i = Math.round(b.clip.w * (b.y1 - b.y0) / (s * s) * MUD_SPECKS_PER_M2); i > 0; i--) {
      const r = between(GRIME.speck.r) * s
      out.push({
        kind: 'speck', x: b.clip.x + rand() * b.clip.w, y: b.y0 + rand() * (b.y1 - b.y0),
        w: r, h: r, alpha: between(GRIME.speck.alpha), clip: b.clip,
      })
    }
  }
  return out
}

/** 每一塊裁在它往外半個空白之內 */
function clipTo(g: CanvasRenderingContext2D, r: GrimeRect): void {
  const half = GRIME_GUTTER / 2
  g.beginPath()
  g.rect(r.x - half, r.y - half, r.w + 2 * half, r.h + 2 * half)
  g.clip()
}

/** 白底圖集：每一格刷泥巴帶、蓋印子。**只在瀏覽器裡跑** */
function buildAtlas(layouts: readonly GroundGrimeLayout[]): Texture {
  const c = document.createElement('canvas')
  c.width = GRIME_ATLAS_WIDTH
  c.height = GRIME_ATLAS_HEIGHT
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, c.width, c.height)
  const img = grimeSprites()
  for (const L of layouts) {
    for (const b of groundMudBands(L)) {
      g.save()
      clipTo(g, b.clip)
      const grad = g.createLinearGradient(0, b.y1, 0, b.y0)
      grad.addColorStop(0, `rgba(${MUD_COLOR}, ${MUD_ALPHA})`)
      grad.addColorStop(1, `rgba(${MUD_COLOR}, 0)`)
      g.fillStyle = grad
      g.fillRect(b.clip.x, b.y0, b.clip.w, b.y1 - b.y0)
      g.restore()
    }
    // 【同一塊一起裁】每個印子各自裁切的話載入慢一個量級（與船的 `drawStamps` 同一個道理）
    const byClip = new Map<GrimeRect, GroundGrimeStamp[]>()
    for (const st of groundGrimeStamps(L, Math.random)) {
      const list = byClip.get(st.clip)
      if (list === undefined) byClip.set(st.clip, [st])
      else list.push(st)
    }
    for (const [clip, list] of byClip) {
      g.save()
      clipTo(g, clip)
      for (const st of list) {
        g.globalAlpha = st.alpha
        if (st.kind === 'streak') g.drawImage(img.streak, st.x - st.w / 2, st.y, st.w, st.h)
        else g.drawImage(img[st.kind], st.x - st.w, st.y - st.h, 2 * st.w, 2 * st.h)
      }
      g.restore()
    }
  }
  g.globalAlpha = 1
  const t = new CanvasTexture(c)
  // 與船的髒污圖相同：UV 原點在左上角、sRGB、斜看不糊
  t.flipY = false
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  return t
}

let atlas: Texture | null = null
/** 蓋 `atlas` 時有幾支 GLB */
let atlasCells = 0

/**
 * 車輛與地面砲的髒污圖集，照已載入的 GLB 蓋好，之後同一張（換場不重蓋）。之後又載了別的 GLB
 * 就重蓋一張（舊的釋放）—— 不重蓋的話新的那幾台讀到白格，沒有髒污也不報錯。
 * node（測試）沒有畫布，回 null —— 材質維持純頂點色
 */
export function groundGrimeTexture(): Texture | null {
  if (typeof document === 'undefined') return null
  const layouts = groundGrimeLayouts()
  if (atlas === null || layouts.length !== atlasCells) {
    atlas?.dispose()
    atlas = buildAtlas(layouts)
    atlasCells = layouts.length
  }
  return atlas
}
