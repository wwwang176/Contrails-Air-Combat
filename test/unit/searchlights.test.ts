import { describe, expect, it } from 'vitest'
import { Mesh, Vector3 } from 'three'
import {
  aimAngles, BEAM_LENGTH, createSearchlights, SEARCHLIGHT_RANGE, type SearchTarget,
} from '../../src/render/searchlights'
import { createGroundTarget } from '../../src/world/groundTargets'
import { GROUND_FLAK_SPEC } from '../../src/world/shipGuns'

function plane(team: 'blue' | 'red', x: number, y: number, z: number, alive = true): SearchTarget {
  return { team, alive, aircraft: { state: { position: new Vector3(x, y, z) } } }
}

/** 光束此刻指向的單位向量（網格的 +Y 轉到世界） */
function beamDir(m: Mesh): Vector3 {
  return new Vector3(0, 1, 0).applyQuaternion(m.quaternion)
}

describe('aimAngles', () => {
  it('正北（−Z）是方位 0、正上是仰角 90°', () => {
    const a = { yaw: 0, pitch: 0 }
    aimAngles(0, 0, 0, 0, 0, -100, a)
    expect(a.yaw).toBeCloseTo(0, 9)
    expect(a.pitch).toBeCloseTo(0, 9)
    aimAngles(0, 0, 0, 0, 100, 0, a)
    expect(a.pitch).toBeCloseTo(Math.PI / 2, 9)
  })
})

describe('探照燈', () => {
  it('偵測距離比重砲的射程遠', () => {
    expect(SEARCHLIGHT_RANGE).toBeGreaterThan(GROUND_FLAK_SPEC.muzzleVelocity * GROUND_FLAK_SPEC.maxFuse)
  })

  it('沒有敵機在距離內就不亮；進來了才亮，而且追著它', () => {
    const base = createGroundTarget(0, 'searchlight', 'red', 0, -7000, 0)
    const s = createSearchlights([base])
    const m = s.object.children[0] as Mesh
    s.update(0, [plane('blue', 0, 1500, -7000 + SEARCHLIGHT_RANGE + 500)])
    expect(m.visible).toBe(false)
    // 一架在 3 km 外、1,500 m 高，紅方的飛機不算
    const list = [plane('red', 100, 1500, -6000), plane('blue', 0, 1500, -4000)]
    for (let t = 0; t < 10; t += 1 / 60) s.update(t, list)
    expect(m.visible).toBe(true)
    const dir = beamDir(m)
    const want = new Vector3(0, 1500 - 2, 3000).normalize()
    expect(dir.dot(want)).toBeGreaterThan(0.999)
  })

  it('轉動有速率上限：第一幀還沒轉到位', () => {
    const base = createGroundTarget(0, 'searchlight', 'red', 0, -7000, 0)
    const s = createSearchlights([base])
    const m = s.object.children[0] as Mesh
    const list = [plane('blue', 3000, 500, -7000)]
    s.update(0, list)
    s.update(1 / 60, list)
    const want = new Vector3(3000, 500 - 2, 0).normalize()
    expect(beamDir(m).dot(want)).toBeLessThan(0.99)
  })

  it('只對探照燈建光束；座被炸掉就不亮', () => {
    const targets = [
      createGroundTarget(0, 'searchlight', 'red', 0, -7000, 0),
      createGroundTarget(1, 'truck', 'red', 50, -7000, 0),
      createGroundTarget(2, 'searchlight', 'red', 100, -7000, 0),
    ]
    const s = createSearchlights(targets)
    const beams: Mesh[] = []
    s.object.traverse((o) => { if ((o as Mesh).isMesh) beams.push(o as Mesh) })
    expect(beams).toHaveLength(2)
    const list = [plane('blue', 0, 1500, -5000)]
    s.update(0, list)
    expect(beams.every((b) => b.visible)).toBe(true)
    targets[0]!.alive = false
    s.update(1, list)
    expect(beams[0]!.visible).toBe(false)
    expect(beams[1]!.visible).toBe(true)
  })

  it('光束長 BEAM_LENGTH、跟著座走', () => {
    const base = createGroundTarget(0, 'searchlight', 'red', 300, -7000, 0)
    const s = createSearchlights([base])
    const m = s.object.children[0] as Mesh
    s.update(0, [plane('blue', 300, 1500, -6000)])
    m.geometry.computeBoundingBox()
    const bb = m.geometry.boundingBox!
    expect(bb.max.y - bb.min.y).toBeCloseTo(BEAM_LENGTH, 3)
    expect(m.position.x).toBe(300)
    expect(m.position.z).toBe(-7000)
  })
})
