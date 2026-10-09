import { afterEach, describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createBattleAudioCues } from '../../src/audio/battleAudioCues'
import { hitFeedback, hitRate } from '../../src/audio/curves'
import { warmJamGainDb } from '../../src/control/gunHeat'
import { P51D } from '../../src/specs/p51d'
import { JU87 } from '../../src/specs/ju87'
import { B17G } from '../../src/specs/b17g'
import { World } from '../../src/world/World'
import { clearDamage, pushDamage } from '../../src/world/damage'
import { pushImpact } from '../../src/world/events'
import { pushBurst } from '../../src/world/flak'
import { HIT_PARTS } from '../../src/world/hit'

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

/**
 * 【快過熱：每打一發配一聲槍機聲】跟齊射同一條路（子步收槍焰的上升緣），與槍聲完全同步、低幀率也不漏。
 * 音量隨熱度從 −18 dB 升到 0 dB（`warmJamGainDb`），過熱那一刻接上紅色空響
 */
describe('快過熱的槍機聲', () => {
  function warmSetup(spec = P51D) {
    const world = new World()
    const player = world.add(new Aircraft(spec), { update() {} }, 'blue', new Vector3(0, 1000, 0))
    const playPool = vi.fn()
    const gun = { warmFiring: false, gunHeat: { heat: 0 } }
    const cues = createBattleAudioCues({ playPool }, new Vector3(0, 1000, 0), 25, gun)
    cues.rebuildVolleyGroups(player)
    // 前射武器與砲塔一起打一發
    const shoot = (t: number): void => {
      player.muzzleFlash.fill(0)
      for (const ts of player.turretStates) ts.flash = 0
      cues.queueAudioCues(world, player, land, false)
      player.muzzleFlash.fill(0.03)
      for (const ts of player.turretStates) ts.flash = 0.03
      cues.queueAudioCues(world, player, land, false)
      cues.playFrame(world, player, t, true)
    }
    const jams = () => playPool.mock.calls.filter((c) => String(c[0]).startsWith('gun-jam-'))
    return { playPool, gun, shoot, jams }
  }

  it('綠色時只有槍聲', () => {
    const s = warmSetup()
    s.shoot(1)
    expect(s.jams()).toHaveLength(0)
  })

  it('快過熱時每一發齊射配一聲那一組的槍機聲，音量照熱度', () => {
    const s = warmSetup()
    s.gun.warmFiring = true
    s.gun.gunHeat.heat = 0.6
    s.shoot(1)
    s.gun.gunHeat.heat = 0.9
    s.shoot(2)
    const j = s.jams()
    expect(j.map((c) => c[0])).toEqual(['gun-jam-m2-50calx6', 'gun-jam-m2-50calx6'])
    expect(j.map((c) => c.slice(1, 6))).toEqual([['reload', 0, 0, 0, false], ['reload', 0, 0, 0, false]])
    expect(j[0]![6]).toBeCloseTo(warmJamGainDb(0.6), 9)
    expect(j[1]![6]).toBeCloseTo(warmJamGainDb(0.9), 9)
  })

  /** 【只配前射武器】後座砲塔的齊射不是玩家扣的扳機，不吃過熱 */
  it('後座砲塔的齊射不配槍機聲', () => {
    const s = warmSetup(JU87)
    s.gun.warmFiring = true
    s.gun.gunHeat.heat = 0.8
    s.shoot(1)
    expect(s.jams().map((c) => c[0])).toEqual(['gun-jam-mg17x2'])
  })
})

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

  /**
   * 【先濾距離再佔時段】聽不到的遠處命中（超過 `impact` 的 1200 m）佔掉時段的話，旁邊那一發就被擋掉；
   * 同一個子步裡挑最近的那一發
   */
  it('材質撞擊：同一子步挑聽得到的最近一發；聽不到的不佔時段', () => {
    const { world, player, playPool, cues } = setup()
    world.time = 10
    pushImpact(world.materialHits, 3000, 1000, 0, 0, 0, 0)
    pushImpact(world.materialHits, 300, 1000, 0, 0, 0, 0)
    pushImpact(world.materialHits, 50, 1000, 0, 0, 0, 0)
    pushImpact(world.materialHits, 400, 1000, 0, 0, 0, 0)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 10, true)
    expect(playPool.mock.calls.map((c) => c[2])).toEqual([50])
    world.time = 10.1
    pushImpact(world.materialHits, 3000, 1000, 0, 0, 0, 0)
    cues.queueAudioCues(world, player, land, false)
    world.time = 10.11
    pushImpact(world.materialHits, 60, 1000, 0, 0, 0, 0)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 10.11, true)
    expect(playPool.mock.calls.map((c) => c[2])).toEqual([50, 60])
  })

  /**
   * 【挑這一幀離鏡頭最近的那一架】不定位的一聲，音量與悶度看被打中那一架的距離。記最後一筆的話，
   * 同一幀僚機在 1.5 km 外打中，自己 100 m 打中的那一聲就用 1.5 km 的悶聲播
   */
  it('命中回饋：同一幀有好幾架被打中時，用最近那一架的距離、機型與它最後被打中的部位', () => {
    const { world, player, cam, playPool, cues } = setup()
    const near = world.add(new Aircraft(JU87), { update() {} }, 'red', new Vector3(100, 1000, 0))
    const far = world.add(new Aircraft(B17G), { update() {} }, 'red', new Vector3(1500, 1000, 0))
    near.aircraft.state.position.set(100, 1000, 0)
    far.aircraft.state.position.set(1500, 1000, 0)
    pushDamage(world.damageEvents, near.index, 1, 0, 0, 0)
    pushDamage(world.damageEvents, near.index, 1, 0, 0, 1)
    pushDamage(world.damageEvents, far.index, 1, 0, 0, 0)
    cues.queueAudioCues(world, player, land, false)
    clearDamage(world.damageEvents)
    cues.playFrame(world, player, 1, true)
    const fb = { gainDb: 0, cutoffHz: 0 }
    hitFeedback(near.aircraft.state.position.distanceTo(cam), fb)
    expect(playPool.mock.calls).toEqual([['hit', 'hitDealt', 0, 0, 0, false, fb.gainDb, false,
      hitRate(JU87.mass, JU87.protection[HIT_PARTS[1]!]), fb.cutoffHz]])
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
