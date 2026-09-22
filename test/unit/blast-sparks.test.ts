import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'
import {
  createBlastSparks, sparkOffset, SPARKS_PER_CONE, SPARK_CONES_MIN, SPARK_CONES_EXTRA,
  SPARK_BURST_DRAG, SPARK_BURST_CULL, SPARK_FIRE_REACH, SPARK_BEAM_CONE, SPARK_BEAM_ASPECT_MIN,
  SPARK_BEAM_ASPECT_MAX, SPARK_SPEED_MIN_RATIO, SPARK_GRAVITY,
} from '../../src/render/blastSparks'
import { LAND_BLAST, TORPEDO_BLAST, blastFireRadius, scaleBlast } from '../../src/render/blast'

const out = new Vector3()

describe('火星的運動', () => {
  it('出生那一刻在起點', () => {
    sparkOffset(40, 10, -20, 0, SPARK_BURST_DRAG, out)
    expect(out.length()).toBeCloseTo(0, 9)
  })

  /** 【快速噴射】水平方向衝出去的距離趨近 初速 ÷ 阻力 */
  it('水平方向最多衝出 初速 ÷ 阻力', () => {
    sparkOffset(50, 0, 0, 30, SPARK_BURST_DRAG, out)
    expect(out.x).toBeCloseTo(50 / SPARK_BURST_DRAG, 4)
  })

  /** 【較慢墜落】煞住之後以 重力 ÷ 阻力 的速度往下飄，不再加速；比噴出去慢得多 */
  it('之後以終端速度往下', () => {
    const a = sparkOffset(0, 30, 0, 10, SPARK_BURST_DRAG, new Vector3()).y
    const b = sparkOffset(0, 30, 0, 11, SPARK_BURST_DRAG, new Vector3()).y
    expect(a - b).toBeCloseTo(SPARK_GRAVITY / SPARK_BURST_DRAG, 3)
    expect(a - b).toBeLessThan(SPARK_FIRE_REACH * blastFireRadius(LAND_BLAST) * SPARK_BURST_DRAG / 10)
  })
})

describe('一次爆炸噴出去的火星', () => {
  function live(s: ReturnType<typeof createBlastSparks>, now: number): number {
    const b = s.object.geometry.getAttribute('aBirth').array as Float32Array
    let n = 0
    for (let i = 0; i < b.length; i += 4) if (b[i]! === now) n++
    return n
  }

  it('每束 SPARKS_PER_CONE 顆、SPARK_CONES_MIN 到 +SPARK_CONES_EXTRA 束', () => {
    const s = createBlastSparks(4096)
    for (let seed = 0; seed < 40; seed++) {
      s.reset()
      s.burst(0, 0, 0, -1, 1, true, seed, 5, 0, 0, 0)
      const n = live(s, 5)
      expect(n % SPARKS_PER_CONE).toBe(0)
      expect(n / SPARKS_PER_CONE).toBeGreaterThanOrEqual(SPARK_CONES_MIN)
      expect(n / SPARKS_PER_CONE).toBeLessThanOrEqual(SPARK_CONES_MIN + SPARK_CONES_EXTRA)
    }
  })

  /** 【落地的只往上】往地下噴的那一半一出生就被地面吃掉 */
  it('落地的爆炸只往上噴，空中的有往下的', () => {
    const s = createBlastSparks(4096)
    const v = s.object.geometry.getAttribute('aVel').array as Float32Array
    s.burst(0, 0, 0, -1, 1, true, 7, 5, 0, 0, 0)
    let down = 0
    for (let i = 0; i < v.length; i += 3) if (v[i + 1]! < 0) down++
    expect(down).toBe(0)
    let air = 0
    for (let seed = 0; seed < 10; seed++) {
      s.reset()
      s.burst(0, 0, 0, -1e4, 1, false, seed, 5, 0, 0, 0)
      for (let i = 0; i < v.length; i += 3) if (v[i + 1]! < 0) air++
    }
    expect(air).toBeGreaterThan(0)
  })

  /** 【跟著火球走】最快那一顆衝到火球半徑的 `SPARK_FIRE_REACH` 倍 */
  it('最快的一顆衝到火球半徑的 SPARK_FIRE_REACH 倍', () => {
    const s = createBlastSparks(4096)
    const v = s.object.geometry.getAttribute('aVel').array as Float32Array
    const reach = (): number => {
      let m = 0
      for (let i = 0; i < v.length; i += 3) m = Math.max(m, Math.hypot(v[i]!, v[i + 1]!, v[i + 2]!))
      return m / SPARK_BURST_DRAG
    }
    for (const r of [5, 20]) {
      s.reset()
      s.burst(0, 0, 0, -1, r, true, 3, 5, 0, 0, 0)
      expect(reach()).toBeLessThanOrEqual(SPARK_FIRE_REACH * r + 1e-3)
      expect(reach()).toBeGreaterThan(SPARK_FIRE_REACH * r * 0.9)
    }
  })

  it('太遠的爆炸不噴', () => {
    const s = createBlastSparks(4096)
    s.burst(SPARK_BURST_CULL + 1, 0, 0, -1, 1, true, 1, 5, 0, 0, 0)
    expect(live(s, 5)).toBe(0)
  })

  /** 【滿了從最舊的蓋】不能丟掉新的 —— 玩家眼前那一顆才是剛炸的 */
  it('池滿時蓋掉最舊的', () => {
    const s = createBlastSparks(1000)
    s.burst(0, 0, 0, -1, 1, true, 1, 1, 0, 0, 0)
    s.burst(0, 0, 0, -1, 1, true, 2, 2, 0, 0, 0)
    s.burst(0, 0, 0, -1, 1, true, 3, 3, 0, 0, 0)
    expect(live(s, 3)).toBeGreaterThanOrEqual(SPARK_CONES_MIN * SPARKS_PER_CONE)
  })

  it('reset 之後全部熄掉', () => {
    const s = createBlastSparks(4096)
    s.burst(0, 0, 0, -1, 1, true, 1, 5, 0, 0, 0)
    s.reset()
    expect(live(s, 5)).toBe(0)
  })
})

