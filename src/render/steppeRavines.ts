import { BufferAttribute, BufferGeometry, Color } from 'three'
import { FloraKind, hash2, pushFlora, type FloraSource } from './flora'
import {
  regionAt, trackGap, trackWidthAt, TRACK_WARP_MAX, TRACK_WIDTH_MAX, type RegionSample,
} from './fields'
import { FIELD_COLORS } from './season'
import type { Ravine } from '../world/kurskRavines'

/**
 * # 沖溝的畫法（只有平面）
 *
 * 走向在 `world/kurskRavines.ts`。這裡把它畫成三樣東西：
 *
 * - **溝帶**（`buildRavineStripes`）：平貼烘進地面貼圖的一條**不透明**的帶子，蓋掉底下的田、
 *   田埂與凹路 —— 田在溝緣停住，像是溝先在那裡、田被它切斷。斷面由外到內：田埂色的邊（田的
 *   邊界沿著溝緣）、溝坡的草、溝底的灌木。**沒有起伏** —— 高度場一格 80 m，做不出窄溝。
 * - **渡口**（`buildRavineFords`）：凹路穿過溝的地方，把路色補回溝帶上，路沒有被溝切斷。
 * - **沿線的樹與灌木**（`steppeRavineFloraFor`）：溝底的樹、溝坡的灌木，兩岸交錯。
 *
 * 【座標只由全域索引決定】植被的鐵律（見 `flora.ts` 檔頭）：樹的位置由「沿這條溝的弧長索引」
 * 與溝的編號決定，tile 的邊界只用來過濾。
 */

/** 溝坡的草色與溝底的灌木色 */
export const RAVINE_SLOPE = 0x6d7442
export const RAVINE_BOTTOM = 0x3d4b2b
/** 田埂色的邊：實心的寬度與淡出的寬度，m */
export const RAVINE_RIM_SOLID = 4
export const RAVINE_RIM_FADE = 4
/** 渡口的格寬，m：凹路在溝帶上以這個大小的方格補回 */
export const FORD_CELL = 3
/** 沿溝每隔多遠一棵樹（兩岸交錯，所以一岸是兩倍），m */
export const RAVINE_TREE_SPACING = 7
/** 沿溝每隔多遠一叢灌木，m */
export const RAVINE_BUSH_SPACING = 4.5
/** 離凹路的路緣至少多遠，m */
export const RAVINE_ROAD_CLEAR = 10
/** 樹的縮放：溝裡的樹比人工林帶更矮（1.0 是 30 m） */
const TREE_SCALE = [0.35, 0.65] as const
const BUSH_SCALE = [0.6, 1.0] as const
/** 沿線抖動的幅度，佔間距的比例。必須 < 0.5，否則相鄰兩株會交換次序 */
const ALONG_JITTER = 0.3
/** 這一比例的樹留成缺口 */
const GAP = 0.12
/** 針葉樹的比例 */
const CONE_SHARE = 0.15
/** 緊貼中線的那一段不種，m */
const CLEAR_CORE = 3

const REG: RegionSample = {
  r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}

