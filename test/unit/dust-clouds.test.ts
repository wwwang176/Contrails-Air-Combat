import { describe, expect, it } from 'vitest'
import { Color, type InstancedMesh } from 'three'
import {
  createGroundBattle, DUST_CLOUD_CAPACITY, DUST_CLOUD_EVERY, DUST_CLOUD_LIFE, DUST_CLOUD_LIFE_JITTER,
  DUST_CLOUD_LIFT_MAX, DUST_CLOUD_LIFT_MIN, DUST_CLOUD_SHADE, DUST_CLOUD_SPREAD, dustCloudSpot,
} from '../../src/render/groundBattle'
import { clearBattleFog, setBattleFog } from '../../src/render/heightFog'
import { AT_GUNS, BATTLE_HAZE, RZHEV_DUSTS, toLocal } from '../../src/world/rzhev'
import { MISSIONS, type ReadyMissionCard } from '../../src/battle/missions'

/**
 * # 塵團：出生位置、池子的容量、開場補暖、顏色
 *
 * 塵團是有人活動的地方持續冒出、慢慢長大、順風飄散的大而淡的粒子，補高度霧在側看時沒有「一團」的缺口。
 */

const PLACES = [{ x: 0, z: 0 }, { x: 1000, z: 0 }, { x: 0, z: 1000 }, { x: -800, z: -800 }]
const flat = (): number => 0
const NO_TARGETS: never[] = []

/** 池子裡活著的格子：死格子的矩陣是零，活的第一個元素是直徑 */
function live(o: InstancedMesh): number {
  let n = 0
  for (let i = 0; i < o.count; i++) if (o.instanceMatrix.array[i * 16]! !== 0) n++
  return n
}

function cloudsOf(gb: ReturnType<typeof createGroundBattle>): InstancedMesh | undefined {
  return gb.objects.find((o) => o.name === 'groundBattle.dustClouds') as InstancedMesh | undefined
}

describe('塵團的出生位置', () => {
  const out = { x: 0, z: 0, lift: 0 }

  it('同一個序號永遠同一點', () => {
    const a = { x: 0, z: 0, lift: 0 }
    dustCloudSpot(123, PLACES, out)
    dustCloudSpot(123, PLACES, a)
    expect(a).toEqual(out)
  })

  it('每一顆都落在某一處的散佈半徑內，離地高度在範圍內', () => {
    for (let k = 0; k < 2000; k++) {
      dustCloudSpot(k, PLACES, out)
      const d = Math.min(...PLACES.map((p) => Math.hypot(out.x - p.x, out.z - p.z)))
      expect(d).toBeLessThanOrEqual(DUST_CLOUD_SPREAD + 1e-6)
      expect(out.lift).toBeGreaterThanOrEqual(DUST_CLOUD_LIFT_MIN)
      expect(out.lift).toBeLessThanOrEqual(DUST_CLOUD_LIFT_MAX)
    }
  })

  /** 只有一處也不會挑到不存在的索引；每一處都有人挑到，而且不會全擠在少數幾處 */
  it('每一處都分得到，分得大致均勻', () => {
    const hits = PLACES.map(() => 0)
    for (let k = 0; k < 4000; k++) {
      dustCloudSpot(k, PLACES, out)
      let best = 0
      for (let i = 1; i < PLACES.length; i++) {
        if (Math.hypot(out.x - PLACES[i]!.x, out.z - PLACES[i]!.z) < Math.hypot(out.x - PLACES[best]!.x, out.z - PLACES[best]!.z)) best = i
      }
      hits[best]!++
    }
    for (const h of hits) {
      expect(h).toBeGreaterThan(4000 / PLACES.length * 0.8)
      expect(h).toBeLessThan(4000 / PLACES.length * 1.2)
    }
    dustCloudSpot(7, [PLACES[0]!], out)
    expect(Math.hypot(out.x, out.z)).toBeLessThanOrEqual(DUST_CLOUD_SPREAD + 1e-6)
  })
})

