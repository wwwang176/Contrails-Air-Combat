import { hash01 } from '../../core/hash'
import { DUST_LIFE, DUST_LIFE_JITTER } from '../../render/blastParticles'
import { TRACK_DUST_EVERY } from '../../render/groundVehicleDust'
import type { GroundTarget } from '../../world/groundTargets'
import { propSpeedAt, propTravel } from './kit'
import type { ReelProp } from './reelTypes'

/** 煞停到這個速度以下就不再揚塵，m/s。 */
const MIN_SPEED = 1
const REPLAY_STEP = 1 / 30
const HISTORY_SECONDS = DUST_LIFE * (1 + DUST_LIFE_JITTER)

interface DustFx {
  trackDust(x: number, y: number, z: number): void
  stepTrackDust(dt: number): void
}

/** 車尾揚塵沿用戰場配方；播放、預覽跳時與剪接都由同一條時間軸推進。 */
export function createReelVehicleDust(fx: DustFx) {
  let clocks = new Float32Array(0)

  function reset(count: number): void {
    clocks = new Float32Array(count)
    // 錯開每台車的起點，避免整排車同時冒塵。
    for (let k = 0; k < count; k++) clocks[k] = hash01(k * 13 + 5) * TRACK_DUST_EVERY
  }

  function step(
    dt: number, time: number, props: readonly GroundTarget[], specs: readonly ReelProp[],
    heightAt: (x: number, z: number) => number,
  ): void {
    if (dt <= 0) return
    if (clocks.length !== props.length) reset(props.length)
    for (let k = 0; k < props.length; k++) {
      const g = props[k]!
      const spec = specs[k]!
      if (!g.alive || propSpeedAt(spec, time) < MIN_SPEED) continue
      clocks[k]! -= dt
      if (clocks[k]! > 0) continue
      clocks[k]! += TRACK_DUST_EVERY
      const sin = Math.sin(g.heading), cos = Math.cos(g.heading)
      const travel = propTravel(spec, time)
      const x = g.spawn.x - sin * travel, z = g.spawn.z - cos * travel
      const back = g.unit.realLength / 2
      fx.trackDust(x + sin * back, heightAt(x, z) + 0.5, z + cos * back)
    }
    fx.stepTrackDust(dt)
  }

  /** 共用特效清場後，只重建跳點前仍可能存活的塵尾，不重播爆炸與其他事件。 */
  function rebuild(
    time: number, props: readonly GroundTarget[], specs: readonly ReelProp[],
    heightAt: (x: number, z: number) => number,
  ): void {
    reset(props.length)
    if (!specs.some((spec) => (spec.speed ?? 0) > 0)) return
    let at = Math.max(0, time - HISTORY_SECONDS)
    while (at < time) {
      const dt = Math.min(REPLAY_STEP, time - at)
      at += dt
      step(dt, at, props, specs, heightAt)
    }
  }

  return { reset, step, rebuild }
}
