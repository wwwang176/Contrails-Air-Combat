import { describe, expect, it } from 'vitest'
import {
  BEACHHEAD, EVACUATE_Z, FRONT_LINE, LEYTE_FLAK_SITES, LEYTE_LSTS, LEYTE_MASSIFS, LEYTE_PEAK_MAX, LEYTE_ROAD,
  LEYTE_ROADS, LST_RAMP_REACH, PLAIN_HEIGHT, PLAIN_TOP, SAND_TOP, FIELD_HALF,
  LEYTE_BALLOONS, LEYTE_BEACH, LEYTE_JUNCTIONS, ROAD_WIDEN_MAX, ROAD_WIDTH, isInBeachClearing, isInJunctionClearing,
  baseHeight, carveFactor, coastZ, createLeyte, distanceToRoad, farHeight, isInRoadClearing, isNearRoad,
  roadTreeClear,
} from '../../src/world/leyte'
import { headingToward } from '../../src/core/routeMotion'
import { WOBBLE_MAX } from '../../src/world/archipelago'
import { HILL_GAP } from '../../src/world/farmland'
import { DEFAULT_SAFETY } from '../../src/ai/safety'
import { terrainCeiling } from '../../src/ai/terrainSense'
import { MISSIONS } from '../../src/battle/missions'
import { SHIP_CLASSES } from '../../src/world/ships'
import { BROAD_CROWN_R } from '../../src/specs/flora'

/**
 * # 雷伊泰的海岸線地形（日 M2）
 *
 * 守的是佈局的幾何：陸海的方位、公路全程在平地上而且夠彎、丘陵不壓路、
 * 路口據點不壓路。數值本身是起始值，由試飛裁定 —— 這裡不釘它們。
 */

const { field, hills } = createLeyte()

describe('雷伊泰的海岸線', () => {
  it('陸在 +Z、海在 −Z：岸線以北 600 m 是海、以南 600 m 是平地（不算丘陵）', () => {
    // 【量基準面】靠海的大丘陵會一路延伸到海裡成為岬角，那是刻意的
    for (let x = -10000; x <= 10000; x += 250) {
      expect(baseHeight(x, coastZ(x) - 600)).toBeLessThan(0)
      expect(baseHeight(x, coastZ(x) + 600)).toBeGreaterThanOrEqual(PLAIN_HEIGHT - 1e-6)
    }
  })

  it('岸線是彎的：振幅至少 400 m', () => {
    let lo = Infinity
    let hi = -Infinity
    for (let x = -12000; x <= 12000; x += 100) {
      lo = Math.min(lo, coastZ(x))
      hi = Math.max(hi, coastZ(x))
    }
    expect(hi - lo).toBeGreaterThan(400)
  })
})

