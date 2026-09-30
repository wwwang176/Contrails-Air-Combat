import { BufferAttribute, BufferGeometry, MeshStandardMaterial, type Texture } from 'three'
import { shipParts } from './shipLivery'

/**
 * # 船的號碼
 *
 * 舷號與飛行甲板的號碼。**方塊字**：每個數字由七段粗直條組成（上、中、下三橫，
 * 左右各兩豎），直角相接 —— 美國海軍戰時的船身與甲板號碼就是這種字，不是圓弧的
 * 印刷字。
 *
 * 同艦級共用一張塗裝貼圖，號碼畫進去的話每一艘都同一號；所以號碼是**貼花**：從船殼
 * 挑出號碼框附近、朝那一面的三角形，照原樣複製、往外推一點，UV 照號碼框投影。貼花
 * 因此跟著船殼的曲面走。字的貼圖一艘一張（`numberCanvas`），框外是透明的。
 *
 * 座標是艦體座標：X 橫向（+X 右舷）、Y 上（水線為 0）、−Z 艦首。
 */

export type NumberView = 'port' | 'starboard' | 'deck'

/** 一個號碼的位置 */
export interface NumberMark {
  readonly view: NumberView
  /** 字心的 z，m */
  readonly z: number
  /** 字心的高度（舷側），m */
  readonly y?: number
  /** 字心的橫向位置（甲板），m */
  readonly x?: number
  /** 字高，m */
  readonly height: number
  /**
   * 甲板上的字頂朝哪一頭。**省略 = 朝艦首**（從艦尾進場讀得正）。航艦兩端各一個號碼，
   * 艦尾那一個字頂朝艦尾 —— 兩個都朝外
   */
  readonly top?: 'bow' | 'stern'
}

export interface ShipNumbersDef {
  /** 這個艦級的號碼，第 `index` 艘取 `shipNumber` 那一個。**字數要一樣** */
  readonly values: readonly string[]
  /** 從哪一個網格挑面 */
  readonly mesh: string
  /** 只挑那個網格裡最大的一塊零件（船身材質併了甲板上的東西時用）。省略 = 全部 */
  readonly largestPartOnly?: boolean
  readonly marks: readonly NumberMark[]
  /** 字色（sRGB） */
  readonly color: number
  /** 字的外框色（sRGB）。省略 = 沒有外框 */
  readonly outline?: number
}

type Segment = 'top' | 'mid' | 'bot' | 'ul' | 'll' | 'ur' | 'lr'

/** 每個數字亮哪幾段 */
export const DIGIT_SEGMENTS: Readonly<Record<string, readonly Segment[]>> = {
  '0': ['top', 'bot', 'ul', 'll', 'ur', 'lr'],
  '1': ['ur', 'lr'],
  '2': ['top', 'ur', 'mid', 'll', 'bot'],
  '3': ['top', 'ur', 'mid', 'lr', 'bot'],
  '4': ['ul', 'ur', 'mid', 'lr'],
  '5': ['top', 'ul', 'mid', 'lr', 'bot'],
  '6': ['top', 'ul', 'll', 'mid', 'lr', 'bot'],
  '7': ['top', 'ur', 'lr'],
  '8': ['top', 'mid', 'bot', 'ul', 'll', 'ur', 'lr'],
  '9': ['top', 'ul', 'ur', 'mid', 'lr', 'bot'],
}

/** 字形的比例，都是字高的幾倍。**起始值，由截圖裁定** */
const GLYPH_W = 0.6
const STROKE = 0.18
const GAP = 0.2
/** 號碼框四周的留白（外框畫在這裡面，框的最外一圈一定透明） */
const PAD = 0.15

export interface Rect { readonly x: number, readonly y: number, readonly w: number, readonly h: number }

/**
 * 一個數字的各段，字框 `w` × `h`、筆畫粗 `t`。座標原點在字框左上，y 向下。
 * 橫段貼齊字框左右、豎段貼齊字框上下，外緣剛好是字框。
 */
export function glyphRects(digit: string, w: number, h: number, t: number): Rect[] {
  const segs = DIGIT_SEGMENTS[digit]
  if (segs === undefined) throw new Error(`方塊字沒有「${digit}」`)
  const half = (h + t) / 2
  const midY = (h - t) / 2
  return segs.map((s): Rect => {
    switch (s) {
      case 'top': return { x: 0, y: 0, w, h: t }
      case 'mid': return { x: 0, y: midY, w, h: t }
      case 'bot': return { x: 0, y: h - t, w, h: t }
      case 'ul': return { x: 0, y: 0, w: t, h: half }
      case 'll': return { x: 0, y: midY, w: t, h: half }
      case 'ur': return { x: w - t, y: 0, w: t, h: half }
      case 'lr': return { x: w - t, y: midY, w: t, h: half }
    }
  })
}