interface Prepared {
  readonly ravine: Ravine
  readonly index: number
  /** 到每一點的累計弧長 */
  readonly cum: Float64Array
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

function prepare(ravine: Ravine, index: number): Prepared {
  const pts = ravine.points
  const cum = new Float64Array(pts.length)
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    if (i > 0) cum[i] = cum[i - 1]! + Math.hypot(p.x - pts[i - 1]!.x, p.z - pts[i - 1]!.z)
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  return { ravine, index, cum, minX, maxX, minZ, maxZ }
}

/**
 * 樹與灌木能不能種在這一點：不壓在凹路上。
 *
 * 【村不在這裡擋】村的房子、菜園與支路讓開溝（`ravineKeepOut`，進村的禁區），所以溝可以穿過村的
 * 地界，不必在村邊斷掉
 */
function spotOk(x: number, z: number): boolean {
  regionAt(x, z, REG)
  return trackGap(x, z, REG) >= trackWidthAt(x, z) + RAVINE_ROAD_CLEAR
}

/** 村的房子、菜園與支路離溝帶外緣至少多遠，m */
export const RAVINE_HOUSE_CLEAR = 18

/**
 * 村的禁區：溝帶（含田埂色的邊）再加 `RAVINE_HOUSE_CLEAR` 以內不准蓋房子、種樹與菜園，村的支路
 * 在這裡停下來（`steppeVillage.ts` 的 `keepOut`，與 `battleKeepOut` 併用）。
 *
 * 地形先在，村去配合它：溝沿線的村落在溝的一側，不蓋進溝裡。
 *
 * 熱路徑之外：載入時每個候選位置問一次；離任何一條溝的外接盒遠的點一次比較就回。
 */
export function ravineKeepOutFor(ravines: readonly Ravine[]): (x: number, z: number) => boolean {
  const pre = ravines.map(prepare)
  return (x, z) => {
    for (const p of pre) {
      const r = p.ravine
      const m = r.half + RAVINE_RIM_SOLID + RAVINE_HOUSE_CLEAR
      if (x < p.minX - m || x > p.maxX + m || z < p.minZ - m || z > p.maxZ + m) continue
      const pts = r.points
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!
        const b = pts[i + 1]!
        const room = r.half * Math.max(r.scale[i]!, r.scale[i + 1]!) + RAVINE_RIM_SOLID + RAVINE_HOUSE_CLEAR
        const abx = b.x - a.x
        const abz = b.z - a.z
        const len2 = abx * abx + abz * abz
        const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / len2))
        const dx = x - (a.x + abx * t)
        const dz = z - (a.z + abz * t)
        if (dx * dx + dz * dz < room * room) return true
      }
    }
    return false
  }
}

/**
 * 沿溝種樹與灌木。`ravines` 是整張圖的溝（`world/kurskRavines.ts` 的 `RAVINES`）
 */
export function steppeRavineFloraFor(ravines: readonly Ravine[]): FloraSource {
  const pre = ravines.map(prepare)
  return (x0, z0, x1, z1, heightAt, out) => {
    for (const p of pre) {
      const r = p.ravine
      if (p.maxX + r.band < x0 || p.minX - r.band >= x1 || p.maxZ + r.band < z0 || p.minZ - r.band >= z1) continue
      const pts = r.points
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!
        const b = pts[i + 1]!
        if (Math.max(a.x, b.x) + r.band < x0 || Math.min(a.x, b.x) - r.band >= x1
          || Math.max(a.z, b.z) + r.band < z0 || Math.min(a.z, b.z) - r.band >= z1) continue
        const s0 = p.cum[i]!
        const s1 = p.cum[i + 1]!
        const len = s1 - s0
        const dx = (b.x - a.x) / len
        const dz = (b.z - a.z) / len
        // 【兩輪用索引不用陣列】這支每補一格 tile 就跑一次，陣列字面值每次都配置
        for (let pass = 0; pass < 2; pass++) {
          const bush = pass === 1
          const spacing = bush ? RAVINE_BUSH_SPACING : RAVINE_TREE_SPACING
          const k0 = Math.floor(s0 / spacing) - 1
          const k1 = Math.floor(s1 / spacing) + 1
          for (let k = k0; k <= k1; k++) {
            const h = hash2(k, (p.index * 7919) ^ (bush ? 0x51ed : 0x7a11))
            const s = (k + 0.5 + ((h / 4294967296) - 0.5) * 2 * ALONG_JITTER) * spacing
            if (s < s0 || s >= s1) continue
            const h2 = hash2(h, 0x2b1)
            const u = h2 / 4294967296
            if (!bush && u < GAP) continue
            // 這一點的寬度倍率：溝頭、溝尾與靠近方框的地方收窄，樹也跟著稀疏
            const t = (s - s0) / len
            const sc = r.scale[i]! + (r.scale[i + 1]! - r.scale[i]!) * t
            if ((bush ? u : (u - GAP) / (1 - GAP)) > Math.min(1, sc * 1.6)) continue
            // 溝的寬窄沿線緩緩變化；灌木靠溝坡（外），樹靠溝底（內）
            const wide = r.band * sc * (0.75 + 0.25 * Math.sin(s * 0.02 + p.index))
            const core = CLEAR_CORE * sc
            const h3 = hash2(h2, 0x3c1)
            const f = h3 / 4294967296
            const mag = bush ? core + (wide - core) * (0.3 + 0.7 * f)
              : core + (wide * 0.7 - core) * f
            const sign = ((bush ? hash2(h3, 1) : k) & 1) === 0 ? -1 : 1
            const x = a.x + (b.x - a.x) * t - dz * mag * sign
            const z = a.z + (b.z - a.z) * t + dx * mag * sign
            if (x < x0 || x >= x1 || z < z0 || z >= z1) continue
            if (!spotOk(x, z)) continue
            const h4 = hash2(h3, 0x4d2)
            const scale = bush ? BUSH_SCALE : TREE_SCALE
            pushFlora(
              out, x, heightAt(x, z), z, (h4 / 4294967296) * Math.PI * 2,
              scale[0] + (hash2(h4, 5) / 4294967296) * (scale[1] - scale[0]),
              (hash2(h4, 7) & 0xff) / 255,
              bush ? FloraKind.Bush : u < GAP + CONE_SHARE * (1 - GAP) ? FloraKind.ConeTree : FloraKind.BroadTree,
            )
          }
        }
      }
    }
  }
}