describe('雷伊泰的公路', () => {
  it('從海岸起：第一點碰到水線，其餘在陸上；上岸那一段之後全程在平地', () => {
    const first = LEYTE_ROAD[0]!
    expect(baseHeight(first.x, first.z)).toBeLessThanOrEqual(SAND_TOP)
    let s = 0
    for (let i = 1; i < LEYTE_ROAD.length; i++) {
      const a = LEYTE_ROAD[i - 1]!
      const b = LEYTE_ROAD[i]!
      const len = Math.hypot(b.x - a.x, b.z - a.z)
      const n = Math.ceil(len / 20)
      for (let k = 0; k <= n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n
        const z = a.z + ((b.z - a.z) * k) / n
        // 【上岸的前 500 m 可以在沙灘斜坡上】其後一律在平地（含緩坡）上
        if (s + (len * k) / n > 500) expect(baseHeight(x, z)).toBeGreaterThanOrEqual(PLAIN_HEIGHT - 1e-6)
        else expect(baseHeight(x, z)).toBeGreaterThan(-3)
      }
      s += len
    }
  })

  it('每個轉角不超過 45°（車走圓弧時偏離中線不超過路半寬）', () => {
    for (let i = 1; i + 1 < LEYTE_ROAD.length; i++) {
      const p = LEYTE_ROAD[i - 1]!
      const q = LEYTE_ROAD[i]!
      const r = LEYTE_ROAD[i + 1]!
      const h0 = headingToward(q.x - p.x, q.z - p.z)
      const h1 = headingToward(r.x - q.x, r.z - q.z)
      const d = Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)))
      expect(d).toBeLessThanOrEqual(Math.PI / 4 + 1e-9)
    }
  })

  it('蜿蜒：沒有超過 400 m 的直線段，總長比頭尾直線距離長一成半以上', () => {
    let run = 0
    let total = 0
    for (let i = 1; i < LEYTE_ROAD.length; i++) {
      const p = LEYTE_ROAD[i - 1]!
      const q = LEYTE_ROAD[i]!
      const len = Math.hypot(q.x - p.x, q.z - p.z)
      expect(len).toBeGreaterThan(40)
      total += len
      if (i + 1 < LEYTE_ROAD.length) {
        const r = LEYTE_ROAD[i + 1]!
        const h0 = headingToward(q.x - p.x, q.z - p.z)
        const h1 = headingToward(r.x - q.x, r.z - q.z)
        const d = Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)))
        run = d < (2 * Math.PI) / 180 ? run + len : 0
        expect(run).toBeLessThanOrEqual(400)
      }
    }
    const a = LEYTE_ROAD[0]!
    const z = LEYTE_ROAD[LEYTE_ROAD.length - 1]!
    expect(total).toBeGreaterThan(1.15 * Math.hypot(z.x - a.x, z.z - a.z))
  })

  it('isNearRoad 與 distanceToRoad 一致', () => {
    for (let x = -3000; x <= 4000; x += 137) {
      for (let z = -4000; z <= 2000; z += 131) {
        expect(isNearRoad(x, z, 30), `${x},${z}`).toBe(distanceToRoad(x, z) < 30)
      }
    }
  })

  it('路網：第 0 條就是車隊那一條；支線有粗有細、全部在場內', () => {
    expect(LEYTE_ROADS[0]!.points).toBe(LEYTE_ROAD)
    const widths = new Set(LEYTE_ROADS.map((r) => r.halfWidth))
    expect(widths.size).toBeGreaterThanOrEqual(3)
    expect(LEYTE_ROADS.length).toBeGreaterThan(5)
    for (const r of LEYTE_ROADS) {
      for (const p of r.points) {
        expect(Math.abs(p.x), `${p.x},${p.z}`).toBeLessThan(FIELD_HALF)
        expect(Math.abs(p.z), `${p.x},${p.z}`).toBeLessThan(FIELD_HALF)
      }
    }
  })

  it('isInRoadClearing 與逐條逐段算的答案一致（索引不漏段）', () => {
    const brute = (x: number, z: number): boolean => LEYTE_ROADS.some((r) => {
      const clear = roadTreeClear(r)
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1]!
        const b = r.points[i]!
        const abx = b.x - a.x
        const abz = b.z - a.z
        const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)))
        if (Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)) < clear) return true
      }
      return false
    })
    let hits = 0
    // 每條路旁邊撒點（落在清空帶內外都有），再加全場的固定序列
    for (const r of LEYTE_ROADS) {
      for (let i = 0; i < r.points.length; i += 3) {
        const p = r.points[i]!
        for (const off of [0, 5, 11, 19, 27]) {
          const x = p.x + off
          const z = p.z - off * 0.7
          expect(isInRoadClearing(x, z), `${x},${z}`).toBe(brute(x, z))
          if (brute(x, z)) hits++
        }
      }
    }
    for (let i = 0; i < 2000; i++) {
      const x = -FIELD_HALF + ((i * 7919) % 1000) / 1000 * 2 * FIELD_HALF
      const z = -FIELD_HALF + ((i * 104729) % 1000) / 1000 * 2 * FIELD_HALF
      expect(isInRoadClearing(x, z)).toBe(brute(x, z))
    }
    expect(hits).toBeGreaterThan(200)
  })

  it('支線接得上：每一條支線的頭都落在另一條路上', () => {
    for (const r of LEYTE_ROADS.slice(1)) {
      const h = r.points[0]!
      // 海岸公路的兩頭在場邊，改看它與車隊那一條相交
      const onOther = LEYTE_ROADS.some((o) => o !== r && o.points.some((p) => Math.hypot(p.x - h.x, p.z - h.z) < 1))
      const crossesMain = r.points.some((p) => distanceToRoad(p.x, p.z) < 60)
      expect(onOther || crossesMain, `${h.x},${h.z}`).toBe(true)
    }
  })

  it('灘頭與前線就是公路的兩端', () => {
    expect(BEACHHEAD).toEqual(LEYTE_ROAD[0])
    expect(FRONT_LINE).toEqual(LEYTE_ROAD[LEYTE_ROAD.length - 1])
  })

  it('distanceToRoad 在中線上是 0、離開就變大', () => {
    const a = LEYTE_ROAD[2]!
    expect(distanceToRoad(a.x, a.z)).toBeCloseTo(0, 6)
    expect(distanceToRoad(a.x + 1000, a.z)).toBeGreaterThan(100)
  })
})

