import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { GROUND_SHOT_QUEUE, createCannonAudio } from '../../src/audio/cannonAudio'
import { gunSound } from '../../src/audio/catalog'
import { createShip, SHIP_CLASSES } from '../../src/world/ships'
import { createGroundBattery } from '../../src/world/shipGuns'
import { createGroundTarget } from '../../src/world/groundTargets'
import type { ShipAATier } from '../../src/world/shipAA'
import type { World } from '../../src/world/World'

function ship(x: number, tier: ShipAATier = 'flak') {
  const p = createShip(0, SHIP_CLASSES.fletcher, 'red', x, 0, 0, 0)
  const gun = createGroundBattery()[0]!
  // 開過一發：開火聲看的是開火計數（`shots`），不是槍焰
  p.guns = [{ ...gun, shots: 1, zone: { ...gun.zone, tier, position: new Vector3() } }]
  return p
}

/** 亂數 0.5 = 音量亂數 0 dB，呼叫參數可以直接比 */
function setup(rand: () => number = () => 0.5) {
  const playPool = vi.fn()
  const cam = new Vector3()
  const audio = createCannonAudio({ playPool }, cam, rand)
  const world: Pick<World, 'ships' | 'groundTargets'> = { ships: [], groundTargets: [] }
  return { audio, cam, world, playPool }
}

