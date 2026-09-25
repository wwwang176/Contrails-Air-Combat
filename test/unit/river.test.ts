import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BufferAttribute } from 'three'
import {
  CHANNEL_HALF, CLEARANCE, EXTEND_REACH, RiverIndex, extendRivers, riverLines,
  type RiverFile, type WaterLine,
} from '../../src/world/river'
import { buildRiverMeshes, buildRiverWater, createRiverSet, disposeRiverMeshes } from '../../src/render/river'
import { createLeuna, LEUNA_RIVER_ENDS } from '../../src/world/leuna'
import { FARM_EXTENT, outsideZero } from '../../src/world/farmland'

/**
 * # 河：遊戲裡的洛伊納（手擺丘陵的高度場）
 *
 * 實測高程那一份在 `leuna-dem.test.ts`。
 */

const FILE = JSON.parse(readFileSync('public/data/leuna-rivers.json', 'utf8')) as RiverFile
const solid = outsideZero(createLeuna().field)
const sample = (x: number, z: number): number => solid.sample(x, z)
const HALF = FARM_EXTENT / 2
const LINES = riverLines(sample, FILE)
const EXT = extendRivers(LINES, HALF, sample, LEUNA_RIVER_ENDS)
const ALL = [...LINES, ...EXT]
/** 往外流的延伸段（不含匯流） */
const OUTFLOW = EXT.filter((e) => e.name.endsWith('（延伸）'))
const JOINS = EXT.filter((e) => e.name.endsWith('（匯流）'))

/** 這一段的出圖方向：規則指定的方位，或最近的地圖邊 */
function outwardOf(e: WaterLine): [number, number] {
  const p0 = e.points[0]!
  const rule = LEUNA_RIVER_ENDS.find((r) => Math.hypot(r.at[0] - p0[0], r.at[1] - p0[1]) <= 500)
  if (rule?.bearing !== undefined) return [Math.sin(rule.bearing), -Math.cos(rule.bearing)]
  const alongX = Math.abs(p0[0]) >= Math.abs(p0[1])
  return alongX ? [Math.sign(p0[0]), 0] : [0, Math.sign(p0[1])]
}

function brute(lines: readonly WaterLine[], x: number, z: number): number {
  let best = Infinity
  for (const l of lines) {
    for (let i = 0; i + 1 < l.points.length; i++) {
      const a = l.points[i]!
      const b = l.points[i + 1]!
      const vx = b[0] - a[0]
      const vz = b[1] - a[1]
      const l2 = vx * vx + vz * vz
      const t = l2 <= 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / l2))
      best = Math.min(best, Math.hypot(x - (a[0] + vx * t), z - (a[1] + vz * t)))
    }
  }
  return best
}

