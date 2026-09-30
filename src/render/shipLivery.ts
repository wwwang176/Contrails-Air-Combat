import { BufferAttribute, type BufferGeometry } from 'three'

/**
 * # 船的塗裝版面
 *
 * 一張 2048 × 1024 的貼圖，由上而下三條，剩下的空位（甲板條下方的橫帶或右側的
 * 直欄，取大的那一個）是頂面區：
 *
 * ```
 *   ┌─────────────────────────┬────┐
 *   │ 左舷條  站在左舷看：艦首在左 │    │
 *   │ 右舷條  站在右舷看：艦首在右 │頂面│ ← 船短（Essex、LST）時在右側
 *   │ 甲板條  俯視：艦首在左、右舷在上│    │
 *   ├─────────────────────────┴────┤
 *   │ 頂面                          │ ← 船長（Fletcher、Wichita）時在下方
 *   └──────────────────────────────┘
 * ```
 *
 * 座標是艦體座標：X 橫向（+X 右舷）、Y 上（水線為 0）、−Z 艦首。三條同一個比例。
 *
 * 【甲板條右舷在上】俯視時艦首朝左，上方就是右舷（地圖上往西開的船，右舷朝北）。
 * 左舷在上的是從船底往上看的鏡像，照俯視照片畫的走道會左右顛倒。
 *
 * 每個面依材質與法線歸到一條：
 * - 甲板材質 → 甲板條（俯視投影）
 * - 船身材質、朝上的面 → 頂面區（水平面的漆、鋼板與髒污；迷彩只在立面）。每塊零件
 *   俯視投影、各自錯開位置，比頂面區大的等比縮小放進去
 * - 船身材質、其他的面 → 左舷條或右舷條（側視投影）
 *
 * 【UV 在載入時算、不存在 GLB 裡】與飛機塗裝（`geometry/livery.ts`）同一個做法。
 * 畫圖腳本讀的版面由 `test/tools/ship-livery-faces.ts` 從這裡倒出去；改了這裡的
 * 任何一個數，貼圖要重畫，否則漆會畫到空白處而不會報錯。
 */

export const SHIP_LIVERY_WIDTH = 2048
export const SHIP_LIVERY_HEIGHT = 1024

export interface ShipLiveryLayout {
  /** 貼圖路徑（`public/` 底下） */
  readonly url: string
  /** 每公尺幾 px，三條同一個 */
  readonly scale: number
  /** 側條與甲板條涵蓋的 z 範圍，m（`zMin` 是艦首端） */
  readonly zMin: number
  readonly zMax: number
  /** 側條涵蓋的高度範圍，m */
  readonly yMin: number
  readonly yMax: number
  /** 甲板條涵蓋的半寬，m */
  readonly halfBeam: number
}

export type ShipStrip = 'port' | 'starboard' | 'deck' | 'top'
export type ShipFaceKind = 'body' | 'deck'

export interface ShipRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * 條與條之間的空白，px。畫圖腳本把每一條的漆往外延伸填滿它 —— mipmap 往下縮時
 * 讀到的是同一條的漆，不會滲進隔壁那一條的顏色。
 */
export const SHIP_LIVERY_GUTTER = 16

/**
 * 頂面區至少要多大，px。小於它就丟錯 —— 頂面的零件會縮到看不出鋼板與髒污。
 */
export const SHIP_LIVERY_TOP_MIN = 48

/**
 * 朝上的判定：法線的垂直分量比水平分量 `hypot(nx, nz)` 的這個倍數還大（約 35° 以內）。
 *
 * 【水平分量要含 nz】飛機那一支（`geometry/livery.ts`）只比 nx；照抄的話法線
 * (0, 0, 1) 的前後壁也算朝上，Fletcher 上層結構有 420 m² 會被漆成甲板藍。
 */
const UP_BIAS = 1.4

/**
 * 法線的 x 分量佔法線長這個比例以上，照它的正負號分左右舷；以下照三角形重心。
 *
 * 【為什麼不全照法線】朝前後的面（方尾、上層結構的前後壁）法線沒有左右分量，
 * 正負號是數值雜訊。照重心分的話，它們進的是自己那一側的條。
 */
const SIDE_NX = 0.2

/**
 * 版面各區的像素矩形。**放不下就丟錯** —— 超出的部分會讀到隔壁那一條的漆，
 * 而且不報錯。
 */
