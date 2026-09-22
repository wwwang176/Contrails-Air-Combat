import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { createImpacts, IMPACT_STRIDE } from '../../src/world/events'
import {
  EMBER_PER_CHUNK, FIRE_BLAST, FLAK_BLAST, LAND_BLAST, TORPEDO_BLAST, WATER_BLAST,
  blastScale, blastSmokeColor, dustColor,
  emitBlast, emitEmber, emitFlakBlasts, fireGlowColor, resetFlakBlastSeed, scaleBlast,
  type BlastParams, type BlastPools,
} from '../../src/render/blast'
import { createBursts, pushBurst } from '../../src/world/flak'

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

describe('魚雷命中的配方', () => {
  /**
   * 【釘死每一個值】寫成「比 `WATER_BLAST` 窄／高」的話，填錯數字仍然會綠。
   */
  it('就是這幾個數字', () => {
    expect(TORPEDO_BLAST.jetCount).toBe(9)
    expect(TORPEDO_BLAST.jetSpread).toBe(4.0)
    expect(TORPEDO_BLAST.jetHeight).toBe(46)
    expect(TORPEDO_BLAST.jetRadius).toBe(3.6)
    expect(TORPEDO_BLAST.mistPerJet).toBe(6)
    expect(TORPEDO_BLAST.mistSize).toBe(4.2)
    expect(TORPEDO_BLAST.sprayCount).toBe(10)
    expect(TORPEDO_BLAST.fireCount).toBe(7)
    expect(TORPEDO_BLAST.fireSize).toBe(1.7)
    expect(TORPEDO_BLAST.smokeCount).toBe(15)
    expect(TORPEDO_BLAST.smokeSize).toBe(2.4)
    expect(TORPEDO_BLAST.glowSize).toBe(1.4)
  })

  /**
   * 【落水沒有火、命中有】前者是自己在水裡炸，後者炸的是船 —— 燃料、彈藥
   * 與艦體本身都在燒。只檢查 `fireCount` 的話 `fireSize` 填了值不會被抓到，
   * 所以四組欄位逐格驗。
   */
  it('落水那一份的火、煙、塵、光暈每一格都是 0', () => {
    for (const k of [
      'fireCount', 'fireSpeed', 'fireSize', 'fireCone',
      'smokeCount', 'smokeSpeed', 'smokeSize', 'smokeCone',
      'dustCount', 'dustSpeed', 'dustSize', 'dustCone',
      'glowSize', 'glowAlpha',
    ] as const) {
      expect(WATER_BLAST[k], k).toBe(0)
    }
  })

  it('命中那一份有火有煙，但不揚塵 —— 海上沒有土', () => {
    for (const k of ['fireCount', 'fireSpeed', 'fireSize', 'fireCone',
      'smokeCount', 'smokeSpeed', 'smokeSize', 'smokeCone',
      'glowSize', 'glowAlpha'] as const) {
      expect(TORPEDO_BLAST[k], k).toBeGreaterThan(0)
    }
    for (const k of ['dustCount', 'dustSpeed', 'dustSize', 'dustCone'] as const) {
      expect(TORPEDO_BLAST[k], k).toBe(0)
    }
  })

  /**
   * 【火不能蓋過水柱】讀起來要是「一道水牆，根部有一團火」。火球團徑約
   * `fireSize × fireSpeed` 的量級，水柱是 `jetHeight`。
   */
  it('火比水柱矮得多', () => {
    expect(TORPEDO_BLAST.fireSize * 8).toBeLessThan(TORPEDO_BLAST.jetHeight)
    expect(TORPEDO_BLAST.fireCount).toBeLessThan(LAND_BLAST.fireCount)
    expect(TORPEDO_BLAST.smokeCount).toBeLessThan(LAND_BLAST.smokeCount)
  })

  it('比落水的水冠更窄、更高', () => {
    expect(TORPEDO_BLAST.jetSpread).toBeLessThan(WATER_BLAST.jetSpread)
    expect(TORPEDO_BLAST.jetHeight).toBeGreaterThan(WATER_BLAST.jetHeight)
    expect(TORPEDO_BLAST.jetCount).toBeLessThan(WATER_BLAST.jetCount)
  })

  it('走的是同一支縮放', () => {
    const out = { ...TORPEDO_BLAST }
    scaleBlast(TORPEDO_BLAST, 8, out)
    expect(out.jetHeight).toBeCloseTo(TORPEDO_BLAST.jetHeight * 2, 9)
    expect(out.jetCount).toBeGreaterThan(TORPEDO_BLAST.jetCount)
  })
})

