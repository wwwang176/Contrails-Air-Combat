import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshStandardMaterial,
} from 'three'
import { extendStraight, roadProfile, type RoadProfile } from '../world/landFeatures'
import type { HeightSampler, RiverIndex } from '../world/river'

/**
 * # 高速公路（A9，當年的 Reichsautobahn）
 *
 * 上下行兩條車道，各是一條貼著地面的帶子。過河的地方照 `roadProfile` 墊成
 * 橋：橋面比水面高 `DECK_CLEARANCE`，兩端以 4% 的坡降回地面；墊高的引道兩側
 * 是草坡路堤，河上那一段是橋面板加橋墩。
 *
 * 【出了資料範圍直直延伸】高速公路本來就直，在霧裡只要它繼續。
 */

/** 一條車道的半寬，m。Reichsautobahn 單向兩線加路肩約 10 m */
export const CARRIAGEWAY_HALF = 5
/** 出了資料範圍再直直延伸多遠，m */
const EXTEND = 60_000
/** 路堤的坡度：每高 1 m 往外 1.5 m */
const EMBANK_RUN = 1.5
/** 墊高超過這個才做路堤，m */
const EMBANK_MIN = 0.8
/** 橋面板的厚度，m */
const DECK_DEPTH = 1.4
/** 每隔幾個取樣點一座橋墩（取樣 20 m） */
const PIER_EVERY = 2
/** 橋墩的長寬，m */
const PIER_ALONG = 3
const PIER_ACROSS = 8

/** 水泥路面。**比田亮一截** —— 當年的 Reichsautobahn 從空中是兩條淺色的帶子 */
const CONCRETE = 0xa7a49c
const EMBANKMENT = 0x5b5a44
const STRUCTURE = 0x77746c

/** 這一點往左的單位法線 */
function leftNormal(pts: RoadProfile['points'], i: number): [number, number] {
  const n = pts.length
  const a = pts[Math.max(0, i - 1)]!
  const b = pts[Math.min(n - 1, i + 1)]!
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len]
}

class Builder {
  readonly pos: number[] = []
  readonly col: number[] = []
  readonly idx: number[] = []
  private readonly c = new Color()

  vertex(x: number, y: number, z: number, hex: number): number {
    this.c.setHex(hex)
    this.pos.push(x, y, z)
    this.col.push(this.c.r, this.c.g, this.c.b)
    return this.pos.length / 3 - 1
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d)
  }

  mesh(material: MeshStandardMaterial, name: string): Mesh {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3))
    geo.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3))
    geo.setIndex(this.idx)
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    const m = new Mesh(geo, material)
    m.name = name
    return m
  }
}

/** 路面：左右兩緣，高度照縱剖面 */
function surface(b: Builder, p: RoadProfile): void {
  const n = p.points.length
  const base = b.pos.length / 3
  for (let i = 0; i < n; i++) {
    const [nx, nz] = leftNormal(p.points, i)
    const [x, z] = p.points[i]!
    const y = p.height[i]!
    b.vertex(x + nx * CARRIAGEWAY_HALF, y, z + nz * CARRIAGEWAY_HALF, CONCRETE)
    b.vertex(x - nx * CARRIAGEWAY_HALF, y, z - nz * CARRIAGEWAY_HALF, CONCRETE)
  }
  // 【捲繞方向】與水面帶同一個排法：左在 2i、右在 2i+1，「左、下一個左、右」朝上
  for (let i = 0; i + 1 < n; i++) {
    const k = base + i * 2
    b.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3)
  }
}

