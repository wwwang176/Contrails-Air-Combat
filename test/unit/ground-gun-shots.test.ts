import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'
import { preloadGroundModels } from '../../src/render/geometry/ground'
import { createGroundModels } from '../../src/render/groundTargets'
import { createGroundTarget } from '../../src/world/groundTargets'
import { createGroundBattery } from '../../src/world/shipGuns'
import { createGroundBattle } from '../../src/render/groundBattle'

const camera = new Vector3()
beforeAll(async () => {
  await preloadGroundModels(async url => {
    const b = readFileSync(`public${url}`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  })
})
afterEach(() => vi.restoreAllMocks())

function setup() {
  const target = createGroundTarget(0, 'usFlakHeavy', 'red', 100, 200, 0)
  target.position.y = 10
  target.guns = createGroundBattery()
  const emit = vi.fn()
  const models = createGroundModels([target], undefined, emit)
  return { target, emit, models, gun: target.guns[0]! }
}

describe('90 mm 砲口開火事件', () => {
  it.each(['atGun', 'tank', 'tankDug', 'panzer4', 'tiger'] as const)('%s 的劇本砲火與音效使用實際模型砲口，跟隨車身轉向', id => {
    const target = createGroundTarget(0, id, 'red', 100, 200, 0)
    target.position.y = 10
    const enemy = createGroundTarget(1, 'tank', 'blue', 100, -200, 0)
    const targets = [target, enemy]
    const models = createGroundModels(targets)
    const fire = vi.fn()
    const fired = vi.fn()
    const battle = createGroundBattle({ shooters: [id, 'tank'], period: 10, range: 1000 },
      vi.fn(), undefined, vi.fn(), fired, undefined, { muzzle: models.muzzle, fire })
    const position = new Vector3(), direction = new Vector3()
    try {
      battle.update(targets, 0, 0, () => 0)
      models.update(targets, camera, 0)
      expect(models.muzzle(0, position, direction)).toBe(true)
      expect(position.z).toBeLessThan(198)
      expect(position.x).toBeCloseTo(100, 4)
      expect(position.y).toBeGreaterThan(10)
      expect(direction.distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-6)
      const initial = position.clone().sub(target.position)
      target.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
      models.update(targets, camera, 0)
      expect(models.muzzle(0, position, direction)).toBe(true)
      expect(position.clone().sub(target.position).distanceTo(initial.applyQuaternion(target.orientation))).toBeLessThan(1e-4)
      expect(direction.distanceTo(new Vector3(-1, 0, 0))).toBeLessThan(1e-6)
      battle.scriptShot(targets, 0, 1, 10, 0, () => 0)
      expect(fire).toHaveBeenCalledTimes(1)
      expect(fire).toHaveBeenCalledWith(position.x, position.y, position.z,
        direction.x, direction.y, direction.z, id === 'tiger' ? 1 : 0.85)
      expect(fired).toHaveBeenCalledWith(id, position.x, position.y, position.z, 0)
      expect(battle.shots).toBe(1)
      target.dormant = true
      models.update(targets, camera, 0)
      expect(models.muzzle(0, position, direction)).toBe(false)
      expect(models.muzzle(99, position, direction)).toBe(false)
    } finally { battle.dispose(); models.dispose() }
  })

  it('使用真實模型管口，跟著車身方位及砲管仰角，不從固定高度的砲座噴出', () => {
    const { target, emit, models, gun } = setup()
    try {
      gun.aim.set(0, 0, -1)
      gun.shots++
      models.update([target], camera, 1 / 60)
      expect(emit.mock.calls[0]!.slice(0, 3)).toEqual([
        expect.closeTo(100, 4), expect.closeTo(11.7, 4), expect.closeTo(195.85, 4),
      ])
      target.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
      gun.aim.set(0, 1, -1).normalize()
      gun.shots++
      models.update([target], camera, 1 / 60)
      const call = emit.mock.calls[1]!
      expect(call[0]).toBeCloseTo(100 + 0.15 - 4.3 / Math.sqrt(2), 4)
      expect(call[1]).toBeCloseTo(11.7 + 4.3 / Math.sqrt(2), 4)
      expect(call[2]).toBeCloseTo(200, 4)
      expect(call[3]).toBeCloseTo(-1 / Math.sqrt(2), 4)
      expect(call[4]).toBeCloseTo(1 / Math.sqrt(2), 4)
      expect(call[5]).toBeCloseTo(0, 4)
    } finally { models.dispose() }
  })

  it('短閃光已過仍按發數通報；暫停、停火不重複，擊毀與隱藏時不通報', () => {
    const { target, emit, models, gun } = setup()
    try {
      gun.flash = 0
      gun.shots = 2
      models.update([target], camera, 0)
      expect(emit).not.toHaveBeenCalled()
      models.update([target], camera, 1 / 30)
      expect(emit).toHaveBeenCalledTimes(2)
      models.update([target], camera, 1 / 30)
      expect(emit).toHaveBeenCalledTimes(2)
      target.alive = false
      gun.shots++
      models.update([target], camera, 1 / 30)
      target.alive = true
      target.dormant = true
      gun.shots++
      models.update([target], camera, 1 / 30)
      target.dormant = false
      models.update([target], camera, 1 / 30)
      expect(emit).toHaveBeenCalledTimes(2)
    } finally { models.dispose() }
  })

  it('重開清掉發數，下一場第一發照樣通報', () => {
    const { target, emit, models, gun } = setup()
    gun.shots = 1
    models.update([target], camera, 1 / 60)
    gun.shots = 0
    models.resetTurrets()
    gun.shots = 1
    models.update([target], camera, 1 / 60)
    expect(emit).toHaveBeenCalledTimes(2)
    models.update([target], camera, 4)
    expect(emit).toHaveBeenCalledTimes(2)
    models.dispose()
  })

  it('其他地面砲不觸發砲口小爆炸', () => {
    const emit = vi.fn()
    const targets = (['flakHeavy', 'flakLight', 'usFlakTrack', 'atGun'] as const).map((id, i) =>
      createGroundTarget(i, id, 'red', 0, 0, 0))
    for (const target of targets) target.guns = createGroundBattery()
    const models = createGroundModels(targets, undefined, emit)
    for (const target of targets) target.guns[0]!.shots++
    models.update(targets, camera, 1 / 60)
    expect(emit).not.toHaveBeenCalled()
    models.dispose()
  })
})