/** 號碼框的寬高，m（含四周留白）。UV 的 0…1 就是這個框 */
export function numberBox(text: string, mark: NumberMark): { w: number, h: number } {
  const H = mark.height
  const n = text.length
  return {
    w: n * GLYPH_W * H + (n - 1) * GAP * H + 2 * PAD * H,
    h: H + 2 * PAD * H,
  }
}

/**
 * 第 `index` 艘船的號碼。**輪流**：編號相鄰的船在場上多半擺在一起，輪流保證相鄰
 * 兩艘不同。
 */
export function shipNumber(values: readonly string[], index: number): string {
  const n = values.length
  return values[((index % n) + n) % n]!
}

/**
 * 把號碼畫到一張 canvas 上：寬高比與 `numberBox` 相同，背景透明，先畫外框再畫字。
 * **只在瀏覽器裡跑。**
 */
export function numberCanvas(text: string, def: ShipNumbersDef, pxHigh = 128): HTMLCanvasElement {
  const mark = def.marks[0]!
  const box = numberBox(text, mark)
  const s = pxHigh / box.h
  const H = mark.height
  const c = document.createElement('canvas')
  c.width = Math.ceil(box.w * s)
  c.height = pxHigh
  const g = c.getContext('2d')!
  const hex = (v: number) => `#${v.toString(16).padStart(6, '0')}`
  const rects: Rect[] = []
  for (let i = 0; i < text.length; i++) {
    const x0 = PAD * H + i * (GLYPH_W + GAP) * H
    for (const r of glyphRects(text[i]!, GLYPH_W * H, H, STROKE * H)) {
      rects.push({ x: x0 + r.x, y: PAD * H + r.y, w: r.w, h: r.h })
    }
  }
  if (def.outline !== undefined) {
    const o = 0.05 * H
    g.fillStyle = hex(def.outline)
    for (const r of rects) g.fillRect((r.x - o) * s, (r.y - o) * s, (r.w + 2 * o) * s, (r.h + 2 * o) * s)
  }
  g.fillStyle = hex(def.color)
  for (const r of rects) g.fillRect(r.x * s, r.y * s, r.w * s, r.h * s)
  return c
}

/**
 * 號碼貼花的材質。
 *
 * 【alphaTest】字圖在框內、字外是透明的；少了它字外那一塊會以字圖的背景色蓋在船殼上。
 * 【polygonOffset】與底下的船殼只差 3 cm，遠處深度精度不夠，再往前推一點免得互閃。
 */
export function numberMaterial(map: Texture | null): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map, roughness: 0.8, alphaTest: 0.5,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
}

/** 貼花離船殼多遠，m。夠遠才不會與船殼搶深度，夠近才看不出浮起來 */
const LIFT = 0.03

/**
 * 凸多邊形留下 `axis` 座標 ≥ `bound`（`upper` 為 true 時 ≤ `bound`）的那一半。
 * 切點照線性內插，三角形是平的，所以切出來的點仍在原本那一面上。
 */
function clipPolygon(poly: number[][], axis: number, bound: number, upper: boolean): number[][] {
  const inside = (p: number[]) => upper ? p[axis]! <= bound : p[axis]! >= bound
  const out: number[][] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const ia = inside(a), ib = inside(b)
    if (ia) out.push(a)
    if (ia !== ib) {
      const t = (bound - a[axis]!) / (b[axis]! - a[axis]!)
      out.push([a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t])
    }
  }
  return out
}

/**
 * 從 `geo`（艦體座標、沒有索引）挑出號碼框範圍內、朝那一面的三角形，複製成貼花。
 * 回傳的幾何有 position、normal、uv；一個都沒挑到回 null。
 *
 * - 挑面：朝向是法線與那一面夾角 60° 以內（舷側）或 45° 以內（甲板）；每一個
 *   三角形裁到號碼框內，框外一點都不留。
 * - UV：框中心是 (0.5, 0.5)，v 向上。站在那一面看過去正著讀 —— 右舷艦首在右、
 *   左舷艦首在左、甲板字頂朝艦首（從艦尾進場的飛行員讀得正，右舷在右）。
 *
 * `largestPartOnly`：只挑 `geo` 裡最大的一塊零件（船殼），甲板上的欄杆、通風口不會
 * 被印上半個字。
 */
