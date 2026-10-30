import {
  Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType,
  type MeshStandardMaterial, type Texture,
} from 'three'
import {
  GRIME_ATLAS_HEIGHT, GRIME_ATLAS_WIDTH, GRIME_GUTTER, type GrimeRect, type GroundGrimeLayout,
} from './geometry/ground/grime'
import { groundGrimeLayouts } from './geometry/ground/glb'
import { grimeSprites, type GrimeKind } from './shipGrime'

/**
 * # 車輛與地面砲的髒污：圖集
 *
 * **載入時**在白底的圖集上蓋髒污（色斑、雨痕、小污點，與船同一組小圖），每一支 GLB 一格
 * （版面見 `geometry/ground/grime.ts`）；側面、車頭、車尾的下緣另外刷一條泥巴帶，頂面蓋一層。
 * 車輛與地面砲的材質拿它當貼圖（`applyGroundDust`）：RGB 乘上頂點色（白 = 不變），alpha 是
 * 灰土、混進土色。冬季塗裝照樣換、髒污照樣蓋。
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
  blotch: { perM2: 0.9, r: [0.25, 0.9], alpha: [0.15, 0.35] },
  streak: { perM2: 1.8, w: [0.03, 0.1], len: [0.2, 1.0], alpha: [0.1, 0.25] },
  speck: { perM2: 6, r: [0.01, 0.04], alpha: [0.15, 0.35] },
} as const

/** 泥巴帶從模型最低點往上多高，m。要高過履帶與輪子、沾到車身下緣與擋泥板 */
export const GROUND_MUD_HEIGHT = 1.3
/** 泥巴帶最下緣的顏色與濃度（往上淡到 0）。**起始值，由截圖裁定。** */
const MUD_COLOR = '110, 92, 70'
const MUD_ALPHA = 0.7
/** 頂面（水平面積灰）整片蓋一層的濃度，與泥巴同色 */
const TOP_GRIME_ALPHA = 0.18

/**
 * 灰土：整台蒙一層土色（`applyGroundDust` 在頂點色之後混進去）。乘法只能變暗，深綠色上蓋黑點
 * 幾乎看不出來；混進淺土色才會把深色洗淡、白漆弄髒。
 *
 * 側面、車頭、車尾由上緣的 `top` 往下緣的 `bottom` 漸濃，頂面一層 `surface`，再乘上一點
 * 起伏（`wobble`，0 = 均勻）。`color` 是 sRGB。**起始值，由截圖裁定。**
 */
export const GROUND_DUST = {
  top: 0.03,
  bottom: 0.3,
  surface: 0.15,
  wobble: 0.35,
  color: [92, 80, 62],
} as const
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

/**
 * 灰土的濃度（0…255），圖集一個 px 一格、列優先、第 0 列在上。每一塊往外多算半個空白 ——
 * 貼圖取樣在塊的邊上會混到隔壁的 px，空白處是 0 的話邊緣會亮一條。沒用到的地方 0。
 * `rand` 給每一塊起伏的相位與波長。
 */
export function groundDustMask(layouts: readonly GroundGrimeLayout[], rand: () => number): Uint8Array {
  const W = GRIME_ATLAS_WIDTH
  const out = new Uint8Array(W * GRIME_ATLAS_HEIGHT)
  const half = GRIME_GUTTER / 2
  const D = GROUND_DUST
  for (const L of layouts) {
    const fill = (r: GrimeRect, from: number, to: number) => {
      // 起伏：兩組正弦，波長 0.8～2 m
      const k = () => (2 * Math.PI) / ((0.8 + rand() * 1.2) * L.scale)
      const k1 = k(), k2 = k(), k3 = k()
      const p1 = rand() * 6.3, p2 = rand() * 6.3, p3 = rand() * 6.3
      const x0 = Math.max(0, Math.floor(r.x - half)), x1 = Math.min(W, Math.ceil(r.x + r.w + half))
      const y0 = Math.max(0, Math.floor(r.y - half)), y1 = Math.min(GRIME_ATLAS_HEIGHT, Math.ceil(r.y + r.h + half))
      for (let y = y0; y < y1; y++) {
        const t = Math.min(1, Math.max(0, (y + 0.5 - r.y) / r.h))
        const base = from + (to - from) * t
        for (let x = x0; x < x1; x++) {
          const n = 0.6 * Math.sin(x * k1 + p1) * Math.sin(y * k2 + p2) + 0.4 * Math.sin((0.7 * x + y) * k3 + p3)
          out[y * W + x] = Math.round(255 * Math.min(1, Math.max(0, base * (1 + D.wobble * n))))
        }
      }
    }
    for (const r of [L.right, L.left, L.front, L.back]) fill(r, D.top, D.bottom)
    fill(L.top, D.surface, D.surface)
  }
  return out
}

/** 灰土的顏色，換成線性空間給著色器 */
const DUST_COLOR = new Color().setRGB(
  GROUND_DUST.color[0] / 255, GROUND_DUST.color[1] / 255, GROUND_DUST.color[2] / 255, SRGBColorSpace)

/**
 * 讓材質讀髒污圖集：RGB 照舊乘上去（變暗的印子與泥巴），alpha 是灰土的比例，**在頂點色之後**
 * 混進土色 —— three 的頂點色在貼圖之後才乘，混在前面的話土色也被乘成深綠、變不淺。
 */
export function applyGroundDust(m: MeshStandardMaterial): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms['groundDust'] = { value: DUST_COLOR }
    // 灰土的比例再乘上頂點的權重（`GROUND_DUST_WEIGHT`：履帶、輪胎 0）
    shader.vertexShader = 'attribute float dustWeight;\nvarying float vDustWeight;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDustWeight = dustWeight;')
    shader.fragmentShader = 'uniform vec3 groundDust;\nvarying float vDustWeight;\n' + shader.fragmentShader
      .replace('#include <map_fragment>', [
        'float groundDustMix = 0.0;',
        '#ifdef USE_MAP',
        '  vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
        '  diffuseColor.rgb *= sampledDiffuseColor.rgb;',
        '  groundDustMix = sampledDiffuseColor.a * vDustWeight;',
        '#endif',
      ].join('\n'))
      .replace('#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, groundDust, groundDustMix );')
  }
  m.customProgramCacheKey = () => 'groundDust'
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
    // 頂面整片蓋一層：水平面積灰
    g.save()
    clipTo(g, L.top)
    g.fillStyle = `rgba(${MUD_COLOR}, ${TOP_GRIME_ALPHA})`
    g.fillRect(L.top.x, L.top.y, L.top.w, L.top.h)
    g.restore()
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
  // 【alpha 另外寫、不經過畫布】畫布存的是預乘過的顏色，alpha 小的地方 RGB 會被量化掉。
  // 讀出不透明的 RGB，alpha 換成灰土，直接建 RGBA 的資料貼圖
  const data = g.getImageData(0, 0, c.width, c.height).data
  const dust = groundDustMask(layouts, Math.random)
  for (let i = 0; i < dust.length; i++) data[i * 4 + 3] = dust[i]!
  const t = new DataTexture(new Uint8Array(data.buffer), c.width, c.height, RGBAFormat, UnsignedByteType)
  // 與船的髒污圖相同：UV 原點在左上角（資料第 0 列就是上緣，不翻）、sRGB、斜看不糊
  t.flipY = false
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
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
