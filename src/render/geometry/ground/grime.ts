import { BufferAttribute, type BufferGeometry, type Vector3 } from 'three'

/**
 * # 車輛與地面砲的髒污：貼圖座標
 *
 * 車輛與地面砲沒有塗裝貼圖，顏色是頂點色。髒污是一張白底的圖集（`render/groundGrime.ts` 蓋印子），
 * 材質拿它當貼圖乘上頂點色：白 = 不變。
 *
 * 每一支 GLB 在圖集裡佔一格，格內照三角形的朝向投影到五塊：右側、左側、車頭、車尾、頂面。
 * 底面朝下看不到，算進頂面。圖的原點在左上角（貼圖 `flipY = false`），v 朝下 = 車上往下，
 * 所以雨痕往下拖。
 *
 * 【UV 用整台的模型座標算】在拆砲塔之前算（`glb.ts` 的 `bakeGroundScene`）；砲塔拆開、平移、
 * 轉動都不動 UV，髒污跟著零件走。
 */

/** 一格的邊長，px */
export const GRIME_CELL = 512
/** 圖集幾欄幾列。格數不夠時 `groundGrimeLayout` 丟錯 */
export const GRIME_COLUMNS = 4
export const GRIME_ROWS = 3
export const GRIME_ATLAS_WIDTH = GRIME_COLUMNS * GRIME_CELL
export const GRIME_ATLAS_HEIGHT = GRIME_ROWS * GRIME_CELL
/** 塊與塊、塊與格邊之間的空白，px。蓋印子時每一塊裁在它往外半個空白之內 */
export const GRIME_GUTTER = 8

/** 幾何烘好之後，版面掛在 `userData` 的這個鍵 */
export const GRIME_LAYOUT_KEY = 'grimeLayout'

/**
 * GLB 材質名 → 灰土的權重（頂點屬性 `dustWeight`，著色器把圖集的灰土比例乘上它）。
 * **履帶、輪胎是 0**：深色的橡膠混進淺土色就變成淺褐，看起來不對。表裡沒有的材質是 1
 */
export const GROUND_DUST_WEIGHT: Readonly<Record<string, number>> = {
  LP_Track: 0,
  LP_Tire: 0,
  LP_Glass: 0.4,
  LP_Steel: 0.6,
  LP_ArmorGreen: 1,
  LP_TruckGreen: 1,
  LP_GunGrey: 1,
  LP_Canvas: 1,
}

/** 圖集上的一塊，px */
export interface GrimeRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** 一支 GLB 在圖集裡的版面 */
export interface GroundGrimeLayout {
  readonly cell: number
  /** px / m */
  readonly scale: number
  /** 整台（砲塔在靜止姿勢）的模型座標包圍盒 */
  readonly min: { readonly x: number; readonly y: number; readonly z: number }
  readonly max: { readonly x: number; readonly y: number; readonly z: number }
  /** +x 那一側 */
  readonly right: GrimeRect
  /** −x 那一側 */
  readonly left: GrimeRect
  /** −z（車頭） */
  readonly front: GrimeRect
  /** +z（車尾） */
  readonly back: GrimeRect
  readonly top: GrimeRect
}

/**
 * 一支 GLB 的版面：格內由上往下排右側、左側、頂面，最下一列並排車頭與車尾。
 * 比例尺取排得下的最大值，五塊同一個比例尺。
 */
export function groundGrimeLayout(min: Vector3, max: Vector3, cell: number): GroundGrimeLayout {
  if (cell < 0 || cell >= GRIME_COLUMNS * GRIME_ROWS) {
    throw new Error(`髒污圖集只有 ${GRIME_COLUMNS * GRIME_ROWS} 格，第 ${cell} 格排不下`)
  }
  const W = max.x - min.x
  const H = max.y - min.y
  const L = max.z - min.z
  const G = GRIME_GUTTER
  const scale = Math.min(
    (GRIME_CELL - 2 * G) / L,
    (GRIME_CELL - 3 * G) / (2 * W),
    (GRIME_CELL - 5 * G) / (3 * H + W),
  )
  const ox = (cell % GRIME_COLUMNS) * GRIME_CELL + G
  const oy = Math.floor(cell / GRIME_COLUMNS) * GRIME_CELL + G
  const l = L * scale, w = W * scale, h = H * scale
  return {
    cell, scale,
    min: { x: min.x, y: min.y, z: min.z },
    max: { x: max.x, y: max.y, z: max.z },
    right: { x: ox, y: oy, w: l, h },
    left: { x: ox, y: oy + h + G, w: l, h },
    top: { x: ox, y: oy + 2 * (h + G), w: l, h: w },
    front: { x: ox, y: oy + 2 * (h + G) + w + G, w, h },
    back: { x: ox + w + G, y: oy + 2 * (h + G) + w + G, w, h },
  }
}

/**
 * 照每一個三角形的朝向寫 `uv`（模型座標，整台在靜止姿勢）。幾何要是無索引的 ——
 * 共用頂點的話，一個頂點屬於好幾面、只能讀到其中一塊。
 */
export function applyGroundGrimeUv(geo: BufferGeometry, L: GroundGrimeLayout): void {
  if (geo.index !== null) throw new Error('髒污的 UV 要算在無索引的幾何上')
  const p = geo.getAttribute('position')
  const uv = new Float32Array(p.count * 2)
  const s = L.scale
  for (let i = 0; i + 2 < p.count; i += 3) {
    const ax = p.getX(i), ay = p.getY(i), az = p.getZ(i)
    const ux = p.getX(i + 1) - ax, uy = p.getY(i + 1) - ay, uz = p.getZ(i + 1) - az
    const vx = p.getX(i + 2) - ax, vy = p.getY(i + 2) - ay, vz = p.getZ(i + 2) - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const mx = Math.abs(nx), my = Math.abs(ny), mz = Math.abs(nz)
    for (let k = i; k < i + 3; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k)
      let px: number, py: number
      if (mx >= my && mx >= mz) {
        const r = nx > 0 ? L.right : L.left
        px = r.x + (nx > 0 ? z - L.min.z : L.max.z - z) * s
        py = r.y + (L.max.y - y) * s
      } else if (mz >= my) {
        const r = nz < 0 ? L.front : L.back
        px = r.x + (nz < 0 ? x - L.min.x : L.max.x - x) * s
        py = r.y + (L.max.y - y) * s
      } else {
        px = L.top.x + (z - L.min.z) * s
        py = L.top.y + (x - L.min.x) * s
      }
      uv[k * 2] = px / GRIME_ATLAS_WIDTH
      uv[k * 2 + 1] = py / GRIME_ATLAS_HEIGHT
    }
  }
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
}