describe('高砲爆點的小爆炸（FLAK_BLAST／emitFlakBlasts）', () => {
  it('只有火球與光暈 —— 煙由 flakBursts 那個池出，這裡不重複', () => {
    expect(FLAK_BLAST.fireCount).toBeGreaterThan(0)
    expect(FLAK_BLAST.glowSize).toBeGreaterThan(0)
    expect(FLAK_BLAST.smokeCount).toBe(0)
    expect(FLAK_BLAST.dustCount).toBe(0)
    expect(FLAK_BLAST.sprayCount).toBe(0)
    expect(FLAK_BLAST.jetCount).toBe(0)
  })

  it('比船上火災的那一朵小 —— 一枚 5 吋砲彈，不是燃燒中的甲板', () => {
    expect(FLAK_BLAST.fireSize).toBeLessThan(FIRE_BLAST.fireSize)
    expect(FLAK_BLAST.fireCount).toBeLessThanOrEqual(FIRE_BLAST.fireCount)
  })

  it('每一個引爆事件在爆點噴 fireCount 顆', () => {
    resetFlakBlastSeed()
    const p = pools()
    const ev = createBursts()
    pushBurst(ev, 100, 1000, -50, 1)
    pushBurst(ev, -300, 1200, 800, 1)
    emitFlakBlasts(p, ev)
    expect(p.shots.fireball!.length).toBe(2 * FLAK_BLAST.fireCount)
    for (let k = 0; k < FLAK_BLAST.fireCount; k++) {
      const s = p.shots.fireball![k]!
      expect([s.x, s.y, s.z]).toEqual([100, 1000, -50])
    }
    const s = p.shots.fireball![FLAK_BLAST.fireCount]!
    expect([s.x, s.y, s.z]).toEqual([-300, 1200, 800])
    expect(p.shots.smoke!.length).toBe(0)
  })

  /** 與 flakBursts 同一條紀律：種子用單調計數器，不用幀內序號 */
  it('連續兩幀各一朵，方向不同；重設種子後逐位元重現', () => {
    resetFlakBlastSeed()
    const a = pools()
    const e1 = createBursts()
    pushBurst(e1, 0, 1000, 0, 1)
    emitFlakBlasts(a, e1)
    const b = pools()
    const e2 = createBursts()
    pushBurst(e2, 0, 1000, 0, 1)
    emitFlakBlasts(b, e2)
    expect(JSON.stringify(a.shots.fireball)).not.toBe(JSON.stringify(b.shots.fireball))

    resetFlakBlastSeed()
    const c = pools()
    emitFlakBlasts(c, e1)
    expect(JSON.stringify(c.shots.fireball)).toBe(JSON.stringify(a.shots.fireball))
  })
})

/**
 * 【放大只給火球、煙、塵】`BOMB_BLAST_SIZE` 乘在交給 `scaleBlast` 的尺度上。
 * 一起乘進動態光源、鏡頭震動或碎片散射的話，遠處的一顆炸彈會把整片天照亮、
 * 或是把鏡頭搖到準星離開目標 —— 那不是「爆炸大一點」。
 */
describe('投下的炸彈另外放大表現尺度', () => {
  const MAIN = import.meta.glob('../../src/main.ts', { query: '?raw', import: 'default', eager: true })
  const src = Object.values(MAIN)[0] as string
  const body = src.slice(src.indexOf('function emitBombBlasts'), src.indexOf('const emitFirePuff'))

  it('只有 scaleBlast 吃放大過的尺度', () => {
    expect(body).toContain('const vis = scale * BOMB_BLAST_SIZE')
    expect(body).toContain('scaleBlast(recipe, vis * vis * vis, SCALED_BLAST)')
  })

  /** 碎片不在這裡：它跟著火球半徑走，見 `blast-sparks.test.ts` 的接線護欄 */
  it('光與震動用原尺度', () => {
    expect(body).toContain('blastLights.flash(d[o]!, d[o + 1]!, d[o + 2]!, scale, ctx.camera.position)')
    expect(body).toContain('ordnanceShakeScale(scale)')
  })

  /** 【魚雷不吃】它另有自己的水冠配方，`vis` 不得漏到那一支 */
  it('魚雷那一支沒有被一起放大', () => {
    const torp = src.slice(src.indexOf('function emitTorpedoBlasts'), src.indexOf('function shakeFlakBursts'))
    expect(torp).not.toContain('BOMB_BLAST_SIZE')
    expect(torp).toContain('scaleBlast(TORPEDO_BLAST, scale * scale * scale, SCALED_BLAST)')
  })
})
