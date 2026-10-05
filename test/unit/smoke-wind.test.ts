import { afterEach, describe, expect, it } from 'vitest'
import { Color, Matrix4, NormalBlending, Quaternion, Vector3 } from 'three'
import { createParticles, type ParticleConfig, type Particles } from '../../src/render/particles'
import { SMOKE_WIND, WIND_MAX, WIND_MIN, windOf } from '../../src/render/wind'
import type { Anchors } from '../../src/render/anchors'
import { createShipFireSmoke, createSmoke, createSteam } from '../../src/render/smoke'
import { createBlastSmoke, createDust, createEmberSmoke } from '../../src/render/blast'
import { createFlakBursts } from '../../src/render/flakBursts'
import { createFireball } from '../../src/render/fireball'
import { createSpray } from '../../src/render/spray'

const CFG: ParticleConfig = {
  capacity: 4, blending: NormalBlending, life: 100, sizeFrom: 1, sizeTo: 1,
  gravity: 0, drag: 0, alphaFrom: 1, color: (_t: number, out: Color) => { out.setRGB(1, 1, 1) },
}

function at(p: Particles, i: number): Vector3 {
  const m = new Matrix4()
  p.object.getMatrixAt(i, m)
  return new Vector3().setFromMatrixPosition(m)
}

afterEach(() => { SMOKE_WIND.x = 0; SMOKE_WIND.z = 0 })

describe('windOf：一場的風', () => {
  it('水平、大小在範圍內、同一個種子每次一樣、不同種子方向不同', () => {
    const angles = new Set<number>()
    for (let seed = 0; seed < 200; seed++) {
      const w = windOf(seed, { x: 0, z: 0 })
      const s = Math.hypot(w.x, w.z)
      expect(s).toBeGreaterThanOrEqual(WIND_MIN - 1e-9)
      expect(s).toBeLessThanOrEqual(WIND_MAX + 1e-9)
      expect(windOf(seed, { x: 0, z: 0 })).toEqual(w)
      angles.add(Math.round(Math.atan2(w.z, w.x) * 4))
    }
    // 四個象限都有：方向沒有被種子卡在一邊
    expect(angles.size).toBeGreaterThan(20)
  })
})

describe('煙順風飄', () => {
  it('開風的池子：自由粒子一秒後多飄「風 × 1 s」；沒開風的不動', () => {
    SMOKE_WIND.x = 2
    SMOKE_WIND.z = -1
    const windy = createParticles({ ...CFG, wind: true })
    const still = createParticles(CFG)
    for (const p of [windy, still]) p.emit(10, 50, 20, 0, 1, 0)
    for (let k = 0; k < 60; k++) { windy.step(1 / 60); still.step(1 / 60) }
    const a = at(windy, 0)
    const b = at(still, 0)
    expect(a.x - b.x).toBeCloseTo(2, 4)
    expect(a.z - b.z).toBeCloseTo(-1, 4)
    expect(a.y).toBeCloseTo(b.y, 6)
  })

  it('吸附在錨點上的粒子不吹（座標是錨點的區域座標）', () => {
    SMOKE_WIND.x = 3
    const anchors: Anchors = {
      frame(_id, outPos, outQuat) { outPos.set(0, 0, 0); outQuat.copy(new Quaternion()); return true },
    }
    const windy = createParticles({ ...CFG, wind: true })
    windy.emit(1, 2, 3, 0, 0, 0, 1, 0)
    for (let k = 0; k < 60; k++) windy.step(1 / 60, anchors)
    expect(at(windy, 0).x).toBeCloseTo(1, 6)
  })

  /** 同一個池子各建兩個：一個在風裡走 1/6 秒、一個在無風裡走，比 x 的差 */
  function drift(make: () => Particles): number {
    const a = make()
    const b = make()
    a.emit(0, 100, 0, 0, 0, 0)
    b.emit(0, 100, 0, 0, 0, 0)
    for (let k = 0; k < 10; k++) {
      SMOKE_WIND.x = 3
      a.step(1 / 60)
      SMOKE_WIND.x = 0
      b.step(1 / 60)
    }
    return at(a, 0).x - at(b, 0).x
  }

  it('煙與塵的池子順風飄；火球、水花不飄', () => {
    const windy: [string, () => Particles][] = [
      ['飛機拖煙', () => createSmoke(4)],
      ['火災煙', () => createShipFireSmoke(4)],
      ['蒸汽', () => createSteam(4)],
      ['爆炸黑煙', () => createBlastSmoke(4)],
      ['餘燼小煙', () => createEmberSmoke(4)],
      ['揚塵', () => createDust(4)],
      ['高砲黑雲', () => createFlakBursts(4)],
    ]
    for (const [name, make] of windy) expect(drift(make), name).toBeCloseTo(3 / 6, 4)
    expect(drift(() => createFireball(4)), '火球').toBeCloseTo(0, 6)
    expect(drift(() => createSpray(0xffffff, 4)), '水花').toBeCloseTo(0, 6)
  })

  it('沒有風（選單、機庫）時開風的池子與不開的一樣', () => {
    const windy = createParticles({ ...CFG, wind: true })
    windy.emit(10, 50, 20, 0, 1, 0)
    for (let k = 0; k < 60; k++) windy.step(1 / 60)
    expect(at(windy, 0).x).toBeCloseTo(10, 6)
    expect(at(windy, 0).z).toBeCloseTo(20, 6)
  })
})