export function shipLiveryRects(L: ShipLiveryLayout): Record<ShipStrip, ShipRect> {
  const g = SHIP_LIVERY_GUTTER
  const w = (L.zMax - L.zMin) * L.scale
  const sideH = (L.yMax - L.yMin) * L.scale
  const deckH = 2 * L.halfBeam * L.scale
  const port = { x: g, y: g, w, h: sideH }
  const starboard = { x: g, y: port.y + sideH + g, w, h: sideH }
  const deck = { x: g, y: starboard.y + sideH + g, w, h: deckH }
  if (!(w > 0 && sideH > 0 && deckH > 0)) throw new Error('船的塗裝版面：範圍要是正的')
  if (g + w + g > SHIP_LIVERY_WIDTH) {
    throw new Error(`船的塗裝版面：寬 ${w.toFixed(0)} px 放不進 ${SHIP_LIVERY_WIDTH}`)
  }
  if (deck.y + deckH + g > SHIP_LIVERY_HEIGHT) {
    throw new Error(`船的塗裝版面：三條共 ${(deck.y + deckH + g).toFixed(0)} px 高，放不進 ${SHIP_LIVERY_HEIGHT}`)
  }
  // 頂面區：甲板條下方的橫帶或右側的直欄，取面積大的
  const band = { x: g, y: deck.y + deckH + g, w: SHIP_LIVERY_WIDTH - 2 * g, h: 0 }
  band.h = SHIP_LIVERY_HEIGHT - g - band.y
  const column = { x: g + w + g, y: g, w: 0, h: SHIP_LIVERY_HEIGHT - 2 * g }
  column.w = SHIP_LIVERY_WIDTH - g - column.x
  const area = (r: ShipRect) => Math.max(0, r.w) * Math.max(0, r.h)
  const top = area(band) >= area(column) ? band : column
  if (top.w < SHIP_LIVERY_TOP_MIN || top.h < SHIP_LIVERY_TOP_MIN) {
    throw new Error(`船的塗裝版面：頂面區只剩 ${top.w.toFixed(0)} × ${top.h.toFixed(0)} px`)
  }
  return { port, starboard, deck, top }
}

/**
 * 一塊零件的頂面在頂面區裡擺在哪：零件俯視外框的左上角（z 最小、x 最大）對到
 * (`u0`, `v0`)，縮放 `f`（1 = 與側條同一個比例）。
 */
export interface TopPlacement {
  readonly zMin: number
  readonly xMax: number
  readonly u0: number
  readonly v0: number
  readonly f: number
}

/**
 * 零件 `p` 的頂面擺法：比頂面區大就等比縮小放進去；位置由零件編號算，不同零件讀到
 * 頂面區的不同地方，同一個模型每次載入都一樣。
 */
export function topPlacement(
  parts: ShipParts, p: number, L: ShipLiveryLayout, top: ShipRect,
): TopPlacement {
  const s = L.scale
  const dz = parts.extent[p * 3 + 2]! * s
  const dx = parts.extent[p * 3]! * s
  const f = Math.min(1, top.w / Math.max(dz, 1e-6), top.h / Math.max(dx, 1e-6))
  const hash = (k: number) => {
    const h = Math.sin(p * 12.9898 + k * 78.233) * 43758.5453
    return h - Math.floor(h)
  }
  return {
    zMin: parts.origin[p * 3 + 2]!,
    xMax: parts.origin[p * 3]! + parts.extent[p * 3]!,
    u0: top.x + hash(1) * Math.max(0, top.w - dz * f),
    v0: top.y + hash(2) * Math.max(0, top.h - dx * f),
    f,
  }
}

/**
 * 一個面歸哪一區。`n` 是面法線（不必正規化），`cx` 是重心的 x。
 */
export function shipFaceStrip(
  kind: ShipFaceKind, nx: number, ny: number, nz: number, cx: number,
): ShipStrip {
  if (kind === 'deck') return 'deck'
  const h = Math.hypot(nx, nz)
  if (ny >= h * UP_BIAS) return 'top'
  const len = Math.hypot(nx, ny, nz)
  const side = Math.abs(nx) >= SIDE_NX * len ? nx : cx
  return side >= 0 ? 'starboard' : 'port'
}

/**
 * 艦體座標的一點 → 該區的像素座標，寫進 `out`。頂面區要給那塊零件的擺法 `place`
 * （俯視：艦首在左、右舷在上，與甲板條同一個方向）。
 */
export function shipLiveryPixel(
  out: number[], strip: ShipStrip, x: number, y: number, z: number,
  L: ShipLiveryLayout, R: Record<ShipStrip, ShipRect>, place?: TopPlacement,
): void {
  const s = L.scale
  switch (strip) {
    case 'port':
      out[0] = R.port.x + (z - L.zMin) * s
      out[1] = R.port.y + (L.yMax - y) * s
      break
    case 'starboard':
      out[0] = R.starboard.x + (L.zMax - z) * s
      out[1] = R.starboard.y + (L.yMax - y) * s
      break
    case 'deck':
      out[0] = R.deck.x + (z - L.zMin) * s
      out[1] = R.deck.y + (L.halfBeam - x) * s
      break
    case 'top':
      if (place === undefined) throw new Error('頂面區要給零件的擺法')
      out[0] = place.u0 + (z - place.zMin) * s * place.f
      out[1] = place.v0 + (place.xMax - x) * s * place.f
      break
  }
}