export function buildNumberDecal(
  geo: BufferGeometry, mark: NumberMark, box: { w: number, h: number }, largestPartOnly = false,
): BufferGeometry | null {
  if (geo.index !== null) throw new Error('號碼貼花要沒有索引的幾何')
  const pos = geo.getAttribute('position')
  let keepPart = -1
  let partOf: Int32Array | null = null
  if (largestPartOnly) {
    const parts = shipParts(geo)
    const tris = new Int32Array(parts.count)
    for (const p of parts.of) tris[p]!++
    for (let p = 0; p < parts.count; p++) if (keepPart < 0 || tris[p]! > tris[keepPart]!) keepPart = p
    partOf = parts.of
  }
  const cx = mark.view === 'deck' ? (mark.x ?? 0) : 0
  const cy = mark.view === 'deck' ? 0 : (mark.y ?? 0)
  const uvOf = (x: number, y: number, z: number): [number, number] => {
    switch (mark.view) {
      case 'starboard': return [0.5 + (mark.z - z) / box.w, 0.5 + (y - cy) / box.h]
      case 'port': return [0.5 + (z - mark.z) / box.w, 0.5 + (y - cy) / box.h]
      case 'deck': return mark.top === 'stern'
        ? [0.5 - (x - cx) / box.w, 0.5 - (mark.z - z) / box.h]
        : [0.5 + (x - cx) / box.w, 0.5 + (mark.z - z) / box.h]
    }
  }
  // 號碼框在艦體座標的範圍：(軸, 下限, 上限)，軸 0 = x、1 = y、2 = z。甲板上字高沿 z
  const clipBounds: readonly (readonly [number, number, number])[] = mark.view === 'deck'
    ? [[2, mark.z - box.h / 2, mark.z + box.h / 2], [0, cx - box.w / 2, cx + box.w / 2]]
    : [[2, mark.z - box.w / 2, mark.z + box.w / 2], [1, cy - box.h / 2, cy + box.h / 2]]
  const outP: number[] = []
  const outN: number[] = []
  const outUv: number[] = []
  const v = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i + 2 < pos.count; i += 3) {
    if (partOf !== null && partOf[i / 3] !== keepPart) continue
    for (let k = 0; k < 3; k++) {
      v[k * 3] = pos.getX(i + k); v[k * 3 + 1] = pos.getY(i + k); v[k * 3 + 2] = pos.getZ(i + k)
    }
    const ux = v[3]! - v[0]!, uy = v[4]! - v[1]!, uz = v[5]! - v[2]!
    const wx = v[6]! - v[0]!, wy = v[7]! - v[1]!, wz = v[8]! - v[2]!
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
    const len = Math.hypot(nx, ny, nz)
    if (len === 0) continue
    nx /= len; ny /= len; nz /= len
    const facing = mark.view === 'starboard' ? nx > 0.5 : mark.view === 'port' ? nx < -0.5 : ny > 0.7
    if (!facing) continue
    // 【裁到號碼框內】框外不能靠字圖的透明邊擋：mipmap 縮小之後邊緣的 alpha 會升到
    // 0.7 以上，過得了 alphaTest，遠看框外多出一片色塊
    let poly: number[][] = [[v[0]!, v[1]!, v[2]!], [v[3]!, v[4]!, v[5]!], [v[6]!, v[7]!, v[8]!]]
    for (const [axis, lo, hi] of clipBounds) {
      poly = clipPolygon(poly, axis, lo, false)
      poly = clipPolygon(poly, axis, hi, true)
      if (poly.length < 3) break
    }
    if (poly.length < 3) continue
    // 凸多邊形，扇形切成三角形
    for (let k = 1; k + 1 < poly.length; k++) {
      for (const q of [poly[0]!, poly[k]!, poly[k + 1]!]) {
        outP.push(q[0]! + nx * LIFT, q[1]! + ny * LIFT, q[2]! + nz * LIFT)
        outN.push(nx, ny, nz)
        outUv.push(...uvOf(q[0]!, q[1]!, q[2]!))
      }
    }
  }
  if (outP.length === 0) return null
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(outP), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(outN), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(outUv), 2))
  return g
}
