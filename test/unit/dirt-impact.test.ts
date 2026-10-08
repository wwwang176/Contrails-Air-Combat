import { describe, it, expect, vi } from 'vitest'
import {
  DIRT_CULL, DIRT_IMPACT, createDirtImpacts, dirtSurfaceOf, type DirtImpacts,
} from '../../src/render/dirtImpact'
import { clearImpacts, createImpacts, pushImpact, type ImpactEvents } from '../../src/world/events'
import type { TerrainKind } from '../../src/world/terrainKind'

/**
 * 子彈打進地面的土柱。用真的粒子池，讀 `live` 與實例顏色。
 *
 * 【取樣量都在容量以內】池滿了會覆蓋最舊的，`live` 停在容量上 —— 那時比例
 * 與決定性都量不出來。
 */

const NO_WATER = (): number => -Infinity

/** `n` 發落在原點附近、相機貼著看 */
function strafe(d: DirtImpacts, n: number, water = NO_WATER, out = createImpacts()): ImpactEvents {
  const ev = createImpacts(n)
  for (let i = 0; i < n; i++) pushImpact(ev, i * 0.5, 0, 0, 0, 1, 0)
  d.emit(ev, 0, 10, 0, water, out)
  return out
}

describe('一發的組成', () => {
  it('土地一發：土塊、土柱、煙塵照配方，沒有夾土', () => {
    const d = createDirtImpacts()
    strafe(d, 1)
    expect(d.pools.clods.live).toBe(DIRT_IMPACT.clodCount)
    expect(d.pools.spout.live).toBe(DIRT_IMPACT.spoutCount)
    expect(d.pools.dust.live).toBe(DIRT_IMPACT.dustCount)
    expect(d.pools.mixClods.live).toBe(0)
  })

  it('雪地：一部分土塊是夾在裡面的深色泥土，比例接近 mixRatio', () => {
    const d = createDirtImpacts()
    d.setSurface('snow')
    strafe(d, 80)
    const mix = d.pools.mixClods.live
    const all = mix + d.pools.clods.live
    expect(all).toBe(80 * DIRT_IMPACT.clodCount)
    expect(mix / all).toBeGreaterThan(DIRT_IMPACT.mixRatio - 0.08)
    expect(mix / all).toBeLessThan(DIRT_IMPACT.mixRatio + 0.08)
  })
})

/**
 * 【大小倍率】戰車與反坦克砲的砲彈落地用 2 倍（`main.ts` 的 `onShellLanded`）。尺寸照倍率；土柱
 * 被阻尼拖住、高度跟初速成正比，所以初速也照倍率；土塊是拋體、高度跟初速平方成正比，初速乘倍率
 * 的平方根 —— 兩者都長高成倍率倍
 */
describe('大小倍率', () => {
  type Call = { speed: number; size: number }
  /** 一發，記下每一顆的初速與尺寸 */
  function one(scale?: number): { clods: Call[]; spout: Call[]; dust: Call[] } {
    const d = createDirtImpacts()
    const rec = { clods: [] as Call[], spout: [] as Call[], dust: [] as Call[] }
    for (const k of ['clods', 'spout', 'dust'] as const) {
      vi.spyOn(d.pools[k], 'emit').mockImplementation((_x, _y, _z, vx, vy, vz, size) => {
        rec[k].push({ speed: Math.hypot(vx, vy, vz), size: size ?? 1 })
      })
    }
    const ev = createImpacts(1)
    pushImpact(ev, 0, 0, 0, 0, 1, 0)
    d.emit(ev, 0, 10, 0, NO_WATER, createImpacts(), scale)
    return rec
  }

  it('2 倍：數量不變、尺寸 2 倍、土柱初速 2 倍、土塊初速 √2 倍、煙塵初速 √2 倍', () => {
    const a = one()
    const b = one(2)
    for (const k of ['clods', 'spout', 'dust'] as const) {
      expect(b[k]).toHaveLength(a[k].length)
      for (let i = 0; i < a[k].length; i++) expect(b[k][i]!.size, k).toBeCloseTo(a[k][i]!.size * 2, 9)
    }
    for (let i = 0; i < a.spout.length; i++) expect(b.spout[i]!.speed).toBeCloseTo(a.spout[i]!.speed * 2, 6)
    for (let i = 0; i < a.clods.length; i++) expect(b.clods[i]!.speed).toBeCloseTo(a.clods[i]!.speed * Math.SQRT2, 6)
    for (let i = 0; i < a.dust.length; i++) expect(b.dust[i]!.speed).toBeCloseTo(a.dust[i]!.speed * Math.SQRT2, 6)
  })

  it('省略 = 1 倍（戰鬥機機槍打地面不變）', () => {
    const a = one()
    const b = one(1)
    expect(b).toEqual(a)
  })
})

