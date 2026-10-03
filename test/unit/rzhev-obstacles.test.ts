import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import {
  GERMAN_AT_GUNS, GERMAN_DUG_PANZERS, SOVIET_INFANTRY, SOVIET_MORTARS, MINEFIELDS, OBSTACLES, SOVIET_ROUTE_A, SOVIET_ROUTE_B, SOVIET_FLAK,
  GERMAN_INFANTRY, GERMAN_MORTARS, GERMAN_TRUCKS, STALLED_SOVIET_TANKS, GERMAN_RESERVE_EAST, GERMAN_RESERVE_WEST, toLocal, TRENCHES,
  WRECK_SOVIET_TANKS, WRECK_GERMAN_PANZERS,
} from '../../src/world/rzhev'
import {
  buildObstacles, coilPath, hedgehogBars, OBSTACLE_COLORS, OBSTACLE_MAX_TRIS, OBSTACLE_SIZE, obstaclePlacements,
  wireRuns,
} from '../../src/render/geometry/ground/obstacles'
import { regionAt, trackGap, trackWidthAt } from '../../src/render/fields'
import { createTerrain } from '../../src/render/terrain'

/**
 * # 勒熱夫的障礙物：反坦克樁、捷克刺蝟、鐵絲網
 *
 * 立體的，走地形的「佈景」機制（非索引三角形湯、位置與頂點色）。佈局是資料、幾何是純函數；
 * 擺位的限制（縱隊的路上不放、任何一條路上都不放、不壓單位、不進雷區）在這裡守。
 * 造型：反坦克樁是上窄的截頭錐、捷克刺蝟是三根傾斜 35° 的長條（立在三個下端上）、鐵絲網是
 * 蛇腹形（concertina）：一段一條連續的螺旋，像拉開的彈簧；段與段之間有缺口。
 */

const flat = (): number => 0
const pieces = obstaclePlacements(OBSTACLES)
const near = (x: number, z: number, pts: readonly { x: number; z: number }[]): number => {
  let best = Infinity
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!
    const b = pts[k + 1]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const t = Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1)))
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)))
  }
  return best
}
const REG = { r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0 }
const onRoad = (x: number, z: number): boolean => {
  regionAt(x, z, REG)
  return trackGap(x, z, REG) < trackWidthAt(x, z)
}

