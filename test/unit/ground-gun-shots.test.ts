import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'
import { preloadGroundModels } from '../../src/render/geometry/ground'
import { createGroundModels } from '../../src/render/groundTargets'
import { createGroundTarget } from '../../src/world/groundTargets'
import { createGroundBattery } from '../../src/world/shipGuns'

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
