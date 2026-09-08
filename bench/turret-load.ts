import { Vector3 } from 'three'
import { GOLDEN_ANGLE } from '../src/weapons/turret'
import { createBattle, stepBattle, DEFAULT_BATTLE, type Battle } from '../src/battle/setup'
import { lineAbreast } from '../src/battle/order'
import { HEAD_ON, PURSUIT, type EntryPlan } from '../src/battle/entry'
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
  /**
   * 這一份是不是「包圍」擺位。
   *
   * 【為什麼要記】`resetTurretLoad` 走 `World.respawn`，而那會把飛機送回
   * **出生點** —— 也就是把 `surround()` 的擺位整個還原成 `PURSUIT`。不記的話
   * 第一次重置之後追瞄負載就悄悄退化成 114/160，而測試照樣綠。
   */
  surrounded: boolean
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
 *          這是**開局最常見的狀態**，而全掃若改成每步跑就會落在這裡。
 *   追瞄   全部有目標時每步都解預瞄、轉向、生彈丸。
 * ```
 *
 * 只量其中一種會漏掉另一種。
 */
function build(entry: EntryPlan): TurretLoadState {
  const battle = createBattle(new Idle(), {
    ...DEFAULT_BATTLE, units: lineAbreast(entry, P51D, 20, B17G, 20),
  })
  const state: TurretLoadState = { battle, surrounded: false }
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
 * **每一座砲塔都有目標**的最壞負載 —— 每步解預瞄、轉向、生彈丸。
 *
 * 【為什麼不能只用 `PURSUIT`】那**達不到它宣稱的東西**：暖機 300 步之後
 * 只有 **114 / 160 座**取得目標，`top` 與 `tail` 是 **0 座**（追擊起始把
 * 敵機全部放在同一側，上方與正後方的錐裡一台都沒有）。門檻因此不會涵蓋
 * 合法的最壞情形。
 *
 * 【怎麼做到 160/160】把敵機擺成**包圍**：轟炸機收成一小團（半徑 80 m），
 * 戰鬥機沿費波那契球均勻鋪在半徑 500 m 的球面上。這樣每一台轟炸機的每一個
 * 射界錐裡都有敵機，而 500 m 遠在射程之內。
 *
 * 【為什麼合成擺位是合理的】與 `fill()` 把彈丸池人工灌滿同一個道理：要量的
 * 是**最壞情形**，而最壞情形在一場真的戰鬥裡不會穩定出現。合成擺位是可達的
 * 輸入（實測 160/160），不是虛構的。
 */
export function createTurretTrackLoad(): TurretLoadState {
  const state = build(PURSUIT)
  state.surrounded = true
  surround(state)
  return state
}

/** 轟炸機團的半徑，m。收得比射程小很多，讓每一台都被同一批敵機包住。 */
const BOMBER_CLUSTER = 80
/** 戰鬥機球殼的半徑，m。要遠小於射程上界（約 2.0 km）。 */
const FIGHTER_SHELL = 500

/**
 * 把場景擺成「轟炸機在中間、戰鬥機包一圈」。
 *
 * 費波那契球（黃金角螺旋）是**確定性**的均勻鋪點 —— 不用亂數，也不會像
 * 經緯度格點那樣在兩極擠成一團。
 */
function surround(state: TurretLoadState): void {
  const cs = state.battle.world.combatants
  const centre = new Vector3()
  for (const c of cs) centre.add(c.aircraft.state.position)
  centre.divideScalar(cs.length)

  const turreted = cs.filter((c) => c.aircraft.spec.turrets.length > 0)
  const others = cs.filter((c) => c.aircraft.spec.turrets.length === 0)

  // 轟炸機：收成一小團，仍然散開到不重疊
  for (let k = 0; k < turreted.length; k++) {
    const p = turreted[k]!.aircraft.state.position
    fibonacci(k, turreted.length, BOMBER_CLUSTER, p).add(centre)
  }
  // 戰鬥機：均勻鋪在球殼上，把每一個射界錐都填滿
  for (let k = 0; k < others.length; k++) {
    const p = others[k]!.aircraft.state.position
    fibonacci(k, others.length, FIGHTER_SHELL, p).add(centre)
  }
}

/** 費波那契球的第 k 點（共 n 點），半徑 r，寫進 `out`。 */
function fibonacci(k: number, n: number, r: number, out: Vector3): Vector3 {
  const y = n === 1 ? 0 : 1 - (2 * k) / (n - 1)
  const rad = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = k * GOLDEN_ANGLE
  return out.set(Math.cos(theta) * rad * r, y * r, Math.sin(theta) * rad * r)
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
      Math.cos(a) * 20, Math.sin(a) * 20, -887, 6, c.index, 0, PROJECTILE_LIFETIME, 12.7,
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
    p.spawn(o.x, o.y, o.z - 200, 0, 0, -887, 6, 0, 0, PROJECTILE_LIFETIME, 12.7)
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
  // 【重置之後要重新擺】`respawn` 把飛機送回出生點，也就是把 surround 還原
  if (state.surrounded) surround(state)
  fill(state)
}
