import { Quaternion, Vector3 } from 'three'
import { NO_HIT, segmentBox, segmentPointDistanceSq } from './hit'
import type { BombBlockFn } from './bomb'
import type { Ship } from './ships'
import type { GroundTarget } from './groundTargets'

export interface BombObstacleQuery {
  /** 最近命中的船或地面目標；下一次查詢會覆寫，兩者最多一個非空。 */
  readonly ship: Ship | null
  readonly ground: GroundTarget | null
  readonly block: BombBlockFn
}

const INV = new Quaternion()
const A = new Vector3()
const B = new Vector3()

/**
 * 直接讀取世界的目標陣列，新增、移動與擊毀立即生效。
 * 回呼只回傳線段參數，命中目標留給緊接著的落點事件讀取，不在查詢中配置物件。
 */
export function createBombObstacleQuery(
  ships: readonly Ship[], groundTargets: readonly GroundTarget[],
): BombObstacleQuery {
  const block: BombBlockFn = (x0, y0, z0, x1, y1, z1) => {
    result.ship = null
    result.ground = null
    if (ships.length === 0 && groundTargets.length === 0) return NO_HIT
    let best = NO_HIT
    // 沉船仍擋炸彈；砲位先於船殼判定，距離相同時保留先命中的目標。
    for (const sh of ships) {
      if (segmentPointDistanceSq(
        x0, y0, z0, x1, y1, z1, sh.position.x, sh.position.y, sh.position.z,
      ) > sh.cls.radius * sh.cls.radius) continue

      INV.copy(sh.orientation).conjugate()
      const a = A.set(x0, y0, z0).sub(sh.position).applyQuaternion(INV)
      const b = B.set(x1, y1, z1).sub(sh.position).applyQuaternion(INV)

      for (let gi = 0; gi < sh.guns.length; gi++) {
        const g = sh.guns[gi]!
        if (!g.alive) continue
        const t = segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, g.box)
        if (t === NO_HIT || (best !== NO_HIT && t >= best)) continue
        best = t
        result.ship = sh
      }
      for (const box of sh.cls.hull) {
        const t = segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, box)
        if (t === NO_HIT || (best !== NO_HIT && t >= best)) continue
        best = t
        result.ship = sh
      }
    }
    // 炸毀的地面目標不擋炸彈，與子彈的命中判定一致。
    for (let i = 0; i < groundTargets.length; i++) {
      const g = groundTargets[i]!
      if (!g.alive) continue
      if (segmentPointDistanceSq(
        x0, y0, z0, x1, y1, z1, g.position.x, g.position.y, g.position.z,
      ) > g.radius * g.radius) continue

      INV.copy(g.orientation).conjugate()
      const a = A.set(x0, y0, z0).sub(g.position).applyQuaternion(INV)
      const b = B.set(x1, y1, z1).sub(g.position).applyQuaternion(INV)
      for (const box of g.hull) {
        const t = segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, box)
        if (t === NO_HIT || (best !== NO_HIT && t >= best)) continue
        best = t
        result.ground = g
        result.ship = null
      }
    }
    return best
  }
  const result = { ship: null as Ship | null, ground: null as GroundTarget | null, block }
  return result
}
