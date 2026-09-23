import { describe, expect, it } from 'vitest'
import {
  BEACHHEAD, EVACUATE_Z, FRONT_LINE, LEYTE_FLAK_SITES, LEYTE_HILLS, LEYTE_PEAK_MAX, LEYTE_ROAD,
  PLAIN_HEIGHT,
  baseHeight, coastZ, createLeyte, distanceToRoad,
} from '../../src/world/leyte'
import { headingToward } from '../../src/control/takeoffRoll'
import { WOBBLE_MAX } from '../../src/world/archipelago'
import { ARENA_RADIUS } from '../../src/world/arena'

/**
 * # 雷伊泰的海岸線地形（日 M2）
 *
 * 守的是佈局的幾何：陸海的方位、公路全程在平地上而且夠彎、丘陵不壓路、
 * 撤離點在陸上。數值本身是起始值，由試飛裁定 —— 這裡不釘它們。
 */

const { field, hills } = createLeyte()

describe('雷伊泰的海岸線', () => {
  it('陸在 +Z、海在 −Z：岸線以北 600 m 是海、以南 600 m 是平地', () => {
    for (let x = -10000; x <= 10000; x += 250) {
      expect(field.sample(x, coastZ(x) - 600)).toBeLessThan(0)
      expect(field.sample(x, coastZ(x) + 600)).toBeGreaterThanOrEqual(PLAIN_HEIGHT - 1e-6)
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
  it('每一點都在平地上（沒有落進海或斜坡）', () => {
    for (let i = 1; i < LEYTE_ROAD.length; i++) {
      const a = LEYTE_ROAD[i - 1]!
      const b = LEYTE_ROAD[i]!
      const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 20)
      for (let k = 0; k <= n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n
        const z = a.z + ((b.z - a.z) * k) / n
        expect(baseHeight(x, z)).toBeCloseTo(PLAIN_HEIGHT, 6)
      }
    }
  })

  it('彎的：至少 5 個轉角，每個轉角不超過 45°（車走圓弧時偏離中線不超過路半寬）', () => {
    let turns = 0
    for (let i = 1; i + 1 < LEYTE_ROAD.length; i++) {
      const p = LEYTE_ROAD[i - 1]!
      const q = LEYTE_ROAD[i]!
      const r = LEYTE_ROAD[i + 1]!
      const h0 = headingToward(q.x - p.x, q.z - p.z)
      const h1 = headingToward(r.x - q.x, r.z - q.z)
      const d = Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)))
      expect(d).toBeLessThanOrEqual(Math.PI / 4 + 1e-9)
      if (d > (5 * Math.PI) / 180) turns++
    }
    expect(turns).toBeGreaterThanOrEqual(5)
  })

  it('每一段至少 400 m（轉角的圓弧切得進去）', () => {
    for (let i = 1; i < LEYTE_ROAD.length; i++) {
      const a = LEYTE_ROAD[i - 1]!
      const b = LEYTE_ROAD[i]!
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThanOrEqual(400)
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

describe('雷伊泰的丘陵', () => {
  it('峰高不超過上限、全部在陸上、膨脹圓離公路至少 400 m', () => {
    for (const h of LEYTE_HILLS) {
      expect(h.peak).toBeLessThanOrEqual(LEYTE_PEAK_MAX)
      expect(h.cz - h.radius * WOBBLE_MAX).toBeGreaterThan(coastZ(h.cx) + 300)
      expect(distanceToRoad(h.cx, h.cz) - h.radius * WOBBLE_MAX).toBeGreaterThanOrEqual(400)
    }
  })

  it('避障清單只有丘陵，高度場的最高點落在丘陵上', () => {
    expect(hills.length).toBe(LEYTE_HILLS.length)
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
      expect(baseHeight(s.x, s.z), `${s.x},${s.z}`).toBeCloseTo(PLAIN_HEIGHT, 6)
      expect(distanceToRoad(s.x, s.z), `${s.x},${s.z}`).toBeGreaterThanOrEqual(40)
    }
  })
})

describe('撤離點', () => {
  it('在陸上、場地之內', () => {
    expect(baseHeight(0, EVACUATE_Z)).toBeCloseTo(PLAIN_HEIGHT, 6)
    expect(EVACUATE_Z).toBeLessThan(ARENA_RADIUS)
  })
})
