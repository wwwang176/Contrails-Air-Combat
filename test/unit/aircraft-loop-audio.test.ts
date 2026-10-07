import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createAircraftLoopAudio } from '../../src/audio/aircraftLoopAudio'
import { turretFile, turretGainDb } from '../../src/audio/catalog'
import { G4M } from '../../src/specs/g4m'
import { P51D } from '../../src/specs/p51d'
import { JU87 } from '../../src/specs/ju87'
import { B17G } from '../../src/specs/b17g'
import { World } from '../../src/world/World'

function setup() {
  const world = new World()
  const positions: Vector3[] = []
  const assign = vi.fn()
  const cam = new Vector3(), velocity = new Vector3()
  const loops = createAircraftLoopAudio({ assign }, cam, velocity)
  loops.reset()
  const add = (spec = P51D, x = 100) => {
    const c = world.add(new Aircraft(spec), { update() {} }, 'blue', new Vector3(50000, 1000, 0))
    positions.push(new Vector3(x, 0, 0))
    return c
  }
  return { world, positions, assign, cam, velocity, loops, add }
}

describe('飛機定位循環的聲道選擇', () => {
  it('依顯示位置選最近八架引擎、六架機槍，自機座艙不重複播放', () => {
    const { world, positions, assign, loops, add } = setup()
    const me = add(P51D, 1)
    for (let i = 0; i < 12; i++) add(P51D, 120 - i * 10).muzzleFlash.fill(0.03)
    loops.update(world.combatants, Object.freeze(positions), me, 1, true, false)
    const keys = (pool: string) => assign.mock.calls.filter(c => c[0] === pool).map(c => c[1])
    expect(keys('engine')).toEqual([12, 11, 10, 9, 8, 7, 6, 5])
    expect(keys('fire')).toEqual([12, 11, 10, 9, 8, 7])
    expect(assign.mock.calls.find(c => c[0] === 'engine')![3]).toBe(10)
  })

  it('直接讀更新後的位置與聽者速度，上帝視角包含自己的引擎', () => {
    const { world, positions, assign, loops, add, velocity } = setup()
    const me = add(P51D, 100)
    loops.update(world.combatants, positions, me, 1, false, false)
    const originalRate = assign.mock.calls[0]![6]
    positions[0]!.set(200, 0, 0)
    velocity.set(30, 0, 0)
    assign.mockClear()
    loops.update(world.combatants, positions, me, 2, false, false)
    expect(assign.mock.calls[0]!.slice(3, 6)).toEqual([200, 0, 0])
    expect(assign.mock.calls[0]![6]).toBeGreaterThan(originalRate)
  })

  it('槍聲保持 0.25 秒，重設會清掉上一場的開火狀態', () => {
    const { world, positions, assign, loops, add } = setup()
    const me = add(), other = add()
    other.muzzleFlash.fill(0.03)
    loops.update(world.combatants, positions, me, 1, true, false)
    other.muzzleFlash.fill(0)
    assign.mockClear()
    loops.update(world.combatants, positions, me, 1.24, true, false)
    expect(assign.mock.calls.some(c => c[0] === 'fire')).toBe(true)
    assign.mockClear()
    loops.update(world.combatants, positions, me, 1.25, true, false)
    expect(assign.mock.calls.some(c => c[0] === 'fire')).toBe(false)
    loops.reset()
    assign.mockClear()
    loops.update(world.combatants, positions, me, 0, true, false)
    expect(assign.mock.calls.some(c => c[0] === 'fire' || c[0] === 'turret')).toBe(false)
  })

  it('後座齊射僅排除座艙自己的砲塔，上帝視角恢復定位循環', () => {
    const { world, positions, assign, loops, add } = setup()
    const me = add(JU87)
    me.turretStates[0]!.flash = 0.03
    loops.update(world.combatants, positions, me, 1, true, true)
    expect(assign.mock.calls.some(c => c[0] === 'turret')).toBe(false)
    loops.update(world.combatants, positions, me, 1.01, false, true)
    expect(assign.mock.calls.filter(c => c[0] === 'turret')).toHaveLength(1)
  })

  it('砲塔保持期間不從較多管數切回較少管數，停火後才重新挑選', () => {
    const { world, positions, assign, loops, add } = setup()
    const me = add(), bomber = add(B17G)
    const turrets = bomber.aircraft.spec.turrets
    const single = turrets.findIndex(t => t.guns === 1)
    const twin = turrets.findIndex(t => t.guns === 2)
    expect(single).toBeGreaterThanOrEqual(0)
    expect(twin).toBeGreaterThanOrEqual(0)
    bomber.turretStates[twin]!.flash = 0.03
    loops.update(world.combatants, positions, me, 1, true, false)
    bomber.turretStates[twin]!.flash = 0
    bomber.turretStates[single]!.flash = 0.03
    assign.mockClear()
    loops.update(world.combatants, positions, me, 1.1, true, false)
    const expected = (i: number) => turretFile(turrets[i]!.weapon.id, turrets[i]!.guns)
    expect(assign.mock.calls.find(c => c[0] === 'turret')![2]).toBe(expected(twin))
    assign.mockClear()
    loops.update(world.combatants, positions, me, 1.4, true, false)
    expect(assign.mock.calls.find(c => c[0] === 'turret')![2]).toBe(expected(single))
  })

  it('砲塔帶上這個檔的音量修正', () => {
    const { world, positions, assign, loops, add } = setup()
    const me = add(), bomber = add(G4M)
    const k = bomber.aircraft.spec.turrets.findIndex(t => t.weapon.id === 'type92')
    expect(k).toBeGreaterThanOrEqual(0)
    bomber.turretStates[k]!.flash = 0.03
    loops.update(world.combatants, positions, me, 1, true, false)
    const call = assign.mock.calls.find(c => c[0] === 'turret')!
    expect(call[2]).toBe('turret-type92x1')
    expect(call[7]).toBe(turretGainDb('turret-type92x1'))
    expect(call[7]).toBe(-3)
  })

  it('只處理前 64 席，死亡及退場飛機不佔引擎聲道', () => {
    const { world, positions, assign, loops, add } = setup()
    const me = add()
    for (let i = 1; i < 66; i++) add(P51D, i < 64 ? i * 100 : 1)
    world.combatants[1]!.alive = false
    world.combatants[2]!.retired = true
    loops.update(world.combatants, positions, me, 1, true, false)
    expect(assign.mock.calls.filter(c => c[0] === 'engine').map(c => c[1])).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('最近四架可聞俯衝警笛進池，回到平飛後不沿用上一幀候選', () => {
    const { world, positions, assign, loops, add } = setup()
    const me = add()
    for (let i = 1; i <= 6; i++) {
      const c = add(JU87, i * 100)
      c.aircraft.state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 4)
      c.aircraft.diag.aero.tas = c.aircraft.spec.limits.vne
      c.aircraft.diag.air.sigma = 1
    }
    loops.update(world.combatants, positions, me, 1, true, false)
    expect(assign.mock.calls.filter(c => c[0] === 'siren').map(c => c[1])).toEqual([1, 2, 3, 4])
    for (const c of world.combatants) c.aircraft.state.orientation.identity()
    assign.mockClear()
    loops.update(world.combatants, positions, me, 2, true, false)
    expect(assign.mock.calls.some(c => c[0] === 'siren')).toBe(false)
  })
})
