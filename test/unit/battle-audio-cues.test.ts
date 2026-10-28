import { afterEach, describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createBattleAudioCues } from '../../src/audio/battleAudioCues'
import { hitFeedback, hitRate } from '../../src/audio/curves'
import { randomRate } from '../../src/audio/pick'
import { HDR_EXEMPT } from '../../src/audio/dynamics'
import { warmJamGainDb } from '../../src/control/gunHeat'
import { P51D } from '../../src/specs/p51d'
import { JU87 } from '../../src/specs/ju87'
import { B17G } from '../../src/specs/b17g'
import { World } from '../../src/world/World'
import { clearDamage, pushDamage } from '../../src/world/damage'
import { clearImpacts, createImpacts, pushImpact } from '../../src/world/events'
import { CATEGORY, WATER_HIT, impactSound } from '../../src/audio/catalog'
import { MATERIAL } from '../../src/world/material'
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

  /**
   * 【打到水面：兩層同時起播、共用一個音高】碎屑過低通，疊上落水聲。限頻與材質撞擊同一套：
   * 聽得到的範圍內挑最近的一發、聽不到的不佔時段；候選跨幀留到播完才清
   * （地面戰的砲彈落地在 `playFrame` 之後才寫進來）
   */
  it('打到水面：挑聽得到的最近一發，兩層同一個音高；候選播完才清、被擋的不留', () => {
    const { world, player, playPool, cues } = setup()
    vi.spyOn(Math, 'random').mockReturnValue(0.75)
    const ev = createImpacts()
    pushImpact(ev, 3000, 1000, 0, 0, 1, 0)
    pushImpact(ev, 300, 1000, 0, 0, 1, 0)
    cues.noteWaterHits(ev)
    clearImpacts(ev)
    pushImpact(ev, 40, 1000, 0, 0, 1, 0)
    cues.noteWaterHits(ev)
    cues.playFrame(world, player, 10, true)
    const r = 0.92 + 0.75 * 0.16
    expect(playPool.mock.calls).toEqual([
      ['debris', 'waterHit', 40, 1000, 0, true, WATER_HIT.debrisDb, false, r, WATER_HIT.debrisCutoffHz],
      ['waterHit', 'waterHit', 40, 1000, 0, true, WATER_HIT.splashDb, false, r],
    ])
    // 播完就清：下一幀沒有新的就不響
    cues.playFrame(world, player, 10.1, true)
    expect(playPool).toHaveBeenCalledTimes(2)
    // 聽不到的不佔時段
    clearImpacts(ev)
    pushImpact(ev, 5000, 1000, 0, 0, 1, 0)
    cues.noteWaterHits(ev)
    cues.playFrame(world, player, 10.2, true)
    expect(playPool).toHaveBeenCalledTimes(2)
    clearImpacts(ev)
    pushImpact(ev, 50, 1000, 0, 0, 1, 0)
    cues.noteWaterHits(ev)
    cues.playFrame(world, player, 10.21, true)
    expect(playPool).toHaveBeenCalledTimes(4)
    // 時段內被擋的不留到下一幀
    cues.noteWaterHits(ev)
    cues.playFrame(world, player, 10.22, true)
    cues.playFrame(world, player, 11, true)
    expect(playPool).toHaveBeenCalledTimes(4)
    // 重設清掉候選與時段
    cues.noteWaterHits(ev)
    cues.reset()
    cues.playFrame(world, player, 11.01, true)
    expect(playPool).toHaveBeenCalledTimes(4)
    cues.noteWaterHits(ev)
    cues.playFrame(world, player, 0, true)
    expect(playPool).toHaveBeenCalledTimes(6)
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

/**
 * 【自己打中東西的回饋】與別人的同一個聲音、定位，但**不等音速**（`playPool` 第 11 格 `instant`），
 * 音量走 `hitOwn` 與 `ownHitDb` 的距離曲線。這一發不再走別人的那一條，否則同一發響兩次。
 * 上帝視角時沒有一發算自己的
 */
describe('自己的命中回饋', () => {
  const metal = impactSound(MATERIAL.metal)
  const dirt = impactSound(MATERIAL.ground)
  const RATE = randomRate(() => 0.75)

  it('打到地面、車輛：定位在命中點、立刻響、走 hitOwn；別人的照舊等音速', () => {
    const { world, player, playPool, cues } = setup()
    vi.spyOn(Math, 'random').mockReturnValue(0.75)
    world.time = 10
    pushImpact(world.materialHits, 200, 1000, 0, MATERIAL.ground, 0, 0, player.index)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 10, true)
    expect(playPool).toHaveBeenCalledTimes(1)
    const c = playPool.mock.calls[0]!
    expect([...c.slice(0, 6), ...c.slice(7)]).toEqual([dirt.pool, 'hitOwn', 200, 1000, 0, true, true,
      dirt.rate * RATE, dirt.cutoffHz, true])
    playPool.mockClear()
    world.time = 11
    pushImpact(world.materialHits, 200, 1000, 0, MATERIAL.metal, 0, 0, 7)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 11, true)
    expect(playPool.mock.calls).toEqual([[metal.pool, 'impact', 200, 1000, 0, true, metal.gainDb, false,
      metal.rate, metal.cutoffHz]])
  })

  it('同一子步自己的與別人的各播一聲，自己的不重複走定位那一條', () => {
    const { world, player, playPool, cues } = setup()
    world.time = 10
    pushImpact(world.materialHits, 100, 1000, 0, MATERIAL.metal, 0, 0, player.index)
    pushImpact(world.materialHits, 300, 1000, 0, MATERIAL.metal, 0, 0, -1)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 10, true)
    expect(playPool.mock.calls.map((c) => [c[1], c[2], c[10]])).toEqual([['impact', 300, undefined],
      ['hitOwn', 100, true]])
  })

  /**
   * 【比總增益，不比額外增益】兩類的基準可以不同。近距離與自己被機槍打中一樣大（同樣疊第二層）——
   * 再小就會被自己的機槍與引擎蓋掉
   */
  it('打中飛機：在那一架身上定位、立刻響；近距離與自己被打中一樣大；別人打中的照舊', () => {
    const { world, player, playPool, cues } = setup()
    vi.spyOn(Math, 'random').mockReturnValue(0.75)
    const foe = world.add(new Aircraft(JU87), { update() {} }, 'red', new Vector3(50, 1000, 0))
    foe.aircraft.state.position.set(50, 1000, 0)
    pushDamage(world.damageEvents, foe.index, 1, 0, 0, 1, player.index)
    pushDamage(world.damageEvents, player.index, 1, 0, 0, 1, foe.index)
    cues.queueAudioCues(world, player, land, false)
    clearDamage(world.damageEvents)
    cues.playFrame(world, player, 1, true)
    const own = playPool.mock.calls.find((c) => c[1] === 'hitOwn')!
    const self = playPool.mock.calls.find((c) => c[1] === 'hitSelf')!
    expect(own.slice(0, 6)).toEqual(['hit', 'hitOwn', 50, 1000, 0, true])
    expect(own[8]).toBe(hitRate(JU87.mass, JU87.protection[HIT_PARTS[1]!]) * RATE)
    expect(own[10]).toBe(true)
    const ownDb = CATEGORY.hitOwn.gainDb + (own[6] as number)
    const selfDb = CATEGORY.hitSelf.gainDb + (self[6] as number)
    expect(ownDb).toBeCloseTo(selfDb, 9)
    expect(own[7]).toBe(self[7])
    playPool.mockClear()
    pushDamage(world.damageEvents, foe.index, 1, 0, 0, 0, -1)
    cues.queueAudioCues(world, player, land, false)
    clearDamage(world.damageEvents)
    cues.playFrame(world, player, 2, true)
    expect(playPool.mock.calls.map((c) => c[1])).toEqual(['hitDealt'])
  })

  /** 每一發在新的一場打，避開限頻；回那一聲的額外增益，沒播回 undefined */
  function groundHitDb(distance: number): number | undefined {
    const { world, player, playPool, cues } = setup()
    pushImpact(world.materialHits, distance, 1000, 0, MATERIAL.ground, 0, 0, player.index)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 10, true)
    return playPool.mock.calls[0]?.[6] as number | undefined
  }

  it('距離：100 m 內滿音量，到 1,000 m 只小 3 dB，最後 200 m 收到 0，1,200 m 起不播', () => {
    const near = groundHitDb(50)!
    expect(groundHitDb(100)).toBeCloseTo(near, 9)
    expect(groundHitDb(200)! - near).toBeCloseTo(-0.903, 3)
    expect(groundHitDb(1000)! - near).toBeCloseTo(-3, 9)
    expect(groundHitDb(1100)! - near).toBeCloseTo(3 * Math.log10(100 / 1100) + 20 * Math.log10(0.5), 6)
    expect(groundHitDb(1199)! - near).toBeLessThan(-45)
    expect(groundHitDb(1200)).toBeUndefined()
  })

  /** 少了任一項都不會報錯：引擎再疊一次真實衰減，或吵的時候被 HDR 整聲略過 */
  it('hitOwn：引擎不再做距離衰減、不吃 HDR 窗口', () => {
    expect(CATEGORY.hitOwn.rolloff).toBe(0)
    expect(HDR_EXEMPT.has('hitOwn')).toBe(true)
  })

  it('打到水面：兩層都走 hitOwn、立刻響、同一個音高，大小與打到地面同一條；別人的不吃這幾項', () => {
    const { world, player, playPool, cues } = setup()
    vi.spyOn(Math, 'random').mockReturnValue(0.75)
    cues.queueAudioCues(world, player, land, false)
    const ev = createImpacts()
    pushImpact(ev, 100, 1000, 0, 0, 1, 0, player.index)
    cues.noteWaterHits(ev)
    cues.playFrame(world, player, 1, true)
    const near = groundHitDb(100)! - dirt.gainDb
    expect(playPool.mock.calls.map((c) => [c[0], c[1], c[6], c[8], c[10]])).toEqual([
      ['debris', 'hitOwn', WATER_HIT.debrisDb + near, RATE, true],
      ['waterHit', 'hitOwn', WATER_HIT.splashDb + near, RATE, true]])
    playPool.mockClear()
    clearImpacts(ev)
    pushImpact(ev, 100, 0, 0, 0, 1, 0, -1)
    cues.noteWaterHits(ev)
    cues.playFrame(world, player, 2, true)
    expect(playPool.mock.calls.map((c) => [c[0], c[6], c[10]])).toEqual([
      ['debris', WATER_HIT.debrisDb, undefined], ['waterHit', WATER_HIT.splashDb, undefined]])
  })

  it('自己的命中限頻：0.07 s 內只響一聲，聽不到的（1,200 m 外）不記', () => {
    const { world, player, playPool, cues } = setup()
    pushImpact(world.materialHits, 3000, 1000, 0, MATERIAL.ground, 0, 0, player.index)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 10, true)
    expect(playPool).not.toHaveBeenCalled()
    pushImpact(world.materialHits, 100, 1000, 0, MATERIAL.ground, 0, 0, player.index)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 10, true)
    pushImpact(world.materialHits, 100, 1000, 0, MATERIAL.ground, 0, 0, player.index)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 10.05, true)
    expect(playPool).toHaveBeenCalledTimes(1)
    pushImpact(world.materialHits, 100, 1000, 0, MATERIAL.ground, 0, 0, player.index)
    cues.queueAudioCues(world, player, land, false)
    cues.playFrame(world, player, 10.08, true)
    expect(playPool).toHaveBeenCalledTimes(2)
  })

  /**
   * 【接手僚機那一幀】`stepBattle` 已經換了座位，齊射分組還是舊那架的。新那架打中的算自己的；
   * 新那架的槍焰不拿去比舊的分組
   */
  it('接手僚機那一幀：新座位打中的算自己的，槍焰不比舊分組', () => {
    const { world, player, playPool, cues } = setup()
    const next = world.add(new Aircraft(JU87), { update() {} }, 'blue', new Vector3(0, 1000, 0))
    next.muzzleFlash.fill(0.03)
    world.time = 10
    pushImpact(world.materialHits, 200, 1000, 0, MATERIAL.ground, 0, 0, next.index)
    cues.queueAudioCues(world, next, land, false)
    cues.playFrame(world, next, 10, true)
    expect(playPool.mock.calls.map((c) => [c[1], c[10]])).toEqual([['hitOwn', true]])
    expect(player.index).not.toBe(next.index)
  })

  it('上帝視角：自己打的照別人的那一條（等音速、原音量）', () => {
    const { world, player, playPool, cues } = setup()
    world.time = 10
    pushImpact(world.materialHits, 200, 1000, 0, MATERIAL.metal, 0, 0, player.index)
    cues.queueAudioCues(world, player, land, true)
    cues.playFrame(world, player, 10, true)
    expect(playPool.mock.calls.map((c) => [c[6], c[10]])).toEqual([[metal.gainDb, undefined]])
  })
})
