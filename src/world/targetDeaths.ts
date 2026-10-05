import { Vector3 } from 'three'
import { envelopeCenter, type Balloon } from './balloons'
import { pushImpact, type ImpactEvents } from './events'
import type { GroundTarget } from './groundTargets'
import type { Ship } from './ships'

const BALLOON_C = /* @__PURE__ */ new Vector3()

/** 船艦血量歸零時連同砲位退場；重複結算不會重送擊沉事件。 */
export function sinkIfDead(sh: Ship, killer: number, events: ImpactEvents): void {
  if (!sh.alive || sh.hp > 0) return
  sh.alive = false
  for (const g of sh.guns) g.alive = false
  pushImpact(
    events, sh.position.x, sh.position.y, sh.position.z,
    sh.index, killer, 0,
  )
}

/** 氣球退場事件使用氣囊中心，供渲染層點火、讓氣囊落下。 */
export function popIfDead(b: Balloon, killer: number, events: ImpactEvents): void {
  if (!b.alive || b.hp > 0) return
  b.alive = false
  envelopeCenter(b, BALLOON_C)
  pushImpact(events, BALLOON_C.x, BALLOON_C.y, BALLOON_C.z, b.index, killer, 0)
}

/**
 * 地面目標退場。子彈與炸彈共用；fromBlast 讓渲染層避免重複播放爆炸。
 * killer 是飛機索引，−1 表示沒有飛機擁有者。
 */
export function wreckIfDead(
  t: GroundTarget, killer: number, fromBlast: boolean, events: ImpactEvents,
): void {
  if (!t.alive || t.hp > 0) return
  t.alive = false
  pushImpact(
    events, t.position.x, t.position.y, t.position.z,
    t.index, killer, fromBlast ? 1 : 0,
  )
}
