import { afterEach, describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createBattleAudioCues } from '../../src/audio/battleAudioCues'
import { hitFeedback, hitRate } from '../../src/audio/curves'
import { P51D } from '../../src/specs/p51d'
import { JU87 } from '../../src/specs/ju87'
import { B17G } from '../../src/specs/b17g'
import { World } from '../../src/world/World'
import { clearDamage, pushDamage } from '../../src/world/damage'
import { pushImpact } from '../../src/world/events'
import { pushBurst } from '../../src/world/flak'

const land = { waterAt: () => -Infinity }
function setup(spec = P51D) {
  const world = new World()
  const player = world.add(new Aircraft(spec), { update() {} }, 'blue', new Vector3(0, 1000, 0))
  const cam = new Vector3(0, 1000, 0)
  const playPool = vi.fn()
  const cues = createBattleAudioCues({ playPool }, cam, 25)
  cues.rebuildVolleyGroups(player)
  return { world, player, cam, playPool, cues }
}

afterEach(() => vi.restoreAllMocks())

describe('戰鬥單次音效的收集與播放', () => {
  it('子步只收集齊射，持續槍焰不重複；播放後不留事件', () => {
    const { world, player, playPool, cues } = setup()
    player.muzzleFlash.fill(0.03)
    cues.queueAudioCues(world, player, land, false)
    cues.queueAudioCues(world, player, land, false)
    expect(playPool).not.toHaveBeenCalled()
    cues.playFrame(world, player, 1, true)
    expect(playPool).toHaveBeenCalledTimes(1)
    expect(playPool.mock.calls[0]!.slice(0, 7)).toEqual(['volley-m2-50calx6', 'fireSelf', 0, 0, 0, false, 0])
    cues.playFrame(world, player, 2, true)
    expect(playPool).toHaveBeenCalledTimes(1)
    player.muzzleFlash.fill(0)
    cues.queueAudioCues(world, player, land, false)
    player.muzzleFlash.fill(0.03)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 3, true)
    expect(playPool).toHaveBeenCalledTimes(2)
  })

  it('爆炸在播放時量鏡頭距離，清空與不同實例互不干擾', () => {
    const { world, player, cam, playPool, cues } = setup()
    const other = setup()
    cues.queueExplosion(1000, 1000, 0, 0.5)
    other.cues.queueExplosion(2000, 1000, 0, 1)
    cam.x = 1000
    cues.playFrame(world, player, 1, true)
    expect(playPool.mock.calls.map(c => c[0])).toEqual(['explosion', 'rattle'])
    cues.queueExplosion(1000, 1000, 0, 1)
    cues.clear()
    cues.playFrame(world, player, 2, true)
    expect(playPool).toHaveBeenCalledTimes(2)
    other.cues.playFrame(other.world, other.player, 1, true)
    expect(other.playPool).toHaveBeenCalledTimes(1)
  })

  it('512 筆佇列滿時丟新保舊，清空後能再使用', () => {
    const { world, player, playPool, cues } = setup()
    for (let i = 0; i < 520; i++) cues.queueExplosion(1000 + i, 1000, 0, 1)
    cues.playFrame(world, player, 1, true)
    expect(playPool).toHaveBeenCalledTimes(512)
    expect(playPool.mock.calls.map(c => c[2])).toEqual(Array.from({ length: 512 }, (_, i) => 1000 + i))
    cues.queueExplosion(2000, 1000, 0, 1)
    cues.playFrame(world, player, 2, true)
    expect(playPool).toHaveBeenCalledTimes(513)
  })

  it('材質撞擊清除來源並限頻，換場重設時間後能再次播放', () => {
    const { world, player, playPool, cues } = setup()
    world.time = 10
    pushImpact(world.materialHits, 100, 200, 300, 0, 0, 0)
    pushImpact(world.materialHits, 400, 500, 600, 0, 0, 0)
    cues.queueAudioCues(world, player, land, false)
    expect(world.materialHits.count).toBe(0)
    cues.playFrame(world, player, 10, true)
    expect(playPool).toHaveBeenCalledTimes(1)
    expect(playPool.mock.calls[0]!.slice(1, 6)).toEqual(['impact', 100, 200, 300, true])
    world.time = 10.01
    pushImpact(world.materialHits, 400, 500, 600, 0, 0, 0)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 10.01, true)
    expect(playPool).toHaveBeenCalledTimes(1)
    cues.reset()
    world.time = 0
    pushImpact(world.materialHits, 400, 500, 600, 0, 0, 0)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 0, true)
    expect(playPool).toHaveBeenCalledTimes(2)
  })

  it('命中回饋使用實際受害者與部位；不在座艙時消耗待播旗標', () => {
    const { world, player, cam, playPool, cues } = setup()
    const victim = world.add(new Aircraft(B17G), { update() {} }, 'red', new Vector3(2000, 1000, 0))
    pushDamage(world.damageEvents, victim.index, 1, 0, 0, 999)
    cues.queueAudioCues(world, player, land, false)
    clearDamage(world.damageEvents)
    cues.playFrame(world, player, 1, true)
    const fb = { gainDb: 0, cutoffHz: 0 }
    hitFeedback(victim.aircraft.state.position.distanceTo(cam), fb)
    expect(playPool.mock.calls).toEqual([['hit', 'hitDealt', 0, 0, 0, false, fb.gainDb, false,
      hitRate(B17G.mass, B17G.protection.fuselage), fb.cutoffHz]])
    pushDamage(world.damageEvents, victim.index, 1, 0, 0, 0)
    cues.queueAudioCues(world, player, land, false)
    clearDamage(world.damageEvents)
    cues.playFrame(world, player, 2, false)
    cues.playFrame(world, player, 3, true)
    expect(playPool).toHaveBeenCalledTimes(1)
  })

  it('上帝視角保留定位空爆，排除齊射、自機受擊和機身受創', () => {
    const { world, player, playPool, cues } = setup()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    player.muzzleFlash.fill(0.03)
    pushDamage(world.damageEvents, player.index, 1, 0, 0, 0)
    pushBurst(world.burstEvents, 0, 1000, 0, 1)
    cues.queueAudioCues(world, player, land, true)
    cues.playFrame(world, player, 1, false)
    expect(playPool.mock.calls).toEqual([['flakBurst', 'flakBurst', 0, 1000, 0, true, 0, true]])
    expect(world.damageEvents.count).toBe(1)
    expect(world.burstEvents.count).toBe(1)
  })

  /** 與世界層扣血同一條判準：同隊的砲不傷自己人，就不該有受創聲 */
  it('友軍空爆炸在身上：有爆炸聲、沒有受創聲；敵軍的才有', () => {
    const { world, player, playPool, cues } = setup()
    // 玩家是藍隊（0）。`world.add` 只記出生點，位置要自己擺
    player.aircraft.state.position.set(0, 1000, 0)
    pushBurst(world.burstEvents, 0, 1000, 0, 0)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 1, true)
    expect(playPool.mock.calls.map(c => c[1])).toEqual(['flakBurst'])
    playPool.mockClear()
    world.burstEvents.count = 0
    pushBurst(world.burstEvents, 0, 1000, 0, 1)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 2, true)
    expect(playPool.mock.calls.map(c => c[1])).toEqual(['flakBurst', 'damage', 'hitSelf'])
  })

  it('換機重建前射與後座齊射，清除上一架的槍焰邊緣狀態', () => {
    const { world, player, playPool, cues } = setup(JU87)
    expect(cues.ownTurretVolley).toBe(true)
    player.muzzleFlash.fill(0.03)
    player.turretStates[0]!.flash = 0.03
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 1, true)
    expect(playPool.mock.calls.filter(c => c[1] === 'fireSelf')).toHaveLength(2)
    const next = world.add(new Aircraft(P51D), { update() {} }, 'blue', new Vector3())
    next.muzzleFlash.fill(0.03)
    cues.rebuildVolleyGroups(next)
    expect(cues.ownTurretVolley).toBe(false)
    cues.queueAudioCues(world, next, land, false)
    cues.playFrame(world, next, 2, true)
    expect(playPool.mock.calls.at(-1)![0]).toBe('volley-m2-50calx6')
    expect(playPool).toHaveBeenCalledTimes(3)
  })
})