/**
 * 接線護欄 —— 讀 `main.ts` 的原始碼。只有炸彈與魚雷的爆炸噴火星；
 * 擊墜、地面目標擊毀、落水的炸彈不噴。接錯不會報錯，只是多噴或少噴。
 */
describe('火星的接線', () => {
  const SRC = new TextDecoder().decode(readFileSync('src/main.ts')).replace(/\r\n/g, '\n').split('\n')

  function body(head: string): string {
    const at = SRC.findIndex((l) => l.includes(head))
    expect(at, head).toBeGreaterThanOrEqual(0)
    let end = at + 1
    while (end < SRC.length && SRC[end] !== '}') end++
    return SRC.slice(at, end + 1).join('\n')
  }

  it('只在炸彈與魚雷的爆炸呼叫', () => {
    const calls = SRC.filter((l) => l.includes('burstSparks(') && !l.includes('function burstSparks'))
    expect(calls).toHaveLength(2)
    expect(body('function emitBombBlasts')).toContain('burstSparks(')
    expect(body('function emitTorpedoBlasts')).toContain('burstSparks(')
  })

  it('落水的炸彈不噴', () => {
    const line = body('function emitBombBlasts').split('\n').find((l) => l.includes('burstSparks('))!
    expect(line).toMatch(/if \(kind < 0\.5 \|\| kind > 1\.5\)/)
  })

  /**
   * 【先縮放配方再噴】`burstSparks` 讀的是 `SCALED_BLAST` 的火球半徑；
   * 順序反了的話，噴多遠跟著的是上一團爆炸的大小，不會報錯
   */
  it('兩處都在 scaleBlast 之後才噴', () => {
    for (const head of ['function emitBombBlasts', 'function emitTorpedoBlasts']) {
      const b = body(head)
      expect(b.indexOf('scaleBlast('), head).toBeGreaterThanOrEqual(0)
      expect(b.indexOf('burstSparks('), head).toBeGreaterThan(b.indexOf('scaleBlast('))
    }
    expect(body('function burstSparks')).toContain('blastFireRadius(SCALED_BLAST)')
  })

  /** 【碎片也跟著火球走】直接乘當量尺度的話，60 kg 彈的碎片只有 4 m/s，原地落下 */
  it('炸彈與魚雷的碎片散射跟著火球半徑，並在 scaleBlast 之後', () => {
    for (const head of ['function emitBombBlasts', 'function emitTorpedoBlasts']) {
      const b = body(head)
      const line = b.split('\n').find((l) => l.includes('debris.burst('))!
      expect(line, head).toContain('blastDebrisSpeed()')
      expect(b.indexOf('debris.burst('), head).toBeGreaterThan(b.indexOf('scaleBlast('))
    }
    expect(body('function blastDebrisSpeed')).toContain('blastFireRadius(SCALED_BLAST)')
  })
})

