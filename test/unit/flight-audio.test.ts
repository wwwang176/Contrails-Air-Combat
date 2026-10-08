import { afterEach, describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createFlightAudio } from '../../src/audio/flightAudio'
import { SINGLE_FILES } from '../../src/audio/catalog'
import { createInputState } from '../../src/input/InputState'
import { P51D } from '../../src/specs/p51d'
import { JU87 } from '../../src/specs/ju87'
import { World, teamSlot } from '../../src/world/World'
import { dryClickInterval } from '../../src/control/gunHeat'

function setup(spec = P51D) {
  const world = new World()
  const me = world.add(new Aircraft(spec), { update() {} }, 'blue', new Vector3(0, 1000, 0))
  me.aircraft.state.position.set(0, 1000, 0)
  const input = createInputState()
  const cam = new Vector3(0, 1000, 0)
  const audio = { selfLoop: vi.fn(), playPool: vi.fn(), playFile: vi.fn() }
  const playHeavyHit = vi.fn()
  const gun = { dryFiring: false }
  const flight = createFlightAudio(audio, cam, input, { playHeavyHit, teamSlot, gun })
  flight.reset()
  const update = (time = 1, warn = false, dt = 1 / 60) => flight.update(world, me, time, dt, warn)
  return { world, me, input, cam, audio, flight, playHeavyHit, update, gun }
}

/**
 * 過熱時扣扳機的空響（SPEC `2026-10-08-gun-overheat-design.md`）：射速的兩倍。
 * 【保留餘數】音效每畫面幀才跑一次；每響一次就重設整個間隔的話，60 fps 下 21.7 次／秒會掉到 20 次
 */
describe('過熱的空響', () => {
  const jams = (audio: { playFile: ReturnType<typeof vi.fn> }) =>
    audio.playFile.mock.calls.filter((c) => c[0] === SINGLE_FILES.gunJam).length

  it('按著的期間依射速兩倍響，幀率不影響累積次數；放開就停', () => {
    for (const fps of [30, 60, 144]) {
      const { audio, update, gun, me } = setup()
      const interval = dryClickInterval(me.aircraft.spec.battery)
      gun.dryFiring = true
      for (let i = 0; i < fps * 10; i++) update(1 + i / fps, false, 1 / fps)
      expect(Math.abs(jams(audio) - 10 / interval), `${fps} fps`).toBeLessThanOrEqual(2)
      gun.dryFiring = false
      audio.playFile.mockClear()
      for (let i = 0; i < fps; i++) update(20 + i / fps, false, 1 / fps)
      expect(jams(audio)).toBe(0)
    }
  })

  it('一按下就響第一聲；音量類別是自己的機械聲', () => {
    const { audio, update, gun } = setup()
    gun.dryFiring = true
    update(1, false, 1 / 60)
    const call = audio.playFile.mock.calls.find((c) => c[0] === SINGLE_FILES.gunJam)
    expect(call).toBeDefined()
    expect(call![1]).toBe('reload')
  })

  it('上帝視角不響', () => {
    const { audio, update, gun, input } = setup()
    input.godView = true
    gun.dryFiring = true
    for (let i = 0; i < 60; i++) update(1 + i / 60, false, 1 / 60)
    expect(jams(audio)).toBe(0)
  })
})

afterEach(() => vi.restoreAllMocks())

