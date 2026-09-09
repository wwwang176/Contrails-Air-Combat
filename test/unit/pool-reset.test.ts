import { describe, it, expect, beforeAll } from 'vitest'
import { createFireball } from '../../src/render/fireball'
import { createSmoke } from '../../src/render/smoke'
import { createSpray, WATER_COLOR } from '../../src/render/spray'
import { createSparks } from '../../src/render/sparks'
import { createVortex } from '../../src/render/vortex'
import { createSplashes } from '../../src/render/splash'
import { createDebris } from '../../src/render/debris'
import { createWrecks } from '../../src/render/wrecks'
import { createImpacts, pushImpact } from '../../src/world/events'
import { createKills, pushKill } from '../../src/world/kills'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { loadGlbTemplatesForNode } from '../fixtures/glb'
import { P51D } from '../../src/specs/p51d'

/**
 * 「這裡處處都是水」。**既有的每一條都建立在那個前提上**
 * —— 落水才噴濺，而這些測試量的正是噴濺。
 */
const WET = (): number => 0

describe('粒子池的歸零（M10 spec §5.5）', () => {
  // 【為什麼一次測三個】火球、煙、噴濺都是 createParticles 包出來的，
  // 一個 reset() 同時解決三個。分開測才看得出來三個都真的拿到了。
  const pools = [
    ['火球', () => createFireball()],
    ['煙', () => createSmoke()],
    ['噴濺', () => createSpray(WATER_COLOR)],
  ] as const

  for (const [name, make] of pools) {
    it(`${name}：reset 之後存活數歸零`, () => {
      const p = make()
      for (let i = 0; i < 20; i++) p.emit(0, 100, 0, 1, 2, 3)
      expect(p.live).toBeGreaterThan(0)
      p.reset()
      expect(p.live).toBe(0)
      p.dispose()
    })

    it(`${name}：reset 之後再 step 也不會冒出東西`, () => {
      // 【為什麼要多這一條】只把 live 歸零、不清 age 的話，下一次 step
      // 會把那些還沒到壽命的粒子重新算成活的 —— 上一場的煙會出現在新的一場。
      const p = make()
      for (let i = 0; i < 20; i++) p.emit(0, 100, 0, 1, 2, 3)
      p.reset()
      p.step(1 / 60)
      expect(p.live).toBe(0)
      p.dispose()
    })

    it(`${name}：reset 之後還能正常再用`, () => {
      const p = make()
      for (let i = 0; i < 20; i++) p.emit(0, 100, 0, 1, 2, 3)
      p.reset()
      p.emit(0, 100, 0, 1, 2, 3)
      expect(p.live).toBe(1)
      p.dispose()
    })
  }
})

const FLAT = () => 0

describe('火花池的歸零', () => {
  it('reset 之後存活數歸零，而且 step 不會把它們算活', () => {
    const s = createSparks()
    const e = createImpacts()
    for (let i = 0; i < 5; i++) pushImpact(e, 0, 100, 0, 0, 1, 0)
    s.emit(e, 0, 100, 0)
    expect(s.live).toBeGreaterThan(0)
    s.reset()
    expect(s.live).toBe(0)
    s.step(1 / 60)
    expect(s.live).toBe(0)
    s.dispose()
  })
})

describe('水柱池的歸零', () => {
  it('reset 之後存活數歸零', () => {
    const s = createSplashes()
    const e = createImpacts()
    for (let i = 0; i < 5; i++) pushImpact(e, 0, 0, 0, 0, 1, 0)
    s.emit(e, FLAT, 0)
    expect(s.live).toBeGreaterThan(0)
    s.reset()
    expect(s.live).toBe(0)
    s.step(1 / 60)
    expect(s.live).toBe(0)
    s.dispose()
  })
})

describe('零件池的歸零', () => {
  it('reset 之後存活數歸零', () => {
    const d = createDebris()
    const k = createKills(4)
    pushKill(k, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(k, () => 0x888888)
    expect(d.live).toBeGreaterThan(0)
    d.reset()
    expect(d.live).toBe(0)
    d.step(1 / 60, FLAT, WET, 0)
    expect(d.live).toBe(0)
    d.dispose()
  })
})

describe('殘骸池的歸零', () => {
  // P-51D 走 GLB，node 這邊要先載樣板
  beforeAll(async () => { await loadGlbTemplatesForNode() })

  it('reset 把每一具模型都還給呼叫端', () => {
    // 【為什麼這條是整個 M10 最重要的一條】殘骸池**持有**上一場的模型，
    // 並在回收時透過回呼把它移出場景。不歸零就是每換一場洩漏一批，
    // 而症狀是「玩久了愈來愈慢」，離成因非常遠（M10 spec §5.5）。
    const released: unknown[] = []
    const w = createWrecks(4, (m) => { released.push(m); m.dispose() })
    for (let i = 0; i < 2; i++) {
      w.adopt(buildAircraft(P51D), P51D, 10, 0, -100, i)
    }
    expect(w.live).toBe(0) // live 由 step 更新，adopt 之後還沒算
    w.reset()
    expect(released).toHaveLength(2)
    w.step(1 / 60, FLAT, WET, 0)
    expect(w.live).toBe(0)
  })

  it('reset 之後還能正常再用', () => {
    const released: unknown[] = []
    const w = createWrecks(4, (m) => { released.push(m); m.dispose() })
    w.adopt(buildAircraft(P51D), P51D, 0, 0, 0, 0)
    w.reset()
    w.adopt(buildAircraft(P51D), P51D, 0, 0, 0, 0)
    w.step(1 / 60, FLAT, WET, 0)
    expect(w.live).toBe(1)
  })
})

/**
 * 【為什麼不塞進上面那個共用迴圈】那三條呼叫的是 `Particles` 的
 * `emit(x, y, z, vx, vy, vz)`，而 `Vortex.emit` 吃的是「座位、G、兩個翼尖」
 * —— 簽章不同，套不進去。
 *
 * 【為什麼凝結尾的 reset 比其他池多守一件事】它除了粒子還有「上一幀的翼尖
 * 位置」與「補點的餘數」。只清粒子的話，換場後第一幀會從上一場的位置拉一
 * 條線過來 —— 那條在 `vortex.test.ts` 裡守著，這裡守的是與其他六個池一致
 * 的三件基本事。
 */
describe('凝結尾池的歸零', () => {
  /** 讓池子裡有東西：兩幀，第二幀才會發射（見 vortex.test.ts）。 */
  const fill = (v: ReturnType<typeof createVortex>): void => {
    v.emit(0, 6, 0, 1000, 0, 0, 1000, 10)
    v.emit(0, 6, 20, 1000, 0, 20, 1000, 10)
  }

  it('reset 之後存活數歸零', () => {
    const v = createVortex()
    fill(v)
    expect(v.live).toBeGreaterThan(0)
    v.reset()
    expect(v.live).toBe(0)
    v.dispose()
  })

  it('reset 之後再 step 也不會冒出東西', () => {
    const v = createVortex()
    fill(v)
    v.reset()
    v.step(1 / 60)
    expect(v.live).toBe(0)
    v.dispose()
  })

  it('reset 之後還能正常再用', () => {
    const v = createVortex()
    fill(v)
    v.reset()
    fill(v)
    expect(v.live).toBeGreaterThan(0)
    v.dispose()
  })
})
