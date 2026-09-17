import {
  BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial,
} from 'three'
import type { HeightFieldData } from '../world/heightfield'
import { assetUrl } from '../core/asset'

/**
 * 洛伊納一帶的河道，只給展示區用。
 *
 * 資料：© OpenStreetMap contributors，ODbL，由
 * `tools/dem/fetch-leuna-rivers.mjs` 抓成 `public/data/leuna-rivers.json`。
 *
 * 【河谷是免費的，河道不是】DEM 已經帶著薩勒河谷 —— 廠區以東 2.4 km 開始
 * 下降，谷底比廠區低 22 m。那個尺度有好幾公里寬，高度場看得到。
 *
 * 【水面鋪在地表上，河槽不挖】高度場一格 80 m，而薩勒河實際寬 50–80 m ——
 * **在 80 m 的格子上挖不出比 160 m 窄的槽**，挖了會被相鄰格點的內插填回去，
 * 水面反而被兩岸埋掉。要挖得看得見就得挖成 240 m 寬，那不是河是運河。
 *
 * 所以每一點取當地地形的高度加一點餘裕。投彈高度看下去與挖出來的沒有差別；
 * 貼地飛過去會發現河沒有岸，那是這個解析度的代價。
 *
 * 【水面不能是一個全域平面】薩勒河在這 30 km 裡有落差（渠化、有船閘）。
 * 固定高度不是淹掉上游就是露出下游。水面做成**沿折線的帶狀網格**，每個頂點
 * 取當地的高度。
 */
export const LEUNA_RIVERS_URL = '/data/leuna-rivers.json'

export interface RiverFile {
  readonly rivers: readonly {
    readonly name: string
    readonly points: readonly (readonly [number, number])[]
  }[]
}

/** 水面的半寬，m */
const CHANNEL_HALF = 45
/**
 * 水面高出當地地形多少，m。
 *
 * 【它不是防閃爍的主力】相機遠平面 5,000 km，2 km 高度的深度解析度是
 * 0.25 m、4 km 是 1 m —— 靠抬高度抬到不閃，就會看得出河浮在田上。閃爍由
 * 材質上的 `polygonOffset` 治（見下），這個值只是餘裕。
 *
 * 【上限兩公尺】再高，低空飛過去看得出河浮在田上。
 */
const CLEARANCE = 1.2
/** 折線重新取樣的間距，m。要比高度場的一格細，否則彎道會切角 */
const STEP = 60
/** 縱剖面的平滑窗，取樣數。河面不該跟著地形的雜訊上下抖 */
const SMOOTH = 15

/** 一條河重新取樣之後的中心線，含每一點的水面高度 */
export interface WaterLine {
  readonly name: string
  readonly points: readonly (readonly [number, number])[]
  /** 水面高度，與 `points` 等長 */
  readonly level: readonly number[]
}

/** 折線依固定間距重新取樣 */
function resample(pts: readonly (readonly [number, number])[], step: number): [number, number][] {
  const out: [number, number][] = [[pts[0]![0], pts[0]![1]]]
  let carry = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-6) continue
    for (let d = step - carry; d < len; d += step) {
      const t = d / len
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
    carry = (carry + len) % step
  }
  out.push([pts[pts.length - 1]![0], pts[pts.length - 1]![1]])
  return out
}

/** 水面的半寬加一點，用來取橫斷面上最高的地 */
const CROSS = CHANNEL_HALF + 30

/**
 * 一條河的水面縱剖面。
 *
 * 【要取橫斷面的最高點不是中心線】水面是一條 90 m 寬的帶子，只看中心線的
 * 高度的話，帶子的兩緣會插進兩側略高的地裡 —— 畫面上是一條斷斷續續的河。
 *
 * 【平滑之後還要再頂一次】平滑會把局部的高點抹掉，抹掉的地方就是會露出
 * 地面的地方。所以取「平滑值與當地最高點的較大者」。
 */
