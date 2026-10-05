import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { GROUND_UNITS } from '../../src/specs/ground'
import { P51D } from '../../src/specs/p51d'
import { createGroundTarget } from '../../src/world/groundTargets'
import { parkedOffset } from '../../src/world/groundAirframe'

// 命中判定與停放姿態必須能在沒有模型建構器的環境使用。
vi.mock('../../src/render/geometry/ground', () => { throw new Error('模擬不應載入地面模型') })
vi.mock('../../src/render/geometry/ground/parked', () => { throw new Error('模擬不應載入模型烘焙') })

describe('地面規格與模型獨立', () => {
  it('所有地面目標共用規格與命中盒，建立時不載入模型', () => {
    for (const unit of GROUND_UNITS) {
      const target = createGroundTarget(0, unit.id, 'red', 0, 0, 0)
      expect(target.unit).toBe(unit)
      expect(target.hull).toBe(unit.hull)
      expect(target.radius).toBeGreaterThan(0)
    }
  })

  it('停放位移只由機體規格計算，保留按規格物件快取的身分', () => {
    const offset = parkedOffset(P51D)
    expect(offset).toBeInstanceOf(Vector3)
    expect(offset.toArray().every(Number.isFinite)).toBe(true)
    expect(parkedOffset(P51D)).toBe(offset)
  })
})
