import { BufferAttribute, type BufferGeometry } from 'three'

/**
 * # 船的塗裝版面
 *
 * 一張 2048 × 1024 的貼圖，由上而下三條，右下角一塊單色區：
 *
 * ```
 *   ┌──────────────────────────────┐
 *   │ 左舷條  站在左舷看：艦首在左 │
 *   │ 右舷條  站在右舷看：艦首在右 │
 *   │ 甲板條  俯視：艦首在左、右舷在上 │
 *   │                        ┌────┤
 *   │                        │單色│
 *   └────────────────────────┴────┘
 * ```
 *
 * 座標是艦體座標：X 橫向（+X 右舷）、Y 上（水線為 0）、−Z 艦首。三條同一個比例。
 *
 * 【甲板條右舷在上】俯視時艦首朝左，上方就是右舷（地圖上往西開的船，右舷朝北）。
 * 左舷在上的是從船底往上看的鏡像，照俯視照片畫的走道會左右顛倒。
 *
 * 每個面依材質與法線歸到一條：
 * - 甲板材質 → 甲板條（俯視投影）
 * - 船身材質、朝上的面 → 單色區（水平面一律漆甲板藍，迷彩只在立面）
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

export type ShipStrip = 'port' | 'starboard' | 'deck' | 'flat'
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
 * 單色區的邊長，px。它的面三個 UV 指向同一點（導數為零），平常讀的是第 0 級；
 * 周圍的空白也塗同一個色（畫圖腳本的約定），任何一級都讀得到它。
 */
export const SHIP_LIVERY_FLAT = 64

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
  const flat = {
    x: SHIP_LIVERY_WIDTH - g - SHIP_LIVERY_FLAT,
    y: SHIP_LIVERY_HEIGHT - g - SHIP_LIVERY_FLAT,
    w: SHIP_LIVERY_FLAT, h: SHIP_LIVERY_FLAT,
  }
  if (!(w > 0 && sideH > 0 && deckH > 0)) throw new Error('船的塗裝版面：範圍要是正的')
  if (g + w + g > SHIP_LIVERY_WIDTH) {
    throw new Error(`船的塗裝版面：寬 ${w.toFixed(0)} px 放不進 ${SHIP_LIVERY_WIDTH}`)
  }
  if (deck.y + deckH + g > SHIP_LIVERY_HEIGHT) {
    throw new Error(`船的塗裝版面：三條共 ${(deck.y + deckH + g).toFixed(0)} px 高，放不進 ${SHIP_LIVERY_HEIGHT}`)
  }
  // 單色區在甲板條右邊或下面都可以，不能與它重疊
  if (deck.y + deckH + g > flat.y && g + w + g > flat.x) {
    throw new Error('船的塗裝版面：單色區與甲板條重疊')
  }
  return { port, starboard, deck, flat }
}

/**
 * 一個面歸哪一區。`n` 是面法線（不必正規化），`cx` 是重心的 x。
 */
export function shipFaceStrip(
  kind: ShipFaceKind, nx: number, ny: number, nz: number, cx: number,
): ShipStrip {
  if (kind === 'deck') return 'deck'
  const h = Math.hypot(nx, nz)
  if (ny >= h * UP_BIAS) return 'flat'
  const len = Math.hypot(nx, ny, nz)
  const side = Math.abs(nx) >= SIDE_NX * len ? nx : cx
  return side >= 0 ? 'starboard' : 'port'
}

/** 艦體座標的一點 → 該區的像素座標，寫進 `out` */
export function shipLiveryPixel(
  out: number[], strip: ShipStrip, x: number, y: number, z: number,
  L: ShipLiveryLayout, R: Record<ShipStrip, ShipRect>,
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
    case 'flat':
      out[0] = R.flat.x + R.flat.w / 2
      out[1] = R.flat.y + R.flat.h / 2
      break
  }
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
  for (let i = 0; i + 2 < n; i += 3) {
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i)
    const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1)
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2)
    // 逆時針為正面，(b−a)×(c−a) 朝外
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const strip = shipFaceStrip(
      kind, uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx, (ax + bx + cx) / 3)
    for (let k = 0; k < 3; k++) {
      const j = i + k
      shipLiveryPixel(p, strip, pos.getX(j), pos.getY(j), pos.getZ(j), L, R)
      uv[j * 2] = p[0]! / SHIP_LIVERY_WIDTH
      uv[j * 2 + 1] = p[1]! / SHIP_LIVERY_HEIGHT
      px[k * 2] = p[0]!
      px[k * 2 + 1] = p[1]!
    }
    visit?.(strip, px)
  }
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
}