describe('砲聲候選與生命週期', () => {
  /** 【五吋艦砲與陸上重高砲各是一種聲音】各自挑最近、各自限頻率 */
  it('陸上砲位照自己的聲音種類，與艦砲分開限頻', () => {
    const { audio, world, playPool } = setup()
    const ground = createGroundTarget(0, 'flakHeavy', 'red', 10, 0, 0)
    ground.guns = createGroundBattery(undefined, undefined, undefined, 'heavyFlak')
    ground.guns[0]!.shots = 1
    world.groundTargets.push(ground)
    world.ships.push(ship(500))
    audio.playCannons(world, 1)
    expect(playPool.mock.calls.map((c) => [c[0], c[2]])).toEqual([['gun-5in', 500], ['gun-heavy-flak', 10]])
    audio.playCannons(world, 1.01)
    ground.guns[0]!.shots++
    audio.playCannons(world, 1.02)
    expect(playPool).toHaveBeenCalledTimes(2)
  })

  /** 【不看槍焰】槍焰 0.03 s，低幀率時在兩幀之間亮了又滅；開火計數增加了就算開了一發 */
  it('兩幀之間開了火而槍焰已經熄掉，照樣出聲；一幀之內開了好幾發只出一聲', () => {
    const { audio, world, playPool } = setup()
    const p = ship(20)
    world.ships.push(p)
    audio.playCannons(world, 1)
    p.guns[0]!.flash = 0
    p.guns[0]!.shots += 3
    audio.playCannons(world, 2)
    expect(playPool).toHaveBeenCalledTimes(2)
    audio.playCannons(world, 3)
    expect(playPool).toHaveBeenCalledTimes(2)
  })

  /** 【世界重設把計數歸零】變小不是開火；之後再增加才響 */
  it('開火計數變小不出聲，之後增加照樣出聲', () => {
    const { audio, world, playPool } = setup()
    const p = ship(20)
    p.guns[0]!.shots = 5
    world.ships.push(p)
    audio.playCannons(world, 1)
    p.guns[0]!.shots = 0
    audio.playCannons(world, 2)
    expect(playPool).toHaveBeenCalledTimes(1)
    p.guns[0]!.shots = 1
    audio.playCannons(world, 3)
    expect(playPool).toHaveBeenCalledTimes(2)
  })
  /**
   * 【每一座砲各自出聲，總量交給引擎】全場同一種共用一個時段的話，一公里外那座先開火就佔掉
   * 0.1 s，旁邊這座跟著消音（勒熱夫實測：旁邊那座 75% 的開火被擋，擋它的中位數 1,072 m）
   */
  it('每一座開了火的砲都出聲，播那一種的池與音量', () => {
    const { audio, world, playPool } = setup()
    world.ships.push(ship(500), ship(20), ship(-20), ship(40, 'mg'), ship(60, 'autocannon'))
    audio.playCannons(world, 1)
    expect(playPool.mock.calls).toEqual(
      ([['naval5in', 500], ['naval5in', 20], ['naval5in', -20], ['naval20', 40], ['naval40', 60]] as const).map(([kind, x]) => {
        const g = gunSound(kind)
        return [g.pool, 'cannon', x, 0, 0, true, g.gainDb, false]
      }))
    audio.playCannons(world, 2)
    expect(playPool).toHaveBeenCalledTimes(5)
  })

  it('遠處同一種的砲剛響過，旁邊這座照樣響；同一座在時段內再開火不重複響', () => {
    const { audio, world, playPool } = setup()
    const far = ship(1000, 'mg')
    const near = ship(15, 'mg')
    near.guns[0]!.shots = 0
    world.ships.push(far, near)
    audio.playCannons(world, 1)
    near.guns[0]!.shots = 1
    audio.playCannons(world, 1.02)
    expect(playPool.mock.calls.map((c) => c[2])).toEqual([1000, 15])
    near.guns[0]!.shots = 2
    audio.playCannons(world, 1.04)
    expect(playPool).toHaveBeenCalledTimes(2)
    near.guns[0]!.shots = 3
    audio.playCannons(world, 1.02 + gunSound('naval20').gap)
    expect(playPool).toHaveBeenCalledTimes(3)
  })

  /** 每發的音量小變化 ±1 dB；音高的小變化在引擎（`cannon` 類別的 `pitchJitter`），這裡不再乘 */
  it('每發音量 ±1 dB：亂數 0 是 −1、接近 1 是 +1', () => {
    const g = gunSound('naval5in')
    for (const [r, d] of [[0, -1], [0.999999, 1]] as const) {
      const { audio, world, playPool } = setup(() => r)
      world.ships.push(ship(20))
      audio.playCannons(world, 1)
      expect(playPool.mock.calls[0]![6]).toBeCloseTo(g.gainDb + d, 4)
      expect(playPool.mock.calls[0]).toHaveLength(8)
    }
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

  /**
   * 【地面戰也是每一台各自限頻率】同一種全場共用一個時段時，遠處那台先開就把旁邊這台消音
   * （勒熱夫實測：貼著一個步兵班，它 120 次開火只有 28 次出聲）
   */
  it('地面戰：留到下一幀播；每一台各自限頻，遠處同一種不擋旁邊這台；被擋的不延後', () => {
    const { audio, world, playPool } = setup()
    const note = audio.noteGroundShot
    audio.playCannons(world, 0)
    note('tank', 100, 0, 0, 1)
    note('panzer4', 20, 0, 0, 2)
    expect(playPool).not.toHaveBeenCalled()
    audio.playCannons(world, 1)
    expect(playPool.mock.calls.map((c) => c[2])).toEqual([100, 20])
    note('tank', 10, 0, 0, 1)
    note('tank', 15, 0, 0, 3)
    audio.playCannons(world, 1.01)
    expect(playPool.mock.calls.map((c) => c[2])).toEqual([100, 20, 15])
    audio.playCannons(world, 2)
    expect(playPool).toHaveBeenCalledTimes(3)
    note('truck', 0, 0, 0, 4)
    note('tank', 6000, 0, 0, 5)
    audio.playCannons(world, 3)
    expect(playPool).toHaveBeenCalledTimes(3)
  })

  /** 【佇列固定大小】一幀內超過的話丟最遠的 —— 熱路徑不配置 */
  it(`一幀內超過 ${GROUND_SHOT_QUEUE} 發時丟掉最遠的`, () => {
    const { audio, world, playPool } = setup()
    for (let k = 0; k < GROUND_SHOT_QUEUE + 6; k++) audio.noteGroundShot('infantry', GROUND_SHOT_QUEUE + 6 - k, 0, 0, k)
    audio.playCannons(world, 1)
    const xs = (playPool.mock.calls.map((c) => c[2]) as number[]).sort((a, b) => a - b)
    expect(xs).toEqual(Array.from({ length: GROUND_SHOT_QUEUE }, (_, i) => i + 1))
  })

  it('1024 個記錄槽滿時，記得住的砲照樣出聲，地面砲也照樣播；超出的那一門不出聲', () => {
    const { audio, world, playPool } = setup()
    const p = ship(100)
    p.guns = Array.from({ length: 1025 }, (_, i) => ({
      ...p.guns[0]!, zone: { ...p.guns[0]!.zone, position: new Vector3(i === 1024 ? -99 : 0, 0, 0) },
    }))
    world.ships.push(p)
    audio.noteGroundShot('tank', 30, 0, 0, 0)
    audio.playCannons(world, 1)
    const xs = playPool.mock.calls.map(call => call[2] as number)
    expect(xs).toHaveLength(1025)
    expect(xs.slice(0, 1024).every((x) => x === 100)).toBe(true)
    expect(xs[1024]).toBe(30)
  })

  it('重設清除閃光、限頻與待播事件，且不同實例互不影響', () => {
    const { audio, world, playPool } = setup()
    const other = setup()
    world.ships.push(ship(10))
    audio.playCannons(world, 10)
    audio.noteGroundShot('tank', 20, 0, 0, 0)
    other.audio.noteGroundShot('tank', 30, 0, 0, 0)
    audio.reset()
    audio.reset()
    audio.playCannons(world, 0)
    other.audio.playCannons(other.world, 0)
    expect(playPool.mock.calls.map(call => call[2])).toEqual([10, 10])
    expect(other.playPool.mock.calls.map(call => call[2])).toEqual([30])
  })
})