/** 溝帶一個斷面的頂點數：左邊三個、溝坡一個、溝底兩個、中線一個，右邊對稱 */
export const STRIPE_SECTION = 11
/** 一個斷面相鄰兩個頂點之間畫四邊形的位置（跳過 2→3 與 7→8：同一個位置、只換色，是硬邊） */
const STRIPE_QUADS = [0, 1, 3, 4, 5, 6, 8, 9] as const

/**
 * 溝帶的網格：每一條溝一條帶子，一個點 `STRIPE_SECTION` 個頂點，斷面由左到右：
 * 田埂色的邊（淡出 → 實心）→ 溝坡的草 → 溝底的灌木 → 對稱回去。邊與草之間是硬邊（同一個位置
 * 兩個頂點、兩種顏色），所以田埂是一條清楚的線；草到灌木是漸層。烘進地面貼圖時整條不透明、
 * 只有最外緣淡出（`fieldClipmap.ts` 的 `addOverlay`，頂點色第四個分量是不透明度）。
 * `keep` 回 false 的點把帶子切斷（離村太近的地方）。
 *
 * 【y 不讀】烘圖只用世界 xz。
 */
export function buildRavineStripes(
  ravines: readonly Ravine[], keep: (x: number, z: number) => boolean = () => true,
): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const tint = [new Color(FIELD_COLORS.julyWheat.hedge), new Color(RAVINE_SLOPE), new Color(RAVINE_BOTTOM)]
  for (const r of ravines) {
    const pts = r.points
    let runStart = -1
    const end = (last: number): void => {
      if (runStart < 0 || last - runStart < 1) { runStart = -1; return }
      const base = pos.length / 3
      for (let i = runStart; i <= last; i++) {
        const a = pts[Math.max(runStart, i - 1)]!
        const b = pts[Math.min(last, i + 1)]!
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
        const nx = -(b.z - a.z) / len
        const nz = (b.x - a.x) / len
        const p = pts[i]!
        // 溝頭、溝尾收窄：半寬與田埂色的邊都跟著寬度倍率縮（邊至少留一半，細溝才讀得出邊）
        const sc = r.scale[i]!
        const h = r.half * sc
        const rimIn = RAVINE_RIM_SOLID * (0.5 + 0.5 * sc)
        const rimOut = rimIn + RAVINE_RIM_FADE * (0.5 + 0.5 * sc)
        // [離中線的偏移 m, 顏色, 不透明度]
        const section: readonly (readonly [number, number, number])[] = [
          [-(h + rimOut), 0, 0], [-(h + rimIn), 0, 1], [-h, 0, 1], [-h, 1, 1], [-0.4 * h, 2, 1], [0, 2, 1],
          [0.4 * h, 2, 1], [h, 1, 1], [h, 0, 1], [h + rimIn, 0, 1], [h + rimOut, 0, 0],
        ]
        for (const [off, id, alpha] of section) {
          pos.push(p.x + nx * off, 0, p.z + nz * off)
          const c = tint[id]!
          col.push(c.r, c.g, c.b, alpha)
        }
      }
      for (let i = 0; i < last - runStart; i++) {
        const k = base + i * STRIPE_SECTION
        for (const q of STRIPE_QUADS) {
          const a = k + q
          const b = a + 1
          idx.push(a, a + STRIPE_SECTION, b, b, a + STRIPE_SECTION, b + STRIPE_SECTION)
        }
      }
      runStart = -1
    }
    for (let i = 0; i < pts.length; i++) {
      if (keep(pts[i]!.x, pts[i]!.z)) { if (runStart < 0) runStart = i } else end(i - 1)
    }
    end(pts.length - 1)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 4))
  geo.setIndex(idx)
  return geo
}

