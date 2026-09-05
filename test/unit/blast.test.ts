import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { createImpacts, IMPACT_STRIDE } from '../../src/world/events'
import {
  LAND_BLAST, WATER_BLAST, dustColor, emitBlast, type BlastParams, type BlastPools,
} from '../../src/render/blast'

/** 記下每一次 emit 的假粒子池。只實作 `emitBlast` 用得到的那一支 */
interface Shot {
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  size: number
}
function fakePool(): { shots: Shot[] } & BlastPools['fireball'] {
  const shots: Shot[] = []
  return {
    shots,
    emit(x, y, z, vx, vy, vz, size = 1) { shots.push({ x, y, z, vx, vy, vz, size }) },
  } as never
}

function pools(): BlastPools & { shots: Record<string, Shot[]> } {
  const fireball = fakePool()
  const smoke = fakePool()
  const dust = fakePool()
  const spray = fakePool()
  const splashEvents = createImpacts()
  return {
    fireball, smoke, dust, spray, splashEvents,
    shots: {
      fireball: fireball.shots, smoke: smoke.shots,
      dust: dust.shots, spray: spray.shots,
    },
  } as never
}

const speedOf = (s: Shot): number => Math.hypot(s.vx, s.vy, s.vz)

describe('emitBlast：數量', () => {
  it('每一種粒子的顆數就是參數上的數字', () => {
    const p = pools()
    emitBlast(p, LAND_BLAST, 0, 0, 0, 0)
    expect(p.shots.fireball!.length).toBe(LAND_BLAST.fireCount)
    expect(p.shots.smoke!.length).toBe(LAND_BLAST.smokeCount)
    expect(p.shots.dust!.length).toBe(LAND_BLAST.dustCount)
    expect(p.shots.spray!.length).toBe(LAND_BLAST.sprayCount)
    expect(p.splashEvents.count).toBe(LAND_BLAST.jetCount)
  })

  it('顆數為 0 的那一種一顆都不發', () => {
    const p = pools()
    const none: BlastParams = { ...WATER_BLAST, fireCount: 0, sprayCount: 0 }
    emitBlast(p, none, 0, 0, 0, 0)
    expect(p.shots.fireball!.length).toBe(0)
    expect(p.shots.spray!.length).toBe(0)
    expect(p.shots.smoke!.length).toBeGreaterThan(0)
  })
})

describe('emitBlast：兩種爆炸的分野', () => {
  it('墜地不推水柱、不噴水霧 —— 內陸地圖每一顆都會發生', () => {
    expect(LAND_BLAST.jetCount).toBe(0)
    expect(LAND_BLAST.sprayCount).toBe(0)
    const p = pools()
    emitBlast(p, LAND_BLAST, 0, 0, 0, 0)
    expect(p.splashEvents.count).toBe(0)
    expect(p.shots.spray!.length).toBe(0)
  })

  it('落水不揚塵', () => {
    expect(WATER_BLAST.dustCount).toBe(0)
    const p = pools()
    emitBlast(p, WATER_BLAST, 0, 0, 0, 0)
    expect(p.shots.dust!.length).toBe(0)
  })

  it('落水的水柱散開成一圈，不疊在同一點上', () => {
    const p = pools()
    emitBlast(p, WATER_BLAST, 100, 0, -50, 0)
    const d = p.splashEvents.data
    for (let e = 0; e < p.splashEvents.count; e++) {
      const o = e * IMPACT_STRIDE
      const r = Math.hypot(d[o]! - 100, d[o + 2]! - -50)
      expect(r).toBeCloseTo(WATER_BLAST.jetSpread, 4)
    }
    // 第一根與第二根不同位置
    expect(d[0]).not.toBe(d[IMPACT_STRIDE])
  })
})

describe('emitBlast：方向與位置', () => {
  it('每一顆都從爆點出發', () => {
    const p = pools()
    emitBlast(p, LAND_BLAST, 12, 3, -7, 0)
    for (const list of Object.values(p.shots)) {
      for (const s of list) {
        expect(s.x).toBe(12)
        expect(s.y).toBe(3)
        expect(s.z).toBe(-7)
      }
    }
  })

  it('速率就是參數上的值 —— 方向只決定往哪裡去', () => {
    const p = pools()
    emitBlast(p, LAND_BLAST, 0, 0, 0, 0)
    for (const s of p.shots.fireball!) expect(speedOf(s)).toBeCloseTo(LAND_BLAST.fireSpeed, 4)
    for (const s of p.shots.dust!) expect(speedOf(s)).toBeCloseTo(LAND_BLAST.dustSpeed, 4)
  })

  it('全部往上半空間走 —— 地面爆炸沒有東西往地底下鑽', () => {
    const p = pools()
    emitBlast(p, LAND_BLAST, 0, 0, 0, 0)
    for (const list of Object.values(p.shots)) {
      for (const s of list) expect(s.vy).toBeGreaterThan(0)
    }
  })

  it('尺寸倍率就是參數上的值', () => {
    const p = pools()
    emitBlast(p, LAND_BLAST, 0, 0, 0, 0)
    for (const s of p.shots.fireball!) expect(s.size).toBe(LAND_BLAST.fireSize)
    for (const s of p.shots.smoke!) expect(s.size).toBe(LAND_BLAST.smokeSize)
  })
})

describe('emitBlast：可重播', () => {
  it('同一個 seed 逐位元相同 —— 展示區的 REPLAY 靠這條', () => {
    const a = pools()
    const b = pools()
    emitBlast(a, LAND_BLAST, 0, 0, 0, 77)
    emitBlast(b, LAND_BLAST, 0, 0, 0, 77)
    expect(b.shots.fireball).toEqual(a.shots.fireball)
    expect(b.shots.dust).toEqual(a.shots.dust)
  })

  it('換一個 seed 就換一組方向', () => {
    const a = pools()
    const b = pools()
    emitBlast(a, LAND_BLAST, 0, 0, 0, 1)
    emitBlast(b, LAND_BLAST, 0, 0, 0, 2)
    expect(b.shots.fireball).not.toEqual(a.shots.fireball)
  })
})

describe('dustColor', () => {
  const c = new Color()

  it('每一段都在 [0,1] 之內', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      dustColor(t, c)
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('土色是暖的 —— 紅 > 綠 > 藍', () => {
    for (const t of [0, 0.3, 0.7, 1]) {
      dustColor(t, c)
      expect(c.r).toBeGreaterThan(c.g)
      expect(c.g).toBeGreaterThan(c.b)
    }
  })

  it('隨年齡變暗 —— 揚起的土會落下與稀釋', () => {
    const young = new Color()
    const old = new Color()
    dustColor(0, young)
    dustColor(1, old)
    expect(old.r + old.g + old.b).toBeLessThan(young.r + young.g + young.b)
  })
})