describe('雷伊泰的山脈', () => {
  it('圓盤兩兩至少隔 HILL_GAP —— AI 一次只處理一個圓盤（`ai/terrainSense.ts`）', () => {
    for (let i = 0; i < LEYTE_MASSIFS.length; i++) {
      for (let j = i + 1; j < LEYTE_MASSIFS.length; j++) {
        const a = LEYTE_MASSIFS[i]!
        const b = LEYTE_MASSIFS[j]!
        const gap = Math.hypot(a.cx - b.cx, a.cz - b.cz) - a.outerRadius - b.outerRadius
        expect(gap, `${i} ↔ ${j}`).toBeGreaterThanOrEqual(HILL_GAP)
      }
    }
  })

  it('每一瓣連同 wobble 都在自己的圓盤內、峰高是瓣的最大值 —— AI 的圓盤與高度上界靠它', () => {
    for (const m of LEYTE_MASSIFS) {
      let top = 0
      for (const lo of m.lobes) {
        expect(Math.hypot(lo.cx - m.cx, lo.cz - m.cz) + lo.radius * WOBBLE_MAX)
          .toBeLessThanOrEqual(m.outerRadius + 1e-6)
        top = Math.max(top, lo.peak)
      }
      expect(m.peak).toBe(top)
    }
  })

  it('山脈裡的瓣連成一片：沒有只剩一兩瓣的孤丘，每一瓣都與同一座的另一瓣重疊', () => {
    for (const m of LEYTE_MASSIFS) {
      expect(m.lobes.length, `${m.cx},${m.cz}`).toBeGreaterThan(2)
      for (const a of m.lobes) {
        const touches = m.lobes.some((b) => b !== a
          && Math.hypot(a.cx - b.cx, a.cz - b.cz) < a.radius + b.radius)
        expect(touches, `${a.cx},${a.cz}`).toBe(true)
      }
    }
  })

  it('內插後的地形不高過 AI 估的高度上界 —— 平地的高度與 80 m 格距在凸處的誤差都要被蓋住', () => {
    // 【步長 20 m、偏 7 m】落在格子內部，內插與解析的差最大的地方
    // 【量的是 AI 讀的那一份（`hills`）】瓣的起伏疊在平地上，AI 那一份加了 PLAIN_TOP
    for (const m of hills) {
      for (let x = m.cx - m.outerRadius + 7; x <= m.cx + m.outerRadius; x += 20) {
        for (let z = m.cz - m.outerRadius + 7; z <= m.cz + m.outerRadius; z += 20) {
          const c = terrainCeiling(m, x, z)
          if (c === 0) continue
          const h = field.sample(x, z)
          if (h > c) expect(h, `${x.toFixed(0)},${z.toFixed(0)}`).toBeLessThanOrEqual(c)
        }
      }
    }
  })

  it('山谷只往下挖：刻痕的保留比例在 0.65～1，而且真的有挖到的地方', () => {
    let lo = Infinity
    let hi = -Infinity
    for (let x = -15000; x <= 15000; x += 173) {
      for (let z = -15000; z <= 15000; z += 191) {
        const k = carveFactor(x, z)
        lo = Math.min(lo, k)
        hi = Math.max(hi, k)
      }
    }
    expect(lo).toBeGreaterThanOrEqual(0.65 - 1e-9)
    expect(lo).toBeLessThan(0.75)
    expect(hi).toBeLessThanOrEqual(1)
  })

  it('每一瓣都在場地之內 —— 被高度場的邊界切掉的話，場邊會是一道崖', () => {
    for (const lo of LEYTE_MASSIFS.flatMap((m) => m.lobes)) {
      const r = lo.radius * WOBBLE_MAX
      expect(Math.abs(lo.cx) + r, `${lo.cx},${lo.cz}`).toBeLessThanOrEqual(FIELD_HALF + 1e-6)
      expect(Math.abs(lo.cz) + r, `${lo.cx},${lo.cz}`).toBeLessThanOrEqual(FIELD_HALF + 1e-6)
    }
  })

  it('平地的緩坡不超過 AI 的改出餘裕（丘陵之外 AI 一律當海平面）', () => {
    let top = 0
    for (let x = -14000; x <= 14000; x += 97) {
      for (let z = -3000; z <= 14000; z += 89) top = Math.max(top, baseHeight(x, z))
    }
    expect(top).toBeLessThan(DEFAULT_SAFETY.fighterClearance)
  })

  it('峰高不超過上限、瓣心在陸上、瓣的膨脹圓離公路至少 400 m', () => {
    for (const m of hills) expect(m.peak).toBeLessThanOrEqual(LEYTE_PEAK_MAX)
    for (const m of LEYTE_MASSIFS) {
      for (const lo of m.lobes) {
        // 【瓣心在陸上就好】靠海的那一側可以一路延伸到海裡，是岬角
        expect(lo.cz, `${lo.cx},${lo.cz}`).toBeGreaterThan(coastZ(lo.cx) + 600)
        expect(distanceToRoad(lo.cx, lo.cz) - lo.radius * WOBBLE_MAX).toBeGreaterThanOrEqual(400 - 1e-6)
      }
    }
  })

  it('避障清單就是山脈（每一瓣加上平地的最高處），高度場的最高點落在山脈上', () => {
    expect(hills.length).toBe(LEYTE_MASSIFS.length)
    hills.forEach((h, i) => {
      const m = LEYTE_MASSIFS[i]!
      expect([h.cx, h.cz, h.outerRadius, h.peak]).toEqual([m.cx, m.cz, m.outerRadius, m.peak + PLAIN_TOP])
      h.lobes.forEach((lo, k) => expect(lo.peak).toBe(m.lobes[k]!.peak + PLAIN_TOP))
    })
    let top = -Infinity
    for (const v of field.data) top = Math.max(top, v)
    expect(top).toBeGreaterThan(PLAIN_HEIGHT + 50)
    expect(top).toBeLessThanOrEqual(LEYTE_PEAK_MAX + 1e-6)
  })
})