/** 一點到折線第 `i − 1`、`i`、`i + 1` 三段的最短距離 */
function nearSegments(x: number, z: number, pts: Ravine['points'], i: number): number {
  let best = Infinity
  for (let j = Math.max(0, i - 1); j <= Math.min(pts.length - 2, i + 1); j++) {
    const a = pts[j]!
    const b = pts[j + 1]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const len2 = abx * abx + abz * abz
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / len2))
    const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t))
    if (d < best) best = d
  }
  return best
}

/**
 * 渡口：凹路穿過溝帶的地方，把路色以 `FORD_CELL` 的方格補回去（溝帶不透明，會蓋掉底下的路）。
 * 一個格子在溝帶的範圍裡、而且在凹路上才補（判準與地面著色器同一條式子：`trackGap < trackWidthAt`）。
 * 烘在溝帶之後。`keep` 同 `buildRavineStripes`。
 */
export function buildRavineFords(
  ravines: readonly Ravine[], keep: (x: number, z: number) => boolean = () => true,
): BufferGeometry {
  const cells = new Set<string>()
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const c = new Color(FIELD_COLORS.julyWheat.track)
  for (const r of ravines) {
    // 窗的半邊：全寬的溝帶加一格。每個取樣點再依自己的寬度倍率縮小 `reach`
    const win = r.half + RAVINE_RIM_SOLID + FORD_CELL
    const pts = r.points
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!
      const b = pts[i + 1]!
      const len = Math.hypot(b.x - a.x, b.z - a.z)
      for (let s = 0; s < len; s += 10) {
        const cx = a.x + ((b.x - a.x) * s) / len
        const cz = a.z + ((b.z - a.z) * s) / len
        if (!keep(cx, cz)) continue
        const reach = r.half * (r.scale[i]! + (r.scale[i + 1]! - r.scale[i]!) * (s / len)) + RAVINE_RIM_SOLID
        regionAt(cx, cz, REG)
        // `r2 − r1` 每走一公尺最多差兩公尺：窗裡任何一點都碰不到路就整窗跳過
        if (REG.r2 - REG.r1 >= TRACK_WIDTH_MAX + 2 * TRACK_WARP_MAX + 2 * win) continue
        const ix0 = Math.floor((cx - win) / FORD_CELL)
        const ix1 = Math.floor((cx + win) / FORD_CELL)
        const iz0 = Math.floor((cz - win) / FORD_CELL)
        const iz1 = Math.floor((cz + win) / FORD_CELL)
        for (let iz = iz0; iz <= iz1; iz++) {
          for (let ix = ix0; ix <= ix1; ix++) {
            const key = `${ix},${iz}`
            if (cells.has(key)) continue
            const x = (ix + 0.5) * FORD_CELL
            const z = (iz + 0.5) * FORD_CELL
            if (nearSegments(x, z, pts, i) > reach) continue
            regionAt(x, z, REG)
            if (trackGap(x, z, REG) >= trackWidthAt(x, z)) continue
            cells.add(key)
            const base = pos.length / 3
            const x1 = ix * FORD_CELL
            const z1 = iz * FORD_CELL
            pos.push(x1, 0, z1, x1 + FORD_CELL, 0, z1, x1 + FORD_CELL, 0, z1 + FORD_CELL, x1, 0, z1 + FORD_CELL)
            for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b, 1)
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
          }
        }
      }
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 4))
  geo.setIndex(idx)
  return geo
}
