import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  createGroundTarget, groundPose, resetGroundTarget, settleGroundTargets,
} from '../../src/world/groundTargets'
import { createGroundMotion, stepGroundMotion } from '../../src/world/groundMotion'

/**
 * # 車輛隨地面俯仰、側傾
 *
 * 守的是：坡上的車身法線就是坡面的法線、人與砲位維持直立、越過三角面的折線時
 * 俯仰是漸變的、開局姿態在重開之後回來、沿路線走的車每一步都照地面擺。
 */

const SLOPE = 0.1

/** 車頭的俯仰角：車頭（−Z）轉到世界之後的仰角 */
function pitchOf(t: ReturnType<typeof createGroundTarget>): number {
  const f = new Vector3(0, 0, -1).applyQuaternion(t.orientation)
  return Math.asin(f.y)
}

function upOf(t: ReturnType<typeof createGroundTarget>): Vector3 {
  return new Vector3(0, 1, 0).applyQuaternion(t.orientation)
}

describe('車輛隨地面擺姿態', () => {
  it('往北上坡：抬頭的角度就是坡度，不側傾', () => {
    // 北是 −Z，往北越走越高
    const ground = (_x: number, z: number): number => -z * SLOPE
    const t = createGroundTarget(0, 'tank', 'red', 0, 0, 0)
    groundPose(t, 0, 0, 0, ground)
    expect(pitchOf(t)).toBeCloseTo(Math.atan(SLOPE), 6)
    const n = new Vector3(0, 1, SLOPE).normalize()
    expect(upOf(t).distanceTo(n)).toBeLessThan(1e-6)
  })

  it('橫在坡上：側傾，車身的上方就是坡面的法線', () => {
    const ground = (_x: number, z: number): number => -z * SLOPE
    const t = createGroundTarget(0, 'truck', 'red', 0, 0, Math.PI / 2)
    groundPose(t, 0, 0, Math.PI / 2, ground)
    expect(pitchOf(t)).toBeCloseTo(0, 6)
    const n = new Vector3(0, 1, SLOPE).normalize()
    expect(upOf(t).distanceTo(n)).toBeLessThan(1e-6)
  })

  it('斜著開上斜坡：車頭朝航向、上方是法線', () => {
    const ground = (x: number, z: number): number => 0.06 * x - 0.08 * z
    const heading = 0.7
    const t = createGroundTarget(0, 'panzer4', 'red', 0, 0, heading)
    groundPose(t, 0, 0, heading, ground)
    const n = new Vector3(-0.06, 1, 0.08).normalize()
    expect(upOf(t).distanceTo(n)).toBeLessThan(2e-3)
    const f = new Vector3(0, 0, -1).applyQuaternion(t.orientation)
    expect(Math.atan2(-f.x, -f.z)).toBeCloseTo(heading, 3)
  })

  it('人與砲位維持直立', () => {
    const ground = (_x: number, z: number): number => -z * SLOPE
    for (const id of ['infantry', 'flakHeavy'] as const) {
      const t = createGroundTarget(0, id, 'red', 0, 0, 0)
      groundPose(t, 0, 0, 0, ground)
      expect(upOf(t).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-9)
    }
  })

  it('越過折線：俯仰由一面的坡度漸變到另一面，至少花 10 m', () => {
    // z > 0 平地；z < 0 往北上坡。折線在 z = 0
    const ground = (_x: number, z: number): number => (z < 0 ? -z * SLOPE : 0)
    const t = createGroundTarget(0, 'tank', 'red', 0, 0, 0)
    const step = 0.25
    let prev = NaN
    let maxJump = 0
    for (let z = 20; z >= -20; z -= step) {
      groundPose(t, 0, z, 0, ground)
      const p = pitchOf(t)
      if (!Number.isNaN(prev)) maxJump = Math.max(maxJump, Math.abs(p - prev))
      prev = p
      if (z > 10) expect(p).toBeCloseTo(0, 9)
      if (z < -10) expect(p).toBeCloseTo(Math.atan(SLOPE), 9)
    }
    expect(maxJump).toBeLessThanOrEqual(Math.atan(SLOPE) * step / 10 + 1e-9)
  })

  it('落地時擺好；重開回到落地時的姿態', () => {
    const ground = (_x: number, z: number): number => -z * SLOPE
    const t = createGroundTarget(0, 'tank', 'red', 0, 0, 0)
    settleGroundTargets([t], ground)
    const settled = t.orientation.clone()
    expect(pitchOf(t)).toBeCloseTo(Math.atan(SLOPE), 6)
    t.orientation.identity()
    resetGroundTarget(t)
    expect(t.orientation.angleTo(settled)).toBeLessThan(1e-9)
  })

  it('沿路線走的車每一步照腳下的地面擺', () => {
    // 前 500 m 平地，再往北是上坡
    const ground = (_x: number, z: number): number => (z < -500 ? (-500 - z) * SLOPE : 0)
    const m = createGroundMotion([{ x: 0, z: 0 }, { x: 0, z: -2000 }], { speed: 10, turnRadius: 25, turnRate: 0.4 }, 0, 0)
    const t = createGroundTarget(0, 'truck', 'red', 0, 0, 0, m)
    stepGroundMotion(t, 10, ground)
    expect(pitchOf(t)).toBeCloseTo(0, 9)
    stepGroundMotion(t, 100, ground)
    expect(t.position.z).toBeCloseTo(-1000, 3)
    expect(pitchOf(t)).toBeCloseTo(Math.atan(SLOPE), 6)
  })
})
