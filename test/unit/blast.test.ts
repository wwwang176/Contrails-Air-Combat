import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { createImpacts, IMPACT_STRIDE } from '../../src/world/events'
import {
  EMBER_PER_CHUNK, LAND_BLAST, WATER_BLAST, blastScale, blastSmokeColor, dustColor,
  emitBlast, emitEmber, fireGlowColor, scaleBlast,
  type BlastParams, type BlastPools,
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
    emit(
      x: number, y: number, z: number,
      vx: number, vy: number, vz: number, size = 1,
    ): void { shots.push({ x, y, z, vx, vy, vz, size }) },
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
    const none: BlastParams = { ...LAND_BLAST, fireCount: 0, dustCount: 0 }
    emitBlast(p, none, 0, 0, 0, 0)
    expect(p.shots.fireball!.length).toBe(0)
    expect(p.shots.dust!.length).toBe(0)
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

  it('沒有 jets 池時水柱退回 splashEvents', () => {
    const p = pools()
    emitBlast(p, WATER_BLAST, 100, 0, -50, 0)
    expect(p.splashEvents.count).toBe(WATER_BLAST.jetCount)
  })

  it('水冠由內往外撒，第一根在正中心', () => {
    const p = pools()
    emitBlast(p, WATER_BLAST, 100, 0, -50, 0)
    const d = p.splashEvents.data
    const radiusOf = (e: number): number =>
      Math.hypot(d[e * IMPACT_STRIDE]! - 100, d[e * IMPACT_STRIDE + 2]! + 50)
    expect(radiusOf(0)).toBeCloseTo(0, 9)
    let prev = -1
    for (let e = 0; e < p.splashEvents.count; e++) {
      const r = radiusOf(e)
      expect(r).toBeGreaterThan(prev)
      expect(r).toBeLessThanOrEqual(WATER_BLAST.jetSpread + 1e-6)
      prev = r
    }
  })

  it('柱子密到會重疊 —— 中央柱的直徑大過相鄰兩根的間距', () => {
    const n = WATER_BLAST.jetCount
    // 相鄰兩根在半徑上的間距（最外圈最密）
    const gap = WATER_BLAST.jetSpread
      * (Math.sqrt((n - 1) / (n - 1)) - Math.sqrt((n - 2) / (n - 1)))
    expect(WATER_BLAST.jetRadius * 2).toBeGreaterThan(gap)
  })

  it('水花跟著每一根柱子走 —— 柱子密，水花也密', () => {
    const p = pools()
    emitBlast(p, WATER_BLAST, 0, 0, 0, 0)
    expect(p.shots.spray!.length).toBe(WATER_BLAST.sprayCount * WATER_BLAST.jetCount)
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

describe('emitBlast：光暈', () => {
  it('光暈與火球同數量、同方向 —— 貼在球塊上而不是散在旁邊', () => {
    const p = pools()
    const glow = fakePool()
    emitBlast({ ...p, glow }, LAND_BLAST, 0, 0, 0, 5)
    expect(glow.shots.length).toBe(LAND_BLAST.fireCount)
    for (let i = 0; i < glow.shots.length; i++) {
      const g = glow.shots[i]!
      const f = p.shots.fireball![i]!
      expect(g.vx).toBe(f.vx)
      expect(g.vy).toBe(f.vy)
      expect(g.vz).toBe(f.vz)
    }
  })

  it('光暈比火球大', () => {
    const p = pools()
    const glow = fakePool()
    emitBlast({ ...p, glow }, LAND_BLAST, 0, 0, 0, 5)
    expect(glow.shots[0]!.size).toBeGreaterThan(p.shots.fireball![0]!.size)
  })

  it('glowSize 為 0 就一顆都不發', () => {
    const p = pools()
    const glow = fakePool()
    emitBlast({ ...p, glow }, { ...LAND_BLAST, glowSize: 0 }, 0, 0, 0, 5)
    expect(glow.shots.length).toBe(0)
  })

  it('沒有 glow 池時不會爆 —— 遊戲可以先不接它', () => {
    const p = pools()
    expect(() => emitBlast(p, LAND_BLAST, 0, 0, 0, 5)).not.toThrow()
  })
})

describe('emitEmber：火交棒給煙', () => {
  it('一塊火球換 EMBER_PER_CHUNK 顆', () => {
    const pool = fakePool()
    emitEmber(pool, 3, 0, 0, 0, 1, 2, 3, 10)
    expect(pool.shots.length).toBe(EMBER_PER_CHUNK)
  })

  it('散開 —— 三顆不在同一點上', () => {
    const pool = fakePool()
    emitEmber(pool, 3, 100, 50, -20, 0, 0, 0, 10)
    const seen = new Set(pool.shots.map((s) => `${s.x},${s.y},${s.z}`))
    expect(seen.size).toBe(EMBER_PER_CHUNK)
    // 【散開的半徑跟著火球的直徑走】否則大爆炸的煙會擠成一顆
    for (const s of pool.shots) {
      expect(Math.hypot(s.x - 100, (s.y - 50) / 0.6, s.z + 20)).toBeCloseTo(3.2, 4)
    }
  })

  it('每一顆都比原本那一塊小 —— 三顆加起來才蓋得住', () => {
    const pool = fakePool()
    emitEmber(pool, 3, 0, 0, 0, 0, 0, 0, 10)
    for (const s of pool.shots) expect(s.size).toBeLessThan(10)
  })

  it('繼承火球的速度', () => {
    const pool = fakePool()
    emitEmber(pool, 3, 0, 0, 0, 7, -2, 4, 10)
    for (const s of pool.shots) {
      expect(s.vx).toBe(7)
      expect(s.vy).toBe(-2)
      expect(s.vz).toBe(4)
    }
  })

  it('同一格恆得同一組位置 —— 重播靠這條', () => {
    const a = fakePool()
    const b = fakePool()
    emitEmber(a, 9, 0, 0, 0, 0, 0, 0, 10)
    emitEmber(b, 9, 0, 0, 0, 0, 0, 0, 10)
    expect(b.shots).toEqual(a.shots)
  })
})

describe('blastScale：立方根律', () => {
  it('基準是 1', () => {
    expect(blastScale(1)).toBe(1)
  })

  it('八倍的裝藥只有兩倍大', () => {
    expect(blastScale(8)).toBeCloseTo(2, 9)
    expect(blastScale(0.125)).toBeCloseTo(0.5, 9)
  })

  it('負當量不產生 NaN', () => {
    expect(Number.isFinite(blastScale(-1))).toBe(true)
    expect(blastScale(0)).toBe(0)
  })
})

describe('scaleBlast', () => {
  const out = (): { -readonly [K in keyof BlastParams]: number } => ({ ...LAND_BLAST })

  it('1× 是恆等', () => {
    const o = out()
    scaleBlast(LAND_BLAST, 1, o)
    expect(o).toEqual({ ...LAND_BLAST })
  })

  it('尺寸與顆數都乘上尺度，初速與錐角不動', () => {
    const o = out()
    scaleBlast(LAND_BLAST, 8, o)
    expect(o.fireSize).toBeCloseTo(LAND_BLAST.fireSize * 2, 9)
    expect(o.fireCount).toBe(Math.round(LAND_BLAST.fireCount * 2))
    expect(o.fireSpeed).toBe(LAND_BLAST.fireSpeed)
    expect(o.fireCone).toBe(LAND_BLAST.fireCone)
  })

  it('顆數為 0 的保持 0 —— 墜地不該被當量放出水柱', () => {
    const o = out()
    scaleBlast(LAND_BLAST, 8, o)
    expect(o.jetCount).toBe(0)
    expect(o.sprayCount).toBe(0)
    expect(o.dustCount).toBeGreaterThan(0)
  })

  it('顆數不會被縮到 0 —— 小當量仍然看得見', () => {
    const o = out()
    scaleBlast(LAND_BLAST, 0.001, o)
    expect(o.fireCount).toBeGreaterThanOrEqual(1)
    expect(o.smokeCount).toBeGreaterThanOrEqual(1)
  })

  it('光暈是比例，不吃當量 —— 火球的直徑已經乘過了', () => {
    const o = out()
    scaleBlast(LAND_BLAST, 8, o)
    expect(o.glowSize).toBe(LAND_BLAST.glowSize)
    expect(o.glowAlpha).toBe(LAND_BLAST.glowAlpha)
  })
})

describe('blastSmokeColor：黑接手，慢慢轉深灰', () => {
  const c = new Color()

  it('出生近黑 —— 接的是燒完的火球那一刻', () => {
    blastSmokeColor(0, c)
    expect(c.r + c.g + c.b).toBeLessThan(0.12)
  })

  it('之後單調變亮到深灰，然後停住', () => {
    let prev = 0
    for (let t = 0; t <= 1.0001; t += 0.05) {
      blastSmokeColor(t, c)
      const l = c.r + c.g + c.b
      expect(l).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = l
    }
    blastSmokeColor(1, c)
    expect(c.r).toBeLessThan(0.3)
  })
})

describe('fireGlowColor', () => {
  const c = new Color()

  it('全程在 [0,1] 之內', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      fireGlowColor(t, c)
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('收到黑 —— 加法混合下那就是消失', () => {
    fireGlowColor(1, c)
    expect(c.r + c.g + c.b).toBeCloseTo(0, 6)
  })

  it('是暖色 —— 紅 > 綠 > 藍', () => {
    for (const t of [0, 0.2, 0.4]) {
      fireGlowColor(t, c)
      expect(c.r).toBeGreaterThan(c.g)
      expect(c.g).toBeGreaterThan(c.b)
    }
  })
})
