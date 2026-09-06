/**
 * **命中盒比真的飛機大多少？** 不是測試。
 *
 * 跑法：`npx vite-node test/tools/hitbox-area.probe.ts`
 *
 * 【為什麼要量這個】`damage-live.probe.ts` 量到實戰中 47～55% 的命中被判成
 * `tail`，而 `fuselage`（名目基準 1.0）只有 4%。那不是因為玩家專打尾翼，
 * 是因為尾翼的命中盒是一個 5.76 × 2.77 m 的**空板**：平尾是十字形，AABB
 * 把十字外面那四塊空氣一起包進去，而 `hitAircraft` 的倍率取「線段碰到的
 * 所有盒之中最高的那一個」，1.2 > 1.0，於是尾翼盒贏過機身盒。
 *
 * 這一支把兩件事並排量出來：
 *
 *   命中盒聯集的正投影面積   ← 子彈實際打得到的面積
 *   真實網格的正投影面積     ← 玩家在畫面上看到的面積
 *
 * 【怎麼量】把三角形投影到垂直於彈道的平面上做光柵化，數格子。同一個網格
 * 也拿去掃命中盒，兩邊的量綱一致才能相除。
 */
import { Mesh, Vector3 } from 'three'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { loadGlbTemplatesForNode } from '../fixtures/glb'
import type { HitBox, HitPart } from '../../src/world/hit'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { F6F5 } from '../../src/specs/f6f5'
import { HE111 } from '../../src/specs/he111'
import { B17G } from '../../src/specs/b17g'
import type { AircraftSpec } from '../../src/specs/types'

await loadGlbTemplatesForNode()

const CELL = 0.04
const D = Math.PI / 180
const PARTS: readonly HitPart[] = ['cockpit', 'engine', 'tail', 'fuselage', 'wingLeft', 'wingRight']

const from = (azDeg: number, elDeg: number): Vector3 => {
  const az = azDeg * D, el = elDeg * D
  return new Vector3(
    Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el),
  ).normalize()
}
const ASPECTS = [
  { name: '正後方', s: from(0, 0) },
  { name: '後上方 30°', s: from(0, 30) },
  { name: '側方 90°', s: from(90, 0) },
  { name: '迎頭', s: from(180, 0) },
] as const

/** 取真實網格的三角形（排除螺旋槳的掃掠面）。 */
function triangles(spec: AircraftSpec): number[][] {
  const m = buildAircraft(spec)
  m.group.updateMatrixWorld(true)
  const tris: number[][] = []
  m.group.traverse((o) => {
    if (o.userData['spinning']) return
    const mesh = o as Mesh
    const pos = mesh.geometry?.getAttribute?.('position')
    if (!pos) return
    const idx = mesh.geometry.getIndex()
    const v = new Vector3()
    const get = (i: number): number[] => {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld)
      return [v.x, v.y, v.z]
    }
    const count = idx ? idx.count : pos.count
    for (let k = 0; k + 2 < count; k += 3) {
      const a = idx ? idx.getX(k) : k, b = idx ? idx.getX(k + 1) : k + 1, c = idx ? idx.getX(k + 2) : k + 2
      tris.push([...get(a), ...get(b), ...get(c)])
    }
  })
  m.dispose()
  return tris
}

