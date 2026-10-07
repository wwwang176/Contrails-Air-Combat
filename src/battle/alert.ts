import type { Combatant } from '../world/combatant'
import type { Ship } from '../world/ships'
import type { Projectiles } from '../world/Projectiles'
import type { Torpedoes } from '../world/torpedo'
import type { Bombs } from '../world/bomb'

/**
 * # 警戒（倫內爾島）
 *
 * 警戒前敵方還沒發現藍方：紅方戰鬥機在艦隊上空直線巡邏不接戰，艦砲與藍方砲塔停火。
 * 下面任一成立就進入警戒，整場不解除（SPEC `2026-10-08-rennell-alert-design.md` §4）。
 */

/** 藍機高過這個就被發現，m（世界高度；海面是 0） */
export const ALERT_ALTITUDE = 500

/**
 * 藍機與紅機、紅船的三維距離小於這個就被發現，m。
 *
 * G4M 機槍（九二式 7.7 mm）的射程：初速 745 m/s × 彈丸壽命 1.2 s ≈ 894 m，取整。
 * 寫死，不從武器表算 —— 改武器不該連帶改這一關的難度。
 */
export const ALERT_RANGE = 900

/** 判斷要讀的世界。`World` 本身就滿足 */
export interface AlertWorld {
  readonly combatants: readonly Pick<Combatant, 'alive' | 'team' | 'hp' | 'aircraft'>[]
  readonly ships: readonly Pick<Ship, 'alive' | 'team' | 'hp' | 'cls' | 'position'>[]
  readonly projectiles: Pick<Projectiles, 'capacity' | 'owner' | 'team'>
  readonly torpedoes: Pick<Torpedoes, 'capacity' | 'active' | 'team'>
  readonly bombs: Pick<Bombs, 'capacity' | 'active' | 'team'>
}

/**
 * 這一刻藍方有沒有被發現。熱路徑，不配置。
 *
 * - 活著的藍機高於 `ALERT_ALTITUDE`；
 * - 活著的藍機離活著的紅機或紅船不到 `ALERT_RANGE`；
 * - 場上有藍方的子彈、魚雷或炸彈（開過火、投過雷）；
 * - 活著的紅機或紅船不是滿血（被打到了）。
 *
 * 【開火看池子不看槍口閃光】閃光只亮 0.03 s，每 0.1 s 掃一次會漏；子彈至少飛 1.2 s。
 */
export function alertTriggered(w: AlertWorld): boolean {
  const cs = w.combatants
  const r2 = ALERT_RANGE * ALERT_RANGE
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    if (!c.alive) continue
    if (c.team === 'red') {
      if (c.hp < c.aircraft.spec.hp) return true
      continue
    }
    const p = c.aircraft.state.position
    if (p.y > ALERT_ALTITUDE) return true
    for (let k = 0; k < cs.length; k++) {
      const o = cs[k]!
      if (o.alive && o.team === 'red' && o.aircraft.state.position.distanceToSquared(p) < r2) return true
    }
    for (let k = 0; k < w.ships.length; k++) {
      const s = w.ships[k]!
      if (s.alive && s.team === 'red' && s.position.distanceToSquared(p) < r2) return true
    }
  }
  for (let k = 0; k < w.ships.length; k++) {
    const s = w.ships[k]!
    if (s.alive && s.team === 'red' && s.hp < s.cls.hp) return true
  }
  const p = w.projectiles
  for (let i = 0; i < p.capacity; i++) if (p.owner[i] !== -1 && p.team[i] === 0) return true
  const t = w.torpedoes
  for (let i = 0; i < t.capacity; i++) if (t.active[i] === 1 && t.team[i] === 0) return true
  const b = w.bombs
  for (let i = 0; i < b.capacity; i++) if (b.active[i] === 1 && b.team[i] === 0) return true
  return false
}