describe('障礙物的佈局', () => {
  it('三種都有，數量在預算內', () => {
    const n = (k: string): number => pieces.filter((p) => p.kind === k).length
    expect(n('teeth')).toBeGreaterThan(1200)
    expect(n('teeth')).toBeLessThan(3000)
    expect(n('hedgehog')).toBeGreaterThan(80)
    expect(n('hedgehog')).toBeLessThan(400)
    expect(n('wire')).toBeGreaterThan(700)
    expect(n('wire')).toBeLessThan(2000)
  })

  it('離德軍縱隊與預備隊的路線至少 30 m（縱隊有轉彎半徑，會切內角）', () => {
    for (const p of pieces) {
      for (const r of [SOVIET_ROUTE_A, SOVIET_ROUTE_B, GERMAN_RESERVE_WEST, GERMAN_RESERVE_EAST]) {
        expect(near(p.x, p.z, r), `${p.kind} ${p.x.toFixed(0)},${p.z.toFixed(0)}`).toBeGreaterThanOrEqual(30)
      }
    }
  })

  it('不壓在任何一條路上（凹路：西路、斜路、主路都算），也不壓在路邊 6 m 內', () => {
    for (const p of pieces) {
      const l = toLocal(p.x, p.z)
      expect(onRoad(p.x, p.z), `${p.kind} 壓在路上 ${l.lx.toFixed(0)},${l.lz.toFixed(0)}`).toBe(false)
      for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]] as const) {
        expect(onRoad(p.x + dx, p.z + dz), `${p.kind} 在路邊 ${l.lx.toFixed(0)},${l.lz.toFixed(0)}`).toBe(false)
      }
    }
  })

  it('離所有單位（含殘骸）至少 10 m', () => {
    const units = [
      ...GERMAN_AT_GUNS, ...GERMAN_DUG_PANZERS, ...WRECK_SOVIET_TANKS, ...WRECK_GERMAN_PANZERS, ...STALLED_SOVIET_TANKS,
      ...GERMAN_INFANTRY, ...SOVIET_INFANTRY, ...SOVIET_FLAK, ...GERMAN_MORTARS, ...SOVIET_MORTARS, ...GERMAN_TRUCKS,
    ]
    for (const p of pieces) {
      for (const u of units) {
        const l = toLocal(u.x, u.z)
        expect(Math.hypot(p.x - u.x, p.z - u.z), `${p.kind} 對單位 ${l.lx.toFixed(0)},${l.lz.toFixed(0)}`).toBeGreaterThanOrEqual(10)
      }
    }
  })

  it('不進雷區內部', () => {
    for (const p of pieces) {
      for (const m of MINEFIELDS) {
        const dx = p.x - m.x
        const dz = p.z - m.z
        const inside = Math.abs(dx * m.ux + dz * m.uz) < m.hu && Math.abs(dx * m.vx + dz * m.vz) < m.hv
        expect(inside, `${p.kind} ${p.x.toFixed(0)},${p.z.toFixed(0)}`).toBe(false)
      }
    }
  })

  it('不壓在壕溝與反坦克壕上（貼圖蓋的寬度加上零件的大小）', () => {
    for (const p of pieces) {
      for (const t of TRENCHES) {
        // 壕溝貼圖在線外各蓋半個寬；零件離線至少「半個寬 + 3 m」，不蓋在溝上
        expect(near(p.x, p.z, t.points), `${p.kind} ${p.x.toFixed(0)},${p.z.toFixed(0)}`).toBeGreaterThanOrEqual(t.width / 2 + 3)
      }
    }
  })

  it('不擋在燒毀殘骸的周圍（壕邊的 IV 號殘骸帶 lz +206 … +258 內不放）', () => {
    for (const p of pieces) {
      const l = toLocal(p.x, p.z)
      if (Math.abs(l.lx) < 740) continue
      expect(l.lz > 206 && l.lz < 258, `${p.kind} ${l.lx.toFixed(0)},${l.lz.toFixed(0)}`).toBe(false)
    }
  })

  it('都在戰場框內', () => {
    for (const p of pieces) {
      const l = toLocal(p.x, p.z)
      expect(Math.abs(l.lx)).toBeLessThanOrEqual(1500 + 1)
      expect(Math.abs(l.lz)).toBeLessThanOrEqual(1500 + 1)
    }
  })
})

