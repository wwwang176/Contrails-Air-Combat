import { describe, expect, it } from 'vitest'
import { Color, type InstancedMesh } from 'three'
import {
  createAmbientFog, AMBIENT_FOG_LIFE, AMBIENT_FOG_LIFE_JITTER, ambientFogSpot,
} from '../../src/render/ambientFog'
import { BATTLE_HAZE, RZHEV_DUSTS } from '../../src/world/rzhev'
import { MISSIONS, type MissionAmbientFog, type ReadyMissionCard } from '../../src/battle/missions'

/**
 * # 環境霧：出生位置、池子的容量、開場補暖、顏色
 *
 * 塵團是有人活動的地方持續冒出、慢慢長大、順風飄散的大而淡的粒子，補高度霧在側看時沒有「一團」的缺口。
 */

const PLACES = [{ x: 0, z: 0 }, { x: 1000, z: 0 }, { x: 0, z: 1000 }, { x: -800, z: -800 }]
const flat = (): number => 0
/** 每一個可選欄位都填的一份 */
const CONFIG: MissionAmbientFog = {
  places: PLACES, tint: 0xe8edf1, skyMix: 0.4, shade: 0.85, shadeJitter: 0.3,
  every: 0.15, spread: 70, sizeFrom: 30, sizeTo: 200, alpha: 0.35, liftMin: 8, liftMax: 40,
}
/** 可選欄位全部省略、走預設值的一份 */
const MINIMAL: MissionAmbientFog = {
  places: PLACES, tint: 0xbab7aa,
  every: 0.48, spread: 170, sizeFrom: 50, sizeTo: 360, alpha: 0.22, liftMin: 10, liftMax: 28,
}

/** 池子裡活著的格子：死格子的矩陣是零，活的第一個元素是直徑 */
function live(o: InstancedMesh): number {
  let n = 0
  for (let i = 0; i < o.count; i++) if (o.instanceMatrix.array[i * 16]! !== 0) n++
  return n
}

