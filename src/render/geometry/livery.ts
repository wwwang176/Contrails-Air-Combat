import { BufferAttribute, type BufferGeometry } from 'three'

/**
 * 塗裝貼圖的版面：四個正投影視圖（上、下、左、右）拼在一張圖上，UV 在載入時
 * 依這份版面算，不存在 GLB 裡。
 *
 * 座標一律是機體座標：X 翼展（+X 右翼）、Y 上、Z 機尾（機首在 −Z）。
 *
 * 每一個視圖都是「站在那一側看過去」的樣子，畫貼圖的照看到的畫：
 *     上視  機首朝上、右翼在右        （左上 1024×1024）
 *     下視  機首朝上、右翼在**左**    （右上 1024×1024）
 *     左視  機首在左                  （左下 1024×512）
 *     右視  機首在右                  （右下 1024×512）
 *
 * 每個三角形依法線歸到其中一個視圖。斜面會被拉長；朝前後的面（槳轂、尾錐末端）
 * 歸到 x、y 裡較大的那一邊，拉得最長，但面積都很小。
 *
 * 【貼圖是照這份版面畫的】`tools/livery/*.py` 讀的版面是
 * `test/tools/livery-faces.ts` 從這裡倒出去的。改了這裡的任何一個數，貼圖要重畫，
 * 否則標誌會畫到空白處而不會報錯。
 */
export interface LiveryLayout {
  /** 貼圖路徑（`public/` 底下） */
  url: string
  /** 每公尺幾 px。四個視圖同一個比例 */
  scale: number
  /** 上下視中心的 z */
  planZ: number
  /** 左右視中心的 y */
  sideY: number
  /**
   * 另外擺的零件。
   *
   * 【為什麼要搬】正投影下，上下疊著的兩個面會投到貼圖的同一塊：平尾的下面與
   * 尾錐的下面、發動機艙的側面與機身側面。搬到空位之後兩邊各畫各的，不會一邊
   * 的塗裝跟著上另一邊。
   */
  moves?: readonly LiveryMove[]
}

export interface LiveryMove {
  /** 認零件：GLB 的 `part` 標記（glTF extras） */
  part?: string
  /** 認零件：GLB 節點名的開頭（載入後名字裡的點已被拿掉） */
  node?: string
  /** 上下視的位移（m）：x 是**往外推**（左右兩半各自朝外）、z 照加 */
  plan?: readonly [number, number]
  /** 左右視的位移（m）：z、y */
  side?: readonly [number, number]
}

export const LIVERY_WIDTH = 2048
export const LIVERY_HEIGHT = 1536

export type LiveryView = 'top' | 'bottom' | 'left' | 'right'

/** 各視圖中心在圖上的位置，px */
const ORIGIN: Record<LiveryView, readonly [number, number]> = {
  top: [512, 512],
  bottom: [1536, 512],
  left: [512, 1280],
  right: [1536, 1280],
}

/**
 * 側視的偏好：法線的水平分量乘上這個數還比垂直分量大，就歸側視（約 55° 以內）。
 *
 * 【為什麼要偏向側視】機身是圓的，一比一分的話側面只剩中間一條窄帶，機身
 * 標誌、代號跨過分界就被切成兩半 —— 另一半貼的是上視那一塊的漆。機翼幾乎
 * 水平，不受影響。
 */
const SIDE_BIAS = 1.4

export function liveryView(nx: number, ny: number): LiveryView {
  if (Math.abs(ny) >= Math.abs(nx) * SIDE_BIAS) return ny >= 0 ? 'top' : 'bottom'
  return nx > 0 ? 'right' : 'left'
}

/**
 * 機體座標的一點 → 該視圖上的像素座標，寫進 `out`。
 *
 * `half` 是搬位零件的這個面在哪一半（−1 左、+1 右，看面中心）。同一個面的
 * 三個頂點要用同一個值，否則跨中線的面會被撕開。
 */
export function liveryPixel(
  out: number[], view: LiveryView, x: number, y: number, z: number,
  L: LiveryLayout, move: LiveryMove | null, half: number,
): void {
  if (move?.plan && (view === 'top' || view === 'bottom')) {
    x += half * move.plan[0]
    z += move.plan[1]
  }
  if (move?.side && (view === 'left' || view === 'right')) {
    z += move.side[0]
    y += move.side[1]
  }
  const [ox, oy] = ORIGIN[view]
  const s = L.scale
  switch (view) {
    case 'top': out[0] = ox + x * s; out[1] = oy + (z - L.planZ) * s; break
    case 'bottom': out[0] = ox - x * s; out[1] = oy + (z - L.planZ) * s; break
    case 'left': out[0] = ox + (z - L.planZ) * s; out[1] = oy - (y - L.sideY) * s; break
    case 'right': out[0] = ox - (z - L.planZ) * s; out[1] = oy - (y - L.sideY) * s; break
  }
}

/** 這個零件要不要搬、搬多少 */
export function liveryMoveFor(
  L: LiveryLayout, name: string, part: unknown,
): LiveryMove | null {
  for (const m of L.moves ?? []) {
    if (m.part !== undefined && m.part === part) return m
    if (m.node !== undefined && name.startsWith(m.node)) return m
  }
  return null
}

/**
 * 逐三角形算塗裝 UV，寫進 `uv`。**幾何要是沒有索引的**：相鄰兩個面可能歸到
 * 不同視圖，共用頂點就只能有一組 UV。
 *
 * 呼叫端先把頂點烘進機體座標。`visit` 給倒版面的工具用：每個三角形回報一次
 * 視圖與三個頂點的像素座標。
 */
export function applyLiveryUv(
  geo: BufferGeometry, L: LiveryLayout, move: LiveryMove | null,
  visit?: (view: LiveryView, px: readonly number[]) => void,
): void {
  if (geo.index !== null) throw new Error('塗裝 UV 要沒有索引的幾何')
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
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const view = liveryView(nx, ny)
    const half = (ax + bx + cx) >= 0 ? 1 : -1
    for (let k = 0; k < 3; k++) {
      const j = i + k
      liveryPixel(p, view, pos.getX(j), pos.getY(j), pos.getZ(j), L, move, half)
      uv[j * 2] = p[0]! / LIVERY_WIDTH
      uv[j * 2 + 1] = p[1]! / LIVERY_HEIGHT
      px[k * 2] = p[0]!
      px[k * 2 + 1] = p[1]!
    }
    visit?.(view, px)
  }
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
}