describe('自機與附近彈藥的音效生命週期', () => {
  it('座艙的循環依機種與警告狀態播放，上帝視角全部關閉', () => {
    const { me, input, audio, update } = setup(JU87)
    me.aircraft.diag.aero.tas = me.aircraft.spec.limits.vne
    me.aircraft.diag.air.sigma = 1
    me.aircraft.state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 4)
    update()
    expect(audio.selfLoop.mock.calls.map(c => c[0])).toEqual(['engine', 'wind', 'siren', 'warn'])
    expect(audio.selfLoop.mock.calls.every(c => c[1] !== null)).toBe(true)
    input.godView = true
    audio.selfLoop.mockClear()
    update(2, true)
    expect(audio.selfLoop.mock.calls.map(c => c[1])).toEqual([null, null, null, null])
  })

  it('裝填完成與進出投彈視角各響一次，重設不誤播上一架的事件', () => {
    const { me, input, audio, flight, update } = setup()
    me.bombBay.reloading = true
    update()
    me.bombBay.reloading = false
    input.viewMode = 'bomb'
    update(2)
    expect(audio.playFile.mock.calls.map(c => c[0])).toEqual([SINGLE_FILES.reloadDone, SINGLE_FILES.bayToggle])
    update(3)
    expect(audio.playFile).toHaveBeenCalledTimes(2)
    input.viewMode = 'third'
    update(4)
    expect(audio.playFile).toHaveBeenCalledTimes(3)
    me.bombBay.reloading = true
    update(5)
    me.bombBay.reloading = false
    input.viewMode = 'bomb'
    flight.reset()
    update(0)
    expect(audio.playFile).toHaveBeenCalledTimes(3)
  })

  it('附近下降的炸彈每槽只呼嘯一次，槽重用與換場可再播放', () => {
    const { world, me, audio, flight, update } = setup()
    const b = world.bombs
    b.active[0] = 1; b.owner[0] = me.index
    b.x[0] = 0; b.y[0] = 1100; b.z[0] = 0; b.vy[0] = -100; b.age[0] = 2
    b.active[1] = 1; b.x[1] = 1000; b.y[1] = 1000; b.vy[1] = -100
    update()
    b.age[0] = 3
    update(2)
    expect(audio.playFile.mock.calls.map(c => c[0])).toEqual([SINGLE_FILES.whistle])
    b.age[0] = 0.1
    update(3)
    expect(audio.playFile).toHaveBeenCalledTimes(2)
    flight.reset()
    update(0)
    expect(audio.playFile).toHaveBeenCalledTimes(3)
  })

  it('擦過量鏡頭位置，上帝視角包含友軍子彈且仍受播放間隔限制', () => {
    const { world, input, cam, audio, flight, update } = setup()
    const p = world.projectiles
    p.owner[0] = 3; p.team[0] = teamSlot('blue')
    p.x[0] = 1008; p.y[0] = 1000; p.z[0] = 0; p.vx[0] = 800
    cam.x = 1000
    update()
    expect(audio.playPool).not.toHaveBeenCalled()
    input.godView = true
    update(2)
    update(2.01)
    expect(audio.playPool.mock.calls).toEqual([['flyby', 'flyby', 1008, 1000, 0, true]])
    update(2.13)
    expect(audio.playPool).toHaveBeenCalledTimes(2)
    flight.reset()
    update(0)
    expect(audio.playPool).toHaveBeenCalledTimes(3)
  })

  it('重擊比較相鄰座艙幀的血量，離開座艙與重設後不誤報', () => {
    const { me, input, flight, playHeavyHit, update } = setup()
    update()
    me.hp -= me.aircraft.spec.hp * 0.2
    update(2)
    expect(playHeavyHit.mock.calls).toEqual([[1]])
    input.godView = true
    update(3)
    me.hp -= me.aircraft.spec.hp * 0.2
    input.godView = false
    update(4)
    expect(playHeavyHit).toHaveBeenCalledTimes(1)
    flight.reset()
    me.hp -= me.aircraft.spec.hp * 0.2
    update(0)
    expect(playHeavyHit).toHaveBeenCalledTimes(1)
  })

  it('超速晃動按計時播放，恢復正常速度後下一次超速重新起算', () => {
    const { me, audio, update } = setup()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    me.aircraft.diag.air.sigma = 1
    me.aircraft.diag.aero.tas = me.aircraft.spec.limits.vne
    update()
    update(1.001, false, 0.001)
    expect(audio.playPool.mock.calls.map(c => c[0])).toEqual(['rattle'])
    expect(random).toHaveBeenCalledTimes(1)
    me.aircraft.diag.aero.tas = 100
    update(2)
    me.aircraft.diag.aero.tas = me.aircraft.spec.limits.vne
    update(3)
    expect(audio.playPool.mock.calls.map(c => c[0])).toEqual(['rattle', 'rattle'])
    expect(random).toHaveBeenCalledTimes(2)
  })
})