describe('障礙物的造型', () => {
  const origin = (x = 0, z = 0): { x: number; z: number } => ({ x, z })
  const one = (kind: 'teeth' | 'hedgehog' | 'wire', len = 2): ReturnType<typeof buildObstacles> =>
    buildObstacles([{ kind, points: [origin(), origin(len, 0)] }], flat)
  const verts = (g: ReturnType<typeof buildObstacles>): [number, number, number][] => {
    const p = g.getAttribute('position')
    return Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)])
  }

  it('反坦克樁是上窄的截頭錐：五個面、頂面是平的、底部埋進地下', () => {
    // 2 m 長的線：第一排在 1.5 m 放一根，第二排從 3.0 m 起，放不到
    const g = buildObstacles([{ kind: 'teeth', points: [origin(), origin(2, 0)] }], flat)
    expect(g.getAttribute('position').count / 3).toBe(10)
    const v = verts(g)
    const top = Math.max(...v.map((p) => p[1]))
    const bottom = Math.min(...v.map((p) => p[1]))
    expect(bottom).toBeCloseTo(-OBSTACLE_SIZE.sink, 6)
    const span = (y: number): number => {
      const xs = v.filter((p) => Math.abs(p[1] - y) < 1e-6).map((p) => p[0])
      return Math.max(...xs) - Math.min(...xs)
    }
    expect(span(top)).toBeGreaterThan(0.3)
    expect(span(top)).toBeLessThan(span(bottom) * 0.6)
    // 頂面是平的：頂上四個頂點同高
    expect(v.filter((p) => Math.abs(p[1] - top) < 1e-6).length).toBeGreaterThanOrEqual(6)
  })

  it('捷克刺蝟的三根長條：互相垂直、各傾斜約 35°、方位差 120°、交在同一點、三個下端同高', () => {
    const bars = hedgehogBars(0.4, OBSTACLE_SIZE.hedgehog.bar)
    expect(bars).toHaveLength(3)
    const dir = bars.map(([a, b]) => {
      const d: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const l = Math.hypot(...d)
      return d.map((c) => c / l) as [number, number, number]
    })
    const dot = (p: number[], q: number[]): number => p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!
    expect(dot(dir[0]!, dir[1]!)).toBeCloseTo(0, 9)
    expect(dot(dir[1]!, dir[2]!)).toBeCloseTo(0, 9)
    expect(dot(dir[0]!, dir[2]!)).toBeCloseTo(0, 9)
    for (const d of dir) expect((Math.asin(d[1]) * 180) / Math.PI).toBeCloseTo(35.264, 2)
    const az = dir.map((d) => (Math.atan2(d[2], d[0]) * 180) / Math.PI)
    expect((((az[1]! - az[0]!) % 360) + 360) % 360).toBeCloseTo(120, 6)
    expect((((az[2]! - az[1]!) % 360) + 360) % 360).toBeCloseTo(120, 6)
    // 都過原點（中心）
    for (const [a, b] of bars) {
      expect((a[0] + b[0]) / 2).toBeCloseTo(0, 9)
      expect((a[1] + b[1]) / 2).toBeCloseTo(0, 9)
      expect((a[2] + b[2]) / 2).toBeCloseTo(0, 9)
    }
    // 立起來：三個下端同高、三個上端同高，上下端的高差就是 L × sin 35°
    const lows = bars.map(([a, b]) => Math.min(a[1], b[1]))
    expect(Math.max(...lows) - Math.min(...lows)).toBeLessThan(1e-9)
    const highs = bars.map(([a, b]) => Math.max(a[1], b[1]))
    expect(highs[0]! - lows[0]!).toBeCloseTo(OBSTACLE_SIZE.hedgehog.bar * Math.sin(Math.asin(1 / Math.sqrt(3))), 9)
  })

  it('捷克刺蝟貼地：下端埋進地下、上端離地高，三根都是封閉的長條（每根十二個三角形）', () => {
    // 5 m 長的線：第一排在 3 m 放一個，第二排從 6 m 起，放不到
    const g = one('hedgehog', 5)
    expect(g.getAttribute('position').count / 3).toBe(36)
    const v = verts(g)
    expect(Math.min(...v.map((p) => p[1]))).toBeLessThan(0)
    expect(Math.max(...v.map((p) => p[1]))).toBeGreaterThan(1.2)
  })

  /**
   * 【反坦克障礙不得比坦克高】T-34 車高約 2.6 m；龍牙與刺蝟實物都在一公尺上下到兩公尺以內。
   * 量的是整顆合併幾何的最高頂點，抬起來的零件（刺蝟的上端）也算在內。
   */
  it('反坦克樁與捷克刺蝟都比 T-34 矮：樁 ≤ 1.5 m、刺蝟 ≤ 2.0 m', () => {
    const top = (g: ReturnType<typeof buildObstacles>): number => Math.max(...verts(g).map((p) => p[1]))
    expect(top(one('teeth', 30))).toBeLessThanOrEqual(1.5)
    expect(top(one('hedgehog', 30))).toBeLessThanOrEqual(2.0)
  })

  /**
   * 【鐵絲網是一條連續的螺旋，不是一堆圈】蛇腹形的實物是一卷拉開約 15 m 的彈簧。沿線每走
   * `pitch / segs` 一個頂點、繞軸轉 `360° / segs`，相鄰兩根短條共用頂點，整段首尾相接。
   */
  describe('鐵絲網的螺旋', () => {
    const W = OBSTACLE_SIZE.wire
    const line = [origin(), origin(100, 0)]
    const path = coilPath(line, 10, 70, flat)

    it('頂點數是 長度 × 每圈根數 ÷ 螺距；每圈 segs 個頂點繞軸一整圈', () => {
      expect(path.length).toBe(Math.round((60 * W.segs) / W.pitch) + 1)
      // 軸沿 x：離軸的位置是 (y − 軸高, z)，轉角每個頂點 360° / segs
      const axisY = W.radius - 0.08
      const ang = (k: number): number => Math.atan2(path[k]![1] - axisY, path[k]![2])
      const mid = Math.floor(path.length / 2)
      let turn = 0
      for (let k = mid; k < mid + W.segs; k++) {
        let d = ang(k + 1) - ang(k)
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        turn += d
      }
      // 一圈整：±2π
      expect(Math.abs(Math.abs(turn) - 2 * Math.PI)).toBeLessThan(1e-6)
    })

    it('離軸一個半徑（頭尾收窄的一圈除外）、最低的頂點在地面附近', () => {
      const axisY = W.radius - 0.08
      for (let k = W.segs; k + W.segs < path.length; k++) {
        expect(Math.hypot(path[k]![1] - axisY, path[k]![2])).toBeCloseTo(W.radius, 9)
      }
      expect(Math.min(...path.map((p) => p[1]))).toBeGreaterThan(-0.1)
      expect(Math.min(...path.map((p) => p[1]))).toBeLessThan(0.05)
      // 不比坦克高：連鐵絲的粗細一起算也在 1.3 m 以內
      expect(Math.max(...path.map((p) => p[1])) + W.thick).toBeLessThan(1.3)
    })

    it('段有頭有尾：頭尾一圈的半徑比全寬小', () => {
      const r = (k: number): number => Math.hypot(path[k]![1] - (W.radius - 0.08), path[k]![2])
      expect(r(0)).toBeLessThan(W.radius * 0.6)
      expect(r(path.length - 1)).toBeLessThan(W.radius * 0.6)
      expect(r(Math.floor(path.length / 2))).toBeCloseTo(W.radius, 9)
    })

    it('沿線每個頂點只往前走一小步（沒有跳點），整段是連續的', () => {
      const ds = W.pitch / W.segs
      for (let k = 0; k + 1 < path.length; k++) {
        const d = Math.hypot(path[k + 1]![0] - path[k]![0], path[k + 1]![1] - path[k]![1], path[k + 1]![2] - path[k]![2])
        expect(d).toBeLessThan(ds + W.radius * 2)
        expect(path[k + 1]![0]).toBeGreaterThan(path[k]![0])
      }
    })

    it('貼地：地面高 10 m 的地方整條螺旋跟著抬高', () => {
      const up = coilPath(line, 10, 70, () => 10)
      expect(Math.min(...up.map((p) => p[1]))).toBeGreaterThan(9.9)
    })
  })

  /**
   * 【實物的鐵絲網是分段的】蛇腹形一卷約 15 m，接成一段，段與段之間留缺口（自己人的通道、路口、
   * 地形的邊）；沒有一條線從頭鋪到尾。
   */
  describe('鐵絲網分段', () => {
    const W = OBSTACLE_SIZE.wire
    const pts = [{ x: 0, z: 0 }, { x: 1200, z: 0 }]
    const runs = wireRuns(pts, 12345)

    it('有好幾段，每段長度在 run 範圍內（最後一段可以短）、都在線上', () => {
      expect(runs.length).toBeGreaterThan(8)
      runs.forEach((r, i) => {
        expect(r.s0).toBeGreaterThanOrEqual(0)
        expect(r.s1).toBeLessThanOrEqual(1200 + 1e-9)
        expect(r.s1 - r.s0).toBeLessThanOrEqual(W.run[1] + 1e-9)
        if (i + 1 < runs.length) expect(r.s1 - r.s0).toBeGreaterThanOrEqual(W.run[0] - 1e-9)
      })
    })

    it('段與段之間的缺口在 gap 範圍內，段不重疊', () => {
      for (let i = 0; i + 1 < runs.length; i++) {
        const gap = runs[i + 1]!.s0 - runs[i]!.s1
        expect(gap).toBeGreaterThanOrEqual(W.gap[0] - 1e-9)
        expect(gap).toBeLessThanOrEqual(W.gap[1] + 1e-9)
      }
    })

    it('一條線有一半到九成鋪著鐵絲網，不是整條', () => {
      const covered = runs.reduce((s, r) => s + (r.s1 - r.s0), 0)
      expect(covered / 1200).toBeGreaterThan(0.5)
      expect(covered / 1200).toBeLessThan(0.9)
    })

    it('同一條線同一組結果；換一條線（種子）段就換位置', () => {
      expect(wireRuns(pts, 12345)).toEqual(runs)
      expect(wireRuns(pts, 999)).not.toEqual(runs)
    })

    it('幾何只畫段裡面：缺口的地方沒有鐵絲', () => {
      const g = buildObstacles([{ kind: 'wire', points: pts }], flat)
      const p = g.getAttribute('position')
      // 第 0 條線的種子是 (0 + 1) × 100003（`obstaclePlacements` 與 `buildObstacles` 共用同一個）
      const own = wireRuns(pts, 100003)
      expect(own.length).toBeGreaterThan(8)
      const inRun = (x: number): boolean => own.some((r) => x >= r.s0 - W.thick && x <= r.s1 + W.thick)
      for (let i = 0; i < p.count; i++) expect(inRun(p.getX(i))).toBe(true)
      // 而且確實有三角形（不是空的）
      expect(p.count).toBeGreaterThan(3000)
    })
  })
})

