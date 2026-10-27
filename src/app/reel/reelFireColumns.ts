import { createFirePuff } from '../../render/firePuff'
import { createGroundFires, lightGroundFire, stepGroundFires } from '../../render/groundFires'
import type { BlastPools } from '../../render/blast'
import type { Particles } from '../../render/particles'

export interface ReelFirePoint {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly age: number
}

/** 短片火點使用遊戲的燃燒配方；獨立煙池讓預先發展不會快轉其他爆炸或煙霧。 */
export function createReelFireColumns(pools: BlastPools, plume: Particles, capacity = 16) {
  const fires = createGroundFires(capacity)
  let warming = false
  // 預先發展只保留煙；過去的火球已熄滅，不應一次灌進共用火焰池。
  const puff = createFirePuff({
    ...pools,
    fireball: { emit(...args) { if (!warming) pools.fireball.emit(...args) } },
    glow: { emit(...args) { if (!warming) pools.glow?.emit(...args) } },
  }, plume)

  function reset(): void {
    fires.reset()
    plume.reset()
    plume.object.visible = false
  }

  function step(dt: number): void {
    if (!plume.object.visible || dt <= 0) return
    stepGroundFires(fires, dt, puff)
    plume.step(dt)
  }

  function start(points: readonly ReelFirePoint[]): void {
    if (points.length > capacity || points.some((p) =>
      ![p.x, p.y, p.z, p.age].every(Number.isFinite) || p.age < 0 || p.age > 20)) {
      throw new Error('短片火點超出容量或預先燃燒時間範圍')
    }
    reset()
    if (points.length === 0) return
    plume.object.visible = true
    const duration = Math.max(...points.map((p) => p.age))
    const pending = points.map((point) => ({ ...point, at: duration - point.age }))
      .sort((a, b) => a.at - b.at)
    let cursor = 0
    let t = 0
    warming = true
    try {
      while (true) {
        while (cursor < pending.length && pending[cursor]!.at <= t + 1e-8) {
          const p = pending[cursor++]!
          lightGroundFire(fires, p.x, p.y, p.z)
        }
        if (t >= duration) break
        const dt = Math.min(1 / 30, duration - t)
        step(dt)
        t += dt
      }
    } finally {
      warming = false
    }
  }

  reset()
  return { start, step, reset }
}
