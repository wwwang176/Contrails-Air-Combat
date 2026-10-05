import { Quaternion, Vector3 } from 'three'
import { blastRadiusOf, bombBlastDamage } from '../weapons/bomb'
import { pointBoxDistance, type HitPart } from './hit'
import type { Combatant } from './World'
import type { GroundTarget } from './groundTargets'
import type { Ship } from './ships'
import type { ImpactEvents } from './events'
import { sinkIfDead, wreckIfDead } from './targetDeaths'

export interface BombBlastWorld {
  readonly combatants: readonly Combatant[]
  readonly groundTargets: readonly GroundTarget[]
  readonly ships: readonly Ship[]
  readonly groundKillEvents: ImpactEvents
  readonly shipKillEvents: ImpactEvents
  applyDamage(victim: Combatant, damage: number, part: HitPart, shooter?: Combatant): void
}

const BLAST_P = /* @__PURE__ */ new Vector3()
const INV = /* @__PURE__ */ new Quaternion()

/**
 * 爆炸的範圍傷害。**直接命中只是距離 0 的那一個特例** —— 沒有另一套
 * 「命中傷害」，兩者走同一條衰減曲線。
 *
 * 【船量的是到艦體的距離，不是到質心】Essex 有 266 m 長。落在艦首前
 * 10 m 的那一顆離船體只有 10 m、離質心卻有 140 m —— 照質心算的話它完全
 * 不會傷到船。`pointBoxDistance` 在艦體座標裡問「離這個盒子多遠」，
 * 答案對艦首與對艦舯一樣正確。
 *
 * 【砲位也各自算】它們是獨立的盒子，離爆心近的那幾座先報銷。
 *
 * 【不分敵我】炸彈沒有敵我識別 —— 投彈的自己與僚機也炸得到。AI 戰鬥機對地
 * 投彈因此另有一條高度下限（`AiController` 的 `AI_BOMB_MIN_HEIGHT`）。
 *
 * @param owner 投放者的 combatant 索引；−1 = 沒有主人。**只影響戰果歸屬，
 *              不影響傷害** —— 炸到誰是幾何決定的
 */
export function applyBombBlast(
  world: BombBlastWorld,
  x: number, y: number, z: number, damage: number, owner: number,
): void {
  const radius = blastRadiusOf(damage)
  for (const c of world.combatants) {
    if (!c.alive) continue
    const p = c.aircraft.state.position
    const dmg = bombBlastDamage(Math.hypot(p.x - x, p.y - y, p.z - z), damage)
    // 【飛機用質心】一架 12 m 的飛機在 30 m 的半徑下，質心與機翼尖的
    // 差別小於衰減曲線本身的精度
    if (dmg <= 0) continue
    // 【只有敵機算兇手的戰果】炸彈不分敵我（見上面），而記分板不分 ——
    // 照樣傳 shooter 的話，炸到自己僚機會替投彈的人記一次擊墜
    const shooter = world.combatants[owner]
    world.applyDamage(
      c, dmg, 'fuselage',
      shooter !== undefined && shooter.team !== c.team ? shooter : undefined,
    )
  }

  // 【地面目標與船同一套】量的是到盒子的距離，不是到中心：火車 13 m 長，
  // 落在車頭前 5 m 的那一顆離車體 5 m、離中心卻有 11 m。
  for (const t of world.groundTargets) {
    if (!t.alive) continue
    const reach = t.radius + radius
    if (t.position.distanceToSquared(BLAST_P.set(x, y, z)) > reach * reach) continue
    INV.copy(t.orientation).conjugate()
    const local = BLAST_P.set(x, y, z).sub(t.position).applyQuaternion(INV)
    let near = Infinity
    for (const box of t.unit.hull) {
      const d = pointBoxDistance(local.x, local.y, local.z, box)
      if (d < near) near = d
    }
    const dmg = bombBlastDamage(near, damage)
    if (dmg > 0) {
      t.hp -= dmg
      wreckIfDead(t, owner, true, world.groundKillEvents)
    }
  }

  for (const sh of world.ships) {
    if (!sh.alive) continue
    // 【先比包圍球】半徑加上殺傷半徑之外的船一定碰不到
    const reach = sh.cls.radius + radius
    if (sh.position.distanceToSquared(BLAST_P.set(x, y, z)) > reach * reach) continue

    INV.copy(sh.orientation).conjugate()
    const local = BLAST_P.set(x, y, z).sub(sh.position).applyQuaternion(INV)

    let near = Infinity
    for (const box of sh.cls.hull) {
      const d = pointBoxDistance(local.x, local.y, local.z, box)
      if (d < near) near = d
    }
    const hullDmg = bombBlastDamage(near, damage)
    if (hullDmg > 0) sh.hp -= hullDmg

    for (const g of sh.guns) {
      if (!g.alive) continue
      const gd = bombBlastDamage(
        pointBoxDistance(local.x, local.y, local.z, g.box), damage,
      )
      if (gd <= 0) continue
      g.hp -= gd
      if (g.hp <= 0) g.alive = false
    }
    sinkIfDead(sh, owner, world.shipKillEvents)
  }
}
