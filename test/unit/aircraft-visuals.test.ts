import { describe, expect, it, vi } from 'vitest'
import { Group, Quaternion, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import { World } from '../../src/world/World'
import { createAircraftVisuals } from '../../src/render/aircraftVisuals'
import {
  AIRCRAFT_LOD_DIST, AIRCRAFT_LOD_HYSTERESIS, type AircraftModel,
} from '../../src/render/geometry/buildAircraft'
import { createWrecks } from '../../src/render/wrecks'
import type { Vortex } from '../../src/render/vortex'

function model(): AircraftModel {
  return {
    group: new Group(),
    metrics: { realLength: 10, noseZ: -4 },
    eyePoint: new Vector3(0, 1, 0),
    wingTip: new Vector3(5, 1, 2),
    bombPoint: null,
    enginePoints: [new Vector3(0, 0, -3)],
    setPropSpin: vi.fn(),
    dispose: vi.fn(),
  }
}

function fixture(capacity = 4) {
  const scene = new Group()
  const models: AircraftModel[] = []
  const builders = {
    buildAircraft: vi.fn((_spec: typeof P51D, _variant?: string) => {
      const m = model()
      models.push(m)
      return m
    }),
    buildAircraftLod: vi.fn((id: string) => {
      if (id !== B17G.id) return null
      const m = model()
      models.push(m)
      return m
    }),
  }
  const visuals = createAircraftVisuals(scene, builders)
  const wrecks = createWrecks(capacity, m => {
    scene.remove(m.group)
    m.dispose()
  })
  const adopt = vi.spyOn(wrecks, 'adopt')
  const world = new World()
  const add = (spec = B17G) => world.add(
    new Aircraft(spec), { update() {} }, 'blue', new Vector3(0, 1000, 0),
  )
  const vortex = { emit: vi.fn<Vortex['emit']>() }
  const camera = new Vector3(0, 1000, 0)
  const update = (alpha = 0.5, liveries?: Readonly<Record<string, string>>) =>
    visuals.update(world.combatants, alpha, camera, 12, liveries, wrecks, vortex)
  return { scene, models, builders, visuals, wrecks, adopt, world, add, vortex, camera, update }
}

describe('飛機顯示資源的生命週期', () => {
  it('增援只建立新席位，保留原有模型與供相機、槍火讀取的姿態物件', () => {
    const f = fixture()
    const first = f.add()
    const liveries = { [B17G.id]: 'mission' }
    f.visuals.sync(f.world.combatants, liveries)
    const original = f.visuals.visuals.get(first)!
    const position = f.visuals.positions[0]
    const quaternion = f.visuals.quaternions[0]
    const second = f.add(P51D)
    f.visuals.sync(f.world.combatants, liveries)
    f.visuals.sync(f.world.combatants, liveries)
    for (let i = 0; i < 10; i++) f.update()
    expect(f.builders.buildAircraft).toHaveBeenCalledTimes(2)
    expect(f.builders.buildAircraft).toHaveBeenNthCalledWith(1, B17G, 'mission')
    expect(f.builders.buildAircraft).toHaveBeenNthCalledWith(2, P51D, undefined)
    expect(f.visuals.visuals.get(first)).toBe(original)
    expect(f.visuals.positions[0]).toBe(position)
    expect(f.visuals.quaternions[0]).toBe(quaternion)
    expect(f.visuals.positions[1]).toBe(f.visuals.visuals.get(second)!.position)
    expect(f.visuals.visuals.get(second)!.lod).toBeNull()
    expect(f.scene.children).toHaveLength(3)
    f.visuals.clear(f.wrecks)
  })

  it('內插同步寫入高低模，LOD 保留遲滯，翼尖尾跡取自畫面上的姿態', () => {
    const f = fixture()
    const c = f.add()
    c.aircraft.prevPosition.set(10, 100, 20)
    c.aircraft.state.position.set(30, 300, 40)
    c.aircraft.prevOrientation.identity()
    c.aircraft.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
    c.aircraft.diag.loadFactor = 3
    c.command.throttle = 0.8
    f.visuals.sync(f.world.combatants, undefined)
    const v = f.visuals.visuals.get(c)!
    const expectedPosition = new Vector3(20, 200, 30)
    const expectedRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    const left = new Vector3(-5, 1, 2).applyQuaternion(expectedRotation).add(expectedPosition)
    const right = new Vector3(5, 1, 2).applyQuaternion(expectedRotation).add(expectedPosition)
    const mid = AIRCRAFT_LOD_DIST + AIRCRAFT_LOD_HYSTERESIS / 2
    for (const [distance, far] of [
      [mid, false], [AIRCRAFT_LOD_DIST + AIRCRAFT_LOD_HYSTERESIS + 1, true],
      [mid, true], [AIRCRAFT_LOD_DIST - 1, false],
    ] as const) {
      f.camera.copy(expectedPosition).add(new Vector3(0, 0, distance))
      f.update()
      expect(v.far).toBe(far)
      expect(v.model.group.visible).toBe(!far)
      expect(v.lod!.group.visible).toBe(far)
      for (const m of [v.model, v.lod!]) {
        expect(m.group.position.toArray()).toEqual(expectedPosition.toArray())
        expect(m.group.quaternion.angleTo(expectedRotation)).toBeLessThan(1e-7)
      }
      expect((far ? v.lod! : v.model).setPropSpin).toHaveBeenLastCalledWith(12, true)
      const tail = f.vortex.emit.mock.lastCall!
      expect(tail.slice(0, 2)).toEqual([c.index, 3])
      for (const [i, value] of [...left.toArray(), ...right.toArray()].entries()) {
        expect(tail[i + 2]).toBeCloseTo(value, 10)
      }
    }
    f.visuals.clear(f.wrecks)
  })

  it('不進場的席位隱藏兩具模型，不留下殘骸或尾跡', () => {
    const f = fixture()
    const c = f.add()
    c.retired = true
    c.alive = false
    f.visuals.sync(f.world.combatants, undefined)
    f.update()
    const v = f.visuals.visuals.get(c)!
    expect(v.model.group.visible).toBe(false)
    expect(v.lod!.group.visible).toBe(false)
    expect(f.wrecks.live).toBe(0)
    expect(f.adopt).not.toHaveBeenCalled()
    expect(f.vortex.emit).not.toHaveBeenCalled()
    f.visuals.clear(f.wrecks)
    for (const m of f.models) expect(m.dispose).toHaveBeenCalledTimes(1)
  })

  it('擊墜時把內插後的高模交給殘骸池，此後不再覆寫它的姿態', () => {
    const f = fixture()
    const c = f.add()
    f.visuals.sync(f.world.combatants, undefined)
    const v = f.visuals.visuals.get(c)!
    const lod = v.lod!
    f.camera.set(100000, 0, 0)
    f.update()
    expect(v.far).toBe(true)
    c.aircraft.prevPosition.set(10, 2000, 30)
    c.aircraft.state.position.set(30, 4000, 50)
    c.aircraft.state.velocity.set(100, -20, 0)
    c.alive = false
    f.vortex.emit.mockClear()
    f.update()
    expect(f.adopt).toHaveBeenCalledTimes(1)
    expect(f.adopt).toHaveBeenLastCalledWith(v.model, B17G, 100, -20, 0, c.index)
    expect(v.model.group.position.toArray()).toEqual([20, 3000, 40])
    expect(v.model.group.visible).toBe(true)
    expect(v.lod).toBeNull()
    expect(lod.dispose).toHaveBeenCalledTimes(1)
    expect(lod.group.parent).toBeNull()
    f.wrecks.step(0.01, () => -10000, () => -Infinity, 0)
    const fallen = v.model.group.position.clone()
    expect(fallen.x).toBeGreaterThan(20)
    f.update()
    expect(v.model.group.position.toArray()).toEqual(fallen.toArray())
    expect(f.wrecks.live).toBe(1)
    expect(f.adopt).toHaveBeenCalledTimes(1)
    expect(f.vortex.emit).not.toHaveBeenCalled()
    f.visuals.clear(f.wrecks)
    for (const m of f.models) expect(m.dispose).toHaveBeenCalledTimes(1)
  })

  it('復活建立新模型與任務塗裝，姿態參考不變，清場各自釋放新舊模型一次', () => {
    const f = fixture()
    const c = f.add()
    f.visuals.sync(f.world.combatants, undefined)
    const v = f.visuals.visuals.get(c)!
    const old = v.model
    const position = f.visuals.positions[0]
    const quaternion = f.visuals.quaternions[0]
    c.alive = false
    f.update()
    c.alive = true
    f.update(0.5, { [B17G.id]: 'revived' })
    expect(v.model).not.toBe(old)
    expect(v.lod).not.toBeNull()
    expect(f.builders.buildAircraft).toHaveBeenLastCalledWith(B17G, 'revived')
    expect(f.visuals.positions[0]).toBe(position)
    expect(f.visuals.quaternions[0]).toBe(quaternion)
    expect(old.dispose).not.toHaveBeenCalled()
    expect(f.adopt).toHaveBeenCalledTimes(1)
    const positions = f.visuals.positions
    const quaternions = f.visuals.quaternions
    f.visuals.clear(f.wrecks)
    f.visuals.clear(f.wrecks)
    expect(f.wrecks.live).toBe(0)
    expect(f.scene.children).toHaveLength(0)
    expect(f.visuals.visuals.size).toBe(0)
    expect(positions).toHaveLength(0)
    expect(quaternions).toHaveLength(0)
    for (const m of f.models) expect(m.dispose).toHaveBeenCalledTimes(1)
    f.visuals.sync(f.world.combatants, undefined)
    expect(f.visuals.positions).toBe(positions)
    expect(f.visuals.quaternions).toBe(quaternions)
    expect(positions[0]).not.toBe(position)
    f.visuals.clear(f.wrecks)
    for (const m of f.models) expect(m.dispose).toHaveBeenCalledTimes(1)
  })

  it.each(['reset', 'recycle', 'ground'] as const)('%s 釋放過的殘骸不會在清場時再釋放', mode => {
    const f = fixture(1)
    const first = f.add()
    const second = f.add(P51D)
    f.visuals.sync(f.world.combatants, undefined)
    const deadModel = f.visuals.visuals.get(first)!.model
    first.alive = false
    f.update()
    if (mode === 'reset') f.wrecks.reset()
    if (mode === 'recycle') {
      second.alive = false
      f.update()
    }
    if (mode === 'ground') {
      f.wrecks.step(0.1, () => 10000, () => -Infinity, 0)
      f.wrecks.step(0.1, () => 10000, () => -Infinity, 0.1)
    }
    expect(deadModel.dispose).toHaveBeenCalledTimes(1)
    f.visuals.clear(f.wrecks)
    for (const m of f.models) expect(m.dispose).toHaveBeenCalledTimes(1)
    expect(f.scene.children).toHaveLength(0)
  })
})
