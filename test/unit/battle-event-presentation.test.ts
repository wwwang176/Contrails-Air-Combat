import { describe, expect, it, vi } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { createBattleEventPresentation } from '../../src/app/battleEventPresentation'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { createImpacts, pushImpact, type ImpactEvents } from '../../src/world/events'
import { pushKill } from '../../src/world/kills'
import { pushDamage } from '../../src/world/damage'
import { pushBurst } from '../../src/world/flak'
import { createDamageMarks } from '../../src/hud/damageMarks'
import { createGroundFires } from '../../src/render/groundFires'
import { createShipFires } from '../../src/render/shipFires'
import type { BlastPools } from '../../src/render/blast'

function setup() {
  const world = new World()
  const player = world.add(new Aircraft(P51D), { update() {} }, 'blue', new Vector3())
  const observed: string[] = []
  const record = (name: string) => vi.fn((events: { count: number }) => {
    observed.push(`${name}:${events.count}`)
  })
  const particle = () => ({ emit: vi.fn() })
  /** 假的土柱：記下收到幾筆，並把每一筆當成河面以下推進水柱緩衝 */
  const dirt = {
    emit: vi.fn((events: ImpactEvents, _x: number, _y: number, _z: number,
      _waterAt: (x: number, z: number) => number, river: ImpactEvents) => {
      observed.push(`dirt:${events.count}`)
      for (let i = 0; i < events.count; i++) pushImpact(river, 0, 1, 0, 0, 1, 0)
    }),
  }
  // 記錄池邊界，不建立 GPU 資源。
  const BLAST_POOLS = {
    fireball: particle(), smoke: particle(), dust: particle(), spray: particle(),
    splashEvents: createImpacts(),
  } as unknown as BlastPools
  const camera = { position: new Vector3(), quaternion: new Quaternion() }
  const damageMarks = createDamageMarks()
  const groundFires = createGroundFires()
  const audio = vi.fn((w: Pick<World, 'killEvents' | 'bombEvents' | 'damageEvents'>) => {
    observed.push(`audio:${w.killEvents.count}:${w.bombEvents.count}:${w.damageEvents.count}`)
  })
  const deps = {
    camera, damageMarks, groundFires, shipFires: createShipFires(), BLAST_POOLS,
    battleAudioCues: { queueAudioCues: audio },
    sparks: { emit: record('sparks') }, splashes: { emit: record('splashes') }, dirt,
    blastPresentation: {
      emitKillBlasts: record('kill'), emitGroundKills: record('ground'),
      emitBalloonPops: record('balloon'), emitBombBlasts: record('bomb'),
      emitTorpedoBlasts: record('torpedo'), shakeFlakBursts: record('flak'),
    },
    debris: { emit: record('debris') }, debrisColorOf: () => 0,
    spray: particle(), flakBursts: particle(),
  }
  const present = createBattleEventPresentation(deps)
  const terrain = { heightAt: () => 0, collisionHeightAt: () => 0, waterAt: () => 0 }
  return { world, player, deps, present, terrain, observed }
}