describe('地圖外的延伸', () => {
  /**
   * 五端碰到地圖邊：Saale 的北端與西端、Luppe 兩端（它貼著北緣流）、Wethau 的
   * 南端。Luppe 的西端是下游、匯入 Saale，其餘四端往外流。地圖中間的匯流口
   * 不延伸 —— 延伸了就是一條從地圖中間冒出來、往外流的假河。
   */
  it('四端往外流、Luppe 的下游匯入 Saale', () => {
    expect(OUTFLOW.map((e) => e.name).sort()).toEqual(
      ['Luppe（延伸）', 'Saale（延伸）', 'Saale（延伸）', 'Wethau（延伸）'])
    expect(JOINS.map((e) => e.name)).toEqual(['Luppe（匯流）'])
    for (const e of EXT) {
      const p = e.points[0]!
      expect(Math.max(Math.abs(p[0]), Math.abs(p[1])), e.name).toBeGreaterThan(HALF - 1000)
    }
  })

  /**
   * 【支流不與主流並排走】沿著地圖邊流的支流，下游那一端照預設會自己往外流
   * 60 km、與主流並排 —— 從北邊看出去是兩條平行的河。匯流段要在幾公里內
   * 落在主流的延伸段上，而且整段都在它旁邊。
   */
  it('Luppe 的下游在幾公里內接上 Saale 的延伸段', () => {
    const join = JOINS[0]!
    const end = join.points.at(-1)!
    const saale = OUTFLOW.filter((e) => e.name === 'Saale（延伸）')
    expect(saale.some((s) => s.points.some((q) => q[0] === end[0] && q[1] === end[1]))).toBe(true)
    let len = 0
    for (let i = 0; i + 1 < join.points.length; i++) {
      len += Math.hypot(join.points[i + 1]![0] - join.points[i]![0], join.points[i + 1]![1] - join.points[i]![1])
    }
    expect(len).toBeLessThan(8000)
  })

  /** 【上游朝萊比錫】萊比錫在廠區幾乎正東，不是北邊 */
  it('Luppe 的上游往東流出去', () => {
    const luppe = OUTFLOW.find((e) => e.name === 'Luppe（延伸）')!
    const a = luppe.points[0]!
    const b = luppe.points.at(-1)!
    const bearing = Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180 / Math.PI
    expect(bearing).toBeGreaterThan(60)
    expect(bearing).toBeLessThan(105)
  })

  /** 【起點就是河端】差一點點，兩段水面之間就是一道縫 */
  it('從河端接出去，一路往外、不繞回地圖', () => {
    for (const e of OUTFLOW) {
      const p0 = e.points[0]!
      expect(LINES.some((l) => [l.points[0]!, l.points.at(-1)!].some((q) => q[0] === p0[0] && q[1] === p0[1])),
        e.name).toBe(true)
      // 每一步沿出圖方向的分量都要是正的
      const [nx, nz] = outwardOf(e)
      for (let i = 0; i + 1 < e.points.length; i++) {
        const a = e.points[i]!
        const b = e.points[i + 1]!
        expect((b[0] - a[0]) * nx + (b[1] - a[1]) * nz, `${e.name} 第 ${i} 步`).toBeGreaterThan(0)
      }
      const last = e.points.at(-1)!
      expect((last[0] - p0[0]) * nx + (last[1] - p0[1]) * nz, `${e.name} 走不夠遠`).toBeGreaterThan(EXTEND_REACH / 2)
    }
  })

  /**
   * 【接頭順著原來的切線】水面帶的端面垂直於最後一段；兩段的方向差多少，
   * 接頭外側就裂開多寬 —— 落在裂縫裡的炸彈算落水，畫面上卻是田。
   */
  it('延伸段的第一段與原河道的最後一段同方向', () => {
    for (const e of EXT) {
      const p0 = e.points[0]!
      const same = (q: readonly [number, number]): boolean => q[0] === p0[0] && q[1] === p0[1]
      const line = LINES.find((l) => same(l.points[0]!) || same(l.points.at(-1)!))!
      const atStart = same(line.points[0]!)
      const q = atStart ? line.points[1]! : line.points.at(-2)!
      const inward = Math.atan2(p0[1] - q[1], p0[0] - q[0])
      const p1 = e.points[1]!
      const outward = Math.atan2(p1[1] - p0[1], p1[0] - p0[0])
      let diff = Math.abs(inward - outward)
      if (diff > Math.PI) diff = 2 * Math.PI - diff
      expect(diff * 180 / Math.PI, e.name).toBeLessThan(1)
    }
  })

  /**
   * 【要像地圖內的真河那樣彎】真河每 3 km 的彎曲度是 1.25～1.45。太直的話
   * 一出地圖就變成一條運河，接縫一眼就看得出來。
   */
  it('有彎，不是一條直線', () => {
    for (const e of OUTFLOW) {
      const a = e.points[0]!
      const b = e.points.at(-1)!
      let len = 0
      for (let i = 0; i + 1 < e.points.length; i++) {
        len += Math.hypot(e.points[i + 1]![0] - e.points[i]![0], e.points[i + 1]![1] - e.points[i]![1])
      }
      expect(len / Math.hypot(b[0] - a[0], b[1] - a[1]), e.name).toBeGreaterThan(1.15)
    }
  })

  /**
   * 【延伸段彼此不交叉】交叉的話是兩條河在霧裡打結。匯流段只在最後一點碰到
   * 主流（那一點是主流的折點，端點相碰不算交叉）。
   */
  it('延伸段彼此不交叉', () => {
    const cross = (a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): boolean => {
      const rx = b[0]! - a[0]!, rz = b[1]! - a[1]!, sx = d[0]! - c[0]!, sz = d[1]! - c[1]!
      const den = rx * sz - rz * sx
      if (Math.abs(den) < 1e-9) return false
      const t = ((c[0]! - a[0]!) * sz - (c[1]! - a[1]!) * sx) / den
      const u = ((c[0]! - a[0]!) * rz - (c[1]! - a[1]!) * rx) / den
      return t > 0 && t < 1 && u > 0 && u < 1
    }
    for (let i = 0; i < EXT.length; i++) {
      for (let j = i + 1; j < EXT.length; j++) {
        const A = EXT[i]!.points
        const B = EXT[j]!.points
        for (let p = 0; p + 1 < A.length; p++) {
          for (let q = 0; q + 1 < B.length; q++) {
            expect(cross(A[p]!, A[p + 1]!, B[q]!, B[q + 1]!), `${i} × ${j}`).toBe(false)
          }
        }
      }
    }
  })

  it('每次進場一模一樣', () => {
    const again = extendRivers(riverLines(sample, FILE), HALF, sample, LEUNA_RIVER_ENDS)
    expect(again.map((e) => e.points)).toEqual(EXT.map((e) => e.points))
  })
})