/** 把一組點投到 (ex, ey) 平面、光柵化成格子集合。 */
function rasterTris(tris: readonly number[][], ex: Vector3, ey: Vector3, cells: Set<number>): void {
  const K = 4096
  for (const t of tris) {
    const px = [], py = []
    for (let i = 0; i < 3; i++) {
      const x = t[i * 3]!, y = t[i * 3 + 1]!, z = t[i * 3 + 2]!
      px.push(x * ex.x + y * ex.y + z * ex.z)
      py.push(x * ey.x + y * ey.y + z * ey.z)
    }
    const i0 = Math.floor(Math.min(...px) / CELL), i1 = Math.ceil(Math.max(...px) / CELL)
    const j0 = Math.floor(Math.min(...py) / CELL), j1 = Math.ceil(Math.max(...py) / CELL)
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const cx = (i + 0.5) * CELL, cy = (j + 0.5) * CELL
        // 重心座標的同號檢查
        const d1 = (cx - px[1]!) * (py[0]! - py[1]!) - (px[0]! - px[1]!) * (cy - py[1]!)
        const d2 = (cx - px[2]!) * (py[1]! - py[2]!) - (px[1]! - px[2]!) * (cy - py[2]!)
        const d3 = (cx - px[0]!) * (py[2]! - py[0]!) - (px[2]! - px[0]!) * (cy - py[0]!)
        const neg = d1 < 0 || d2 < 0 || d3 < 0
        const pos = d1 > 0 || d2 > 0 || d3 > 0
        if (neg && pos) continue
        cells.add((i + K) * (2 * K) + (j + K))
      }
    }
  }
}

/** 命中盒的八個角投影後取凸包外框 —— AABB 投影就是六個面各自的矩形聯集。 */
function rasterBox(box: HitBox, ex: Vector3, ey: Vector3, cells: Set<number>): void {
  const c = box.center, h = box.half
  const tris: number[][] = []
  const corner = (sx: number, sy: number, sz: number): number[] =>
    [c.x + sx * h.x, c.y + sy * h.y, c.z + sz * h.z]
  const faces: [number, number, number][][] = []
  for (const ax of [0, 1, 2]) {
    for (const sg of [-1, 1]) {
      const q: [number, number, number][] = []
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const s: [number, number, number] = [0, 0, 0]
        s[ax] = sg
        s[(ax + 1) % 3] = u
        s[(ax + 2) % 3] = v
        q.push(s)
      }
      faces.push(q)
    }
  }
  for (const q of faces) {
    tris.push([...corner(...q[0]!), ...corner(...q[1]!), ...corner(...q[2]!)])
    tris.push([...corner(...q[0]!), ...corner(...q[2]!), ...corner(...q[3]!)])
  }
  rasterTris(tris, ex, ey, cells)
}

const f = (v: number, d = 2): string => v.toFixed(d)
console.log('══ 命中盒的正投影面積 vs 真實網格 ══════════════════════════')
for (const spec of [P51D, F6F5, BF109K4, HE111, B17G]) {
  const tris = triangles(spec)
  console.log(`\n${spec.name}（${tris.length} 個三角形）`)
  console.log('進場         盒面積   真面積   放大   ' + PARTS.map((p) => p.slice(0, 6).padStart(8)).join(''))
  for (const asp of ASPECTS) {
    const dir = asp.s.clone().multiplyScalar(-1)
    const up = Math.abs(dir.y) > 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
    const ex = new Vector3().crossVectors(dir, up).normalize()
    const ey = new Vector3().crossVectors(ex, dir).normalize()
    const real = new Set<number>()
    rasterTris(tris, ex, ey, real)
    const union = new Set<number>()
    const per: string[] = []
    for (const p of PARTS) {
      // 【一定要 filter 不能 find】尾翼與（日後的）機翼都可能是多個盒。
      // `find` 只量到第一個，聯集會少算 —— B-17G 從側面會量成「盒比真外形
      // 還小」，那在幾何上不可能。
      const one = new Set<number>()
      for (const box of spec.hitBoxes.filter((b) => b.part === p)) rasterBox(box, ex, ey, one)
      for (const c of one) union.add(c)
      per.push(f(one.size * CELL * CELL, 1).padStart(8))
    }
    const A = union.size * CELL * CELL, R = real.size * CELL * CELL
    console.log(`${asp.name.padEnd(12)}${f(A, 1).padStart(7)}  ${f(R, 1).padStart(7)}`
      + `  ${f(A / R, 2).padStart(5)}×  ` + per.join(''))
  }
}
console.log('\n【怎麼讀】「放大」= 命中盒聯集 ÷ 真實外形。1.0 表示打得到的面積就是')
console.log('看得到的面積。各部位那幾欄是**各自**的投影面積（會互相重疊，加起來大於聯集）。')
