import { describe, it, expect } from 'vitest'
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import {
  createSpray, emitSpray,
  DEBRIS_SPRAY_COUNT, SPRAY_CONE, SPRAY_LIFE, SPRAY_SIZE, WATER_COLOR,
  WRECK_SPRAY_COUNT,
} from '../../src/render/spray'
import { createImpacts, pushImpact } from '../../src/world/events'

function positionOf(mesh: InstancedMesh, i: number): Vector3 {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const p = new Vector3()
  m.decompose(p, new Quaternion(), new Vector3())
  return p
}

function scaleOf(mesh: InstancedMesh, i: number): number {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const s = new Vector3()
  m.decompose(new Vector3(), new Quaternion(), s)
  return s.x
}

describe('emitSpray', () => {
  it('一筆事件生 count 顆', () => {
    const s = createSpray(WATER_COLOR, 128)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSpray(s, e, WRECK_SPRAY_COUNT)
    s.step(0.01)
    expect(s.live).toBe(WRECK_SPRAY_COUNT)
    s.dispose()
  })

  it('零件用比較小的數量 —— 同一個池子，兩種規模', () => {
    expect(DEBRIS_SPRAY_COUNT).toBeLessThan(WRECK_SPRAY_COUNT)
    const s = createSpray(WATER_COLOR, 128)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSpray(s, e, DEBRIS_SPRAY_COUNT)
    s.step(0.01)
    expect(s.live).toBe(DEBRIS_SPRAY_COUNT)
    s.dispose()
  })

  it('往上噴 —— 錐軸是世界 +Y，不是事件裡的法線', () => {
    // 【為什麼不用法線】水面的法線幾乎恆為向上（Gerstner 波的坡度很小），
    // 而向上正是水花該去的方向。命中飛機的火花才需要真正的表面法線，因為
    // 機身的朝向什麼都可能（M8 spec §9.2）。
    // 這裡故意餵一個朝下的法線，噴濺仍然必須往上。
    const s = createSpray(WATER_COLOR, 128)
    const e = createImpacts(8)
    pushImpact(e, 0, 100, 0, 0, -1, 0)
    emitSpray(s, e, WRECK_SPRAY_COUNT)
    s.step(0.05)
    let above = 0
    for (let i = 0; i < WRECK_SPRAY_COUNT; i++) {
      if (positionOf(s.object, i).y > 100) above++
    }
    expect(above).toBe(WRECK_SPRAY_COUNT)
    s.dispose()
  })

  it('是四散的 —— 不是一柱往上', () => {
    const s = createSpray(WATER_COLOR, 128)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSpray(s, e, WRECK_SPRAY_COUNT)
    s.step(0.1)
    let maxR = 0
    for (let i = 0; i < WRECK_SPRAY_COUNT; i++) {
      const p = positionOf(s.object, i)
      maxR = Math.max(maxR, Math.hypot(p.x, p.z))
    }
    // 半角 55°、25 m/s、0.1 s → 橫向最多約 2 m
    expect(maxR).toBeGreaterThan(0.8)
    expect(SPRAY_CONE).toBeGreaterThan(0.5)
    s.dispose()
  })

  it('受重力 —— 噴上去會落回來', () => {
    const s = createSpray(WATER_COLOR, 128)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSpray(s, e, 1)
    let peak = -Infinity
    let last = 0
    for (let i = 0; i < 36; i++) {
      s.step(SPRAY_LIFE / 36)
      const y = positionOf(s.object, 0).y
      if (y > peak) peak = y
      last = y
    }
    expect(peak).toBeGreaterThan(0)
    expect(last).toBeLessThan(peak)
    s.dispose()
  })

  it('尺寸固定不膨脹 —— 水滴不是煙', () => {
    const s = createSpray(WATER_COLOR, 128)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSpray(s, e, 1)
    s.step(0.05)
    const early = scaleOf(s.object, 0)
    s.step(0.3)
    expect(scaleOf(s.object, 0)).toBeCloseTo(early, 6)
    expect(early).toBeCloseTo(SPRAY_SIZE, 6)
    s.dispose()
  })

  it('顏色是參數 —— 之後接地面只要換一個池子', () => {
    // 【為什麼】M8 spec §9.4：地面之後會用土色噴射。顏色寫死的話那時要動
    // 這個模組；當成參數的話只要多建一個實例。
    const water = createSpray(WATER_COLOR, 16)
    const dirt = createSpray(0x8a6a44, 16)
    expect(water.object).not.toBe(dirt.object)
    water.dispose()
    dirt.dispose()
  })

  it('壽命結束就死光', () => {
    const s = createSpray(WATER_COLOR, 128)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSpray(s, e, WRECK_SPRAY_COUNT)
    s.step(SPRAY_LIFE + 0.01)
    expect(s.live).toBe(0)
    s.dispose()
  })
})