describe('水面', () => {
  /** 【草甸烘在地面裡】河的群組只有水面；另外疊一條草甸網格的話是一整條同色的硬邊帶子 */
  it('河的群組只有水面', () => {
    const g = buildRiverMeshes(createRiverSet(ALL))
    expect(g.children.map((c) => c.name)).toEqual(['riverWater'])
    disposeRiverMeshes(g)
  })

  /**
   * 【水面不懸空】它是貼著地形鋪的帶子，爬上丘陵的側坡就是斜掛、一邊懸空。
   * 中心線上的水面離地面超過三公尺就看得出來。
   */
  it('每一條河（含延伸段）的水面高出中心線地面不超過 3 m、也不低於地面', () => {
    for (const l of ALL) {
      for (let i = 0; i < l.points.length; i++) {
        const [x, z] = l.points[i]!
        const above = l.level[i]! - sample(x, z)
        expect(above, `${l.name} (${Math.round(x)},${Math.round(z)})`).toBeLessThanOrEqual(3)
        expect(above, `${l.name} (${Math.round(x)},${Math.round(z)})`).toBeGreaterThanOrEqual(CLEARANCE - 1e-6)
      }
    }
  })

  /** 【捲繞方向】反了的話法線朝下、整條被背面剔除 —— 畫面上什麼都沒有 */
  it('每一個三角形的法線都朝上', () => {
    const mesh = buildRiverWater(ALL)
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute
    const idx = mesh.geometry.getIndex()!
    let down = 0
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t)
      const b = idx.getX(t + 1)
      const c = idx.getX(t + 2)
      const ux = pos.getX(b) - pos.getX(a)
      const uz = pos.getZ(b) - pos.getZ(a)
      const vx = pos.getX(c) - pos.getX(a)
      const vz = pos.getZ(c) - pos.getZ(a)
      if (uz * vx - ux * vz <= 0) down++
    }
    expect(down).toBe(0)
    expect(idx.count / 3).toBeGreaterThan(1000)
  })
})