/**
 * 零件的一種：它的色階，與認它的框。框量的是零件重心（艦體座標，m）；`x` 比的是
 * |x|，兩舷對稱的零件寫一個框就好。`dx`／`dy`／`dz` 量的是零件外框的長寬高 ——
 * 同一種零件散在船上各處、位置不規則時（航艦走廊上的機砲），認尺寸比認位置穩。
 * 省略的條件不限。
 */
export interface ShipPartBox {
  readonly x?: readonly [number, number]
  readonly y?: readonly [number, number]
  readonly z?: readonly [number, number]
  readonly dx?: readonly [number, number]
  readonly dy?: readonly [number, number]
  readonly dz?: readonly [number, number]
}

export interface ShipPartKind {
  readonly name: string
  /** 畫面上的明暗倍率（sRGB）。寫進頂點色時換成線性，見 `partTones` */
  readonly tone: number
  readonly boxes: readonly ShipPartBox[]
}

/** 第 `p` 塊零件落在哪一種的框裡；依表的順序取第一個，都不在回 null */
export function shipPartKind(
  kinds: readonly ShipPartKind[], parts: ShipParts, p: number,
): ShipPartKind | null {
  const c = parts.centroid
  const e = parts.extent
  const ax = Math.abs(c[p * 3]!)
  const inRange = (v: number, r: readonly [number, number] | undefined) =>
    r === undefined || (v >= r[0] && v <= r[1])
  for (const k of kinds) {
    for (const b of k.boxes) {
      if (inRange(ax, b.x) && inRange(c[p * 3 + 1]!, b.y) && inRange(c[p * 3 + 2]!, b.z)
        && inRange(e[p * 3]!, b.dx) && inRange(e[p * 3 + 1]!, b.dy) && inRange(e[p * 3 + 2]!, b.dz)) {
        return k
      }
    }
  }
  return null
}

export interface ShipParts {
  /** 零件數 */
  readonly count: number
  /** 第 i 個三角形屬於第幾塊 */
  readonly of: Int32Array
  /** 每一塊的重心，xyz 連排 */
  readonly centroid: Float64Array
  /** 每一塊外框的長寬高，xyz 連排 */
  readonly extent: Float64Array
  /** 每一塊外框的最小角，xyz 連排 */
  readonly origin: Float64Array
}

/**
 * 把幾何拆成零件：共用頂點（位置相同）連在一起的三角形是一塊。**幾何要是沒有索引的。**
 * 塊的編號依第一次出現的三角形排，同一份幾何每次結果相同。
 */
