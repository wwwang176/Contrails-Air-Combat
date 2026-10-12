import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { Bombs } from '../../src/world/bomb'
import { Torpedoes } from '../../src/world/torpedo'
import { createBombs, createTorpedoes } from '../../src/render/bombs'
import { FixedStepAccumulator } from '../../src/core/loop'

const ground = () => -10000
const noop = () => {}

describe('彈藥顯示內插', () => {
  it.each(['bomb', 'torpedo'] as const)('%s：模型與標記共用位置，多個子步只留最後一步，重用及清場不拖影', kind => {
    const pool = kind === 'bomb' ? new Bombs(1) : new Torpedoes(1)
    const visual = kind === 'bomb' ? createBombs() : createTorpedoes()
    const spawn = (x: number) => pool instanceof Bombs
      ? pool.spawn(x, 100, 0, 120, -10, 0, 100, 1)
      : pool.spawn(x, 100, 0, 120, -10, 0, 100, 1, 0, 1)
    const step = () => pool instanceof Bombs
      ? pool.step(1 / 240, 0, ground, noop)
      : pool.step(1 / 240, 0, ground, ground, noop, noop, noop)
    const matrix = new Matrix4()
    const position = new Vector3()
    try {
      spawn(10)
      visual.update(pool, 0)
      expect(visual.frame.x[0]).toBe(10)
      for (let i = 0; i < 4; i++) step()
      const latest = pool.x[0]!
      for (const alpha of [0, 0.25, 0.75, 1]) {
        visual.update(pool, alpha)
        expect(visual.frame.x[0]).toBeCloseTo(latest - 0.5 * (1 - alpha), 10)
        visual.object.getMatrixAt(0, matrix)
        position.setFromMatrixPosition(matrix)
        expect(position.x).toBeCloseTo(visual.frame.x[0]!, 5)
        expect(position.y).toBeCloseTo(visual.frame.y[0]!, 5)
        const previous = pool.previous
        const direction = new Vector3(
          previous.vx[0]! + (pool.vx[0]! - previous.vx[0]!) * alpha,
          previous.vy[0]! + (pool.vy[0]! - previous.vy[0]!) * alpha,
          previous.vz[0]! + (pool.vz[0]! - previous.vz[0]!) * alpha,
        ).normalize()
        expect(new Vector3(0, -1, 0).transformDirection(matrix).distanceTo(direction)).toBeLessThan(1e-7)
        expect(visual.frame.team[0]).toBe(1)
        expect(pool.x[0]).toBe(latest)
      }
      spawn(5000)
      visual.update(pool, 0)
      expect(visual.frame.x[0]).toBe(5000)
      pool.clear()
      visual.update(pool, 0.5)
      expect(visual.frame.active[0]).toBe(0)
      visual.object.getMatrixAt(0, matrix)
      expect(new Vector3().setFromMatrixPosition(matrix).y).toBeLessThan(-100000)
      spawn(-3000)
      visual.update(pool, 0)
      expect(visual.frame.x[0]).toBe(-3000)
    } finally { visual.dispose() }
  })

  it.each([60, 144, 300])('%i FPS：等速相機與彈藥之間的水平間距保持固定', fps => {
    const pool = new Bombs(1)
    const visual = createBombs()
    const loop = new FixedStepAccumulator({ stepHz: 240, maxSubsteps: 8, maxFrameSeconds: 0.25 })
    pool.spawn(0, 1000, 0, 120, 0, 0, 100)
    let clock = 0
    try {
      for (let i = 0; i < fps; i++) {
        const dt = (i % 2 ? 1.1 : 0.9) / fps
        clock += dt
        const alpha = loop.advance(dt, step => pool.step(step, 0, ground, noop))
        visual.update(pool, alpha)
        if (clock > 1 / 240) expect(visual.frame.x[0]).toBeCloseTo(120 * (clock - 1 / 240), 8)
      }
    } finally { visual.dispose() }
  })

  it('魚雷入水後仍可內插，命中後當幀收掉模型與標記', () => {
    const pool = new Torpedoes(1)
    const visual = createTorpedoes()
    pool.spawn(0, 0.01, 0, 0, -10, -80, 100, 0, -1)
    try {
      pool.step(1 / 240, 0, () => 0, () => 0, noop, noop, noop)
      expect(pool.phase[0]).toBe(1)
      visual.update(pool, 0.5)
      expect(visual.frame.y[0]).toBeGreaterThan(pool.y[0]!)
      expect(visual.frame.y[0]).toBeLessThan(0.01)
      pool.step(1 / 240, 0, () => 0, () => 0, noop, noop, noop, () => 0.5)
      visual.update(pool, 0.5)
      expect(visual.frame.active[0]).toBe(0)
    } finally { visual.dispose() }
  })
})
