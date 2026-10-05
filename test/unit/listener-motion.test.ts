import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createListenerMotion } from '../../src/audio/listenerMotion'

describe('音效聽者的速度', () => {
  it('第一幀以目前位置為基準，接著按時間平滑速度，輸出物件保持不變', () => {
    const motion = createListenerMotion()
    const output = motion.velocity
    const position = new Vector3(1000, 500, -100)
    motion.update(position, 0.02)
    expect(output.toArray()).toEqual([0, 0, 0])
    position.add(new Vector3(2, -1, 3))
    motion.update(position, 0.02)
    const alpha = 1 - Math.exp(-0.02 / 0.05)
    expect(output.x).toBeCloseTo(100 * alpha, 12)
    expect(output.y).toBeCloseTo(-50 * alpha, 12)
    expect(output.z).toBeCloseTo(150 * alpha, 12)
    expect(position.toArray()).toEqual([1002, 499, -97])
    motion.update(position, 0.02)
    expect(output.x).toBeCloseTo(100 * alpha * (1 - alpha), 12)
    expect(motion.velocity).toBe(output)
  })

  it('超過 400 m/s 的瞬移歸零，下一幀從瞬移後的位置繼續計算', () => {
    const motion = createListenerMotion()
    motion.update(new Vector3(), 0.01)
    motion.update(new Vector3(4, 0, 0), 0.01)
    expect(motion.velocity.x).toBeGreaterThan(0)
    motion.update(new Vector3(8.01, 0, 0), 0.01)
    expect(motion.velocity.toArray()).toEqual([0, 0, 0])
    motion.update(new Vector3(9.01, 0, 0), 0.01)
    expect(motion.velocity.x).toBeCloseTo(100 * (1 - Math.exp(-0.2)), 12)
  })

  it.each([0, -0.01])('dt = %s 時重新定位，之後不把停頓期間的位移當速度', dt => {
    const motion = createListenerMotion()
    motion.update(new Vector3(), 0.01)
    motion.update(new Vector3(1, 0, 0), 0.01)
    motion.update(new Vector3(100, 0, 0), dt)
    expect(motion.velocity.toArray()).toEqual([0, 0, 0])
    motion.update(new Vector3(101, 0, 0), 0.01)
    expect(motion.velocity.x).toBeCloseTo(100 * (1 - Math.exp(-0.2)), 12)
  })

  it('換場重設會立即清除速度，下一幀重新定位，且各聽者狀態獨立', () => {
    const a = createListenerMotion()
    const b = createListenerMotion()
    a.update(new Vector3(), 0.01)
    a.update(new Vector3(1, 0, 0), 0.01)
    expect(a.velocity.x).toBeGreaterThan(0)
    expect(b.velocity.toArray()).toEqual([0, 0, 0])
    a.reset()
    expect(a.velocity.toArray()).toEqual([0, 0, 0])
    a.update(new Vector3(2, 0, 0), 0.01)
    expect(a.velocity.toArray()).toEqual([0, 0, 0])
    a.update(new Vector3(3, 0, 0), 0.01)
    expect(a.velocity.x).toBeCloseTo(100 * (1 - Math.exp(-0.2)), 12)
  })
})
