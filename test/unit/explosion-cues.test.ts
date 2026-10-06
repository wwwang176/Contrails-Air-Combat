import { describe, expect, it } from 'vitest'
import { queueExplosionCues, type ExplosionEvents } from '../../src/audio/explosionCues'
import { createCueQueue, CUE, CUE_STRIDE, pushCue, type CueQueue } from '../../src/audio/queue'
import { BOMB_BLAST_DAMAGE } from '../../src/weapons/bomb'
import { createImpacts, pushImpact } from '../../src/world/events'
import { createKills, pushKill } from '../../src/world/kills'

function fixture() {
  return {
    killEvents: createKills(8), groundKillEvents: createImpacts(8),
    bombEvents: createImpacts(8), torpedoEvents: createImpacts(8),
    groundTargets: [{ unit: {} }, { unit: { personnel: true } }],
  } satisfies ExplosionEvents
}

function rows(q: CueQueue): number[][] {
  return Array.from({ length: q.count }, (_, i) => Array.from(q.data.slice(i * CUE_STRIDE, (i + 1) * CUE_STRIDE)))
}

describe('爆炸事件的音效轉換', () => {
  it('保留既有佇列，依擊落、地面擊毀、炸彈、魚雷順序追加，來源緩衝不變', () => {
    const world = fixture()
    const cues = createCueQueue(16)
    pushCue(cues, CUE.SelfVolley, 2, 0, 0)
    pushKill(world.killEvents, 1, 20, 3, 0, 0, 0, 0)
    pushImpact(world.groundKillEvents, 4, 5, 6, 0, 0, 0)
    pushImpact(world.bombEvents, 7, 8, 9, 0, BOMB_BLAST_DAMAGE * 2, 0)
    pushImpact(world.torpedoEvents, 10, -2, 12, 0, BOMB_BLAST_DAMAGE / 2, 0)
    const snapshot = structuredClone(world)
    queueExplosionCues(cues, world, { waterAt: () => 0 }, 25)
    expect(rows(cues)).toEqual([
      [CUE.SelfVolley, 2, 0, 0, 1],
      [CUE.Explosion, 1, 20, 3, 1], [CUE.Splash, 1, 0, 3, 1],
      [CUE.Blast, 4, 5, 6, 1], [CUE.Blast, 7, 8, 9, 2],
      [CUE.Blast, 10, 0, 12, 0.5], [CUE.Splash, 10, 0, 12, 0.5],
    ])
    expect(world).toEqual(snapshot)
  })

  it.each([
    [0, 25, true], [0, 25.01, false], [10, 35, true], [-Infinity, 0, false],
  ])('擊落在水面 %s、高度 %s 時是否加水花：%s', (water, y, splash) => {
    const world = fixture()
    const cues = createCueQueue(4)
    pushKill(world.killEvents, 1, y, 2, 0, 0, 0, 0)
    queueExplosionCues(cues, world, { waterAt: () => water }, 25)
    expect(rows(cues).map(r => r[0])).toEqual(splash ? [CUE.Explosion, CUE.Splash] : [CUE.Explosion])
    if (splash) expect(rows(cues)[1]).toEqual([CUE.Splash, 1, water, 2, 1])
  })

  it('人員死亡與已有炸彈落點聲的擊毀不重複產生爆炸', () => {
    const world = fixture()
    const cues = createCueQueue(8)
    pushImpact(world.groundKillEvents, 1, 2, 3, 1, 0, 0)
    pushImpact(world.groundKillEvents, 4, 5, 6, 0, 0, 1)
    pushImpact(world.groundKillEvents, 7, 8, 9, 0, 0, 0)
    queueExplosionCues(cues, world, { waterAt: () => -Infinity }, 25)
    expect(rows(cues)).toEqual([[CUE.Blast, 7, 8, 9, 1]])
  })

  it('水中炸彈產生水花與悶響，其他落點只產生爆炸，兩層共用同一當量', () => {
    const world = fixture()
    const cues = createCueQueue(16)
    for (const kind of [0, 0.5, 1, 1.5, 2]) {
      pushImpact(world.bombEvents, kind, 2, 3, kind, BOMB_BLAST_DAMAGE * 0.5, 0)
    }
    queueExplosionCues(cues, world, { waterAt: () => -Infinity }, 25)
    expect(rows(cues)).toEqual([
      [CUE.Blast, 0, 2, 3, 0.5], [CUE.Blast, 0.5, 2, 3, 0.5],
      [CUE.Splash, 1, 2, 3, 0.5], [CUE.SplashBoom, 1, 2, 3, 0.5],
      [CUE.Blast, 1.5, 2, 3, 0.5], [CUE.Blast, 2, 2, 3, 0.5],
    ])
  })

  it.each([-Infinity, Infinity, NaN])('魚雷找不到有限水面高度（%s）時使用事件高度', water => {
    const world = fixture()
    const cues = createCueQueue(4)
    pushImpact(world.torpedoEvents, 1, 7, 3, 0, BOMB_BLAST_DAMAGE, 0)
    queueExplosionCues(cues, world, { waterAt: () => water }, 25)
    expect(rows(cues)).toEqual([[CUE.Blast, 1, 7, 3, 1], [CUE.Splash, 1, 7, 3, 1]])
  })

  it('佇列滿時維持原有事件優先順序，不覆蓋前面的聲音、不擴容', () => {
    const world = fixture()
    const cues = createCueQueue(2)
    const buffer = cues.data
    pushCue(cues, CUE.SelfVolley, 0, 0, 0)
    pushKill(world.killEvents, 1, 0, 2, 0, 0, 0, 0)
    pushImpact(world.bombEvents, 3, 4, 5, 0, BOMB_BLAST_DAMAGE, 0)
    queueExplosionCues(cues, world, { waterAt: () => 0 }, 25)
    expect(rows(cues)).toEqual([[CUE.SelfVolley, 0, 0, 0, 1], [CUE.Explosion, 1, 0, 2, 1]])
    expect(cues.data).toBe(buffer)
    expect(world.killEvents.count).toBe(1)
    expect(world.bombEvents.count).toBe(1)
  })
})
