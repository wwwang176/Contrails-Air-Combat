import {
  BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial,
} from 'three'
import { FloraKind, pushFlora, type FloraSource } from './flora'
import { excludingWhere } from './floraExclude'
import {
  CHANNEL_HALF, RiverIndex, type HeightSampler, type WaterLine,
} from '../world/river'

/**
 * # 河的算繪：水面、河岸草甸、河廊排除、河岸林
 *
 * 【為什麼要草甸與河廊】河面鋪好之後最刺眼的變成田 —— 犁過的方格與樹籬一路
 * 壓到水邊，河看起來像畫在田上的一條線。真實的河廊是沒犁過的草地加一排沿岸
 * 的樹，而且田的格線在那裡會斷掉。
 *
 * 【`polygonOffset` 不是抬高度】水面與草甸都貼著地面，而投彈高度的深度解析度
 * 只剩公尺級（遠平面 5,000 km）—— 靠抬高度會看得出它們浮在田上。
 */

/** 草甸帶的半寬，m */
export const MEADOW_HALF = 190
/** 樹籬、林地、村落被擋開的半寬，m。比草甸窄一點 —— 帶子外緣本來就在漸變回田 */
export const CLEAR_HALF = 150
/** 河岸林的半寬帶：離中心線這個範圍內撒樹，m */
const TREE_NEAR = 55
const TREE_FAR = 145
/** 沿岸撒樹的間距，m */
const TREE_STEP = 22

/** 水面的顏色。十一月的內陸河是灰綠的，不是海那種藍 */
const WATER = 0x33454b
/** 草甸的顏色。十一月沒犁過的河灘：偏黃的枯草，比田的褐土亮 */
export const MEADOW = 0x6e6a4a

/** 一條河、這一點的法線（往左岸） */
function normalAt(line: WaterLine, i: number): [number, number] {
  const n = line.points.length
  const a = line.points[Math.max(0, i - 1)]!
  const b = line.points[Math.min(n - 1, i + 1)]!
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz) || 1
  return [-dz / len, dx / len]
}

/** 沿中心線鋪一條帶狀的水面 */
export function buildRiverWater(lines: readonly WaterLine[]): Mesh {
  const pos: number[] = []
  const idx: number[] = []
  for (const line of lines) {
    const base = pos.length / 3
    const n = line.points.length
    for (let i = 0; i < n; i++) {
      const [nx, nz] = normalAt(line, i)
      const p = line.points[i]!
      const y = line.level[i]!
      pos.push(p[0] + nx * CHANNEL_HALF, y, p[1] + nz * CHANNEL_HALF)
      pos.push(p[0] - nx * CHANNEL_HALF, y, p[1] - nz * CHANNEL_HALF)
    }
    // 【捲繞方向】左岸在 `2i`、右岸在 `2i+1`，所以逆時針是「左、下一個左、右」。
    // 反過來的話法線朝下，整條河會被背面剔除 —— 而畫面上就是**什麼都沒有**，
    // 不是一條黑帶子。
    //
    // 【急彎的那一格要丟掉】髮夾彎處兩岸的點會交換左右，四邊形翻面。丟掉留下的
    // 縫比一片翻面的水好看得多
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
  geo.computeBoundingSphere()
  const mesh = new Mesh(geo, new MeshStandardMaterial({
    color: WATER, roughness: 0.22, metalness: 0.12,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
  }))
  mesh.name = 'riverWater'
  return mesh
}

/**
 * 河岸的草甸：一條貼著地形的帶子。
 *
 * 【要跟著地形起伏】只取中心線高度的話，380 m 寬的平帶子在起伏的地上會一半
 * 陷進去一半浮起來。所以橫向也切段，每一個頂點各自取當地地形。**延伸段不切**
 * —— 外環是平的，切了只是多頂點。
 */
export function buildBankGround(sample: HeightSampler, lines: readonly WaterLine[]): Mesh {
  const pos: number[] = []
  const idx: number[] = []
  for (const line of lines) {
    /** 橫向切幾段。太少的話帶子跨不過地形的起伏 */
    const cross = line.coarse ? 1 : 6
    const base = pos.length / 3
    const n = line.points.length
    for (let i = 0; i < n; i++) {
      const [nx, nz] = normalAt(line, i)
      const p = line.points[i]!
      for (let c = 0; c <= cross; c++) {
        const s = (c / cross) * 2 - 1
        const x = p[0] + nx * MEADOW_HALF * s
        const z = p[1] + nz * MEADOW_HALF * s
        pos.push(x, sample(x, z) + 0.15, z)
      }
    }
    for (let i = 0; i + 1 < n; i++) {
      for (let c = 0; c < cross; c++) {
        const k = base + i * (cross + 1) + c
        const kn = k + cross + 1
        // 【捲繞方向】與水面同一個坑：反了就整條被背面剔除，畫面上什麼都沒有
        idx.push(k, kn, k + 1, k + 1, kn, kn + 1)
      }
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  const mesh = new Mesh(geo, new MeshStandardMaterial({
    color: MEADOW, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }))
  mesh.name = 'riverBank'
  return mesh
}

/**
 * 把一個散佈器包成「離河太近就不長」。與 `floraExclude.ts` 的矩形版同一個
 * 做法，只是判準換成到折線的距離。
 *
 * 【為什麼不能用矩形】河是彎的，能框住它的矩形會把半張圖的樹籬也砍掉。
 */
export function excludingCorridor(source: FloraSource, index: RiverIndex, halfWidth = CLEAR_HALF): FloraSource {
  return excludingWhere(source, (x, z) => index.distance(x, z) < halfWidth)
}

/**
 * 河岸林：沿著中心線兩側撒闊葉樹與灌木。只撒 `within` 這個方框之內 ——
 * 植被只畫到鏡頭周圍幾公里，延伸段再往外撒是白算。
 *
 * 【位置只由全域索引決定】與農地那三支同一條鐵律 —— 位置若跟著「現在畫到
 * 哪一格」變，同一棵樹在相鄰的兩格會長在兩個地方。這裡的索引是
 * 「第幾條河、第幾站、左右哪一邊」，與視窗無關。
 */
export function riverBankFlora(lines: readonly WaterLine[], within: number): FloraSource {
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
        if (Math.abs(px) > within || Math.abs(pz) > within) continue
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

/** 一整組河：中心線（含延伸段）與索引。`terrain.ts` 吃這一份 */
export interface RiverSet {
  readonly lines: readonly WaterLine[]
  /** 查詢半徑要蓋得住草甸：植被過濾問到 `CLEAR_HALF`、水面問到 `CHANNEL_HALF` */
  readonly index: RiverIndex
}

export function createRiverSet(lines: readonly WaterLine[]): RiverSet {
  return { lines, index: new RiverIndex(lines, MEADOW_HALF) }
}

/** 水面與草甸，掛在同一個群組底下。**草甸先加** —— 同樣的深度偏移時水面要蓋在上面 */
export function buildRiverMeshes(sample: HeightSampler, set: RiverSet): Group {
  const g = new Group()
  g.name = 'river'
  g.add(buildBankGround(sample, set.lines))
  g.add(buildRiverWater(set.lines))
  return g
}

export function disposeRiverMeshes(g: Group): void {
  for (const o of g.children) {
    const m = o as Mesh
    m.geometry.dispose()
    ;(m.material as MeshStandardMaterial).dispose()
  }
}
