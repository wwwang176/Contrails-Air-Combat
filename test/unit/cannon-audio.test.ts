import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { createCannonAudio } from '../../src/audio/cannonAudio'
import { gunSound } from '../../src/audio/catalog'
import { createShip, SHIP_CLASSES } from '../../src/world/ships'
import { createGroundBattery } from '../../src/world/shipGuns'
import { createGroundTarget } from '../../src/world/groundTargets'
import type { ShipAATier } from '../../src/world/shipAA'
import type { World } from '../../src/world/World'

function ship(x: number, tier: ShipAATier = 'flak') {
  const p = createShip(0, SHIP_CLASSES.fletcher, 'red', x, 0, 0, 0)
  const gun = createGroundBattery()[0]!
  p.guns = [{ ...gun, flash: 1, zone: { ...gun.zone, tier, position: new Vector3() } }]
  return p
}

function setup() {
  const playPool = vi.fn()
  const cam = new Vector3()
  const audio = createCannonAudio({ playPool }, cam)
  const world: Pick<World, 'ships' | 'groundTargets'> = { ships: [], groundTargets: [] }
  return { audio, cam, world, playPool }
}

describe('砲聲候選與生命週期', () => {
  it('艦砲與地面高射砲共用同層最近候選與限頻', () => {
    const { audio, world, playPool } = setup()
    const ground = createGroundTarget(0, 'flakHeavy', 'red', 10, 0, 0)
    ground.guns = createGroundBattery()
    ground.guns[0]!.flash = 1
    world.groundTargets.push(ground)
    world.ships.push(ship(500))
    audio.playCannons(world, 1)
    expect(playPool).toHaveBeenCalledTimes(1)
    expect(playPool.mock.calls[0]![2]).toBe(10)
    ground.guns[0]!.flash = 0
    audio.playCannons(world, 1.01)
    ground.guns[0]!.flash = 1
    audio.playCannons(world, 1.02)
    expect(playPool).toHaveBeenCalledTimes(1)
  })
  it('每層選最近的砲，保留第一個等距候選與各層音色', () => {
    const { audio, world, playPool } = setup()
    world.ships.push(ship(500), ship(20), ship(-20), ship(40, 'mg'), ship(60, 'autocannon'))
    audio.playCannons(world, 1)
    expect(playPool.mock.calls).toEqual(['flak', 'mg', 'autocannon'].map((tier, i) => {
      const g = gunSound(tier)
      return ['cannon', 'cannon', [20, 40, 60][i], 0, 0, true, g.gainDb, false, g.rate, g.cutoffHz]
    }))
    audio.playCannons(world, 2)
    expect(playPool).toHaveBeenCalledTimes(3)
  })

  it('使用旋轉後的世界砲口與更新後的鏡頭位置，忽略死亡及範圍外砲位', () => {
    const { audio, world, cam, playPool } = setup()
    const p = ship(6100)
    p.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    p.guns[0]!.zone.position.set(0, 0, 10)
    const dead = ship(1, 'mg')
    dead.alive = false
    world.ships.push(p, dead, ship(12000, 'autocannon'))
    cam.set(200, 0, 0)
    audio.playCannons(world, 1)
    expect(playPool).toHaveBeenCalledTimes(1)
    expect(playPool.mock.calls[0]![2]).toBeCloseTo(6110)
    expect(playPool.mock.calls[0]![4]).toBeCloseTo(0)
  })

  it('地面砲候選留到下一幀，限頻丟棄的候選不會延後播放', () => {
    const { audio, world, playPool } = setup()
    const note = audio.noteGroundShot
    audio.playCannons(world, 0)
    note('tank', 100, 0, 0)
    note('panzer4', 20, 0, 0)
    audio.playCannons(world, 1)
    expect(playPool.mock.calls[0]![2]).toBe(20)
    note('tank', 10, 0, 0)
    audio.playCannons(world, 1.01)
    audio.playCannons(world, 2)
    expect(playPool).toHaveBeenCalledTimes(1)
    note('truck', 0, 0, 0)
    note('tank', 6000, 0, 0)
    audio.playCannons(world, 3)
    expect(playPool).toHaveBeenCalledTimes(1)
  })

  it('1024 個記錄槽滿時，仍播放已選的砲與地面砲', () => {
    const { audio, world, playPool } = setup()
    const p = ship(100)
    p.guns = Array.from({ length: 1025 }, (_, i) => ({
      ...p.guns[0]!, zone: { ...p.guns[0]!.zone, position: new Vector3(i === 1024 ? -99 : 0, 0, 0) },
    }))
    world.ships.push(p)
    audio.noteGroundShot('tank', 30, 0, 0)
    audio.playCannons(world, 1)
    expect(playPool.mock.calls.map(call => call[2])).toEqual([30, 100])
  })

  it('重設清除閃光、限頻與待播事件，且不同實例互不影響', () => {
    const { audio, world, playPool } = setup()
    const other = setup()
    world.ships.push(ship(10))
    audio.playCannons(world, 10)
    audio.noteGroundShot('tank', 20, 0, 0)
    other.audio.noteGroundShot('tank', 30, 0, 0)
    audio.reset()
    audio.reset()
    audio.playCannons(world, 0)
    other.audio.playCannons(other.world, 0)
    expect(playPool.mock.calls.map(call => call[2])).toEqual([10, 10])
    expect(other.playPool.mock.calls.map(call => call[2])).toEqual([30])
  })
})
