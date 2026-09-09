import {
  BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial,
} from 'three'
import type { HeightFieldData } from '../world/heightfield'
import {
  createFloraBuffer, FLORA_STRIDE, FloraKind, pushFlora,
  type FloraBuffer, type FloraSource,
} from '../render/flora'
import type { WaterLine } from './leunaRiver'

/**
 * 河廊：河岸的草甸、把田的樹籬擋在河邊之外、以及沿岸的河岸林。只給展示區用。
 *
 * 【為什麼要做】河面鋪好之後最刺眼的變成田 —— 犁過的方格與樹籬一路壓到水邊，
 * 河看起來像畫在田上的一條線。真實的河廊是沒犁過的草地加一排沿岸的樹，而且
 * 田的格線在那裡會斷掉。
 */

/** 草甸帶的半寬，m */
const MEADOW_HALF = 190
/** 樹籬被擋開的半寬，m。比草甸窄一點 —— 帶子的外緣本來就在漸變回田 */
const CLEAR_HALF = 150
/** 河岸林的半寬帶：離中心線這個範圍內撒樹，m */
const TREE_NEAR = 55
const TREE_FAR = 145

/** 草甸的顏色。十一月沒犁過的河灘：偏黃的枯草，比田的褐土亮 */
const MEADOW = 0x6e6a4a

/**
 * 線段的格點索引。植被的過濾與撒樹一格會問上千次，線性掃六百段太慢。
 */
class LineIndex {
  private readonly cells = new Map<string, [number, number, number, number][]>()
  private readonly bucket: number

  constructor(lines: readonly WaterLine[], reach: number) {
    this.bucket = Math.max(200, reach * 2)
    for (const l of lines) {
      for (let i = 0; i + 1 < l.points.length; i++) {
        const seg: [number, number, number, number] = [
          l.points[i]![0], l.points[i]![1], l.points[i + 1]![0], l.points[i + 1]![1],
        ]
        const i0 = Math.floor((Math.min(seg[0], seg[2]) - reach) / this.bucket)
        const i1 = Math.floor((Math.max(seg[0], seg[2]) + reach) / this.bucket)
        const j0 = Math.floor((Math.min(seg[1], seg[3]) - reach) / this.bucket)
        const j1 = Math.floor((Math.max(seg[1], seg[3]) + reach) / this.bucket)
        for (let j = j0; j <= j1; j++) {
          for (let i2 = i0; i2 <= i1; i2++) {
            const k = `${i2},${j}`
            const list = this.cells.get(k)
            if (list === undefined) this.cells.set(k, [seg])
            else list.push(seg)
          }
        }
      }
    }
  }

  /** 到最近一條河的距離，m。超出索引範圍回 Infinity */
  distance(x: number, z: number): number {
    const bi = Math.floor(x / this.bucket)
    const bj = Math.floor(z / this.bucket)
    let best = Infinity
    for (let j = bj - 1; j <= bj + 1; j++) {
      for (let i = bi - 1; i <= bi + 1; i++) {
        for (const s of this.cells.get(`${i},${j}`) ?? []) {
          const vx = s[2] - s[0]
          const vz = s[3] - s[1]
          const l2 = vx * vx + vz * vz
          const t = l2 <= 0 ? 0 : Math.max(0, Math.min(1, ((x - s[0]) * vx + (z - s[1]) * vz) / l2))
          const d = Math.hypot(x - (s[0] + vx * t), z - (s[1] + vz * t))
          if (d < best) best = d
        }
      }
    }
    return best
  }
}

/**
 * 河岸的草甸：一條貼著地形的帶子。
 *
 * 【要跟著地形起伏】只取中心線高度的話，一條 380 m 寬的平帶子在起伏的地上
 * 會一半陷進去一半浮起來。所以橫向也切段，每一個頂點各自取當地地形。
 *
 * 【`polygonOffset` 不是抬高度】它與地面幾乎共面，而投彈高度的深度解析度
 * 只剩公尺級 —— 靠抬高度會看得出草甸浮在田上，見 `leunaRiver.ts` 的水面。
 */
export function buildBankGround(
  field: HeightFieldData, lines: readonly WaterLine[],
): Mesh {
  const pos: number[] = []
  const idx: number[] = []
  /** 橫向切幾段。太少的話帶子跨不過地形的起伏 */
  const CROSS = 6
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
      for (let c = 0; c <= CROSS; c++) {
        const s = (c / CROSS) * 2 - 1
        const x = p[0] + nx * MEADOW_HALF * s
        const z = p[1] + nz * MEADOW_HALF * s
        pos.push(x, field.sample(x, z) + 0.15, z)
      }
    }
    for (let i = 0; i + 1 < n; i++) {
      for (let c = 0; c < CROSS; c++) {
        const k = base + i * (CROSS + 1) + c
        const kn = k + CROSS + 1
        // 【捲繞方向】與水面同一個坑：反了就整條被背面剔除，畫面上什麼都沒有
        idx.push(k, kn, k + 1, k + 1, kn, kn + 1)
      }
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const mesh = new Mesh(geo, new MeshStandardMaterial({
    color: MEADOW, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }))
  mesh.name = 'leunaBankGround'
  return mesh
}