describe('障礙物的幾何', () => {
  const geo = buildObstacles(OBSTACLES, flat)

  it('非索引、有位置、法線與頂點色，全是有限的數', () => {
    expect(geo.index).toBeNull()
    for (const name of ['position', 'normal', 'color']) {
      const a = geo.getAttribute(name)
      expect(a, name).toBeDefined()
      for (let i = 0; i < a!.array.length; i++) expect(Number.isFinite(a!.array[i]!)).toBe(true)
    }
    expect(geo.getAttribute('position').count % 3).toBe(0)
  })

  it('三角形數在預算內', () => {
    const tris = geo.getAttribute('position').count / 3
    expect(tris).toBeGreaterThan(10_000)
    expect(tris).toBeLessThanOrEqual(OBSTACLE_MAX_TRIS)
  })

  it('沒有與地面共面的朝下面（埋地的底面不畫；懸空零件的下表面是傾斜的，不在地面上）', () => {
    const n = geo.getAttribute('normal')
    const p = geo.getAttribute('position')
    for (let t = 0; t < p.count; t += 3) {
      if (n.getY(t) >= -0.95) continue
      const cy = (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) / 3
      // 朝正下方的面只能在地面以下
      expect(cy).toBeLessThan(-0.05)
    }
  })

  it('零件貼著地面：最低的頂點在地面以下不多，不浮在空中', () => {
    const p = geo.getAttribute('position')
    let low = Infinity
    for (let i = 0; i < p.count; i++) low = Math.min(low, p.getY(i))
    expect(low).toBeLessThan(0)
    expect(low).toBeGreaterThan(-0.6)
  })

  it('頂點色是線性色（與其他佈景同一個轉法）', () => {
    const c = new Color(OBSTACLE_COLORS.teeth)
    const col = geo.getAttribute('color')
    let found = 0
    for (let i = 0; i < col.count; i++) {
      if (Math.abs(col.getX(i) - c.r) < 1e-6 && Math.abs(col.getY(i) - c.g) < 1e-6 && Math.abs(col.getZ(i) - c.b) < 1e-6) found++
    }
    expect(found).toBeGreaterThan(1000)
  })

  it('同一份資料兩次建出同一個幾何', () => {
    const again = buildObstacles(OBSTACLES, flat)
    expect(Array.from(again.getAttribute('position').array)).toEqual(Array.from(geo.getAttribute('position').array))
  })

  it('跟著地面高度走', () => {
    const g = buildObstacles([{ kind: 'teeth', points: [{ x: 0, z: 0 }, { x: 4, z: 0 }] }], () => 10)
    const y = g.getAttribute('position')
    let top = -Infinity
    for (let i = 0; i < y.count; i++) top = Math.max(top, y.getY(i))
    expect(top).toBeGreaterThan(10)
  })
})

describe('勒熱夫的地形掛上障礙物', () => {
  it('地形多了一組佈景（第五個孩子），切成好幾塊，釋放不拋錯', () => {
    const t = createTerrain('rzhev')
    expect(t.object.children.length).toBeGreaterThanOrEqual(5)
    const scenery = t.object.children[4]!
    expect(scenery.children.length).toBeGreaterThanOrEqual(2)
    t.dispose()
  })
})