describe('環境霧的出生位置', () => {
  const out = { x: 0, z: 0, lift: 0 }

  it('同一個序號永遠同一點', () => {
    const a = { x: 0, z: 0, lift: 0 }
    ambientFogSpot(123, CONFIG, out)
    ambientFogSpot(123, CONFIG, a)
    expect(a).toEqual(out)
  })

  it('每一顆都落在某一處的散佈半徑內，離地高度在範圍內', () => {
    for (let k = 0; k < 2000; k++) {
      ambientFogSpot(k, CONFIG, out)
      const d = Math.min(...PLACES.map((p) => Math.hypot(out.x - p.x, out.z - p.z)))
      expect(d).toBeLessThanOrEqual(CONFIG.spread + 1e-6)
      expect(out.lift).toBeGreaterThanOrEqual(CONFIG.liftMin)
      expect(out.lift).toBeLessThanOrEqual(CONFIG.liftMax)
    }
  })

  /** 只有一處也不會挑到不存在的索引；每一處都有人挑到，而且不會全擠在少數幾處 */
  it('每一處都分得到，分得大致均勻', () => {
    const hits = PLACES.map(() => 0)
    for (let k = 0; k < 4000; k++) {
      ambientFogSpot(k, CONFIG, out)
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
    ambientFogSpot(7, { ...CONFIG, places: [PLACES[0]!] }, out)
    expect(Math.hypot(out.x, out.z)).toBeLessThanOrEqual(CONFIG.spread + 1e-6)
  })
})

describe('環境霧的專用池', () => {

  it.each([['可選欄位全填', CONFIG], ['可選欄位全省略', MINIMAL]] as const)('%s：補入的新霧由透明淡入', (_, config) => {
    const fog = createAmbientFog(config, new Color(0xaabbcc))
    const object = fog.object!
    expect(object.name).toBe('ambientFog')
    fog.update(0, flat)
    const before = Float32Array.from(object.instanceMatrix.array)
    fog.update(config.every + 0.001, flat)
    const alpha = object.geometry.getAttribute('aAlpha')
    let born = 0
    for (let i = 0; i < object.count; i++) {
      if (before[i * 16] !== 0 || object.instanceMatrix.array[i * 16] === 0) continue
      expect(alpha.getX(i)).toBeGreaterThanOrEqual(0)
      expect(alpha.getX(i)).toBeLessThan(config.alpha * 0.1)
      born++
    }
    expect(born).toBeGreaterThan(0)
    fog.dispose()
  })

  it('卡片沒有出處就沒有這個池；有出處就有', () => {
    const none = createAmbientFog({ ...CONFIG, places: [] }, new Color())
    expect(none.object).toBeNull()
    none.dispose()
    const gb = createAmbientFog(CONFIG, new Color())
    expect(gb.object).not.toBeNull()
    gb.dispose()
  })

  /** 容量要裝得下每一顆都抽到最長壽命的情況，否則環形緩衝會覆蓋還在飄的塵團 */
  it('容量大於最壞情況的同時存活數', () => {
    const fog = createAmbientFog(CONFIG, new Color())
    expect(fog.object!.count).toBeGreaterThanOrEqual((AMBIENT_FOG_LIFE * (1 + AMBIENT_FOG_LIFE_JITTER)) / CONFIG.every)
    fog.dispose()
  })

  /** 開場補暖：第一幀之後就是穩態的數量，不是從一片空白慢慢長出來 */
  it('第一幀之後池子已經是穩態的滿，而且沒有滿到溢出', () => {
    const gb = createAmbientFog(CONFIG, new Color())
    const o = gb.object!
    expect(live(o)).toBe(0)
    gb.update(0, flat)
    const steady = AMBIENT_FOG_LIFE / CONFIG.every
    expect(live(o)).toBeGreaterThan(steady * 0.8)
    expect(live(o)).toBeLessThan(steady * 1.2)
    expect(live(o)).toBeLessThan(o.count)
    gb.dispose()
  })

  it('之後的每一幀都維持穩態：跑一百秒，數量不掉也不爆', () => {
    const gb = createAmbientFog(CONFIG, new Color())
    const o = gb.object!
    const steady = AMBIENT_FOG_LIFE / CONFIG.every
    for (let t = 0; t < 100; t += 0.1) {
      gb.update(0.1, flat)
      expect(live(o)).toBeGreaterThan(steady * 0.8)
      expect(live(o)).toBeLessThan(o.count)
    }
    gb.dispose()
  })

  it('重開一場：清空，下一幀重新補暖', () => {
    const gb = createAmbientFog(CONFIG, new Color())
    const o = gb.object!
    gb.update(0, flat)
    gb.reset()
    expect(live(o)).toBe(0)
    gb.update(0, flat)
    expect(live(o)).toBeGreaterThan((AMBIENT_FOG_LIFE / CONFIG.every) * 0.8)
    gb.dispose()
  })

  /** 比整個矩陣陣列而不是數量：池子滿了以後多生一顆只是蓋掉最舊的，數量看不出來 */
  it('暫停（幀長 0）時一格都不動：不生新的、已有的不飄', () => {
    const gb = createAmbientFog(CONFIG, new Color())
    const o = gb.object!
    gb.update(0, flat)
    const before = Float32Array.from(o.instanceMatrix.array)
    for (let i = 0; i < 100; i++) gb.update(0, flat)
    expect(Float32Array.from(o.instanceMatrix.array)).toEqual(before)
    gb.dispose()
  })

  /** 顏色跟著高度霧的色調：三個通道的比例相同（逐顆的明暗與壓暗倍率是同一個純量） */
  it('塵團的顏色是高度霧的色調乘一個純量', () => {
    const gb = createAmbientFog({ ...CONFIG, skyMix: 1 }, new Color(0.6, 0.45, 0.3))
    const o = gb.object!
    gb.update(0, flat)
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
    expect(brightest).toBeLessThanOrEqual(0.45 * CONFIG.shade! + 1e-6)
    expect(brightest).toBeGreaterThan(0.45 * CONFIG.shade! * 0.9)
    gb.dispose()
  })
})

describe('勒熱夫的塵團出處', () => {
  const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard

  it('卡片帶的就是這份名單', () => {
    expect(card.battle.ambientFog!.places).toBe(RZHEV_DUSTS)
  })

  it('每一處連同散佈半徑都在高度霧的圈內', () => {
    const spread = card.battle.ambientFog!.spread
    for (const p of RZHEV_DUSTS) {
      expect(Math.hypot(p.x - BATTLE_HAZE.x, p.z - BATTLE_HAZE.z) + spread).toBeLessThan(BATTLE_HAZE.radius)
    }
  })
})