describe('塵團的池子', () => {
  const theater = { shooters: [], period: 1e6, range: 1500, dusts: PLACES } as never

  it('卡片沒有出處就沒有這個池；有出處就有', () => {
    const none = createGroundBattle({ shooters: [], period: 1e6, range: 1500 } as never, () => {})
    expect(cloudsOf(none)).toBeUndefined()
    none.dispose()
    const gb = createGroundBattle(theater, () => {})
    expect(cloudsOf(gb)).toBeDefined()
    gb.dispose()
  })

  /** 容量要裝得下每一顆都抽到最長壽命的情況，否則環形緩衝會覆蓋還在飄的塵團 */
  it('容量大於最壞情況的同時存活數', () => {
    expect(DUST_CLOUD_CAPACITY).toBeGreaterThanOrEqual((DUST_CLOUD_LIFE * (1 + DUST_CLOUD_LIFE_JITTER)) / DUST_CLOUD_EVERY)
  })

  /** 開場補暖：第一幀之後就是穩態的數量，不是從一片空白慢慢長出來 */
  it('第一幀之後池子已經是穩態的滿，而且沒有滿到溢出', () => {
    const gb = createGroundBattle(theater, () => {})
    const o = cloudsOf(gb)!
    expect(live(o)).toBe(0)
    gb.update(NO_TARGETS, 0, 0, flat)
    const steady = DUST_CLOUD_LIFE / DUST_CLOUD_EVERY
    expect(live(o)).toBeGreaterThan(steady * 0.8)
    expect(live(o)).toBeLessThan(steady * 1.2)
    expect(live(o)).toBeLessThan(DUST_CLOUD_CAPACITY)
    gb.dispose()
  })

  it('之後的每一幀都維持穩態：跑一百秒，數量不掉也不爆', () => {
    const gb = createGroundBattle(theater, () => {})
    const o = cloudsOf(gb)!
    const steady = DUST_CLOUD_LIFE / DUST_CLOUD_EVERY
    for (let t = 0; t < 100; t += 0.1) {
      gb.update(NO_TARGETS, t, 0.1, flat)
      expect(live(o)).toBeGreaterThan(steady * 0.8)
      expect(live(o)).toBeLessThan(DUST_CLOUD_CAPACITY)
    }
    gb.dispose()
  })

  it('重開一場：清空，下一幀重新補暖', () => {
    const gb = createGroundBattle(theater, () => {})
    const o = cloudsOf(gb)!
    gb.update(NO_TARGETS, 0, 0, flat)
    gb.reset()
    expect(live(o)).toBe(0)
    gb.update(NO_TARGETS, 0, 0, flat)
    expect(live(o)).toBeGreaterThan((DUST_CLOUD_LIFE / DUST_CLOUD_EVERY) * 0.8)
    gb.dispose()
  })

  /** 比整個矩陣陣列而不是數量：池子滿了以後多生一顆只是蓋掉最舊的，數量看不出來 */
  it('暫停（幀長 0）時一格都不動：不生新的、已有的不飄', () => {
    const gb = createGroundBattle(theater, () => {})
    const o = cloudsOf(gb)!
    gb.update(NO_TARGETS, 0, 0, flat)
    const before = Float32Array.from(o.instanceMatrix.array)
    for (let i = 0; i < 100; i++) gb.update(NO_TARGETS, 0, 0, flat)
    expect(Float32Array.from(o.instanceMatrix.array)).toEqual(before)
    gb.dispose()
  })

  /** 顏色跟著高度霧的色調：三個通道的比例相同（逐顆的明暗與壓暗倍率是同一個純量） */
  it('塵團的顏色是高度霧的色調乘一個純量', () => {
    setBattleFog({ x: 0, z: 0, radius: 1000, tint: new Color(0.6, 0.45, 0.3) })
    const gb = createGroundBattle(theater, () => {})
    const o = cloudsOf(gb)!
    gb.update(NO_TARGETS, 0, 0, flat)
    const c = o.instanceColor!.array
    let checked = 0
    let brightest = 0
    for (let i = 0; i < o.count; i++) {
      if (o.instanceMatrix.array[i * 16]! === 0) continue
      const [r, g, b] = [c[i * 3]!, c[i * 3 + 1]!, c[i * 3 + 2]!]
      expect(r / g).toBeCloseTo(0.6 / 0.45, 4)
      expect(b / g).toBeCloseTo(0.3 / 0.45, 4)
      brightest = Math.max(brightest, g)
      checked++
    }
    expect(checked).toBeGreaterThan(100)
    // 逐顆的明暗只往暗走：最亮的一顆不會超過基色乘壓暗倍率
    expect(brightest).toBeLessThanOrEqual(0.45 * DUST_CLOUD_SHADE + 1e-6)
    expect(brightest).toBeGreaterThan(0.45 * DUST_CLOUD_SHADE * 0.9)
    gb.dispose()
    clearBattleFog()
  })
})

describe('庫斯克的塵團出處', () => {
  const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard

  it('卡片帶的就是這份名單', () => {
    expect(card.battle.theater!.dusts).toBe(RZHEV_DUSTS)
  })

  it('十門反坦克砲各一處，加上沿村主街的五處', () => {
    expect(RZHEV_DUSTS).toHaveLength(AT_GUNS.length + 5)
    for (const g of AT_GUNS) expect(RZHEV_DUSTS.some((p) => p.x === g.x && p.z === g.z)).toBe(true)
    const street = RZHEV_DUSTS.slice(AT_GUNS.length).map((p) => toLocal(p.x, p.z))
    for (const l of street) {
      expect(Math.abs(l.lx)).toBeLessThan(1)
      expect(l.lz).toBeLessThan(-200)
    }
  })

  it('每一處連同散佈半徑都在高度霧的圈內', () => {
    for (const p of RZHEV_DUSTS) {
      expect(Math.hypot(p.x - BATTLE_HAZE.x, p.z - BATTLE_HAZE.z) + DUST_CLOUD_SPREAD).toBeLessThan(BATTLE_HAZE.radius)
    }
  })
})
