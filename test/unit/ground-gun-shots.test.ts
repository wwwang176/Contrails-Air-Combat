import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { InstancedMesh, Matrix4, MeshBasicMaterial, Vector3, type Mesh } from 'three'
import { FLASH_SECONDS } from '../../src/weapons/muzzleFlash'
import { createMuzzles } from '../../src/render/muzzle'
import { preloadGroundModels } from '../../src/render/geometry/ground'
import { createGroundModels } from '../../src/render/groundTargets'
import { createGroundTarget } from '../../src/world/groundTargets'
import { createGroundBattery, GROUND_MG_SPEC } from '../../src/world/shipGuns'
import { SHERMAN_ROOF_GUN } from '../../src/render/geometry/ground/roofGun'
import { createGroundBattle } from '../../src/render/groundBattle'

const camera = new Vector3()
beforeAll(async () => {
  await preloadGroundModels(async url => {
    const b = readFileSync(`public${url}`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  })
})
afterEach(() => vi.restoreAllMocks())

function setup(id: 'usFlakHeavy' | 'flakHeavy' | 'flakLight' | 'usFlakTrack' = 'usFlakHeavy') {
  const target = createGroundTarget(0, id, 'red', 100, 200, 0)
  target.position.y = 10
  target.guns = createGroundBattery()
  const emit = vi.fn()
  const models = createGroundModels([target], undefined, emit)
  return { target, emit, models, gun: target.guns[0]! }
}

describe('地面砲口開火事件', () => {
  it.each(['atGun', 'tank', 'tankDug', 'panzer4', 'tiger', 'usTank'] as const)('%s 的劇本砲火與音效使用實際模型砲口，跟隨車身轉向', id => {
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
        expect.closeTo(100, 4), expect.closeTo(11.7, 4), expect.closeTo(195.845, 4),
      ])
      target.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
      gun.aim.set(0, 1, -1).normalize()
      gun.shots++
      models.update([target], camera, 1 / 60)
      const call = emit.mock.calls[1]!
      expect(call[0]).toBeCloseTo(100 + 0.15 - 4.305 / Math.sqrt(2), 4)
      expect(call[1]).toBeCloseTo(11.7 + 4.305 / Math.sqrt(2), 4)
      expect(call[2]).toBeCloseTo(200, 4)
      expect(call[3]).toBeCloseTo(-1 / Math.sqrt(2), 4)
      expect(call[4]).toBeCloseTo(1 / Math.sqrt(2), 4)
      expect(call[5]).toBeCloseTo(0, 4)
    } finally { models.dispose() }
  })

  it.each(['usFlakHeavy', 'flakHeavy'] as const)('%s 短閃光已過仍按發數通報；暫停、停火不重複，擊毀與隱藏時不通報', id => {
    const { target, emit, models, gun } = setup(id)
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

  it.each(['flakHeavy'] as const)('%s 在模型管口開火、尺度正確並跟隨仰角', id => {
    const { target, emit, models, gun } = setup(id)
    try {
      gun.aim.set(0, 0, -1)
      gun.shots = 4
      models.update([target], camera, 1 / 60)
      const calls = emit.mock.calls.slice()
      expect(calls).toHaveLength(4)
      for (const call of calls) {
        expect(call[2]).toBeLessThan(199)
        expect(call[1]).toBeGreaterThan(10)
        expect(call.slice(3)).toEqual([0, 0, -1, 1])
      }
      target.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
      gun.aim.set(0, 1, -1).normalize()
      gun.shots++
      models.update([target], camera, 1 / 60)
      const last = emit.mock.calls.at(-1)!
      expect(last[0]).toBeLessThan(100)
      expect(last[1]).toBeGreaterThan(calls[0]![1])
      expect(last[3]).toBeCloseTo(-Math.SQRT1_2, 4)
      expect(last[4]).toBeCloseTo(Math.SQRT1_2, 4)
      expect(last[5]).toBeCloseTo(0, 4)
    } finally { models.dispose() }
  })

  it.each(['flakLight', 'usFlakTrack'] as const)('%s 沿用戰鬥機槍焰、輪替四管，跟隨移動且不觸發砲口火球', id => {
    const { target, emit, models, gun } = setup(id)
    const fighter = createMuzzles(1)
    const object = models.object.getObjectByName('groundModels.muzzles') as InstancedMesh
    const matrix = new Matrix4(), point = new Vector3()
    const points: Vector3[] = []
    try {
      expect(object).toBeInstanceOf(InstancedMesh)
      expect(object.geometry.getAttribute('position').array).toEqual(fighter.object.geometry.getAttribute('position').array)
      const fighterMaterial = fighter.object.material as MeshBasicMaterial
      expect(object.material).toMatchObject({ blending: fighterMaterial.blending, opacity: fighterMaterial.opacity })
      expect(object.count).toBe(0)
      gun.aim.set(0, 0, -1)
      for (let i = 0; i < 5; i++) {
        gun.shots++
        gun.flash = 0 // 物理閃光已過，低幀率仍至少呈現一幀。
        models.update([target], camera, 1 / 30)
        expect(object.count).toBe(1)
        object.getMatrixAt(0, matrix)
        points.push(new Vector3().setFromMatrixPosition(matrix))
      }
      expect(new Set(points.slice(0, 4).map(p => p.toArray().join(','))).size).toBe(4)
      expect(new Set(points.slice(0, 4).map(p => Math.sign(p.x - 100))).size).toBe(2)
      expect(new Set(points.slice(0, 4).map(p => p.y.toFixed(4))).size).toBe(2)
      expect(points[4]!.distanceTo(points[0]!)).toBeLessThan(1e-5)
      expect(points.every(p => p.y > 10)).toBe(true)
      models.muzzle(0, point, new Vector3())
      for (const p of points) expect(p.z).toBeCloseTo(point.z, 4)
      target.position.x += 10
      models.update([target], camera, 0)
      object.getMatrixAt(0, matrix)
      expect(point.setFromMatrixPosition(matrix).x).toBeCloseTo(points[4]!.x + 10, 4)
      models.update([target], camera, FLASH_SECONDS + 0.001)
      expect(object.count).toBe(0)
      gun.shots++
      models.update([target], camera, 1 / 60)
      expect(object.count).toBe(1)
      target.dormant = true
      models.update([target], camera, 0)
      expect(object.count).toBe(0)
      target.dormant = false
      models.resetTurrets()
      gun.shots = 1
      models.update([target], camera, 0)
      expect(object.count).toBe(0)
      models.update([target], camera, 1 / 60)
      expect(object.count).toBe(1)
      target.alive = false
      models.update([target], camera, 0)
      expect(object.count).toBe(0)
      expect(emit).not.toHaveBeenCalled()
    } finally { fighter.dispose(); models.dispose() }
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
    const targets = (['usTank', 'usFlakTrack', 'atGun'] as const).map((id, i) =>
      createGroundTarget(i, id, 'red', 0, 0, 0))
    for (const target of targets) target.guns = createGroundBattery()
    const models = createGroundModels(targets, undefined, emit)
    for (const target of targets) target.guns[0]!.shots++
    models.update(targets, camera, 1 / 60)
    expect(emit).not.toHaveBeenCalled()
    models.dispose()
  })

  it('雪曼車頂 .50 的槍焰跟隨獨立槍管，主砲不跟著對空射向抬頭', () => {
    const target = createGroundTarget(0, 'usTank', 'red', 100, 200, 0)
    target.position.y = 10
    target.guns = createGroundBattery(GROUND_MG_SPEC, 'mg', 12.7, 'roof50')
    const gun = target.guns[0]!
    const emit = vi.fn()
    const models = createGroundModels([target], undefined, emit)
    const flash = models.object.getObjectByName('groundModels.muzzles') as InstancedMesh
    const roof = models.object.getObjectByName('groundModels.roofGun') as Mesh
    const liveMaterial = roof.material
    const matrix = new Matrix4(), position = new Vector3(), direction = new Vector3()
    try {
      gun.aim.set(0.6, 0.8, 0)
      gun.shots = 1
      models.update([target], camera, 1 / 60)
      expect(flash.count).toBe(1)
      flash.getMatrixAt(0, matrix)
      const expected = new Vector3(SHERMAN_ROOF_GUN.x, SHERMAN_ROOF_GUN.y, SHERMAN_ROOF_GUN.z)
        .addScaledVector(gun.aim, 0.85).add(target.position)
      expect(position.setFromMatrixPosition(matrix).distanceTo(expected)).toBeLessThan(1e-4)
      expect(direction.set(0, 0, 1).transformDirection(matrix).distanceTo(gun.aim)).toBeLessThan(1e-5)
      expect(models.muzzle(0, position, direction)).toBe(true)
      expect(direction.distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-5)
      const before = new Vector3().setFromMatrixPosition(matrix).sub(target.position)
      target.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
      target.position.x += 5
      models.update([target], camera, 0)
      flash.getMatrixAt(0, matrix)
      expect(position.setFromMatrixPosition(matrix).distanceTo(before.applyQuaternion(target.orientation).add(target.position))).toBeLessThan(1e-4)
      expect(emit).not.toHaveBeenCalled()
      target.alive = false
      models.update([target], camera, 0)
      expect(flash.count).toBe(0)
      expect(roof.material).not.toBe(liveMaterial)
      models.resetTurrets()
      expect(flash.count).toBe(0)
      expect(roof.quaternion.w).toBe(1)
    } finally { models.dispose() }
  })
})
