import { describe, expect, it } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { BEAM_LENGTH, createSearchlights, sweepAngles } from '../../src/render/searchlights'
import { createGroundTarget } from '../../src/world/groundTargets'

describe('探照燈的掃描', () => {
  it('仰角在 35° 到 75° 之間、方位會繞一整圈', () => {
    const a = { yaw: 0, pitch: 0 }
    let lo = Infinity
    let hi = -Infinity
    let yawMin = Infinity
    let yawMax = -Infinity
    for (let t = 0; t < 200; t += 0.25) {
      sweepAngles(1.2, t, a)
      lo = Math.min(lo, a.pitch)
      hi = Math.max(hi, a.pitch)
      yawMin = Math.min(yawMin, a.yaw)
      yawMax = Math.max(yawMax, a.yaw)
    }
    expect(lo).toBeGreaterThanOrEqual(35 * Math.PI / 180 - 1e-6)
    expect(hi).toBeLessThanOrEqual(75 * Math.PI / 180 + 1e-6)
    expect(yawMax - yawMin).toBeGreaterThan(Math.PI * 2 - 0.1)
  })

  it('不同相位在同一刻指向不同方向', () => {
    const a = { yaw: 0, pitch: 0 }
    const b = { yaw: 0, pitch: 0 }
    sweepAngles(0, 10, a)
    sweepAngles(2.5, 10, b)
    expect(Math.abs(a.yaw - b.yaw)).toBeGreaterThan(0.1)
  })
})

describe('探照燈的光束', () => {
  const targets = [
    createGroundTarget(0, 'searchlight', 'red', 0, -7000, 0),
    createGroundTarget(1, 'truck', 'red', 50, -7000, 0),
    createGroundTarget(2, 'searchlight', 'red', 100, -7000, 0),
  ]

  it('只對探照燈建光束，死了就藏、復活就回來', () => {
    const s = createSearchlights(targets)
    const beams: Mesh[] = []
    s.object.traverse((o) => { if ((o as Mesh).isMesh) beams.push(o as Mesh) })
    expect(beams).toHaveLength(2)
    s.update(0)
    expect(beams.every((m) => m.visible)).toBe(true)
    targets[0]!.alive = false
    s.update(1)
    expect(beams[0]!.visible).toBe(false)
    expect(beams[1]!.visible).toBe(true)
    targets[0]!.alive = true
    s.update(2)
    expect(beams[0]!.visible).toBe(true)
  })

  it('光束長 BEAM_LENGTH、跟著座走、姿態真的套到網格上', () => {
    const s = createSearchlights(targets)
    s.update(10)
    const m = s.object.children[0] as Mesh
    m.geometry.computeBoundingBox()
    const bb = m.geometry.boundingBox!
    expect(bb.max.y - bb.min.y).toBeCloseTo(BEAM_LENGTH, 3)
    expect(m.position.x).toBe(0)
    expect(m.position.z).toBe(-7000)
    // 【不只算角度，還要套上去】光束永遠直立的實作在上面兩條都是綠的
    const a = { yaw: 0, pitch: 0 }
    sweepAngles(0, 10, a)
    const dir = new Vector3(0, 1, 0).applyQuaternion(m.quaternion)
    expect(Math.asin(dir.y)).toBeCloseTo(a.pitch, 6)
  })
})