/** 路堤、橋面板的側邊與底面、橋墩。**雙面材質** —— 各面朝向不一，省得逐面對捲繞 */
function structure(b: Builder, p: RoadProfile, sample: HeightSampler): void {
  const n = p.points.length
  for (let i = 0; i + 1 < n; i++) {
    const raisedA = p.height[i]! - p.ground[i]! > EMBANK_MIN
    const raisedB = p.height[i + 1]! - p.ground[i + 1]! > EMBANK_MIN
    if (!raisedA && !raisedB) continue
    const water = p.overWater[i]! || p.overWater[i + 1]!
    const ends = [i, i + 1].map((k) => {
      const [nx, nz] = leftNormal(p.points, k)
      const [x, z] = p.points[k]!
      return { x, z, nx, nz, h: p.height[k]!, g: p.ground[k]! }
    })
    for (const side of [1, -1]) {
      const top = ends.map((e) => [e.x + e.nx * CARRIAGEWAY_HALF * side, e.h, e.z + e.nz * CARRIAGEWAY_HALF * side] as const)
      if (water) {
        // 橋面板的側邊：往下一個板厚
        const a = b.vertex(top[0]![0], top[0]![1], top[0]![2], STRUCTURE)
        const c = b.vertex(top[1]![0], top[1]![1], top[1]![2], STRUCTURE)
        const d = b.vertex(top[1]![0], top[1]![1] - DECK_DEPTH, top[1]![2], STRUCTURE)
        const e = b.vertex(top[0]![0], top[0]![1] - DECK_DEPTH, top[0]![2], STRUCTURE)
        b.quad(a, c, d, e)
      } else {
        // 路堤：從路緣斜斜落到地面
        const foot = ends.map((e) => {
          const run = CARRIAGEWAY_HALF + Math.max(0, e.h - e.g) * EMBANK_RUN
          const x = e.x + e.nx * run * side
          const z = e.z + e.nz * run * side
          return [x, sample(x, z), z] as const
        })
        const a = b.vertex(top[0]![0], top[0]![1], top[0]![2], EMBANKMENT)
        const c = b.vertex(top[1]![0], top[1]![1], top[1]![2], EMBANKMENT)
        const d = b.vertex(foot[1]![0], foot[1]![1], foot[1]![2], EMBANKMENT)
        const e = b.vertex(foot[0]![0], foot[0]![1], foot[0]![2], EMBANKMENT)
        b.quad(a, c, d, e)
      }
    }
    if (!water) continue
    // 橋面板的底面
    const under = ends.flatMap((e) => [1, -1].map((side) => b.vertex(
      e.x + e.nx * CARRIAGEWAY_HALF * side, e.h - DECK_DEPTH, e.z + e.nz * CARRIAGEWAY_HALF * side, STRUCTURE)))
    b.quad(under[0]!, under[2]!, under[3]!, under[1]!)
    // 橋墩：從地面（河底）撐到板底
    if (i % PIER_EVERY !== 0 || !p.overWater[i]!) continue
    const e = ends[0]!
    const tx = e.nz
    const tz = -e.nx
    const y0 = e.g
    const y1 = e.h - DECK_DEPTH
    const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([sa, sc]) => [
      e.x + tx * (PIER_ALONG / 2) * sa! + e.nx * (PIER_ACROSS / 2) * sc!,
      e.z + tz * (PIER_ALONG / 2) * sa! + e.nz * (PIER_ACROSS / 2) * sc!,
    ] as const)
    for (let k = 0; k < 4; k++) {
      const p0 = corners[k]!
      const p1 = corners[(k + 1) % 4]!
      b.quad(
        b.vertex(p0[0], y1, p0[1], STRUCTURE), b.vertex(p1[0], y1, p1[1], STRUCTURE),
        b.vertex(p1[0], y0, p1[1], STRUCTURE), b.vertex(p0[0], y0, p0[1], STRUCTURE),
      )
    }
  }
}

/** 每一條車道的縱剖面（含延伸段）。測試與算繪共用 */
export function motorwayProfiles(
  lines: readonly (readonly (readonly [number, number])[])[], sample: HeightSampler, rivers: RiverIndex,
): RoadProfile[] {
  return lines.map((l) => roadProfile(
    extendStraight(l, EXTEND), sample,
    (x, z) => rivers.distance(x, z), (x, z) => rivers.levelNear(x, z),
  ))
}

export function buildMotorway(sample: HeightSampler, profiles: readonly RoadProfile[]): Group {
  const top = new Builder()
  const side = new Builder()
  for (const p of profiles) {
    surface(top, p)
    structure(side, p, sample)
  }
  const g = new Group()
  g.name = 'motorway'
  // 【路面要蓋過田與村鎮的地面】偏移比村鎮（−1／−2）強。過河處是墊高的橋，
  // 不與水面、草甸共面
  g.add(top.mesh(new MeshStandardMaterial({
    vertexColors: true, roughness: 0.9,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  }), 'motorwaySurface'))
  g.add(side.mesh(new MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, side: DoubleSide, flatShading: true,
  }), 'motorwayStructure'))
  return g
}