export function shipParts(geo: BufferGeometry): ShipParts {
  if (geo.index !== null) throw new Error('拆零件要沒有索引的幾何')
  const pos = geo.getAttribute('position')
  const n = pos.count
  // 位置相同的頂點合成一個節點，再用併查集把三角形連起來
  const ids = new Map<string, number>()
  const node = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`
    let id = ids.get(k)
    if (id === undefined) { id = ids.size; ids.set(k, id) }
    node[i] = id
  }
  const parent = new Int32Array(ids.size)
  for (let i = 0; i < parent.length; i++) parent[i] = i
  const find = (a: number): number => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]!]!; a = parent[a]! }
    return a
  }
  for (let i = 0; i + 2 < n; i += 3) {
    const a = find(node[i]!)
    parent[find(node[i + 1]!)] = a
    parent[find(node[i + 2]!)] = a
  }
  // 併查集的根 → 塊的編號；每一塊的頂點數、座標和與外框
  const slot = new Map<number, number>()
  const of = new Int32Array(Math.floor(n / 3))
  const sums: number[] = []
  const verts: number[] = []
  const lo: number[] = []
  const hi: number[] = []
  for (let i = 0; i + 2 < n; i += 3) {
    const r = find(node[i]!)
    let p = slot.get(r)
    if (p === undefined) {
      p = slot.size
      slot.set(r, p)
      sums.push(0, 0, 0)
      verts.push(0)
      lo.push(Infinity, Infinity, Infinity)
      hi.push(-Infinity, -Infinity, -Infinity)
    }
    of[i / 3] = p
    for (let k = 0; k < 3; k++) {
      const v = [pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)]
      for (let a = 0; a < 3; a++) {
        sums[p * 3 + a]! += v[a]!
        if (v[a]! < lo[p * 3 + a]!) lo[p * 3 + a] = v[a]!
        if (v[a]! > hi[p * 3 + a]!) hi[p * 3 + a] = v[a]!
      }
    }
    verts[p]! += 3
  }
  const centroid = new Float64Array(slot.size * 3)
  const extent = new Float64Array(slot.size * 3)
  const origin = new Float64Array(lo)
  for (let p = 0; p < slot.size; p++) {
    for (let a = 0; a < 3; a++) {
      centroid[p * 3 + a] = sums[p * 3 + a]! / verts[p]!
      extent[p * 3 + a] = hi[p * 3 + a]! - lo[p * 3 + a]!
    }
  }
  return { count: slot.size, of, centroid, extent, origin }
}

/**
 * 每一塊零件依種類的色階，逐頂點、rgb 同值，給頂點色用。**幾何要是沒有索引的。**
 *
 * 【為什麼要深淺】Measure 21 整艘同一個色，低多邊形的方塊零件疊在一起就糊成一團。
 * 依種類給色階，艦橋、甲板室、砲、射控才分得開。
 *
 * 【認不出來就丟】漏了一種的話那一塊靜靜地維持原色，看起來像忘了塗。`label` 是
 * 丟錯時說是哪一個網格。
 *
 * 【頂點色是線性的】它在著色器裡與線性的材質色相乘，直接寫 1.4 的話畫面上只亮
 * 16%。寫 `tone^2.2`，畫面上的明暗才是 `tone` 倍。
 *
 * 載入期跑一次，不在熱路徑上。
 */
export function partTones(
  geo: BufferGeometry, kinds: readonly ShipPartKind[], label: string,
): Float32Array {
  const parts = shipParts(geo)
  const tone = new Float32Array(parts.count)
  for (let p = 0; p < parts.count; p++) {
    const k = shipPartKind(kinds, parts, p)
    if (k === null) {
      const f = (a: Float64Array) => [0, 1, 2].map((i) => a[p * 3 + i]!.toFixed(1)).join(', ')
      throw new Error(`${label} 的第 ${p} 塊零件（重心 ${f(parts.centroid)}、長寬高 ${f(parts.extent)}）認不出種類`)
    }
    tone[p] = Math.pow(k.tone, 2.2)
  }
  const n = geo.getAttribute('position').count
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const t = tone[parts.of[Math.floor(i / 3)]!]!
    out[i * 3] = t; out[i * 3 + 1] = t; out[i * 3 + 2] = t
  }
  return out
}

/**
 * 逐三角形算 UV，寫進 `uv`。**幾何要是沒有索引的**：相鄰兩個面可能歸到不同區，
 * 共用頂點就只能有一組 UV。頂點要先烘進艦體座標。
 *
 * `visit` 給倒版面的工具與測試用：每個三角形回報一次區與三個頂點的像素座標。
 */
export function applyShipLiveryUv(
  geo: BufferGeometry, kind: ShipFaceKind, L: ShipLiveryLayout,
  visit?: (strip: ShipStrip, px: readonly number[]) => void,
): void {
  if (geo.index !== null) throw new Error('船的塗裝 UV 要沒有索引的幾何')
  const R = shipLiveryRects(L)
  const pos = geo.getAttribute('position')
  const n = pos.count
  const uv = new Float32Array(n * 2)
  const p = [0, 0]
  const px = [0, 0, 0, 0, 0, 0]
  // 頂面的擺法照零件算；只有真的有朝上的面才拆零件
  let parts: ShipParts | null = null
  const places = new Map<number, TopPlacement>()
  const placeOf = (tri: number): TopPlacement => {
    parts ??= shipParts(geo)
    const q = parts.of[tri]!
    let pl = places.get(q)
    if (pl === undefined) {
      pl = topPlacement(parts, q, L, R.top)
      places.set(q, pl)
    }
    return pl
  }
  for (let i = 0; i + 2 < n; i += 3) {
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i)
    const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1)
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2)
    // 逆時針為正面，(b−a)×(c−a) 朝外
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const strip = shipFaceStrip(
      kind, uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx, (ax + bx + cx) / 3)
    const place = strip === 'top' ? placeOf(i / 3) : undefined
    for (let k = 0; k < 3; k++) {
      const j = i + k
      shipLiveryPixel(p, strip, pos.getX(j), pos.getY(j), pos.getZ(j), L, R, place)
      uv[j * 2] = p[0]! / SHIP_LIVERY_WIDTH
      uv[j * 2 + 1] = p[1]! / SHIP_LIVERY_HEIGHT
      px[k * 2] = p[0]!
      px[k * 2 + 1] = p[1]!
    }
    visit?.(strip, px)
  }
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
}
