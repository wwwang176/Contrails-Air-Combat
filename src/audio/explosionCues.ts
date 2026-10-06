import { blastScaleOf } from '../weapons/bomb'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'
import { KILL_STRIDE, type KillEvents } from '../world/kills'
import { CUE, pushCue, type CueQueue } from './queue'

export interface ExplosionEvents {
  readonly killEvents: Pick<KillEvents, 'count' | 'data'>
  readonly groundKillEvents: Pick<ImpactEvents, 'count' | 'data'>
  readonly bombEvents: Pick<ImpactEvents, 'count' | 'data'>
  readonly torpedoEvents: Pick<ImpactEvents, 'count' | 'data'>
  readonly groundTargets: readonly { readonly unit: { readonly personnel?: boolean } }[]
}

/** 水面高度由目前戰場提供，陸地上的位置回傳 −Infinity。 */
export interface ExplosionTerrain {
  waterAt(x: number, z: number): number
}

/**
 * 物理子步的爆炸事件轉成音效佇列，依擊落、地面擊毀、炸彈、魚雷順序追加。
 * 不配置記憶體，不清除來源緩衝；畫面與其他事件消費者仍需讀取。
 */
export function queueExplosionCues(
  cues: CueQueue, world: ExplosionEvents, terrain: ExplosionTerrain, crashBlastHeight: number,
): void {
  const k = world.killEvents
  for (let e = 0; e < k.count; e++) {
    const o = e * KILL_STRIDE
    const x = k.data[o]!, y = k.data[o + 1]!, z = k.data[o + 2]!
    pushCue(cues, CUE.Explosion, x, y, z)
    const w = terrain.waterAt(x, z)
    if (w > -Infinity && y - w <= crashBlastHeight) pushCue(cues, CUE.Splash, x, w, z)
  }
  const g = world.groundKillEvents
  for (let e = 0; e < g.count; e++) {
    const o = e * IMPACT_STRIDE
    // 人員死亡不產生爆炸；炸彈擊毀的聲音由炸彈落點事件提供。
    if (world.groundTargets[g.data[o + 3]!]?.unit.personnel === true) continue
    if (g.data[o + 5]! === 0) pushCue(cues, CUE.Blast, g.data[o]!, g.data[o + 1]!, g.data[o + 2]!)
  }
  const b = world.bombEvents
  for (let e = 0; e < b.count; e++) {
    const o = e * IMPACT_STRIDE
    const x = b.data[o]!, y = b.data[o + 1]!, z = b.data[o + 2]!
    const kind = b.data[o + 3]!
    const scale = blastScaleOf(b.data[o + 4]!)
    if (kind > 0.5 && kind < 1.5) {
      pushCue(cues, CUE.Splash, x, y, z, scale)
      pushCue(cues, CUE.SplashBoom, x, y, z, scale)
    } else {
      pushCue(cues, CUE.Blast, x, y, z, scale)
    }
  }
  const t = world.torpedoEvents
  for (let e = 0; e < t.count; e++) {
    const o = e * IMPACT_STRIDE
    const x = t.data[o]!, z = t.data[o + 2]!
    const w = terrain.waterAt(x, z)
    const y = Number.isFinite(w) ? w : t.data[o + 1]!
    const scale = blastScaleOf(t.data[o + 4]!)
    pushCue(cues, CUE.Blast, x, y, z, scale)
    pushCue(cues, CUE.Splash, x, y, z, scale)
  }
}
