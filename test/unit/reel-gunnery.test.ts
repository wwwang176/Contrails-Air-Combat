import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { createReelGunnery } from '../../src/app/reel/reelGunnery'
import { P51D } from '../../src/specs/p51d'
import { Projectiles } from '../../src/world/Projectiles'
import type { ImpactEvents } from '../../src/world/events'

function actor(z: number) {
  return {
    spec: P51D, model: {} as object | null,
    position: new Vector3(0, 1000, z), quaternion: new Quaternion(), velocity: new Vector3(),
    burstLeft: 1,
    cooldowns: new Float32Array(P51D.battery.mounts.length),
    muzzleFlash: new Float32Array(P51D.battery.mounts.length),
  }
}

function fixture(light = false) {
  const projectiles = new Projectiles(64)
  const batches: number[] = []
  const fx = { hits: (events: ImpactEvents) => { batches.push(events.count) } }
  const gunnery = createReelGunnery(projectiles, { light, fx })
  return { projectiles, batches, gunnery }
}

describe('短片槍械與曳光', () => {
  it('長影格每挺固定槍只發射一次，放開後槍焰仍會熄滅', () => {
    const { projectiles, gunnery } = fixture()
    const a = actor(0)
    gunnery.stepGuns(a, 0, 0.5)
    expect(projectiles.live).toBe(6)
    expect(Array.from(a.muzzleFlash).every(v => v > 0)).toBe(true)
    a.burstLeft = 0
    gunnery.stepGuns(a, 0, 0.5)
    expect(projectiles.live).toBe(6)
    expect(Array.from(a.muzzleFlash)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('命中立即回收彈丸並交付一次火花，統計在換段時明確重設', () => {
    const { projectiles, batches, gunnery } = fixture()
    const actors = [actor(200), actor(0)]
    projectiles.spawn(0, 1000, 20, 0, 0, -1000, 0, 0, 0, 1.2, 12.7)
    projectiles.step(0.04)
    gunnery.stepHits(actors)
    expect(projectiles.live).toBe(0)
    expect(batches).toEqual([1])
    expect(gunnery.hitCount).toBe(1)
    gunnery.stepHits(actors)
    expect(batches).toEqual([1])
    gunnery.clearStreams()
    expect(gunnery.hitCount).toBe(1)
    gunnery.resetHits()
    expect(gunnery.hitCount).toBe(0)
  })

  it.each([1, -2])('自己的彈與裝飾曳光不產生命中：owner %s', owner => {
    const { projectiles, batches, gunnery } = fixture()
    projectiles.spawn(0, 1000, 20, 0, 0, -1000, 0, owner, 0, 1.2, 12.7)
    projectiles.step(0.04)
    gunnery.stepHits([actor(200), actor(0)])
    expect(projectiles.live).toBe(1)
    expect(batches).toEqual([])
  })

  it.each([[false, 2], [true, 1]] as const)('輕量模式 %s 保留半速曳光，跳接與換段各自清理', (light, count) => {
    const { projectiles, gunnery } = fixture(light)
    const actors = [actor(200), actor(0)]
    gunnery.startStream({ kind: 'gunner', at: 0, actor: 0, target: 1, seconds: 10, miss: 10 })
    gunnery.stepStreams(actors, [], [], 0, 0)
    gunnery.stepStreams(actors, [], [], 0.1, 0.1)
    expect(projectiles.live).toBe(count)
    // 跳接只清彈丸，仍在有效時間內的曳光序列會繼續。
    projectiles.clear()
    gunnery.stepStreams(actors, [], [], 1, 0.2)
    expect(projectiles.live).toBeGreaterThan(0)
    // 換段清除序列，前一段的射手索引不會套到新的演員。
    gunnery.clearStreams()
    projectiles.clear()
    gunnery.stepStreams([actor(100), actor(300)], [], [], 0, 1)
    expect(projectiles.live).toBe(0)
  })
})
