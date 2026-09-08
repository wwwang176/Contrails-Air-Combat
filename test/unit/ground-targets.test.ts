import { describe, expect, it } from 'vitest'
import { boundingRadius } from '../../src/world/hit'
import {
  GROUND_CLASSES, createGroundTarget, groundTopOf, resetGroundTarget, type GroundKind,
} from '../../src/world/groundTargets'
import { BOMB_BLAST_DAMAGE } from '../../src/weapons/bomb'

/**
 * 期望尺寸**獨立寫死**：腳印 x × z、高 y（m）。命中盒與幾何
 * （`plant-geometry.test.ts`）都對著它比 —— 命中盒若直接由幾何推導，
 * 「幾何在盒內」就是恆真的。
 */
export const EXPECTED_SIZE: Record<GroundKind, [number, number, number]> = {
  hydroTower: [8, 40, 8],
  chimney: [8, 100, 8],
  boilerHouse: [60, 18, 30],
  oilTank: [25, 12, 25],
  gasHolder: [40, 35, 40],
  coolingTower: [30, 40, 30],
}

describe('地面目標的構件表', () => {
  for (const [id, [x, y, z]] of Object.entries(EXPECTED_SIZE) as [GroundKind, [number, number, number]][]) {
    it(`${id}：命中盒的外廓就是期望尺寸、底貼 0、頂 = 高`, () => {
      const cls = GROUND_CLASSES[id]
      expect(cls.id).toBe(id)
      expect(cls.size).toEqual({ x, y, z })
      let minY = Infinity
      let maxY = -Infinity
      let maxX = 0
      let maxZ = 0
      for (const b of cls.hull) {
        minY = Math.min(minY, b.center.y - b.half.y)
        maxY = Math.max(maxY, b.center.y + b.half.y)
        maxX = Math.max(maxX, Math.abs(b.center.x) + b.half.x)
        maxZ = Math.max(maxZ, Math.abs(b.center.z) + b.half.z)
      }
      expect(minY).toBe(0)
      expect(maxY).toBeCloseTo(y, 6)
      expect(maxX * 2).toBeCloseTo(x, 6)
      expect(maxZ * 2).toBeCloseTo(z, 6)
      expect(groundTopOf(cls)).toBeCloseTo(y, 6)
    })
  }

  it('包圍球是上界', () => {
    for (const cls of Object.values(GROUND_CLASSES)) {
      expect(cls.radius, cls.id).toBeGreaterThanOrEqual(boundingRadius(cls.hull))
    }
  })

  it('血量用幾枚炸彈訂：塔、煙囪、油槽一枚；鍋爐房、氣櫃、冷卻塔兩枚', () => {
    for (const id of ['hydroTower', 'chimney', 'oilTank'] as const) {
      expect(GROUND_CLASSES[id].hp, id).toBeLessThanOrEqual(BOMB_BLAST_DAMAGE)
    }
    for (const id of ['boilerHouse', 'gasHolder', 'coolingTower'] as const) {
      expect(GROUND_CLASSES[id].hp, id).toBeGreaterThan(BOMB_BLAST_DAMAGE)
      expect(GROUND_CLASSES[id].hp, id).toBeLessThanOrEqual(2 * BOMB_BLAST_DAMAGE)
    }
  })
})

describe('createGroundTarget / resetGroundTarget', () => {
  it('位置 y = 0、朝向由 heading、impactY = 頂、value = 血量、速度 0、盒共用', () => {
    const t = createGroundTarget(3, GROUND_CLASSES.chimney, 'red', 100, -200, 0.5)
    expect(t.kind).toBe('ground')
    expect(t.index).toBe(3)
    expect(t.team).toBe('red')
    expect(t.position.x).toBe(100)
    expect(t.position.y).toBe(0)
    expect(t.position.z).toBe(-200)
    expect(t.speed).toBe(0)
    expect(t.impactY).toBeCloseTo(100, 6)
    expect(t.value).toBe(t.cls.hp)
    expect(t.hull).toBe(t.cls.hull)
    expect(t.alive).toBe(true)
    // 朝向 0.5 rad：自身 −Z 轉到世界
    const fwd = { x: 0, y: 0, z: -1 }
    const q = t.orientation
    const rx = 2 * (q.x * q.z + q.w * q.y) * fwd.z
    expect(rx).toBeCloseTo(-Math.sin(0.5), 6)
  })

  it('打死再 reset 回滿血、活著', () => {
    const t = createGroundTarget(0, GROUND_CLASSES.oilTank, 'red', 0, 0, 0)
    t.hp = 0
    t.alive = false
    resetGroundTarget(t)
    expect(t.hp).toBe(t.cls.hp)
    expect(t.alive).toBe(true)
  })
})