describe('固定防空砲位', () => {
  it('全部在平地上、離公路中線至少 40 m', () => {
    expect(LEYTE_FLAK_SITES.length).toBeGreaterThan(0)
    for (const s of LEYTE_FLAK_SITES) {
      expect(baseHeight(s.x, s.z), `${s.x},${s.z}`).toBeGreaterThanOrEqual(PLAIN_HEIGHT - 1e-6)
      expect(distanceToRoad(s.x, s.z), `${s.x},${s.z}`).toBeGreaterThanOrEqual(40)
    }
  })
})

describe('場外的遠景陸地', () => {
  it('在場地邊緣與場內的基準面接得上', () => {
    const edge = FIELD_HALF
    for (let t = -edge; t <= edge; t += 500) {
      expect(farHeight(edge, t)).toBeCloseTo(baseHeight(edge, t), 6)
      expect(farHeight(-edge, t)).toBeCloseTo(baseHeight(-edge, t), 6)
      expect(farHeight(t, edge)).toBeCloseTo(baseHeight(t, edge), 6)
    }
  })

  it('海岸線照同一條曲線延伸：岸外是水、岸內是陸', () => {
    for (let x = -60000; x <= 60000; x += 2500) {
      expect(farHeight(x, coastZ(x) - 800)).toBeLessThan(0)
      expect(farHeight(x, coastZ(x) + 800)).toBeGreaterThan(SAND_TOP)
    }
  })

  it('場地邊緣上的陸地是一條水平線 —— 遠景的粗格在那裡與場內的細格接得上、不裂開', () => {
    const h = (x: number, z: number): number => field.sample(x, z)
    for (let t = -FIELD_HALF; t <= FIELD_HALF; t += 80) {
      for (const [x, z] of [[FIELD_HALF, t], [-FIELD_HALF, t], [t, FIELD_HALF]] as const) {
        // 岸邊的斜坡不在這一條裡：那一段在水線附近，海面蓋著
        if (z - coastZ(x) < 1000) continue
        expect(h(x, z), `${x},${z}`).toBeCloseTo(PLAIN_HEIGHT, 3)
      }
    }
  })

  it('出了場地就是丘陵地：往外 6 km 的一圈上起伏超過 150 m', () => {
    let lo = Infinity
    let hi = -Infinity
    for (let t = -20000; t <= 20000; t += 250) {
      const y = farHeight(t, FIELD_HALF + 6000)
      lo = Math.min(lo, y)
      hi = Math.max(hi, y)
    }
    expect(hi - lo).toBeGreaterThan(150)
  })

  it('往內陸越遠越高：幾十公里外是山', () => {
    expect(farHeight(0, 45000)).toBeGreaterThan(200)
    expect(farHeight(0, 45000)).toBeGreaterThan(farHeight(0, 20000))
  })
})