describe('每一束的形狀', () => {
  /** 第 `c` 束（每束 `SPARKS_PER_CONE` 顆、依序寫進池子）的截面：長短軸標準差與長軸方向 */
  function section(v: Float32Array, c: number): { major: number; minor: number; axis: Vector3; mean: Vector3 } {
    const dirs: Vector3[] = []
    const m = new Vector3()
    for (let k = 0; k < SPARKS_PER_CONE; k++) {
      const i = (c * SPARKS_PER_CONE + k) * 3
      const d = new Vector3(v[i]!, v[i + 1]!, v[i + 2]!).normalize()
      dirs.push(d)
      m.add(d)
    }
    m.normalize()
    const u = new Vector3(1, 0, 0).cross(m).normalize()
    const w = m.clone().cross(u)
    let suu = 0, sww = 0, suw = 0
    for (const d of dirs) {
      const a = d.dot(u), b = d.dot(w)
      suu += a * a; sww += b * b; suw += a * b
    }
    suu /= SPARKS_PER_CONE; sww /= SPARKS_PER_CONE; suw /= SPARKS_PER_CONE
    const tr = (suu + sww) / 2
    const det = Math.sqrt(((suu - sww) / 2) ** 2 + suw * suw)
    const theta = 0.5 * Math.atan2(2 * suw, suu - sww)
    const axis = u.clone().multiplyScalar(Math.cos(theta)).addScaledVector(w, Math.sin(theta))
    return { major: Math.sqrt(tr + det), minor: Math.sqrt(tr - det), axis, mean: m }
  }

  it('截面是橢圓，而且不超出長軸的半角', () => {
    const s = createBlastSparks(4096)
    const v = s.object.geometry.getAttribute('aVel').array as Float32Array
    for (let seed = 0; seed < 20; seed++) {
      s.reset()
      s.burst(0, 0, 0, -1, 1, true, seed, 5, 0, 0, 0)
      for (let c = 0; c < SPARK_CONES_MIN; c++) {
        const { major, minor } = section(v, c)
        expect(minor / major).toBeGreaterThan(SPARK_BEAM_ASPECT_MIN * 0.6)
        expect(minor / major).toBeLessThan(SPARK_BEAM_ASPECT_MAX * 1.35)
        expect(Math.asin(major)).toBeLessThan(SPARK_BEAM_CONE)
      }
    }
  })

  /** 【長軸隨機轉】固定朝某一邊的話，每一團爆炸的火星都扁向同一個方向 */
  it('長軸方向每一束不同', () => {
    const s = createBlastSparks(4096)
    const v = s.object.geometry.getAttribute('aVel').array as Float32Array
    // 長軸與「束中心線的固定切線」（與中心線最不平行的座標軸 × 中心線）的夾角餘弦
    const align: number[] = []
    for (let seed = 0; seed < 20; seed++) {
      s.reset()
      s.burst(0, 0, 0, -1, 1, true, seed, 5, 0, 0, 0)
      for (let c = 0; c < SPARK_CONES_MIN; c++) {
        const { axis, mean } = section(v, c)
        const ax = Math.abs(mean.x), ay = Math.abs(mean.y), az = Math.abs(mean.z)
        // 兩個分量差不多時，樣本平均出來的中心線會選到另一個座標軸，跳過
        const sorted = [ax, ay, az].sort((a, b) => a - b)
        if (sorted[1]! - sorted[0]! < 0.1) continue
        const t = ax <= ay && ax <= az ? new Vector3(1, 0, 0) : ay <= az ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)
        t.cross(mean).normalize()
        align.push(Math.abs(axis.dot(t)))
      }
    }
    expect(Math.min(...align)).toBeLessThan(0.3)
    expect(Math.max(...align)).toBeGreaterThan(0.9)
  })

  /** 【每顆初速不同】同一束裡快慢差很多，一束才拉成一條線而不是一團 */
  it('同一束裡的初速分散在最快的 SPARK_SPEED_MIN_RATIO 到 1 倍', () => {
    const s = createBlastSparks(4096)
    const v = s.object.geometry.getAttribute('aVel').array as Float32Array
    s.burst(0, 0, 0, -1, 1, true, 3, 5, 0, 0, 0)
    const sp: number[] = []
    for (let k = 0; k < SPARKS_PER_CONE * SPARK_CONES_MIN; k++) {
      sp.push(Math.hypot(v[k * 3]!, v[k * 3 + 1]!, v[k * 3 + 2]!) / (SPARK_FIRE_REACH * SPARK_BURST_DRAG))
    }
    expect(Math.min(...sp)).toBeGreaterThanOrEqual(SPARK_SPEED_MIN_RATIO - 1e-6)
    expect(Math.min(...sp)).toBeLessThan(SPARK_SPEED_MIN_RATIO + 0.05)
    expect(Math.max(...sp)).toBeGreaterThan(0.9)
    // 【偏慢】均勻分布時中位數在區間正中；這裡要明顯偏向慢的那一頭
    sp.sort((a, b) => a - b)
    const median = sp[sp.length >> 1]!
    expect(median).toBeLessThan(SPARK_SPEED_MIN_RATIO + (1 - SPARK_SPEED_MIN_RATIO) * 0.4)
  })
})

describe('火球半徑', () => {
  const scaled = (src: typeof LAND_BLAST, s: number): number => {
    const o = { ...src }
    scaleBlast(src, s * s * s, o)
    return blastFireRadius(o)
  }

  it('越大的彈火球越大', () => {
    expect(scaled(LAND_BLAST, 2)).toBeGreaterThan(scaled(LAND_BLAST, 0.22))
    expect(scaled(TORPEDO_BLAST, 1.67)).toBeGreaterThan(scaled(TORPEDO_BLAST, 1))
  })

  /**
   * 【衝出去的距離不隨當量變】火塊的初速與壽命都是固定的，只有塊的直徑跟著
   * 尺度走 —— 小彈的火球仍有十幾公尺，所以火星不會縮成一小撮
   */
  it('尺度差九倍，火球半徑差不到兩倍', () => {
    const small = scaled(LAND_BLAST, 0.22)
    const big = scaled(LAND_BLAST, 2)
    expect(small).toBeGreaterThan(10)
    expect(big / small).toBeLessThan(2)
  })
})