function profile(field: HeightFieldData, pts: readonly (readonly [number, number])[]): number[] {
  const n = pts.length
  const top: number[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!
    const b = pts[Math.min(n - 1, i + 1)]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz) || 1
    const nx = -dz / len
    const nz = dx / len
    const p = pts[i]!
    let hi = -Infinity
    for (const s of [-1, -0.5, 0, 0.5, 1]) {
      hi = Math.max(hi, field.sample(p[0] + nx * CROSS * s, p[1] + nz * CROSS * s))
    }
    top.push(hi)
  }
  return top.map((h, i) => {
    let sum = 0
    let m = 0
    for (let k = Math.max(0, i - SMOOTH); k <= Math.min(n - 1, i + SMOOTH); k++) {
      sum += top[k]!
      m++
    }
    return Math.max(sum / m, h) + CLEARANCE
  })
}

/**
 * 一條河的中心線與水面高度。**不動高度場** —— 挖槽在 80 m 的格子上做不到，
 * 見檔頭。
 */
export function riverLines(field: HeightFieldData, file: RiverFile): WaterLine[] {
  const lines: WaterLine[] = []
  for (const r of file.rivers) {
    if (r.points.length < 2) continue
    const pts = resample(r.points, STEP)
    lines.push({ name: r.name, points: pts, level: profile(field, pts) })
  }
  return lines
}

/** 水面的顏色。十一月的內陸河是灰綠的，不是海那種藍 */
const WATER = 0x33454b

/** 沿中心線鋪一條帶狀的水面 */
export function buildRiverWater(lines: readonly WaterLine[]): Mesh {
  const pos: number[] = []
  const idx: number[] = []
  const wide = CHANNEL_HALF
  for (const line of lines) {
    const base = pos.length / 3
    const n = line.points.length
    for (let i = 0; i < n; i++) {
      const a = line.points[Math.max(0, i - 1)]!
      const b = line.points[Math.min(n - 1, i + 1)]!
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const len = Math.hypot(dx, dz) || 1
      const nx = -dz / len
      const nz = dx / len
      const p = line.points[i]!
      const y = line.level[i]!
      pos.push(p[0] + nx * wide, y, p[1] + nz * wide)
      pos.push(p[0] - nx * wide, y, p[1] - nz * wide)
    }
    // 【捲繞方向】左岸在 `2i`、右岸在 `2i+1`，所以逆時針是「左、下一個左、右」。
    // 反過來的話法線朝下，整條河會被背面剔除 —— 而畫面上就是**什麼都沒有**，
    // 不是一條黑帶子。
    //
    // 【急彎的那一格要丟掉】髮夾彎處兩岸的點會交換左右，四邊形翻面 ——
    // 實測 2,956 格裡有 21 格。丟掉留下的縫比一片翻面的水好看得多
    for (let i = 0; i + 1 < n; i++) {
      const k = base + i * 2
      for (const tri of [[k, k + 2, k + 1], [k + 1, k + 2, k + 3]]) {
        const [a, b, c] = tri as [number, number, number]
        const ux = pos[b * 3]! - pos[a * 3]!
        const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!
        const vx = pos[c * 3]! - pos[a * 3]!
        const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!
        if (uz * vx - ux * vz > 0) idx.push(a, b, c)
      }
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const mesh = new Mesh(geo, new MeshStandardMaterial({
    color: WATER, roughness: 0.22, metalness: 0.12,
    // 【深度上朝相機偏】水面貼著地面走，而遠平面 5,000 km 讓 2–4 km 高度的
    // 深度解析度只剩 0.25–1 m —— 靠抬高度治不了（抬到看得出河浮在田上還在
    // 閃）。`polygonOffset` 只動深度不動世界座標，這正是它存在的用途
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
  }))
  mesh.name = 'leunaRiverWater'
  return mesh
}

/** 抓 JSON。展示區在切到「洛伊納（實測）」時叫一次 */
export async function loadLeunaRivers(
  fetcher: (url: string) => Promise<RiverFile> =
  async (u) => (await fetch(assetUrl(u))).json() as Promise<RiverFile>,
): Promise<RiverFile> {
  return fetcher(LEUNA_RIVERS_URL)
}
