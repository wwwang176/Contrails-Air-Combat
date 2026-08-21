import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE, type Battle, type BattleConfig } from '../src/battle/setup'
import { HEAD_ON, PURSUIT } from '../src/battle/entry'
import { P51D } from '../src/specs/p51d'
import { B17G } from '../src/specs/b17g'
import { PROJECTILE_CAPACITY, PROJECTILE_LIFETIME } from '../src/world/Projectiles'
import type { Aircraft } from '../src/aircraft/Aircraft'
import type { Command, Controller } from '../src/control/Controller'

export const LOAD_DT = 1 / 240

/** 玩家位置上放一個恆平飛的假控制器 —— 與 `bench/multi-load.ts` 同一個。 */
class Idle implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim)
    out.throttle = 0.7
    out.firing = false
  }
}

export interface TurretLoadState {
  battle: Battle
}

/**
 * 砲塔的效能負載 —— **20 架 P-51D 對 20 架 B-17G**，共 160 座砲塔。
 *
 * 【為什麼要另外一份而不是沿用 `multi-load`】那一份用 `DEFAULT_BATTLE`
 * （P-51D vs Bf 109），**兩者的 `turrets` 都是空陣列** —— 既有的 20v20
 * 門檻因此完全沒有量到砲塔那 160 座每步的成本。
 *
 * 【架數、彈丸池、控制器都與 `multi-load` 一致】唯一的差別是紅隊換成
 * B-17G。這樣「20v20 門檻」與「砲塔門檻」的差就**只有砲塔**，兩個數字直接
 * 可減 —— 兩份負載各自訂初始條件的話，那個差就沒有意義了。
 *
 * ── 為什麼要兩種 ────────────────────────────────────────
 *
 * 砲塔的成本有兩個完全不同的峰：
 *
 * ```
 *   搜尋   沒有目標時每 SEARCH_INTERVAL 秒做一次 O(架數) 的掃描。
 *          這是**開局最常見的狀態** —— 而且計畫第一版在這裡是每步全掃。
 *   追瞄   全部有目標時每步都解預瞄、轉向、生彈丸。
 * ```
 *
 * 只量其中一種會漏掉另一種。
 */
function build(entry: BattleConfig['entry']): TurretLoadState {
  const battle = createBattle(new Idle(), {
    ...DEFAULT_BATTLE, blueSpec: P51D, redSpec: B17G, entry,
  })
  const state: TurretLoadState = { battle }
  fill(state)
  return state
}

/**
 * 兩隊相距 10 km，遠超砲塔約 1.46 km 的射程上界 —— 每一座砲塔每
 * `SEARCH_INTERVAL` 秒掃一次 40 個候選，全部落空。
 */
export function createTurretSearchLoad(): TurretLoadState {
  return build(HEAD_ON)
}

/**
 * 追擊起始：紅隊在後方 400 m、高 200 m，開場就在射程內 —— 每一座砲塔每步
 * 解預瞄、轉向、生彈丸。
 */
export function createTurretTrackLoad(): TurretLoadState {
  return build(PURSUIT)
}

/**
 * 【為什麼要人工把池灌滿】與 `multi-load` 同一個理由：穩態存量隨戰況起伏，
 * 而要量的是最壞情形。也讓這兩份負載的彈丸成本與既有的 20v20 門檻完全相同。
 */
function fill(state: TurretLoadState): void {
  const p = state.battle.world.projectiles
  const cs = state.battle.world.combatants
  for (let i = 0; i < PROJECTILE_CAPACITY; i++) {
    const c = cs[i % cs.length]!
    const o = c.aircraft.state.position
    const a = (i / PROJECTILE_CAPACITY) * Math.PI * 2
    p.spawn(
      o.x + Math.cos(a) * 40, o.y + Math.sin(a) * 40, o.z - 100 - (i % 700),
      Math.cos(a) * 20, Math.sin(a) * 20, -887, 6, c.index,
    )
    // 【壽命要錯開】全部給 age 0 的話會在同一步一起到期、再被一起補滿，
    // 量到的是週期性的尖峰而不是穩態
    p.age[i] = (i / PROJECTILE_CAPACITY) * PROJECTILE_LIFETIME
  }
}

export function stepTurretLoad(state: TurretLoadState): void {
  const p = state.battle.world.projectiles
  const o = state.battle.world.combatants[0]!.aircraft.state.position
  while (p.live < PROJECTILE_CAPACITY) {
    p.spawn(o.x, o.y, o.z - 200, 0, 0, -887, 6, 0)
  }
  stepBattle(state.battle, LOAD_DT)
}

/**
 * 【重置的意義在這一份特別重要】兩隊會相互接近。不定期把它們送回出生點的
 * 話，「搜尋」那一份跑久了會變成「追瞄」，兩種負載於是量到同一件事。
 */
export function resetTurretLoad(state: TurretLoadState): void {
  state.battle.world.projectiles.clear()
  for (const c of state.battle.world.combatants) state.battle.world.respawn(c)
  fill(state)
}