describe('決定性', () => {
  /** 種子不歸零的話，第二輪用的是 80 之後的種子，夾土數會不同 */
  it('reset 之後同一串事件得到同一個結果；新實例也一樣', () => {
    const a = createDirtImpacts()
    a.setSurface('snow')
    strafe(a, 80)
    const first = a.pools.mixClods.live
    a.reset()
    expect(a.pools.mixClods.live + a.pools.clods.live + a.pools.spout.live + a.pools.dust.live)
      .toBe(0)
    strafe(a, 80)
    expect(a.pools.mixClods.live).toBe(first)

    const b = createDirtImpacts()
    b.setSurface('snow')
    strafe(b, 80)
    expect(b.pools.mixClods.live).toBe(first)
  })
})

describe('換地表', () => {
  /** 土柱實例裡最亮與最暗的綠色通道（線性值） */
  function spoutGreen(d: DirtImpacts): { lo: number, hi: number } {
    const o = d.pools.spout.object
    const c = o.instanceColor!.array
    let lo = Infinity
    let hi = 0
    for (let i = 0; i < o.count; i++) {
      if (o.instanceMatrix.array[i * 16]! === 0) continue
      lo = Math.min(lo, c[i * 3 + 1]!)
      hi = Math.max(hi, c[i * 3 + 1]!)
    }
    return { lo, hi }
  }

  it('只改顏色，不重建池', () => {
    const d = createDirtImpacts()
    const before = { ...d.pools }
    strafe(d, 2)
    d.step(0.01)
    expect(spoutGreen(d).hi).toBeLessThan(0.2)

    d.setSurface('snow')
    expect(d.pools).toEqual(before)
    for (const k of Object.keys(before) as (keyof typeof before)[]) {
      expect(d.pools[k]).toBe(before[k])
    }
    d.reset()
    strafe(d, 2)
    d.step(0.01)
    expect(spoutGreen(d).lo).toBeGreaterThan(0.5)
  })
})

describe('剔除與河面', () => {
  it(`離相機超過 ${DIRT_CULL} m 不噴`, () => {
    const d = createDirtImpacts()
    const ev = createImpacts()
    pushImpact(ev, DIRT_CULL + 1, 0, 0, 0, 1, 0)
    d.emit(ev, 0, 0, 0, NO_WATER, createImpacts())
    expect(d.pools.spout.live).toBe(0)
    clearImpacts(ev)
    pushImpact(ev, DIRT_CULL - 1, 0, 0, 0, 1, 0)
    d.emit(ev, 0, 0, 0, NO_WATER, createImpacts())
    expect(d.pools.spout.live).toBe(DIRT_IMPACT.spoutCount)
  })

  it('落點在河面以下：改推水柱，高度是水面，不噴土', () => {
    const d = createDirtImpacts()
    const river = strafe(d, 1, () => 1)
    expect(river.count).toBe(1)
    expect(river.data[1]).toBe(1)
    expect(d.pools.clods.live + d.pools.mixClods.live + d.pools.spout.live + d.pools.dust.live)
      .toBe(0)
  })
})

describe('dirtSurfaceOf', () => {
  it('勒熱夫是雪，其他都是土', () => {
    const soil: TerrainKind[] = [
      'sea', 'archipelago', 'farmland', 'autumnFarmland', 'leuna', 'poltava', 'asch', 'leyte',
    ]
    expect(dirtSurfaceOf('rzhev')).toBe('snow')
    for (const k of soil) expect(dirtSurfaceOf(k)).toBe('soil')
  })
})