describe('查詢索引', () => {
  const index = new RiverIndex(ALL, 200)

  /** 【與逐段掃描一樣】格網漏掉一段的話，那一段河上的炸彈會噴土 */
  it('查詢半徑內的距離與逐段掃描相同', () => {
    let seed = 99
    const rand = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    let near = 0
    for (let k = 0; k < 3000; k++) {
      // 一半撒在河道附近，一半撒在整張圖
      const l = ALL[Math.floor(rand() * ALL.length)]!
      const p = l.points[Math.floor(rand() * l.points.length)]!
      const x = k % 2 === 0 ? p[0] + (rand() - 0.5) * 500 : (rand() - 0.5) * 2 * (HALF + 20_000)
      const z = k % 2 === 0 ? p[1] + (rand() - 0.5) * 500 : (rand() - 0.5) * 2 * (HALF + 20_000)
      const want = brute(ALL, x, z)
      const got = index.distance(x, z)
      if (want <= 200) {
        near++
        expect(got, `(${x},${z})`).toBeCloseTo(want, 6)
      } else {
        expect(got, `(${x},${z})`).toBe(Infinity)
      }
    }
    expect(near).toBeGreaterThan(500)
  })

  it('水面內回水面高度，出了水面半寬回 −Infinity', () => {
    const l = LINES[0]!
    const i = Math.floor(l.points.length / 2)
    const [x, z] = l.points[i]!
    const a = l.points[i - 1]!
    const b = l.points[i + 1]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const nx = -(b[1] - a[1]) / len
    const nz = (b[0] - a[0]) / len
    expect(index.waterAt(x, z)).toBeCloseTo(l.level[i]!, 6)
    expect(index.waterAt(x + nx * (CHANNEL_HALF - 5), z + nz * (CHANNEL_HALF - 5))).toBeGreaterThan(-Infinity)
    expect(index.waterAt(x + nx * (CHANNEL_HALF + 20), z + nz * (CHANNEL_HALF + 20))).toBe(-Infinity)
    expect(index.waterAt(0, -7000)).toBe(-Infinity)
    expect(index.waterAt(1e7, 1e7)).toBe(-Infinity)
  })

  /** 【最外圈也要查得到】含查詢半徑的寬度剛好是格寬的整數倍時，最邊緣那一點不能判成出界 */
  it('查詢半徑的最外緣仍在格網內', () => {
    const one = new RiverIndex([{ name: 't', points: [[0, 0], [120, 0]], level: [1, 1], coarse: false }], 190)
    expect(one.distance(310, 0)).toBeCloseTo(190, 9)
    expect(one.distance(0, 190)).toBeCloseTo(190, 9)
    expect(one.distance(-190, 0)).toBeCloseTo(190, 9)
  })

  /**
   * 【整格判斷保守】植被補格拿 `mayReach` 整格跳過河道走廊。它回 false 的方框裡只要
   * 有一點在查詢半徑內，那一格的河上就會長樹
   */
  it('mayReach 回 false 的方框，框裡每一點都在查詢半徑外', () => {
    let seed = 7
    const rand = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    let skipped = 0
    let reached = 0
    for (let k = 0; k < 4000; k++) {
      // 撒在河道附近，方框 50～1500 m：跨一格到好幾格的都有
      const l = ALL[Math.floor(rand() * ALL.length)]!
      const p = l.points[Math.floor(rand() * l.points.length)]!
      const w = 50 + rand() * 1450
      const h = 50 + rand() * 1450
      const x0 = p[0] + (rand() - 0.5) * 3000 - w / 2
      const z0 = p[1] + (rand() - 0.5) * 3000 - h / 2
      if (index.mayReach(x0, z0, x0 + w, z0 + h)) {
        reached++
        continue
      }
      skipped++
      for (let i = 0; i <= 12; i++) {
        for (let j = 0; j <= 12; j++) {
          const x = x0 + (w * i) / 12
          const z = z0 + (h * j) / 12
          if (index.distance(x, z) !== Infinity) expect.fail(`(${x0},${z0},${w}×${h}) 跳過，但 (${x},${z}) 搆得到`)
        }
      }
    }
    expect(skipped).toBeGreaterThan(500)
    expect(reached).toBeGreaterThan(500)
  })

  it('延伸段上也是水', () => {
    const e = EXT[0]!
    const p = e.points[Math.floor(e.points.length / 2)]!
    expect(index.waterAt(p[0], p[1])).toBeCloseTo(CLEARANCE, 6)
  })
})
