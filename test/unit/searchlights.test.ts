import { describe, expect, it } from 'vitest'
import { Mesh, Sprite, SpriteMaterial, Texture, Vector3 } from 'three'
import {
  aimAngles, BEAM_LENGTH, createSearchlights, glareStrength, SEARCHLIGHT_RANGE, type SearchTarget,
} from '../../src/render/searchlights'
import { createGroundTarget } from '../../src/world/groundTargets'
import { GROUND_FLAK_SPEC } from '../../src/world/shipGuns'

/** 鏡頭放在遠離任何光束的地方，只有眩光的測試會挪它 */
const CAM = new Vector3(20000, 5000, 20000)

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
    const s = createSearchlights([base], new Texture())
    const m = s.object.children[0] as Mesh
    s.update(0, [plane('blue', 0, 1500, -7000 + SEARCHLIGHT_RANGE + 500)], CAM)
    expect(m.visible).toBe(false)
    // 一架在 3 km 外、1,500 m 高，紅方的飛機不算
    const list = [plane('red', 100, 1500, -6000), plane('blue', 0, 1500, -4000)]
    for (let t = 0; t < 10; t += 1 / 60) s.update(t, list, CAM)
    expect(m.visible).toBe(true)
    const dir = beamDir(m)
    const want = new Vector3(0, 1500 - 2, 3000).normalize()
    expect(dir.dot(want)).toBeGreaterThan(0.999)
  })

  it('轉動有速率上限：第一幀還沒轉到位', () => {
    const base = createGroundTarget(0, 'searchlight', 'red', 0, -7000, 0)
    const s = createSearchlights([base], new Texture())
    const m = s.object.children[0] as Mesh
    const list = [plane('blue', 3000, 500, -7000)]
    s.update(0, list, CAM)
    s.update(1 / 60, list, CAM)
    const want = new Vector3(3000, 500 - 2, 0).normalize()
    expect(beamDir(m).dot(want)).toBeLessThan(0.99)
  })

  it('只對探照燈建光束；座被炸掉就不亮', () => {
    const targets = [
      createGroundTarget(0, 'searchlight', 'red', 0, -7000, 0),
      createGroundTarget(1, 'truck', 'red', 50, -7000, 0),
      createGroundTarget(2, 'searchlight', 'red', 100, -7000, 0),
    ]
    const s = createSearchlights(targets, new Texture())
    const beams: Mesh[] = []
    s.object.traverse((o) => { if ((o as Mesh).isMesh) beams.push(o as Mesh) })
    expect(beams).toHaveLength(2)
    const list = [plane('blue', 0, 1500, -5000)]
    s.update(0, list, CAM)
    expect(beams.every((b) => b.visible)).toBe(true)
    targets[0]!.alive = false
    s.update(1, list, CAM)
    expect(beams[0]!.visible).toBe(false)
    expect(beams[1]!.visible).toBe(true)
  })

  it('光束長 BEAM_LENGTH、跟著座走、尾端的頂點色淡到 0', () => {
    const base = createGroundTarget(0, 'searchlight', 'red', 300, -7000, 0)
    const s = createSearchlights([base], new Texture())
    const m = s.object.children[0] as Mesh
    s.update(0, [plane('blue', 300, 1500, -6000)], CAM)
    m.geometry.computeBoundingBox()
    const bb = m.geometry.boundingBox!
    expect(bb.max.y - bb.min.y).toBeCloseTo(BEAM_LENGTH, 3)
    expect(m.position.x).toBe(300)
    expect(m.position.z).toBe(-7000)
    const pos = m.geometry.getAttribute('position')
    const col = m.geometry.getAttribute('color')
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      if (y < 1) expect(col.getX(i)).toBeCloseTo(1, 6)
      if (y > BEAM_LENGTH - 1) expect(col.getX(i)).toBeCloseTo(0, 6)
    }
  })

  it('鎖定之後微晃：方向隨時間變，但一直在飛機的一度之內', () => {
    const base = createGroundTarget(0, 'searchlight', 'red', 0, -7000, 0)
    const s = createSearchlights([base], new Texture())
    const m = s.object.children[0] as Mesh
    const list = [plane('blue', 0, 1500, -4000)]
    for (let t = 0; t < 10; t += 1 / 60) s.update(t, list, CAM)
    const want = new Vector3(0, 1500 - 2, 3000).normalize()
    let minDot = 1
    const seen = new Set<string>()
    for (let t = 10; t < 20; t += 1 / 60) {
      s.update(t, list, CAM)
      const d = beamDir(m)
      minDot = Math.min(minDot, d.dot(want))
      seen.add(d.x.toFixed(5) + '/' + d.y.toFixed(5))
    }
    expect(minDot).toBeGreaterThan(Math.cos(1 * Math.PI / 180))
    expect(seen.size).toBeGreaterThan(50)
  })
})

describe('探照燈的眩光', () => {
  it('夾角小於 0.6° 全亮、大於 5° 熄、中間漸變', () => {
    expect(glareStrength(1)).toBe(1)
    expect(glareStrength(Math.cos(0.5 * Math.PI / 180))).toBe(1)
    expect(glareStrength(Math.cos(6 * Math.PI / 180))).toBe(0)
    const mid = glareStrength(Math.cos(2.5 * Math.PI / 180))
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    expect(glareStrength(-1)).toBe(0)
  })

  it('光束掃到鏡頭時燈座上的十字亮起、大小隨距離放大；掃開就熄', () => {
    const base = createGroundTarget(0, 'searchlight', 'red', 0, -7000, 0)
    const s = createSearchlights([base], new Texture())
    const sprites: Sprite[] = []
    s.object.traverse((o) => { if ((o as Sprite).isSprite) sprites.push(o as Sprite) })
    expect(sprites).toHaveLength(1)
    const glare = sprites[0]!
    // 飛機在正北 3 km、1,500 m 高；鏡頭就放在飛機上 —— 光束追到它就是照著鏡頭
    const list = [plane('blue', 0, 1500, -10000)]
    const onAxis = new Vector3(0, 1500, -10000)
    for (let t = 0; t < 10; t += 1 / 60) s.update(t, list, onAxis)
    expect(glare.visible).toBe(true)
    expect((glare.material as SpriteMaterial).opacity).toBeGreaterThan(0.9)
    const dist = onAxis.distanceTo(glare.position)
    expect(glare.scale.x).toBeCloseTo(dist * 0.16, 3)
    // 鏡頭挪到光束的側面 30°：熄
    const offAxis = new Vector3(3000, 1500, -8000)
    s.update(10.1, list, offAxis)
    expect(glare.visible).toBe(false)
  })
})