describe('進場側保留的平地（EVACUATE_Z）', () => {
  it('在陸上、場地之內', () => {
    expect(baseHeight(0, EVACUATE_Z)).toBeGreaterThanOrEqual(PLAIN_HEIGHT - 1e-6)
    for (const lo of LEYTE_MASSIFS.flatMap((m) => m.lobes)) {
      expect(Math.hypot(lo.cx, lo.cz - EVACUATE_Z) - lo.radius * WOBBLE_MAX, `${lo.cx},${lo.cz}`)
        .toBeGreaterThanOrEqual(300 - 1e-6)
    }
    const a = MISSIONS.japan.find((c) => c.id === 'japan-m2')!.battle!.arena
    expect(Math.hypot(0 - a.x, EVACUATE_Z - a.z)).toBeLessThan(a.radius)
  })
})

describe('灘頭搶灘的 LST', () => {
  const HULL = SHIP_CLASSES.lst.hull[0]!
  const HW = HULL.half.x
  const STERN = HULL.center.z + HULL.half.z
  /** 艦體座標 (x, z) → 世界 (x, z)。與 `createShip` 的艏向同一套：艏向 h 的 −Z 朝 (−sin h, −cos h) */
  function toWorld(l: { x: number; z: number; heading: number }, lx: number, lz: number): [number, number] {
    const c = Math.cos(l.heading)
    const s = Math.sin(l.heading)
    return [l.x + lx * c + lz * s, l.z - lx * s + lz * c]
  }
  /** 俯視的外框：艦艉兩角、跳板末端兩角 */
  function outline(l: { x: number; z: number; heading: number }): [number, number][] {
    return [[-HW, STERN], [HW, STERN], [HW, -LST_RAMP_REACH], [-HW, -LST_RAMP_REACH]]
      .map(([x, z]) => toWorld(l, x!, z!))
  }
  /** 兩個凸四邊形在俯視上隔開 `gap` 以上（分離軸） */
  function separated(a: [number, number][], b: [number, number][], gap: number): boolean {
    for (const poly of [a, b]) {
      for (let i = 0; i < 4; i++) {
        const [x0, z0] = poly[i]!
        const [x1, z1] = poly[(i + 1) % 4]!
        const len = Math.hypot(x1 - x0, z1 - z0)
        const nx = (z1 - z0) / len
        const nz = -(x1 - x0) / len
        const proj = (p: [number, number][]): [number, number] => {
          const v = p.map(([x, z]) => x * nx + z * nz)
          return [Math.min(...v), Math.max(...v)]
        }
        const [a0, a1] = proj(a)
        const [b0, b1] = proj(b)
        if (b0 - a1 >= gap || a0 - b1 >= gap) return true
      }
    }
    return false
  }

  it('公路起點兩側各五艘', () => {
    expect(LEYTE_LSTS.length).toBe(10)
    expect(LEYTE_LSTS.filter((l) => l.x < BEACHHEAD.x).length).toBe(5)
  })

  it('跳板末端落在水線上、艦艉泡在水裡 —— 艏向寫反的話是艦艉擱上沙灘、艦艏朝海', () => {
    for (const l of LEYTE_LSTS) {
      const [tx, tz] = toWorld(l, 0, -LST_RAMP_REACH)
      expect(Math.abs(tz - coastZ(tx)), `${l.x},${l.z}`).toBeLessThan(1)
      const [sx, sz] = toWorld(l, 0, STERN)
      expect(baseHeight(sx, sz)).toBeLessThan(-2)
    }
  })

  it('船與船之間隔開 20 m 以上', () => {
    for (let i = 0; i < LEYTE_LSTS.length; i++) {
      for (let j = i + 1; j < LEYTE_LSTS.length; j++) {
        expect(separated(outline(LEYTE_LSTS[i]!), outline(LEYTE_LSTS[j]!), 20), `${i}-${j}`).toBe(true)
      }
    }
  })

  it('離公路 40 m 以上、離灘頭砲位 150 m 以上', () => {
    for (const l of LEYTE_LSTS) {
      for (const [x, z] of outline(l)) expect(distanceToRoad(x, z)).toBeGreaterThan(40)
      for (const f of LEYTE_FLAK_SITES) expect(Math.hypot(f.x - l.x, f.z - l.z)).toBeGreaterThan(150)
    }
  })
})