/**
 * 把一個散佈器包成「離河太近就不長」。與 `floraExclude.ts` 的矩形版同一個
 * 做法，只是判準換成到折線的距離。
 *
 * 【為什麼不能用矩形】河是彎的，能框住它的矩形會把半張圖的樹籬也砍掉。
 */
export function excludingCorridor(
  source: FloraSource, lines: readonly WaterLine[], halfWidth = CLEAR_HALF,
): FloraSource {
  const index = new LineIndex(lines, halfWidth)
  let scratch: FloraBuffer | null = null
  return (x0, z0, x1, z1, heightAt, out) => {
    if (scratch === null || scratch.capacity < out.capacity) {
      scratch = createFloraBuffer(out.capacity)
    }
    scratch.count = 0
    scratch.dropped = 0
    source(x0, z0, x1, z1, heightAt, scratch)
    for (let i = 0; i < scratch.count; i++) {
      const o = i * FLORA_STRIDE
      if (index.distance(scratch.data[o]!, scratch.data[o + 2]!) < halfWidth) continue
      if (out.count >= out.capacity) { out.dropped++; continue }
      const d = out.count * FLORA_STRIDE
      for (let k = 0; k < FLORA_STRIDE; k++) out.data[d + k] = scratch.data[o + k]!
      out.kind[out.count] = scratch.kind[i]!
      out.count++
    }
    out.dropped += scratch.dropped
  }
}

/** 沿岸撒樹的間距，m */
const TREE_STEP = 22

/**
 * 河岸林：沿著中心線兩側撒闊葉樹與灌木。
 *
 * 【位置只由全域索引決定】與農地那三支同一條鐵律 —— 位置若跟著「現在畫到
 * 哪一格」變，同一棵樹在相鄰的兩格會長在兩個地方。這裡的索引是
 * 「第幾條河、第幾站、左右哪一邊」，與視窗無關。
 */
export function riverBankFlora(lines: readonly WaterLine[]): FloraSource {
  /** 站址預先算好，`FloraSource` 每一格只做視窗篩選 */
  const spots: { x: number; z: number; rot: number; scale: number; kind: FloraKind }[] = []
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!
    const n = line.points.length
    let carry = 0
    for (let i = 0; i + 1 < n; i++) {
      const a = line.points[i]!
      const b = line.points[i + 1]!
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const len = Math.hypot(dx, dz)
      if (len < 1e-6) continue
      const nx = -dz / len
      const nz = dx / len
      for (let d = TREE_STEP - carry; d < len; d += TREE_STEP) {
        const t = d / len
        const px = a[0] + dx * t
        const pz = a[1] + dz * t
        for (const side of [-1, 1]) {
          // 【雜湊只吃全域索引】li、i、d 的整數化與 side，與視窗無關
          let h = (li * 0x9e3779b1 + i * 0x85ebca6b + Math.round(d) * 0x27d4eb2d
            + (side + 2) * 0x165667b1) >>> 0
          h = ((h ^ (h >>> 15)) * 0x2545f491) >>> 0
          h = (h ^ (h >>> 13)) >>> 0
          // 三成的站不長，否則是一排等距的行道樹
          if ((h & 0xff) < 78) continue
          const off = TREE_NEAR + (((h >>> 8) & 0xff) / 255) * (TREE_FAR - TREE_NEAR)
          const jitter = (((h >>> 16) & 0xff) / 255 - 0.5) * TREE_STEP
          spots.push({
            x: px + nx * off * side + (dx / len) * jitter,
            z: pz + nz * off * side + (dz / len) * jitter,
            rot: (((h >>> 20) & 0xff) / 255) * Math.PI * 2,
            scale: 0.8 + (((h >>> 24) & 0x3f) / 63) * 0.7,
            kind: ((h >>> 6) & 0x3) === 0 ? FloraKind.Bush : FloraKind.BroadTree,
          })
        }
      }
      carry = (carry + len) % TREE_STEP
    }
  }
  return (x0, z0, x1, z1, heightAt, out) => {
    for (const s of spots) {
      if (s.x < x0 || s.x >= x1 || s.z < z0 || s.z >= z1) continue
      pushFlora(out, s.x, heightAt(s.x, s.z), s.z, s.rot, s.scale, 0.5, s.kind)
    }
  }
}