describe('物理子步的事件呈現', () => {
  it('音效、特效與火災先讀事件，消費後排空，下一個子步不重播', () => {
    const { world, player, deps, present, terrain, observed } = setup()
    pushImpact(world.hitEvents, 1, 2, 3, 0, 1, 0)
    pushImpact(world.terrainHitEvents, 4, 0, 6, 0, 1, 0)
    pushImpact(world.splashEvents, 1, 0, 3, 0, 1, 0)
    pushKill(world.killEvents, 1, 2, 3, 0, 0, 0, player.index)
    pushDamage(world.damageEvents, player.index, 1, 0, 0, 0)
    pushImpact(world.bombEvents, 10, 0, 20, 0, 100, -1)
    pushImpact(world.torpedoEvents, 30, 0, 40, 1, 100, -1)
    pushImpact(world.torpedoWakeEvents, 30, 0, 40, 0, 1, 0)
    pushBurst(world.burstEvents, 1, 2, 3, 0)
    present(world, player, terrain, 5, false)
    // 兩次 splashes：子彈入海那一份、土柱推出的河面水柱那一份
    expect(observed).toEqual([
      'audio:1:1:1', 'sparks:1', 'splashes:1', 'dirt:1', 'splashes:1', 'kill:1', 'ground:0',
      'balloon:0', 'debris:1', 'bomb:1', 'torpedo:1', 'flak:1',
    ])
    // 河面水柱的高度函數是這一次傳進來的水面，不是陸地高度
    const river = deps.dirt.emit.mock.calls[0]![5]
    expect(deps.dirt.emit.mock.calls[0]![4]).toBe(terrain.waterAt)
    expect(deps.splashes.emit).toHaveBeenCalledWith(river, terrain.waterAt, 5)
    expect(deps.groundFires.live.some(x => x !== 0)).toBe(true)
    expect(deps.spray.emit).toHaveBeenCalled()
    expect(deps.flakBursts.emit).toHaveBeenCalled()
    for (const events of [world.hitEvents, world.terrainHitEvents, river, world.splashEvents,
      world.killEvents, world.damageEvents, world.bombEvents, world.torpedoEvents,
      world.torpedoWakeEvents, world.burstEvents]) expect(events.count).toBe(0)
    const sprayCalls = deps.spray.emit.mock.calls.length
    const flakCalls = deps.flakBursts.emit.mock.calls.length
    observed.length = 0
    present(world, player, terrain, 6, false)
    expect(observed.every(x => !x.includes(':1'))).toBe(true)
    expect(deps.spray.emit).toHaveBeenCalledTimes(sprayCalls)
    expect(deps.flakBursts.emit).toHaveBeenCalledTimes(flakCalls)
  })

  /** 破片從黑雲那一團噴過來：方向是玩家指向爆點。判準與世界層扣血同一支 */
  it('敵方空爆傷到玩家：受擊紅邊亮在爆點那一側；友軍的、半徑外的不亮', () => {
    const { world, player, deps, present, terrain } = setup()
    // 玩家在原點、藍隊；鏡頭朝 −z，所以 +x 是畫面右邊。`world.add` 只記出生點
    player.aircraft.state.position.set(0, 0, 0)
    pushBurst(world.burstEvents, 10, 0, 0, 0, 30, 400)
    pushBurst(world.burstEvents, -100, 0, 0, 1, 30, 400)
    present(world, player, terrain, 1, false)
    expect(deps.damageMarks.filter(m => m.intensity > 0)).toHaveLength(0)

    pushBurst(world.burstEvents, 10, 0, 0, 1, 30, 400)
    present(world, player, terrain, 2, false)
    const lit = deps.damageMarks.filter(m => m.intensity > 0)
    expect(lit).toHaveLength(1)
    expect(lit[0]!.x).toBeCloseTo(1)
    expect(lit[0]!.y).toBeCloseTo(0)
    expect(lit[0]!.z).toBeCloseTo(0)
  })

  it('換場使用新的事件、地形與玩家，受擊提示依當前鏡頭轉換且只取玩家', () => {
    const { world: oldWorld, deps, present, terrain } = setup()
    const world = new World()
    world.add(new Aircraft(P51D), { update() {} }, 'red', new Vector3())
    const player = world.add(new Aircraft(P51D), { update() {} }, 'blue', new Vector3())
    const newTerrain = { ...terrain, heightAt: () => 42 }
    deps.camera.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    pushDamage(world.damageEvents, 0, 0, 1, 0, 0)
    pushDamage(world.damageEvents, player.index, 1, 0, 0, 0)
    pushImpact(oldWorld.hitEvents, 1, 2, 3, 0, 1, 0)
    present(world, player, newTerrain, 99, true)
    expect(deps.battleAudioCues.queueAudioCues).toHaveBeenLastCalledWith(world, player, newTerrain, true)
    expect(deps.splashes.emit).toHaveBeenCalledWith(world.splashEvents, newTerrain.heightAt, 99)
    const visible = deps.damageMarks.filter(m => m.intensity > 0)
    expect(visible).toHaveLength(1)
    expect(visible[0]!.x).toBeCloseTo(0)
    expect(visible[0]!.y).toBeCloseTo(0)
    expect(visible[0]!.z).toBeCloseTo(1)
    expect(oldWorld.hitEvents.count).toBe(1)
    expect(world.damageEvents.count).toBe(0)
  })
})