describe('灘頭的佈景', () => {
  const winches = LEYTE_BALLOONS.flatMap((b) => ('ship' in b.anchor ? [] : [b.anchor]))

  it('補給堆與車都在陸上、不壓公路、不壓灘頭砲位與氣球絞車', () => {
    const spots = [
      ...LEYTE_BEACH.dumps.map((d) => ({ x: d.x, z: d.z, r: Math.hypot(d.width, d.depth) / 2 })),
      ...LEYTE_BEACH.vehicles.map((v) => ({ x: v.x, z: v.z, r: 4 })),
      ...LEYTE_BEACH.depot.map((v) => ({ x: v.x, z: v.z, r: 4 })),
    ]
    expect(spots.length).toBeGreaterThan(40)
    for (const s of spots) {
      const at = `${s.x.toFixed(0)},${s.z.toFixed(0)}`
      expect(s.z, at).toBeGreaterThan(coastZ(s.x) + 10)
      expect(distanceToRoad(s.x, s.z), at).toBeGreaterThan(ROAD_WIDTH / 2 + s.r)
      for (const f of LEYTE_FLAK_SITES) expect(Math.hypot(f.x - s.x, f.z - s.z), at).toBeGreaterThan(s.r + 15)
      for (const w of winches) expect(Math.hypot(w.x - s.x, w.z - s.z), at).toBeGreaterThan(s.r + 10)
    }
  })

  it('補給堆與車上不長樹；離開灘頭就不算', () => {
    for (const d of LEYTE_BEACH.dumps) expect(isInBeachClearing(d.x, d.z)).toBe(true)
    for (const v of LEYTE_BEACH.vehicles) expect(isInBeachClearing(v.x, v.z)).toBe(true)
    for (const v of LEYTE_BEACH.depot) expect(isInBeachClearing(v.x, v.z)).toBe(true)
    expect(isInBeachClearing(0, 3000)).toBe(false)
    expect(isInBeachClearing(BEACHHEAD.x, BEACHHEAD.z + 1500)).toBe(false)
  })
})

describe('卸貨區旁的卡車（日 M2 的目標）', () => {
  const depot = LEYTE_BEACH.depot

  it('九輛卡車全部放得下', () => {
    expect(depot.length).toBe(9)
    for (const v of depot) expect(v.unit).toBe('usTruck')
  })

  /** 每一輛都停在 LST 的跳板前方（跳板末端往內陸 70 m 之內） */
  it('停在 LST 的卸貨區旁', () => {
    const tips = LEYTE_LSTS.map((l) => ({
      x: l.x - Math.sin(l.heading) * LST_RAMP_REACH, z: l.z - Math.cos(l.heading) * LST_RAMP_REACH,
    }))
    for (const v of depot) {
      expect(Math.min(...tips.map((t) => Math.hypot(t.x - v.x, t.z - v.z)))).toBeLessThan(70)
    }
  })

  /** 炸彈對 120 血的卡車致死半徑約 30.6 m：任兩輛隔得比它遠，一顆炸不到兩輛 */
  it('任兩輛至少隔 31 m', () => {
    for (let i = 0; i < depot.length; i++) {
      for (let j = i + 1; j < depot.length; j++) {
        expect(Math.hypot(depot[i]!.x - depot[j]!.x, depot[i]!.z - depot[j]!.z)).toBeGreaterThan(31)
      }
    }
  })

  /** 佈景卡車混在旁邊的話，玩家分不出哪幾輛炸了才算 */
  it('周圍 40 m 內沒有佈景的車', () => {
    for (const v of depot) {
      for (const o of LEYTE_BEACH.vehicles) expect(Math.hypot(o.x - v.x, o.z - v.z)).toBeGreaterThan(40)
    }
  })

  it('日 M2 把它們放成紅隊、不動的卡車', () => {
    const ground = MISSIONS.japan.find((c) => c.id === 'japan-m2')!.battle!.ground!
    for (const v of depot) {
      expect(ground.some((g) => g.unit === 'usTruck' && g.team === 'red' && g.x === v.x && g.z === v.z
        && g.heading === v.heading && g.motion === undefined)).toBe(true)
    }
  })
})

