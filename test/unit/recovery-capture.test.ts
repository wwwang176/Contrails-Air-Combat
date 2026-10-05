import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { captureGroundBuffer, captureLevel, stepGroundReleaseCapture } from '../../src/ai/recoveryCapture'

const aircraft = () => ({ state: { velocity: new Vector3(), orientation: new Quaternion() } })
const command = () => ({ aimWorld: new Vector3(3, -5, 4), firing: true, bombing: true })

describe('防墜後的水平恢復', () => {
  it('保留候選航向、停止武器投射，且不改動飛機狀態', () => {
    const self = aircraft()
    self.state.velocity.set(0, -30, -100)
    const out = command()
    const aim = out.aimWorld
    captureLevel(self, out)
    expect(out.aimWorld).toBe(aim)
    expect(out.aimWorld.toArray()).toEqual([0.6, 0, 0.8])
    expect(out.firing).toBe(false)
    expect(out.bombing).toBe(false)
    expect(self.state.velocity.toArray()).toEqual([0, -30, -100])
  })

  it('候選方向退化時依序使用速度、機首，再退回固定方向', () => {
    const self = aircraft()
    const out = command()
    out.aimWorld.set(0, -1, 0)
    self.state.velocity.set(4, -10, 3)
    captureLevel(self, out)
    expect(out.aimWorld.toArray()).toEqual([0.8, 0, 0.6])

    out.aimWorld.set(0, -1, 0)
    self.state.velocity.set(0, -10, 0)
    self.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    captureLevel(self, out)
    expect(out.aimWorld.x).toBeCloseTo(-1, 12)
    expect(out.aimWorld.y).toBe(0)
    expect(out.aimWorld.z).toBeCloseTo(0, 12)

    out.aimWorld.set(0, -1, 0)
    self.state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
    captureLevel(self, out)
    expect(out.aimWorld.toArray()).toEqual([0, 0, -1])
  })

  it('補高保留水平方位並形成六度爬升，不恢復開火或投彈', () => {
    const out = command()
    captureGroundBuffer(aircraft(), out)
    expect(out.aimWorld.length()).toBeCloseTo(1, 12)
    expect(Math.asin(out.aimWorld.y)).toBeCloseTo(Math.PI / 30, 12)
    expect(out.aimWorld.x / out.aimWorld.z).toBeCloseTo(3 / 4, 12)
    expect(out.firing).toBe(false)
    expect(out.bombing).toBe(false)
  })

  it('重讀同一筆安全回報或等待新回報，不會自行累積安全時間', () => {
    const capture = { active: true, armed: false }
    const gate = { safeSince: -1, sequence: -1 }
    for (let i = 0; i < 240; i++) {
      expect(stepGroundReleaseCapture(capture, gate, false, true, 0, 1, 1, 'safe')).toBe(true)
    }
    expect(gate.safeSince).toBe(1)
    expect(stepGroundReleaseCapture(capture, gate, false, true, 0, 2, 2, 'pending')).toBe(true)
    expect(capture.active).toBe(true)
    expect(stepGroundReleaseCapture(capture, gate, false, false, 0, 2, 2, 'pending')).toBe(false)
    expect(capture.active).toBe(false)
    expect(gate.safeSince).toBe(-1)
  })
})
