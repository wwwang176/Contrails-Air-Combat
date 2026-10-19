import type { Texture } from 'three'
import type { GroundTarget } from '../world/groundTargets'
import { createDust } from './blastParticles'
import type { Particles } from './particles'

/** 與德 M4 的車尾揚塵共用節奏、位置和粒子配方。 */
export const TRACK_DUST_EVERY = 0.35

/** 注入粒子池，地面交戰可以沿用自己的塵土池。 */
export function createVehicleDustEmission(dust: Pick<Particles, 'emit'>) {
  let clocks = new Float32Array(0)
  function update(targets: readonly GroundTarget[], dt: number): void {
    if (dt <= 0) return
    if (clocks.length !== targets.length) clocks = new Float32Array(targets.length)
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!
      if (!t.alive || t.dormant || t.arrived || t.speed <= 0) continue
      const remaining = clocks[i]! - dt
      if (remaining > 0) { clocks[i] = remaining; continue }
      clocks[i] = TRACK_DUST_EVERY
      // 車尾在車頭（−Z）的反方向。姿態含俯仰與側傾，車頭要照四元數轉出來
      const q = t.orientation
      const fx = -2 * (q.x * q.z + q.w * q.y)
      const fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
      const back = t.unit.realLength / 2
      dust.emit(t.position.x - fx * back, t.position.y + 0.5,
        t.position.z - fz * back, 0, 0.8, 0, 0.6)
    }
  }
  return { update, reset: () => { clocks.fill(0) } }
}

/** 沒有地面交戰的車隊只建立一個揚塵池，不建立砲彈、槍焰或交戰排程。 */
export function createGroundVehicleDust(texture: Texture) {
  const dust = createDust(512, 1, texture)
  dust.object.name = 'groundVehicle.dust'
  const emission = createVehicleDustEmission(dust)
  return {
    object: dust.object,
    update(targets: readonly GroundTarget[], dt: number) {
      emission.update(targets, dt)
      dust.step(dt)
    },
    dispose: () => dust.dispose(),
  }
}