describe('路口的補給據點（日 M2）', () => {
  /** 車子的腳印：中心加一圈 8 點，半徑 4.5 m（車長一半再寬一點） */
  const ring = (x: number, z: number, r: number): { x: number; z: number }[] => [
    { x, z },
    ...Array.from({ length: 8 }, (_, k) => ({ x: x + r * Math.cos(k * Math.PI / 4), z: z + r * Math.sin(k * Math.PI / 4) })),
  ]
  /** 木箱堆的腳印：四角、四邊中點與中心 */
  const rect = (d: (typeof LEYTE_JUNCTIONS)[number]['dumps'][number]): { x: number; z: number }[] => {
    const c = Math.cos(d.heading)
    const s = Math.sin(d.heading)
    const out: { x: number; z: number }[] = []
    for (const u of [-1, 0, 1]) {
      for (const v of [-1, 0, 1]) {
        const lat = (u * d.width) / 2
        const dep = (v * d.depth) / 2
        out.push({ x: d.x + lat * c - dep * s, z: d.z - lat * s - dep * c })
      }
    }
    return out
  }

  it('三處：B、C、F，路口是兩條路共用的點', () => {
    expect(LEYTE_JUNCTIONS.map((j) => j.id)).toEqual(['B', 'C', 'F'])
    for (const j of LEYTE_JUNCTIONS) {
      const through = LEYTE_ROADS.filter((r) => r.points.some((p) => Math.hypot(p.x - j.x, p.z - j.z) < 1))
      expect(through.length, j.id).toBe(2)
    }
  })

  it('B、C 在車隊那一條路上，F 不在', () => {
    const on = (id: string): boolean => {
      const j = LEYTE_JUNCTIONS.find((x) => x.id === id)!
      return distanceToRoad(j.x, j.z) < 1
    }
    expect([on('B'), on('C'), on('F')]).toEqual([true, true, false])
  })

  it('每一處都有卡車、M16 與木箱堆，卡車合計 8 輛', () => {
    for (const j of LEYTE_JUNCTIONS) {
      expect(j.trucks.length, j.id).toBeGreaterThan(0)
      expect(j.flak.length, j.id).toBe(2)
      expect(j.dumps.length, j.id).toBeGreaterThan(0)
      for (const v of j.trucks) expect(v.unit).toBe('usTruck')
      for (const v of j.flak) expect(v.unit).toBe('usFlakTrack')
    }
    expect(LEYTE_JUNCTIONS.reduce((n, j) => n + j.trucks.length, 0)).toBe(8)
  })

  /** 車的腳印：四角與中心（長 7.2、寬 2.4，比卡車與 M16 的命中盒大一點） */
  const car = (v: { x: number; z: number; heading: number }): { x: number; z: number }[] => {
    const fx = -Math.sin(v.heading)
    const fz = -Math.cos(v.heading)
    const out = [{ x: v.x, z: v.z }]
    for (const u of [-1, 1]) for (const w of [-1, 1]) out.push({ x: v.x + fx * 3.6 * u + fz * 1.2 * w, z: v.z + fz * 3.6 * u - fx * 1.2 * w })
    return out
  }
  /** 這一點離每一條路的路面最寬處還有多遠，m；負的就是壓在路面上 */
  const gapToRoads = (p: { x: number; z: number }): number => {
    let gap = Infinity
    for (const road of LEYTE_ROADS) {
      const pts = road.points
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!
        const b = pts[i]!
        const abx = b.x - a.x
        const abz = b.z - a.z
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz)))
        gap = Math.min(gap, Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t)) - road.halfWidth * ROAD_WIDEN_MAX)
      }
    }
    return gap
  }
  /** 這一點在木箱堆的長方形裡嗎 */
  const inDump = (d: (typeof LEYTE_JUNCTIONS)[number]['dumps'][number], p: { x: number; z: number }): boolean => {
    const dx = p.x - d.x
    const dz = p.z - d.z
    const c = Math.cos(d.heading)
    const s = Math.sin(d.heading)
    return Math.abs(dx * c - dz * s) < d.width / 2 && Math.abs(dx * s + dz * c) < d.depth / 2
  }

  /** 車隊開過 B、C：停著的車壓在路面上就會被車隊穿過去 */
  it('車子與木箱堆都不壓任何一條路的路面（路寬取起伏的上限）', () => {
    for (const j of LEYTE_JUNCTIONS) {
      for (const v of [...j.trucks, ...j.flak]) {
        for (const p of car(v)) expect(gapToRoads(p), `${j.id} ${v.unit}`).toBeGreaterThan(0)
      }
      for (const d of j.dumps) {
        for (const p of rect(d)) expect(gapToRoads(p), `${j.id} 木箱堆`).toBeGreaterThan(0)
      }
    }
  })

  it('卡車停在路肩上：車子中心離路面最寬處不到 4 m，木箱堆緊貼在卡車後面', () => {
    for (const j of LEYTE_JUNCTIONS) {
      for (const v of j.trucks) expect(gapToRoads(v), j.id).toBeLessThan(4)
      for (const d of j.dumps) {
        const near = Math.min(...j.trucks.map((v) => Math.hypot(v.x - d.x, v.z - d.z)))
        expect(near, `${j.id} 木箱堆`).toBeLessThan(15)
      }
    }
  })

  it('離路口不遠、彼此不重疊：車距至少 7 m，木箱堆不壓車', () => {
    for (const j of LEYTE_JUNCTIONS) {
      const cars = [...j.trucks, ...j.flak]
      for (const v of cars) expect(Math.hypot(v.x - j.x, v.z - j.z), j.id).toBeLessThan(80)
      for (const d of j.dumps) expect(Math.hypot(d.x - j.x, d.z - j.z), j.id).toBeLessThan(90)
      for (let i = 0; i < cars.length; i++) {
        for (const o of cars.slice(i + 1)) expect(Math.hypot(o.x - cars[i]!.x, o.z - cars[i]!.z), j.id).toBeGreaterThan(7)
      }
      for (const d of j.dumps) {
        for (const v of cars) {
          for (const p of car(v)) expect(inDump(d, p), `${j.id} 木箱堆壓到 ${v.unit}`).toBe(false)
        }
      }
    }
  })

  it('在陸上、戰場之內', () => {
    const a = MISSIONS.japan.find((c) => c.id === 'japan-m2')!.battle!.arena
    for (const j of LEYTE_JUNCTIONS) {
      expect(j.z, j.id).toBeGreaterThan(coastZ(j.x) + 500)
      expect(Math.hypot(j.x - a.x, j.z - a.z), j.id).toBeLessThan(a.radius)
    }
  })

  /** 清的是樹幹：車外再一個最大樹冠半徑內都不能有樹，樹冠才不會蓋到車頂 */
  it('車子與木箱堆上不長樹，車外一個樹冠半徑內也沒有', () => {
    for (const j of LEYTE_JUNCTIONS) {
      for (const v of [...j.trucks, ...j.flak]) {
        for (const p of ring(v.x, v.z, 4.5 + BROAD_CROWN_R)) {
          expect(isInJunctionClearing(p.x, p.z), `${j.id} ${v.unit}`).toBe(true)
        }
      }
      for (const d of j.dumps) {
        for (const p of rect(d)) expect(isInJunctionClearing(p.x, p.z), `${j.id} 木箱堆`).toBe(true)
      }
    }
    expect(isInJunctionClearing(0, 6000)).toBe(false)
  })
})
