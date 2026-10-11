import type { Combatant } from '../world/combatant'
import type { GroundTarget } from '../world/groundTargets'
import type { Ship } from '../world/ships'
import type { GroundUnitId } from '../specs/ground'
import type { MissionRules } from './mission'

/**
 * 這一架算不算進了判定圈。
 *
 * 【為什麼是一支函數而不是一行 `<`】它守著兩件事：半徑是**嚴格**小於，
 * 而且距離是 NaN 時一定要回 false。後者的代價很大 —— 位置壞掉時誤判成抵達
 * 的話，任務會在玩家還在半路時突然結束，而畫面上沒有任何異常。兩件事都要
 * 能單獨被殺死，而寫在 `stepBattle` 裡面就只能靠開一場仗才碰得到。
 */
export function arrivedAt(distance: number, radius: number): boolean {
  return distance < radius
}

/** 還活著的架數。 */
export function aliveCount(cs: readonly Combatant[]): number {
  let n = 0
  for (let i = 0; i < cs.length; i++) if (cs[i]!.alive) n++
  return n
}

/**
 * 這一台算不算進炸毀的池：敵方、合乎規則指定的單位。**起飛離場的仍然在池裡**
 * —— 分母是停機線原本那幾架，不因為起飛而縮水。
 *
 * **`stepMission` 的計數與 `ground` 節拍條件共用**（連同 `destroyedInPool`）——
 * 兩邊數法不同的話，目標列說還差三架時起飛的條件已經以為夠了。
 */
export function inDestroyPool(t: GroundTarget, rules: MissionRules): boolean {
  if (t.team === 'blue') return false
  if (rules.kind === 'interdict') return t.unit.id === rules.unit
  return rules.kind !== 'destroy' || rules.unit === undefined || t.unit.id === rules.unit
}

/** 防空單位。在炸毀的池裡也不算主要目標 —— 它們擋路，不是任務要炸的東西 */
const AIR_DEFENCE: ReadonlySet<GroundUnitId> = new Set<GroundUnitId>([
  'flakHeavy', 'flakLight', 'usFlakTrack', 'usFlakHeavy', 'searchlight',
])

/**
 * 這一關的**當下規則**有沒有要玩家自己去打的東西。HUD 依它決定要不要把主要目標
 * 以外的敵方淡化；沒有的關（護航、守艦隊、撤離、殲滅）照常不淡化。
 *
 * 【護航陸攻的擊沉關不算】玩家開的是護航戰鬥機，打不了船；敵艦標成「去打這個」
 * 會把新玩家引到艦隊的砲口前。
 */
export function hasAttackTargets(rules: MissionRules): boolean {
  switch (rules.kind) {
    case 'destroy': case 'interdict': case 'hunt': return true
    case 'sink': return rules.escorts !== true
    default: return false
  }
}

/**
 * 這一艘是不是**當下規則**的主要目標：玩家自己擊沉的關的敵艦。HUD 在它的標記上
 * 標距離、加括號。讀 `b.rules`，返航節拍換掉規則之後就不是了。
 */
export function isObjectiveShip(s: Ship, rules: MissionRules): boolean {
  return rules.kind === 'sink' && hasAttackTargets(rules) && s.team === 'red'
}

/**
 * 這一架是不是**當下規則**的主要目標。HUD 的目標框畫成四角括號。
 *
 * ```
 *   擊落關     指定角色的敵機（省略角色 = 每一架敵機）
 *   炸毀關     從炸毀池裡起飛的那一架 —— 它在池裡，打下來才算數（`destroyedInPool`）
 * ```
 *
 * 【逐座掃地面目標，不建索引】每幀每架一次，地面目標最多幾十座；建 Set 的話
 * 每幀要配置。
 */
export function isObjectiveAircraft(
  c: Combatant, rules: MissionRules, targets: readonly GroundTarget[],
): boolean {
  if (c.team !== 'red') return false
  if (rules.kind === 'hunt') return rules.role === undefined || c.aircraft.spec.role === rules.role
  if (rules.kind !== 'destroy') return false
  for (const t of targets) {
    if (t.departed && t.departedAs === c.index && isObjectiveGround(t, rules)) return true
  }
  return false
}

/** 這一座地面目標是不是**當下規則**的主要目標：炸毀的池裡、不是防空 */
export function isObjectiveGround(t: GroundTarget, rules: MissionRules): boolean {
  if (rules.kind !== 'destroy' && rules.kind !== 'interdict') return false
  return inDestroyPool(t, rules) && !AIR_DEFENCE.has(t.unit.id)
}

/**
 * 池裡的這一台算不算已摧毀。**每一架飛機只算一次，不管死在哪裡。**
 *
 * ```
 *   開到終點   不算 —— 它是開到了，不是被打掉
 *   劇本打掉   不算 —— 那是地面戰的戲，不是玩家的戰果
 *   還沒出現   不算 —— 藏著的縱隊出發前不在場上
 *   沒有離場   停機墊上的那一台打掉了沒有
 *   已經離場   從它起飛的那一架還活不活著（滑行、滾行、升空後被打掉都算）
 * ```
 *
 * 【離場與抵達都不能只看自己的 `alive`】兩者退場時都設成 false —— 看它的話
 * 起飛或抵達的那一刻就算成摧毀。
 */
export function destroyedInPool(t: GroundTarget, cs: readonly Combatant[]): boolean {
  if (t.arrived || t.scripted || t.dormant) return false
  if (!t.departed) return !t.alive
  return !cs[t.departedAs]!.alive
}

/**
 * 敵方地面目標裡 `unit`（省略 = 全部）已摧毀幾座。**`destroyed` 節拍條件用它** ——
 * 那一條自帶單位，不跟著這一場的規則走（返航之後規則換成撤離，池就變了）。
 */
export function countDestroyed(
  targets: readonly GroundTarget[], cs: readonly Combatant[], unit: GroundUnitId | undefined,
): number {
  let n = 0
  for (const t of targets) {
    if (t.team === 'blue') continue
    if (unit !== undefined && t.unit.id !== unit) continue
    if (destroyedInPool(t, cs)) n++
  }
  return n
}

/** 池裡開到終點退場的有幾座。`interdict` 的抵達數 */
export function countArrived(targets: readonly GroundTarget[], rules: MissionRules): number {
  let n = 0
  for (const t of targets) if (t.arrived && inDestroyPool(t, rules)) n++
  return n
}
